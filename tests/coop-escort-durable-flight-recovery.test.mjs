import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createEscortFlightGate}=require("../integration/coopEscortFlightGate.cjs");
const old=process.env.EVEJS_COOP_ESCORT_ROUTE_GATE;
process.env.EVEJS_COOP_ESCORT_ROUTE_GATE="1";
const key="30000144-77-1000000";
const manifest={key,systemID:30000144,fleetID:77,stationID:60001,
 corporationID:10001,haulerIDs:[901],cargo:[
  {cargoID:5501,haulerID:901,typeID:34,quantity:8,fromMinerID:303}
 ]};
const full={status:"FULL_NATIVE_CARGO_DELIVERY_VERIFIED",key,
 stationID:60001,haulerIDs:[901],cargoIDs:[5501],stacks:1,quantity:8,
 convoySaved:false,paidReward:false};
const route={manifestKey:key,systemID:30000144,fleetID:77,
 stationID:60001,corporationID:10001,haulerIDs:[901]};
const booking={status:"AUTHORIZED_NATIVE_ESCORT_BOOKING",
 contractID:"escort-30000144-77-5501",manifestKey:key,
 systemID:30000144,fleetID:77,haulerID:901,stationID:60001,
 corporationID:10001,characters:[701,702],amountISK:20000};
