import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createNativeIngressSnapshot}=require("../integration/coopEscortNativeIngressSnapshot.cjs");
const flag="EVEJS_COOP_ESCORT_NATIVE_INGRESS_SNAPSHOT",before=process.env[flag];
process.env[flag]="1";
const manifestKey="30000144-77-123",contractID="escort-30000144-77-123";
const booking=()=>({manifestKey,contractID,systemID:30000144,fleetID:77,
 haulerID:901,stationID:60001,corporationID:10001,cargoIDs:[5501]});
const ingress=()=>({startTimeMs:1000000,travelCompleteAtMs:1010000,
 completeAtMs:1010250,origin:{x:0,y:0,z:0},targetPoint:{x:100750,y:0,z:0}});
const ack=()=>({status:"READY",phase:"WARP_ACK_CONFIRMED",booking:booking()});
const source=()=>({status:"VERIFIED_NATIVE_ESCORT_DEPARTURE",
 manifestKey,contractID,origin:{x:0,y:0,z:0}});
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"evejs-ingress-"));
 const make=(io=fs)=>createNativeIngressSnapshot({root,io,clock:()=>1002000});
 const write=(opts={})=>make().record({booking:booking(),ingress:ingress(),
  verifiedAck:ack(),source:source(),at:1002000,...opts});
 const loc=path.join(root,"escort-native-ingress-snapshot",manifestKey+".json");
 return {root,make,write,loc,close:()=>fs.rmSync(root,{recursive:true,force:true})};
}
function use(fn){const f=fixture();try{fn(f)}finally{f.close()}}
test("only verified real native warp ACK and source writes immutable ingress",()=>use(f=>{
 assert.equal(f.write().status,"DURABLE_NATIVE_INGRESS_SNAPSHOT");
 const saved=f.make().readDurable(booking());
 assert.equal(saved.status,"VERIFIED_NATIVE_INGRESS_SNAPSHOT");
 assert.deepEqual(saved.row.targetPoint,{x:100750,y:0,z:0});
 assert.equal(saved.row.contractID,contractID);
}));
test("replay immutable same ingress is idempotent with no second file",()=>use(f=>{
 f.write();
 assert.equal(f.write().status,"INGRESS_SNAPSHOT_ALREADY_DURABLE");
 assert.equal(fs.readdirSync(path.dirname(f.loc)).length,1);
}));
test("prepared-only ACK cannot persist a native physical ingress",()=>use(f=>{
 const a=ack();a.phase="WARP_PREPARED";
 assert.equal(f.write({verifiedAck:a}).status,"INGRESS_SNAPSHOT_NATIVE_ACK_OR_SOURCE_INVALID");
 assert.equal(fs.existsSync(f.loc),false);
}));
test("no authentic source pilot witness cannot create snapshot",()=>use(f=>{
 const s=source();s.status="NO_SOURCE";
 assert.equal(f.write({source:s}).status,"INGRESS_SNAPSHOT_NATIVE_ACK_OR_SOURCE_INVALID");
 assert.equal(fs.existsSync(f.loc),false);
}));
test("changed native hauler or native fleet fails ACK identity",()=>use(f=>{
 const a=ack();a.booking={...booking(),haulerID:999};
 assert.equal(f.write({verifiedAck:a}).status,"INGRESS_SNAPSHOT_NATIVE_ACK_OR_SOURCE_INVALID");
}));
test("actual origin must equal original signed player departure source",()=>use(f=>{
 const s=source();s.origin.x=100;
 assert.equal(f.write({source:s}).status,"INGRESS_SNAPSHOT_NATIVE_ACK_OR_SOURCE_INVALID");
}));
test("future or finished ingress cannot be recorded as active",()=>use(f=>{
 assert.equal(f.write({at:999999}).status,"INGRESS_SNAPSHOT_NATIVE_ACK_OR_SOURCE_INVALID");
 assert.equal(f.write({at:1010001}).status,"INGRESS_SNAPSHOT_NATIVE_ACK_OR_SOURCE_INVALID");
}));
test("invalid physical ingress, excessive duration and too-short path rejected",()=>use(f=>{
 assert.equal(f.write({ingress:{...ingress(),travelCompleteAtMs:1050000}}).status,
  "INGRESS_SNAPSHOT_NATIVE_ACK_OR_SOURCE_INVALID");
 assert.equal(f.write({ingress:{...ingress(),targetPoint:{x:500,y:0,z:0}}}).status,
  "INGRESS_SNAPSHOT_RECHECK_UNCERTAIN");
}));
test("lost file or directory fsync ACK blocks durability until original resync",()=>use(f=>{
 const io={...fs,fsyncSync(){throw Error("ACK_LOST")}};
 const w=f.make(io);
 assert.equal(w.record({booking:booking(),ingress:ingress(),
  verifiedAck:ack(),source:source(),at:1002000}).status,
  "INGRESS_SNAPSHOT_WRITE_UNCERTAIN");
 assert.equal(w.readDurable(booking()).status,"INGRESS_SNAPSHOT_FSYNC_UNCERTAIN");
 assert.equal(f.make().readDurable(booking()).status,
  "VERIFIED_NATIVE_INGRESS_SNAPSHOT");
}));
test("changed original contract cannot replay stored snapshot",()=>use(f=>{
 f.write();
 assert.equal(f.make().inspect({...booking(),contractID:"escort-else"}).status,
  "INGRESS_SNAPSHOT_SOURCE_MISMATCH");
}));
test("partially written JSON can never be repaired by a second write",()=>use(f=>{
 f.write();
 fs.writeFileSync(f.loc,"{broken\n");
 assert.equal(f.write().status,"INGRESS_SNAPSHOT_CORRUPT");
}));
test("hardlinks or symlinks cannot be used for original ingress authority",()=>use(f=>{
 f.write();fs.linkSync(f.loc,f.loc+".hard");
 assert.equal(f.make().inspect(booking()).status,
  "INGRESS_SNAPSHOT_NOT_REGULAR_OR_LINKED");
}));
test("feature flag OFF never creates the durable ingress file",()=>use(f=>{
 process.env[flag]="0";
 try{assert.equal(f.write().status,"DISABLED");
  assert.equal(fs.existsSync(f.loc),false)}
 finally{process.env[flag]="1"}
}));
test("original ingress target cannot be overwritten on replay",()=>use(f=>{
 f.write();
 const x=ingress();x.targetPoint.x+=20000;
 assert.equal(f.write({ingress:x}).status,"INGRESS_SNAPSHOT_REPLAY_MISMATCH");
}));
process.on("exit",()=>{if(before===undefined)delete process.env[flag];
 else process.env[flag]=before});
