import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {decodeNativeGetOrder,verifyNativeBookAsk,normalizeNativeOrderForCoordinator}=
 require("../integration/coopNpcRustOrderAuthority.cjs");
const book=()=>({source:"player",order_id:"456",price:1.25,
  vol_remaining:20,station_id:60000001,region_id:10000002,type_id:34,
  bid:false,min_volume:1,vol_entered:20});
const owner=()=>({owner_id:"90000001",is_corp:false,state:"open",
  source:"player",row:book()});
test("pinned GetOrders public OrderRow has no owner, GetOrder OwnerOrderRow enriches it",()=>{
 const b=book();assert.equal("owner_id" in b,false);
 const got=verifyNativeBookAsk(b,owner(),{stationID:60000001,typeID:34});
 assert.equal(got.ok,true);assert.equal(got.owner_id,90000001);
 assert.equal(got.price_cents,125);assert.equal(got.vol_remaining,20);
});
test("flat fake GetOrder cannot authorize real NPC wallet payment",()=>{
 const fake={...book(),owner_id:"90000001",is_corp:false,state:"open"};
 assert.equal(decodeNativeGetOrder(fake).ok,false);
});
test("book quantity or price changes across Rust calls block escrow claim",()=>{
 const reprice=owner();reprice.row.price=1.27;
 assert.equal(verifyNativeBookAsk(book(),reprice,{stationID:60000001,typeID:34}).reason,
  "RUST_BOOK_OWNER_ORDER_DRIFT");
 const less=owner();less.row.vol_remaining=10;
 assert.equal(verifyNativeBookAsk(book(),less,{stationID:60000001,typeID:34}).ok,false);
});
test("seller owner is only read from private GetOrder, never public order book",()=>{
 const b={...book(),owner_id:"fake"};
 const got=verifyNativeBookAsk(b,owner(),{stationID:60000001,typeID:34});
 assert.equal(got.ok,true);assert.equal(got.owner_id,90000001);
});
test("seed, corp and player bid orders cannot pass native NPC buyer proof",()=>{
 const seed=book();seed.source="seed";
 assert.equal(verifyNativeBookAsk(seed,owner(),{stationID:60000001,typeID:34}).ok,false);
 const corporate=owner();corporate.is_corp=true;
 assert.equal(verifyNativeBookAsk(book(),corporate,{stationID:60000001,typeID:34}).ok,false);
 const bid=book();bid.bid=true;
 assert.equal(verifyNativeBookAsk(bid,owner(),{stationID:60000001,typeID:34}).ok,false);
});
test("safe numeric Rust i64 strings guard against loss of JS precision",()=>{
 const huge=owner();huge.owner_id="9007199254740993";
 assert.equal(decodeNativeGetOrder(huge).ok,false);
 const wrong=owner();wrong.row.order_id="000456";
 assert.equal(decodeNativeGetOrder(wrong).ok,false);
});
test("GetOrder normalizer handles previously claimed Rust SETTLING on recovery",()=>{
 const response=owner();response.state="settling";
 const out=normalizeNativeOrderForCoordinator(response);
 assert.equal(out.state,"settling");assert.equal(out.owner_id,90000001);
 assert.equal(out.vol_remaining,20);
});
test("finalized Rust GetOrder is valid only with zero remaining",()=>{
 const filled=owner();filled.state="filled";filled.row.vol_remaining=0;
 assert.equal(normalizeNativeOrderForCoordinator(filled).state,"filled");
 filled.row.vol_remaining=1;
 assert.throws(()=>normalizeNativeOrderForCoordinator(filled),/FILLED_ORDER_HAS_STOCK/);
});
test("new OPEN Rust order cannot have zero items or unknown state",()=>{
 const zero=owner();zero.row.vol_remaining=0;
 assert.throws(()=>normalizeNativeOrderForCoordinator(zero),/OPEN_ORDER_EMPTY/);
 const unknown=owner();unknown.state="cancelled";
 assert.throws(()=>normalizeNativeOrderForCoordinator(unknown),/SCHEMA_DRIFT/);
});


test("fractional-cent Rust player ASK book is not a payable offer",()=>{
 for(const price of [1.254,1.256,0.004]){
  const b={...book(),price};
  const detail=owner();detail.row.price=price;
  assert.equal(verifyNativeBookAsk(b,detail,
   {stationID:60000001,typeID:34}).ok,false);
  assert.equal(decodeNativeGetOrder(detail).ok,false);
  assert.throws(()=>normalizeNativeOrderForCoordinator(detail),
   /RUST_NATIVE_GET_ORDER_SCHEMA_DRIFT/);
 }
});
test("original native Rust integer-cent ask prices remain valid",()=>{
 for(const [price,priceCents] of [[1.25,125],[1.2,120],[0.01,1]]){
  const b={...book(),price};
  const detail=owner();detail.row.price=price;
  assert.equal(verifyNativeBookAsk(b,detail,
   {stationID:60000001,typeID:34}).price_cents,priceCents);
  assert.equal(decodeNativeGetOrder(detail).price_cents,priceCents);
  assert.equal(normalizeNativeOrderForCoordinator(detail).price,price);
 }
});
test("non-numeric Rust order price is not coerced into original wallet authority",()=>{
 const detail=owner();detail.row.price="1.25";
 const b={...book(),price:"1.25"};
 assert.equal(decodeNativeGetOrder(detail).ok,false);
 assert.equal(verifyNativeBookAsk(b,detail,{stationID:60000001,typeID:34}).ok,false);
 assert.throws(()=>normalizeNativeOrderForCoordinator(detail),/SCHEMA_DRIFT/);
});
