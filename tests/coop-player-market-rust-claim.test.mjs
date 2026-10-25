import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {details,claim,finalize,release,readClaim}=require("../integration/coopPlayerMarketRustClaim.cjs");
const proof=()=>Object.freeze({
 orderID:"23",ownerID:201,counterpartyID:301,bid:false,
 stationID:60001234,typeID:34,priceCents:1234,
 volumeBefore:7,filledQuantity:3,volumeAfter:4,
 sellerSourceLocationID:9200000023
});
const ticket=()=>Object.freeze({orderID:"23",cycle:1});
const originalAck=()=>({
 order_id:"23",owner_id:201,is_corp:false,station_id:60001234,
 type_id:34,bid:false,price:12.34,filled_quantity:3,
 vol_remaining:4,state:"open",invalidated:true,release_pending:true
});
test("original player sell order maps native buyer/seller and exact cent values",()=>{
 const d=details(ticket(),proof());
 assert.equal(d.buyer_id,301);assert.equal(d.seller_id,201);
 assert.equal(d.order_id,"23");assert.equal(d.cycle,1);
 assert.equal(d.price_cents,1234);assert.equal(d.filled_quantity,3);
});
test("original player buy order reverses owner and counterparty correctly",()=>{
 const p=Object.freeze({...proof(),ownerID:301,counterpartyID:201,bid:true});
 const d=details(ticket(),p);
 assert.equal(d.buyer_id,301);assert.equal(d.seller_id,201);
});
test("ClaimPlayerFill idempotency protocol checks claim receipt identity and amount",async()=>{
 const calls=[],client={call:async(method,payload)=>{
  calls.push({method,payload});
  return {order_id:payload.order_id,cycle:payload.cycle,phase:"claimed",
   buyer_id:payload.buyer_id,seller_id:payload.seller_id,
   volume_before:payload.volume_before,filled_quantity:payload.filled_quantity,
   volume_after:4};
 }};
 const a=await claim({ticket:ticket(),proof:proof(),client});
 assert.equal(a.phase,"claimed");assert.equal(calls.length,1);
 assert.equal(calls[0].method,"ClaimPlayerFill");
 assert.equal(calls[0].payload.price_cents,1234);
});
test("forged or already finalized Rust claim cannot start native item movement",async()=>{
 for(const change of [{phase:"finalized"},{buyer_id:999},{cycle:2},
    {volume_after:3},{filled_quantity:2},{order_id:"24"}]){
  const p=proof(),t=ticket(),d=details(t,p);
  const client={call:async()=>({
   order_id:d.order_id,cycle:d.cycle,phase:"claimed",
   buyer_id:d.buyer_id,seller_id:d.seller_id,
   volume_before:d.volume_before,filled_quantity:d.filled_quantity,
   volume_after:4,...change
  })};
  await assert.rejects(claim({ticket:t,proof:p,client}),
   /P2P_RUST_CLAIM_RECEIPT_UNVERIFIED/);
 }
});
test("FinalizePlayerFill emits only exact native Rust receipt, never direct wallet credit",async()=>{
 const calls=[],client={call:async(method,payload)=>{
  calls.push({method,payload});
  return originalAck();
 }};
 const result=await finalize({ticket:ticket(),proof:proof(),client});
 assert.equal(result.state,"open");
 assert.equal(calls.length,1);
 assert.equal(calls[0].method,"FinalizePlayerFill");
 assert.deepEqual(Object.keys(calls[0].payload).sort(),
  ["buyer_id","cycle","order_id","seller_id"]);
});
test("Rust ACK with incorrect state, quantity or price fails closed",async()=>{
 for(const change of [{vol_remaining:3},{filled_quantity:1},
    {price:12.35},{state:"filled"},{invalidated:false}]){
  const client={call:async()=>({...originalAck(),...change})};
  await assert.rejects(finalize({ticket:ticket(),proof:proof(),client}),
   /RUST_FILL_ACK_NOT_MATCHED/);
 }
});
test("post-native ReleasePlayerFill requires committed durable receipt and validates order release",async()=>{
 const ticket={orderID:"23",cycle:1},p=proof(),key="p2p:23:1";
 const receipt={key,phase:"GAMESTORE_COMMITTED",orderID:"23",cycle:1,
  buyerID:301,sellerID:201,stationID:60001234,typeID:34,
  itemID:800,sourceItemID:800,quantity:3,volumeBefore:7,volumeAfter:4,
  partial:true,priceCents:1234,grossCents:3702,taxCents:100,
  buyerBeforeCents:100000,buyerAfterCents:96298,
  sellerBeforeCents:50000,sellerAfterCents:53602,committedAt:123456};
 const calls=[];
 const client={call:async(method,payload)=>{
  calls.push({method,payload});
  return {order_id:"23",cycle:1,phase:"released",state:"open",
   native_receipt_key:key,ack:originalAck()};
 }};
 const released=await release({ticket,proof:p,client,receipt});
 assert.equal(released.phase,"released");
 assert.equal(calls.length,1);
 assert.equal(calls[0].method,"ReleasePlayerFill");
 assert.equal(calls[0].payload.native_receipt_key,key);
 await assert.rejects(release({ticket,proof:p,client,receipt:{...receipt,key:"wrong"}}),
  /DURABLE_NATIVE_RECEIPT_REQUIRED/);
 assert.equal(calls.length,1);
});
test("Rust finalize must remain in settling until native receipt release",async()=>{
 const client={call:async()=>({...originalAck(),release_pending:false})};
 await assert.rejects(finalize({ticket:ticket(),proof:proof(),client}),
  /REQUIRES_LOCKED_RELEASE_PENDING/);
});
test("GetPlayerFillClaim is read-only and preserves string i64 order identity",async()=>{
 const client={call:async(method,request)=>{
  assert.equal(method,"GetPlayerFillClaim");
  assert.deepEqual(request,{order_id:"23",cycle:1});
  return {order_id:"23",phase:"claimed"};
 }};
 const result=await readClaim({ticket:ticket(),client});
 assert.equal(result.phase,"claimed");
});
test("untrusted or mismatched native tickets rejected before any Rust RPC",async()=>{
 let calls=0;const client={call:async()=>{calls++}};
 for(const t of [{orderID:"24",cycle:1},{orderID:23,cycle:1},
  {orderID:"23",cycle:0},{orderID:"23",cycle:1.5}]){
  await assert.rejects(claim({ticket:t,proof:proof(),client}),
   /NATIVE_TICKET_INVALID/);
 }
 assert.equal(calls,0);
});
 
