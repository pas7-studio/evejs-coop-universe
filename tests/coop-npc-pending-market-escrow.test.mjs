import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createNpcPendingMarketEscrow,ESCROW_BASE}=require("../integration/coopNpcPendingMarketEscrow.cjs");
const OP="npc-manufacture:abcdef1234567890abcdef1234567890";
const X={operationID:OP,ownerID:1000010,stationID:60000001,itemID:1990000200,typeID:215,quantity:100};
function fixture({reserveFail=false,activationFails=false,escrowFault=false,
  unitPrice=12,stacksize=X.quantity}={}){
 const items=new Map([[String(X.itemID),{itemID:X.itemID,ownerID:X.ownerID,locationID:X.stationID,
   flagID:4,typeID:X.typeID,quantity:X.quantity,stacksize,singleton:0,
   customInfo:"coop-industry:v1:970000000000000"}]]);
 const escrow=new Map(),callCounts={reserve:0,activate:0,get:0},id=456,clone=x=>structuredClone(x);
 const order=(state)=>({operation_id:OP,source_item_id:String(X.itemID),order_id:String(id),
  owner_id:X.ownerID,station_id:X.stationID,type_id:X.typeID,quantity:X.quantity,
  price:Math.round(unitPrice*100)/100,
  bid:false,is_corp:true,state});
 const call=async(type,p)=>{
  if(type==="ReserveNpcSellOrder"){callCounts.reserve++;if(reserveFail)return{state:"open"};
   return order("pending");}
  if(type==="ActivateNpcSellOrder"){callCounts.activate++;if(activationFails)throw Error("RUST_ACTIVATION_ACK_LOST");
   return order("open");}
  if(type==="GetNpcSellOrder"){callCounts.get++;return order("open");}
  throw Error("UNEXPECTED_RUST_RPC");
 };
 const tx={get:(table,key)=>(table==="items"?items:escrow).get(key)??null,
  put:(table,key,value)=>{if(escrowFault&&table==="marketEscrow")throw Error("ESCROW_WRITE_FAULT");
   (table==="items"?items:escrow).set(key,value)},
  del:(table,key)=>(table==="items"?items:escrow).delete(key),scan:()=>[]};
 const gameStore={coopAtomicNativeRows:{transact:(tables,fn)=>{
  assert.deepEqual(tables,["items","marketEscrow"]);
  const beforeItems=clone([...items]),beforeEscrow=clone([...escrow]);
  try{return fn(tx)}catch(error){items.clear();escrow.clear();
   for(const [k,v]of beforeItems)items.set(k,v);
   for(const [k,v]of beforeEscrow)escrow.set(k,v);throw error}
 }}};
 const adapter=createNpcPendingMarketEscrow({call,gameStore,verifyNativeCorporation:owner=>owner===X.ownerID,
  verifyStation:station=>station===X.stationID,resolvePrice:()=>unitPrice,
  getNativeItem:itemID=>items.get(String(itemID)),
  getNativeEscrow:orderID=>escrow.get(String(orderID)),clock:()=>1761390000000});
 return {adapter,items,escrow,callCounts,id};
}
async function withFixture(fn,opts){
 const a=process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS,b=process.env.EVEJS_COOP_NATIVE_NPC_MARKET_PENDING;
 process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS="1";process.env.EVEJS_COOP_NATIVE_NPC_MARKET_PENDING="1";
 try{return await fn(fixture(opts))}finally{
  if(a===undefined)delete process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS;else process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS=a;
  if(b===undefined)delete process.env.EVEJS_COOP_NATIVE_NPC_MARKET_PENDING;else process.env.EVEJS_COOP_NATIVE_NPC_MARKET_PENDING=b;
 }
}
test("same-connection GameStore item move and native escrow, then Rust activation",()=>withFixture(async f=>{
 const r=await f.adapter.listOnce(X);assert.equal(r.status,"LISTED");
 assert.equal(r.orderID,456);assert.equal(f.items.get(String(X.itemID)).locationID,ESCROW_BASE+456);
 assert.equal(f.escrow.get("456").sourceItemID,X.itemID);
 assert.deepEqual(f.callCounts,{reserve:1,activate:1,get:1});
}));
test("default OFF never makes market RPC",()=>withFixture(async f=>{
 delete process.env.EVEJS_COOP_NATIVE_NPC_MARKET_PENDING;
 const r=await f.adapter.listOnce(X);assert.equal(r.error,"NPC_PENDING_MARKET_DISABLED");
 assert.equal(f.callCounts.reserve,0);assert.equal(f.escrow.size,0);
}));
test("missing native-produced item blocks before Rust reserve",()=>withFixture(async f=>{
 f.items.get(String(X.itemID)).quantity=99;
 const r=await f.adapter.listOnce(X);assert.equal(r.error,"NPC_MARKET_UNBACKED_SOURCE");
 assert.equal(f.callCounts.reserve,0);
}));
test("Rust reservation must be pending and match exact operation",()=>withFixture(async f=>{
 const r=await f.adapter.listOnce(X);assert.equal(r.error,"NPC_RUST_PENDING_ORDER_NOT_VERIFIED");
 assert.equal(f.escrow.size,0);assert.equal(f.callCounts.activate,0);
},{reserveFail:true}));
test("native item and escrow roll back together on simulated SQLite failure",()=>withFixture(async f=>{
 await assert.rejects(f.adapter.listOnce(X),/ESCROW_WRITE_FAULT/);
 assert.equal(f.items.get(String(X.itemID)).locationID,X.stationID);
 assert.equal(f.escrow.size,0);assert.equal(f.callCounts.activate,0);
},{escrowFault:true}));
test("lost activation RPC acknowledgement leaves one escrow and never retries source item",()=>withFixture(async f=>{
 await assert.rejects(f.adapter.listOnce(X),/RUST_ACTIVATION_ACK_LOST/);
 assert.equal(f.items.get(String(X.itemID)).locationID,ESCROW_BASE+456);
 assert.equal(f.escrow.size,1);
 const r=await f.adapter.listOnce(X);
 assert.equal(r.error,"NPC_MARKET_UNBACKED_SOURCE");
 assert.deepEqual(f.callCounts,{reserve:1,activate:1,get:0});
},{activationFails:true}));
test("wrong corporation or missing station authority is refused",()=>withFixture(async f=>{
 const r=await f.adapter.listOnce({...X,ownerID:9});
 assert.equal(r.error,"NPC_MARKET_IDENTITY_UNVERIFIED");assert.equal(f.callCounts.reserve,0);
}));
test("malformed or overlarge quantity never reserves sell order",()=>withFixture(async f=>{
 assert.equal((await f.adapter.listOnce({...X,quantity:9999999})).error,"NPC_MARKET_IDENTITY_UNVERIFIED");
 assert.equal(f.callCounts.reserve,0);
}));


