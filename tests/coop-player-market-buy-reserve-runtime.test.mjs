import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {place}=require("../integration/coopPlayerMarketBuyReserveRuntime.cjs");
const pending={
 kind:"P2P_BUY_RESERVE",phase:"RESERVED",
 operationID:"12345678-1234-4234-8234-123456789abc",
 buyerID:201,stationID:60001234,typeID:34,
 priceCents:1234,quantity:7,minVolume:2,durationDays:30,orderRange:0
};
const originalOrder=()=>({
 order_id:"23",owner_id:201,is_corp:false,state:"open",source:"player",
 row:{order_id:"23",bid:true,station_id:60001234,type_id:34,
  price:12.34,vol_remaining:7,min_volume:2,
  duration_days:30,range_value:0}
});
test("original Rust PlaceOrder/GetOrder precedes single native escrow bind",async()=>{
 const calls=[];
 const result=await place({
  quote:{buyerID:201},client:{call:async(method,arg)=>{
   calls.push([method,arg]);
   if(method==="PlaceOrder")return {order_id:"23",station_id:60001234,type_id:34};
   if(method==="GetOrder")return originalOrder();
  }},
  store:{begin:q=>{calls.push(["native_begin",q]);return pending},
   bind:(receipt,row)=>{calls.push(["native_bind",receipt.operationID,row.order_id]);
    return {...receipt,phase:"BOUND",orderID:"23"};}}
 });
 assert.deepEqual(calls.map(x=>x[0]),["native_begin","PlaceOrder","GetOrder","native_bind"]);
 assert.equal(calls[1][1].source,"player");
 assert.equal(calls[1][1].price,12.34);
 assert.equal(calls[1][1].quantity,7);
 assert.equal(calls[2][1].order_id,"23");
 assert.equal(result.receipt.phase,"BOUND");
});
test("Rust PlaceOrder error preserves pending funds, never creates escrow or retries",async()=>{
 const calls=[];
 const client={call:async method=>{calls.push(method);throw Error("LOST_RUST_PLACE_ACK")}};
 const store={begin:()=>{calls.push("reserve");return pending},
  bind:()=>{throw Error("UNEXPECTED_NATIVE_BIND")}};
 await assert.rejects(place({quote:{},client,store}),/LOST_RUST_PLACE_ACK/);
 assert.deepEqual(calls,["reserve","PlaceOrder"]);
});
test("Rust acknowledged order mismatch cannot create unverified native escrow",async()=>{
 const calls=[];
 const store={begin:()=>pending,bind:()=>{calls.push("bind")}};
 const client={call:async method=>{
  calls.push(method);
  if(method==="PlaceOrder")return {order_id:"23",station_id:60001234,type_id:34};
  return {...originalOrder(),order_id:"24"};
 }};
 await assert.rejects(place({quote:{},store,client}),/ORDER_READBACK_MISMATCH/);
 assert.deepEqual(calls,["PlaceOrder","GetOrder"]);
});
test("forged Rust PlaceOrder station or type cannot reach GetOrder/bind",async()=>{
 for(const response of [
  {order_id:"23",station_id:777,type_id:34},
  {order_id:"23",station_id:60001234,type_id:35},
  {order_id:"not-an-id",station_id:60001234,type_id:34}
 ]){
  const calls=[];
  const store={begin:()=>pending,bind:()=>{calls.push("bind")}};
  const client={call:async method=>{calls.push(method);return response}};
  await assert.rejects(place({quote:{},store,client}),/RUST_PLACE_ACK_UNVERIFIED/);
  assert.deepEqual(calls,["PlaceOrder"]);
 }
});
test("invalid local authority cannot debit a native wallet",async()=>{
 await assert.rejects(place({quote:{},client:{},store:{begin(){},bind(){}}}),
  /ORIGINAL_RUST_DAEMON_REQUIRED/);
});
