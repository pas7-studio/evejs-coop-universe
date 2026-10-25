import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {makeBinding}=require("../integration/coopEscortNativeBinding.cjs");
const flagNames=[
 "EVEJS_COOP_ESCORT_CONTRACTS","EVEJS_COOP_ESCORT_ROUTE_GATE",
 "EVEJS_COOP_NATIVE_ATOMIC_ROWS","EVEJS_COOP_NATIVE_ESCORT_WALLET",
 "EVEJS_COOP_NATIVE_HAUL_MANIFEST","EVEJS_COOP_ESCORT_REFUNDS"
];
function fixture(){
 let calls=[];
 const runtime={
  fundBeforeWarp:()=>({status:"FUNDED"}),
  recordDelivery:()=>({status:"DELIVERED"}),
  finishAfterRaid:()=>({status:"SETTLED"}),
  settlePeacefulFlight:()=>({status:"ALREADY_NATIVE_PAID"}),
  refundProvenLoss:()=>({status:"REFUNDED"}),
  readFlight:()=>({status:"READY"}),
  inspectRefundRecovery:()=>({status:"READY"}),
  refundWreckedFlight:k=>{calls.push(k);return {status:"NATIVE_REFUND_ATTEMPT",manifestKey:k}},
  nativeFunds:{capabilities:()=>({nativeDurable:true,atomicDualCredit:true})}
 };
 const api=makeBinding({runtime,readNativeIncident:()=>({status:"READY",incidents:[]})});
 return {api,calls};
}
test("real numeric native manifest key reaches refund authority",()=>{
 const saved=new Map(flagNames.map(n=>[n,process.env[n]]));
 try{
  for(const name of flagNames)process.env[name]="1";
  const f=fixture();const key="30000144-77-123";
  assert.equal(f.api.refundNativeWreck(key).status,"NATIVE_REFUND_ATTEMPT");
  assert.deepEqual(f.calls,[key]);
 }finally{for(const [name,value] of saved){if(value===undefined)delete process.env[name];else process.env[name]=value}}
});
test("malformed and non-numeric manifest cannot request corporate refund",()=>{
 const saved=new Map(flagNames.map(n=>[n,process.env[n]]));
 try{
  for(const name of flagNames)process.env[name]="1";
  const f=fixture();
  assert.equal(f.api.refundNativeWreck("d-dd-dd").status,"NATIVE_REFUND_MANIFEST_KEY_INVALID");
  assert.equal(f.api.refundNativeWreck("../danger").status,"NATIVE_REFUND_MANIFEST_KEY_INVALID");
  assert.equal(f.calls.length,0);
 }finally{for(const [name,value] of saved){if(value===undefined)delete process.env[name];else process.env[name]=value}}
});
test("refund remains disabled by default",()=>{
 const saved=new Map(flagNames.map(n=>[n,process.env[n]]));
 try{
  for(const name of flagNames)process.env[name]="0";
  const f=fixture();
  assert.equal(f.api.refundNativeWreck("30000144-77-123").status,"DISABLED");
  assert.equal(f.calls.length,0);
 }finally{for(const [name,value] of saved){if(value===undefined)delete process.env[name];else process.env[name]=value}}
});