test("sub-cent quotes do not issue free or rounded Rust orders",()=>withFixture(async f=>{
 await assert.rejects(f.adapter.listOnce(X),/NPC_MARKET_PRICE_UNVERIFIED/);
 assert.equal(f.callCounts.reserve,0);
 assert.equal(f.items.get(String(X.itemID)).locationID,X.stationID);
 assert.equal(f.escrow.size,0);
}, {unitPrice:0.004}));
test("fractional-cent positive quotes never silently round to another unit price",()=>withFixture(async f=>{
 await assert.rejects(f.adapter.listOnce(X),/NPC_MARKET_PRICE_UNVERIFIED/);
 assert.equal(f.callCounts.reserve,0);
 assert.equal(f.escrow.size,0);
}, {unitPrice:12.003}));
test("exact fractional dollar-cent quote remains valid",()=>withFixture(async f=>{
 assert.equal((await f.adapter.listOnce(X)).status,"LISTED");
 assert.equal(f.callCounts.reserve,1);
}, {unitPrice:12.05}));
test("quantity with mismatching native stacksize is not eligible for Rust reserve",()=>withFixture(async f=>{
 const result=await f.adapter.listOnce(X);
 assert.equal(result.error,"NPC_MARKET_UNBACKED_SOURCE");
 assert.equal(f.callCounts.reserve,0);
 assert.equal(f.items.get(String(X.itemID)).locationID,X.stationID);
 assert.equal(f.escrow.size,0);
}, {stacksize:0}));
test("stacksize tampering after Rust reserve but before GameStore commit rolls back",()=>withFixture(async f=>{
 const original=f.items.get(String(X.itemID));
 const item=structuredClone(original);
 f.items.set(String(X.itemID),{...item,stacksize:X.quantity+1});
 const result=await f.adapter.listOnce(X);
 assert.equal(result.error,"NPC_MARKET_UNBACKED_SOURCE");
 assert.equal(f.callCounts.reserve,0);
}, {stacksize:X.quantity}));
