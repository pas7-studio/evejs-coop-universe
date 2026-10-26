import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createBuyRefundRuntime}=require("../integration/coopPlayerMarketBuyRefundRuntime.cjs");
const order=state=>({order_id:"23",state,owner_id:201,is_corp:false,source:"player",
 row:{order_id:"23",bid:true,station_id:60001234,type_id:34,
  price:12.34,vol_remaining:4,vol_entered:7}});
function fixture({ack,observed,fail,refundFail}={}){
 const calls=[];
 const store={preflight:()=>{
  calls.push("GameStore_bound_reserve_preflight");return true},
  refund:(o,reason)=>{
   calls.push("GameStore_REFUND_COMMIT");
   if(refundFail)throw Error(refundFail);
   return {key:"buy-refund:23",reason,orderID:o.order_id,phase:"GAMESTORE_COMMITTED"};
  }};
 const client={call:async (method,args)=>{
  calls.push(method);
  if(fail===method)throw Error("LOST_"+method+"_ACK");
  if(method==="CancelOrder")return ack??{order_id:"23",state:"cancelled",invalidated:true};
  if(method==="GetOrder")return observed??order("cancelled");
 }};
 return {calls,store,client,run:createBuyRefundRuntime({store})};
}
test("native BUY cancel: proof -> Rust CancelOrder -> GetOrder -> original GameStore one-credit refund",async()=>{
 const x=fixture();const receipt=await x.run.cancel({client:x.client,order:order("open")});
 assert.equal(receipt.reason,"cancelled");
 assert.deepEqual(x.calls,["GameStore_bound_reserve_preflight","CancelOrder","GetOrder","GameStore_REFUND_COMMIT"]);
});
test("lost CancelOrder ACK causes no new refund and no blind GetOrder recovery",async()=>{
 const x=fixture({fail:"CancelOrder"});
 await assert.rejects(x.run.cancel({client:x.client,order:order("open")}),/LOST_CancelOrder_ACK/);
 assert.deepEqual(x.calls,["GameStore_bound_reserve_preflight","CancelOrder"]);
});
test("rust cancel response must be cancelled with explicit original invalidation",async()=>{
 for(const ack of [
  {order_id:"24",state:"cancelled",invalidated:true},
  {order_id:"23",state:"open",invalidated:false},
  {order_id:"23",state:"cancelled",invalidated:false}
 ]){
  const x=fixture({ack});
  await assert.rejects(x.run.cancel({client:x.client,order:order("open")}),
   /ORIGINAL_CANCEL_ACK_NOT_CONFIRMED/);
  assert.deepEqual(x.calls,["GameStore_bound_reserve_preflight","CancelOrder"]);
 }
});
test("Rust GetOrder must confirm final terminal state and unchanged order volume",async()=>{
 for(const observed of [
   order("open"),order("expired"),{...order("cancelled"),owner_id:999},
   {...order("cancelled"),row:{...order("cancelled").row,price:0}},
   {...order("cancelled"),row:{...order("cancelled").row,vol_remaining:3}}
 ]){
  const x=fixture({observed});
  await assert.rejects(x.run.cancel({client:x.client,order:order("open")}),
   /ORIGINAL_RUST_TERMINAL_READBACK_MISMATCH/);
  assert.equal(x.calls.includes("GameStore_REFUND_COMMIT"),false);
 }
});
test("expiry event needs independent original Rust expired GetOrder readback",async()=>{
 const x=fixture({observed:order("expired")});
 const receipt=await x.run.expire({client:x.client,order:order("expired")});
 assert.equal(receipt.reason,"expired");
 assert.deepEqual(x.calls,["GetOrder","GameStore_REFUND_COMMIT"]);
});
test("expiry event whose Rust row is not expired cannot credit buyer",async()=>{
 const x=fixture({observed:order("open")});
 await assert.rejects(x.run.expire({client:x.client,order:order("expired")}),
  /ORIGINAL_RUST_TERMINAL_READBACK_MISMATCH/);
 assert.deepEqual(x.calls,["GetOrder"]);
});
test("native COMMIT uncertain leaves original Rust terminal order for verified reconciliation",async()=>{
 const x=fixture({refundFail:"NATIVE_SQLITE_COMMIT_OUTCOME_UNKNOWN"});
 await assert.rejects(x.run.cancel({client:x.client,order:order("open")}),
  /COMMIT_OUTCOME_UNKNOWN/);
 assert.deepEqual(x.calls,["GameStore_bound_reserve_preflight","CancelOrder","GetOrder","GameStore_REFUND_COMMIT"]);
});
