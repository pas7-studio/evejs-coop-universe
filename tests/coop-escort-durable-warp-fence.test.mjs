import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createWarpFence}=require("../integration/coopEscortWarpFence.cjs");
const old=process.env.EVEJS_COOP_ESCORT_WARP_FENCE;
process.env.EVEJS_COOP_ESCORT_WARP_FENCE="1";
const route={manifestKey:"30000144-77-1000000",
 contractID:"escort-30000144-77-5501",
 systemID:30000144,fleetID:77,haulerID:901,stationID:60001,
 corporationID:10001,cargoIDs:[5501,5502]};
function onDisk(fn){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"coop-escort-warp-recovery-"));
 try{fn(root,()=>createWarpFence({root,clock:()=>1000000}))}
 finally{fs.rmSync(root,{recursive:true,force:true})}
}
test("durable physical warp intent exists BEFORE warp controller is called",()=>onDisk((root,f)=>{
 const x=f();
 assert.equal(x.inspectSource(route).status,"WARP_SOURCE_CLEAR");
 assert.equal(x.prepare(route).status,"DURABLE_WARP_PREPARED");
 const journal=x.inspect(route.manifestKey);
 assert.equal(journal.status,"READY");
 assert.equal(journal.phase,"WARP_PREPARED");
 assert.deepEqual(journal.booking.cargoIDs,[5501,5502]);
}));
test("restart with lost native warp ACK cannot rewarp original native cargo",()=>onDisk((root,f)=>{
 f().prepare(route);
 const afterRestart=f();
 assert.equal(afterRestart.inspectSource(route).status,"WARP_SOURCE_ALREADY_DISPATCHED");
 assert.equal(afterRestart.inspect(route.manifestKey).phase,"WARP_PREPARED");
 assert.equal(afterRestart.prepare(route).status,"WARP_SOURCE_ALREADY_DISPATCHED");
}));
test("confirmed native warp ACK persists and never creates another dispatch",()=>onDisk((root,f)=>{
 const x=f();x.prepare(route);
 assert.equal(x.confirm(route.manifestKey).status,"DURABLE_WARP_ACK_CONFIRMED");
 assert.equal(f().inspect(route.manifestKey).phase,"WARP_ACK_CONFIRMED");
 assert.equal(f().inspectSource(route).status,"WARP_SOURCE_ALREADY_DISPATCHED");
 assert.equal(f().prepare({...route,manifestKey:"30000144-77-2000000"}).status,
  "WARP_SOURCE_ALREADY_DISPATCHED");
}));
test("loss of confirmation ACK is idempotent (no duplicate append)",()=>onDisk((root,f)=>{
 f().prepare(route);f().confirm(route.manifestKey);
 assert.equal(f().confirm(route.manifestKey).status,"DURABLE_WARP_ACK_CONFIRMED");
 const lines=fs.readFileSync(path.join(root,"escort-native-warp-fence",
  route.manifestKey+".jsonl"),"utf8").trimEnd().split("\n");
 assert.equal(lines.length,2);
}));
test("independent original cargo permits a genuinely new NPC trip",()=>onDisk((root,f)=>{
 f().prepare(route);
 const next={...route,manifestKey:"30000144-77-2000000",
  contractID:"escort-30000144-77-5600",cargoIDs:[5600]};
 assert.equal(f().inspectSource(next).status,"WARP_SOURCE_CLEAR");
 assert.equal(f().prepare(next).status,"DURABLE_WARP_PREPARED");
}));
test("corrupt unfinished native journal blocks replay instead of moving ship",()=>onDisk((root,f)=>{
 f().prepare(route);
 fs.appendFileSync(path.join(root,"escort-native-warp-fence",
  route.manifestKey+".jsonl"),"INCOMPLETE");
 assert.equal(f().inspectSource(route).status,"WARP_FENCE_SCAN_UNVERIFIED");
 assert.equal(f().prepare({...route,manifestKey:"30000144-77-3000000"}).status,
  "WARP_FENCE_SCAN_UNVERIFIED");
}));
test("untrusted symlink in warp journal directory blocks source scan",()=>onDisk((root,f)=>{
 f().prepare(route);
 const p=path.join(root,"escort-native-warp-fence","30000144-77-9000000.jsonl");
 try{fs.symlinkSync(path.join(root,"sensitive.txt"),p)}
 catch(e){if(["EPERM","EACCES","ENOTSUP"].includes(e?.code))return;throw e}
 assert.equal(f().inspectSource(route).status,"WARP_FENCE_NONREGULAR_SOURCE");
}));
test("unavailable fsync is UNCERTAIN and never permits repeat warp",()=>onDisk((root,f)=>{
 const io={...fs,fsyncSync:()=>{throw Error("DEVICE_ERROR")}};
 const uncertain=createWarpFence({root,io,clock:()=>1000000}).prepare(route);
 assert.equal(uncertain.status,"WARP_PREPARE_UNCERTAIN_REPAIR_REQUIRED");
 assert.equal(f().inspectSource(route).status,"WARP_SOURCE_ALREADY_DISPATCHED");
}));
test("price/cargo/route spoof cannot overwrite existing durable intent",()=>onDisk((root,f)=>{
 f().prepare(route);
 assert.equal(f().prepare({...route,corporationID:9999}).status,
  "WARP_SOURCE_ALREADY_DISPATCHED");
 assert.equal(f().inspect(route.manifestKey).booking.corporationID,10001);
}));
test("feature OFF cannot create a native warp intent",()=>onDisk((root,f)=>{
 process.env.EVEJS_COOP_ESCORT_WARP_FENCE="0";
 try{assert.equal(f().prepare(route).status,"DISABLED");
  assert.equal(f().inspect(route.manifestKey).status,"WARP_FENCE_NOT_FOUND")}
 finally{process.env.EVEJS_COOP_ESCORT_WARP_FENCE="1"}
}));
process.on("exit",()=>{
 if(old===undefined)delete process.env.EVEJS_COOP_ESCORT_WARP_FENCE;
 else process.env.EVEJS_COOP_ESCORT_WARP_FENCE=old
});