test("Rust release adapter refuses wrong original sale station, item and paid witness without RPC",async()=>{
 const ticket={orderID:"23",cycle:1},p=proof(),key="p2p:23:1";
 const good={key,phase:"GAMESTORE_COMMITTED",orderID:"23",cycle:1,
  buyerID:301,sellerID:201,stationID:60001234,typeID:34,
  itemID:800,sourceItemID:800,quantity:3,volumeBefore:7,volumeAfter:4,
  partial:true,priceCents:1234,grossCents:3702,taxCents:100,
  buyerBeforeCents:100000,buyerAfterCents:96298,
  sellerBeforeCents:50000,sellerAfterCents:53602,committedAt:123456};
 let calls=0;
 const client={call:async()=>{calls++;return {
  order_id:"23",cycle:1,phase:"released",state:"open",
  native_receipt_key:key,ack:originalAck()
 }}};
 for(const change of [
  {stationID:60001235},{typeID:99},{itemID:undefined},
  {volumeAfter:0},{volumeBefore:6},{partial:false},
  {committedAt:0},{taxCents:3703,sellerAfterCents:49999},
  {buyerAfterCents:100000}
 ]){
  await assert.rejects(release({ticket,proof:p,client,
   receipt:{...good,...change}}),/DURABLE_NATIVE_RECEIPT_REQUIRED/);
  assert.equal(calls,0,JSON.stringify(change));
 }
 assert.equal((await release({ticket,proof:p,client,receipt:good})).phase,"released");
 assert.equal(calls,1);
});
test("funded original BUY Rust release requires matching reserve and unchanged buyer wallet",async()=>{
 const ticket={orderID:"23",cycle:1},
  p=Object.freeze({...proof(),ownerID:301,counterpartyID:201,bid:true,
   sellerSourceLocationID:60001234});
 const id="12345678-1234-4234-8234-123456789abc";
 const good={kind:"P2P_BUY_PAID",key:"p2p:23:1",phase:"GAMESTORE_COMMITTED",
  orderID:"23",cycle:1,buyerID:301,sellerID:201,
  stationID:60001234,typeID:34,itemID:800,sourceItemID:800,
  quantity:3,volumeBefore:7,volumeAfter:4,
  priceCents:1234,grossCents:3702,taxCents:100,
  buyerBeforeCents:91194,buyerAfterCents:91194,
  sellerBeforeCents:50000,sellerAfterCents:53602,
  reserveOperationID:id,reserveReceiptKey:"buy-reserve:"+id,
  reserveBeforeCents:8638,reserveAfterCents:4936,committedAt:123456};
 let calls=0;
 const client={call:async()=>{calls++;return{
  order_id:"23",cycle:1,phase:"released",state:"open",
  native_receipt_key:"p2p:23:1",ack:originalAck()
 }}};
 for(const bad of [
  {reserveReceiptKey:"wrong"},
  {reserveAfterCents:8638},
  {buyerAfterCents:91193},
  {kind:undefined},
  {sellerAfterCents:50000}
 ]){
  await assert.rejects(release({ticket,proof:p,client,
   receipt:{...good,...bad}}),/DURABLE_NATIVE_RECEIPT_REQUIRED/);
  assert.equal(calls,0);
 }
 assert.equal((await release({ticket,proof:p,client,receipt:good})).phase,"released");
 assert.equal(calls,1);
});