const arrived={manifestKey:key,trip:{
 manifestID:key,systemID:30000144,fleetID:77,stationID:60001,
 corporationID:10001,haulers:{"901":{arrivedAt:1000000}}
},terminalProof:{status:"DELIVERED",terminal:true,nativeFullManifestProof:full}};
function setup(fn){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"evejs-escort-flight-reconcile-"));
 let reserve=false;
 const wallet={capabilities:()=>({nativeDurable:true,atomicDualCredit:true,
  durableIdempotency:true}),
  reserveAtomic:()=>{reserve=true},
  verifyReservation:()=>reserve?{status:"RESERVED",contractID:booking.contractID,
   corporationID:10001,amountISK:20000,escrowKey:booking.contractID,
   nativeDurable:true}:{status:"NOT_FOUND"}};
 const create=()=>createEscortFlightGate({root,
  clock:()=>1000000,
  authorizeBooking:()=>booking,
  readManifest:()=>({status:"READY",record:manifest}),
  verifyManifest:()=>full,
  nativeFunds:wallet});
 try{fn({root,create,wasReserved:()=>reserve})}
 finally{fs.rmSync(root,{recursive:true,force:true})}
}
function prepare(gate){
 assert.equal(gate.fundBeforeWarp(route).status,"FUNDED_BEFORE_WARP");
 assert.equal(gate.recordDelivered(arrived).status,"DURABLE_NATIVE_DELIVERY_RECORDED");
}
test("terminal fsync acknowledgement lost: exact replay succeeds without duplicate event",()=>setup(f=>{
 const gate=f.create();prepare(gate);
 assert.equal(f.create().recordDelivered(arrived).status,"DURABLE_NATIVE_DELIVERY_RECORDED");
 const raw=fs.readFileSync(path.join(f.root,"escort-flight-gate",key+".jsonl"),"utf8");
 assert.equal(raw.trimEnd().split("\n").length,3);
 assert.equal(f.wasReserved(),true);
}));
test("a changed cargo quantity or claimed station cannot replay another native delivery",()=>setup(f=>{
 const gate=f.create();prepare(gate);
 const tampered={...arrived,terminalProof:{...arrived.terminalProof,
  nativeFullManifestProof:{...full,quantity:1000}}};
 assert.equal(gate.recordDelivered(tampered).status,
  "FLIGHT_DELIVERY_REPLAY_IDENTITY_CONFLICT");
 assert.equal(gate.recordDelivered({...arrived,trip:{...arrived.trip,stationID:60002}}).status,
  "FLIGHT_DELIVERY_REPLAY_IDENTITY_CONFLICT");
}));
test("verified delivery enumerator survives process restart",()=>setup(f=>{
 prepare(f.create());
 const fromReboot=f.create().listDelivered({systemID:30000144,maxTrips:8});
 assert.equal(fromReboot.status,"READY");
 assert.deepEqual(fromReboot.manifestKeys,[key]);
 assert.deepEqual(f.create().listDelivered({systemID:30000145}).manifestKeys,[]);
}));
test("corrupt source journal blocks entire replay scan instead of partially paying",()=>setup(f=>{
 prepare(f.create());
 fs.appendFileSync(path.join(f.root,"escort-flight-gate",key+".jsonl"),"TRUNCATED");
 assert.equal(f.create().listDelivered({}).status,"FLIGHT_SCAN_UNVERIFIED_JOURNAL");
}));
test("invalid source limits cannot trigger a paid auto-recovery",()=>setup(f=>{
 prepare(f.create());
 assert.equal(f.create().listDelivered({maxTrips:9999}).status,"FLIGHT_SCAN_LIMIT_INVALID");
 assert.equal(f.create().listDelivered({systemID:-1}).status,"FLIGHT_SCAN_SYSTEM_INVALID");
}));
test("non-regular filesystem journal rejects blind or symlinked source",()=>setup(f=>{
 prepare(f.create());
 const injected=path.join(f.root,"escort-flight-gate","30000144-77-9000000.jsonl");
 try{fs.symlinkSync(path.join(f.root,"private"),injected)}
 catch(e){if(["EPERM","ENOTSUP","EACCES"].includes(e.code))return;throw e}
 assert.equal(f.create().listDelivered({}).status,"FLIGHT_SCAN_NONREGULAR_JOURNAL");
}));
test("35 genuine fsynced delivery journals paginate without starving later paid flights",()=> {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"evejs-escort-replay-pages-"));
 const records=new Map(),reserved=new Set();
 const wallet={
  capabilities:()=>({nativeDurable:true,atomicDualCredit:true,durableIdempotency:true}),
  reserveAtomic:b=>{assert.equal(reserved.has(b.contractID),false);reserved.add(b.contractID)},
  verifyReservation:b=>reserved.has(b.contractID)?{
   status:"RESERVED",contractID:b.contractID,corporationID:b.corporationID,
   amountISK:b.amountISK,escrowKey:b.contractID,nativeDurable:true
  }:{status:"NOT_FOUND"}
 };
 const gate=()=>createEscortFlightGate({root,clock:()=>1000000,
  authorizeBooking:route=>({status:"AUTHORIZED_NATIVE_ESCORT_BOOKING",
   ...route,contractID:"escort-"+route.manifestKey,
   characters:[701,702],playerFleetID:44,amountISK:20000}),
  readManifest:key=>({status:"READY",record:records.get(key)?.manifest}),
  verifyManifest:request=>records.get(request.key)?.full,
  nativeFunds:wallet
 });
 try{
  for(let i=0;i<35;i++){
   const k="30000144-77-"+(1000000+i),cargoID=5501+i;
   const m={...manifest,key:k,cargo:[{...manifest.cargo[0],cargoID}]};
   const p={...full,key:k,cargoIDs:[cargoID]};
   records.set(k,{manifest:m,full:p});
   const g=gate();
   assert.equal(g.fundBeforeWarp({...route,manifestKey:k}).status,"FUNDED_BEFORE_WARP");
   const delivered={...arrived,manifestKey:k,
    trip:{...arrived.trip,manifestID:k},
    terminalProof:{...arrived.terminalProof,nativeFullManifestProof:p}};
   assert.equal(g.recordDelivered(delivered).status,"DURABLE_NATIVE_DELIVERY_RECORDED");
  }
  const fresh=gate(),first=fresh.listDelivered({maxTrips:32});
  assert.equal(first.status,"READY");
  assert.equal(first.manifestKeys.length,32);
  assert.equal(first.hasMore,true);
  assert.equal(first.nextAfterKey,first.manifestKeys[31]);
  const second=fresh.listDelivered({maxTrips:32,afterKey:first.nextAfterKey});
  assert.equal(second.status,"READY");
  assert.equal(second.manifestKeys.length,3);
  assert.equal(second.hasMore,false);
  assert.equal(second.nextAfterKey,null);
  assert.equal(new Set([...first.manifestKeys,...second.manifestKeys]).size,35);
  assert.equal(fresh.listDelivered({maxTrips:32,afterKey:"../escape"}).status,
   "FLIGHT_SCAN_CURSOR_INVALID");
  // A corrupt later journal must poison even the FIRST page, never pay part.
  const tail=second.manifestKeys[2];
  fs.appendFileSync(path.join(root,"escort-flight-gate",tail+".jsonl"),"CORRUPT");
  assert.equal(fresh.listDelivered({maxTrips:32}).status,
   "FLIGHT_SCAN_UNVERIFIED_JOURNAL");
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
process.on("exit",()=>{if(old===undefined)delete process.env.EVEJS_COOP_ESCORT_ROUTE_GATE;
 else process.env.EVEJS_COOP_ESCORT_ROUTE_GATE=old});
