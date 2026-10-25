import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createCloneActionFence}=require("../integration/coopCloneActionFence.cjs");
function storage(){
 const files=new Map(),handles=new Map();let seq=0,failWrite=false;
 return {files,setFail:v=>{failWrite=v},api:{
  mkdirSync:()=>{},
  readFileSync:name=>{if(!files.has(name)){const e=Error("ENOENT");e.code="ENOENT";throw e}return files.get(name)},
  openSync:(name,mode)=>{if(mode==="wx"&&files.has(name))throw Error("EEXIST");
   if(mode==="wx"||mode==="a"&&!files.has(name))files.set(name,"");
   const fd=++seq;handles.set(fd,{name,mode});return fd},
  writeSync:(fd,buf,offset=0,len=buf.length)=>{
   const r=handles.get(fd),data=buf.data||buf;
   if(failWrite&&r.mode==="a")throw Error("DISK_FULL");
   files.set(r.name,(r.mode==="a"?files.get(r.name):"")+data.slice(offset,offset+len));
   return len;},
  fsyncSync:()=>{},closeSync:fd=>handles.delete(fd),unlinkSync:name=>files.delete(name)}};
}
const jump={ok:true,kind:"CLONE_JUMP",characterID:101,cloneID:800,
 sourceLocationID:300,destinationLocationID:400,previousLastJump:"0"};
const install={ok:true,kind:"INSTALL_CLONE",characterID:101,
 locationID:300,previousCloneIDs:[800]};
const implant={ok:true,kind:"IMPLANT",characterID:101,itemID:901};
const booster={ok:true,kind:"BOOSTER",characterID:101,itemID:902};
const home={ok:true,kind:"HOME_STATION",characterID:101,
 previousHomeStationID:300,homeStationID:400};
const death={ok:true,kind:"POD_DEATH",characterID:101,deathEventID:"death-101"};
const fence=s=>createCloneActionFence({file:"/var/lib/evejs/coop-clones.jsonl",
 storage:s.api,clock:()=>12345});
const go=(f,proof,execute=()=>null,verify=()=>({ok:true}))=>
 f.execute({proof,captureNative:()=>({persisted:true}),
  nativeExecute:execute,verifyNative:verify});
test("one native clone jump succeeds; replay after reconnect never calls transition",()=>{
 const s=storage(),f=fence(s);let native=0;
 assert.equal(go(f,jump,()=>{native++;return null}).status,"NATIVE_CLONE_ACTION_SETTLED");
 assert.equal(go(fence(s),jump,()=>{native++}).status,"NATIVE_CLONE_MANUAL_RECONCILIATION_OR_REPLAY");
 assert.equal(native,1);
});
test("two characters with same clone index have independent journal custody",()=>{
 const s=storage(),f=fence(s);
 assert.equal(go(f,jump).status,"NATIVE_CLONE_ACTION_SETTLED");
 assert.equal(go(f,{...jump,characterID:102}).status,"NATIVE_CLONE_ACTION_SETTLED");
});
test("implant and booster item IDs are once-only and separate operations",()=>{
 const s=storage(),f=fence(s);
 assert.equal(go(f,implant).status,"NATIVE_CLONE_ACTION_SETTLED");
 assert.equal(go(f,booster).status,"NATIVE_CLONE_ACTION_SETTLED");
 assert.equal(go(f,implant).status,"NATIVE_CLONE_MANUAL_RECONCILIATION_OR_REPLAY");
});
test("clone install with new native clone inventory has a fresh key",()=>{
 const s=storage(),f=fence(s);
 assert.equal(go(f,install).status,"NATIVE_CLONE_ACTION_SETTLED");
 assert.equal(go(f,{...install,previousCloneIDs:[800,801]}).status,
  "NATIVE_CLONE_ACTION_SETTLED");
});
test("home station and pod death require durable unique transition IDs",()=>{
 const s=storage(),f=fence(s);
 assert.equal(go(f,home).status,"NATIVE_CLONE_ACTION_SETTLED");
 assert.equal(go(f,death).status,"NATIVE_CLONE_ACTION_SETTLED");
 assert.equal(go(f,{...death,deathEventID:"death-102"}).status,"NATIVE_CLONE_ACTION_SETTLED");
 assert.equal(go(f,{...death,deathEventID:"evil/../../"}).status,"INVALID_NATIVE_CLONE_EXECUTION");
});
test("unexpected native exception blocks retry after restart",()=>{
 const s=storage(),f=fence(s);let calls=0;
 assert.equal(go(f,jump,()=>{calls++;throw Error("partial transition")}).status,
  "NATIVE_CLONE_MANUAL_RECONCILIATION");
 assert.equal(go(fence(s),jump,()=>{calls++}).status,
  "NATIVE_CLONE_MANUAL_RECONCILIATION_OR_REPLAY");
 assert.equal(calls,1);
});
test("missing postflight proof never marks action settled",()=>{
 const s=storage(),f=fence(s);
 assert.equal(go(f,jump,()=>null,()=>({ok:false})).status,
  "NATIVE_CLONE_MANUAL_RECONCILIATION");
 assert.equal(fence(s).inspect(jump).status,"NATIVE_CLONE_MANUAL_RECONCILIATION");
});
test("simultaneous call during native action sees fsynced PREPARED and cannot replay",()=>{
 const s=storage(),f=fence(s);let blocked;
 assert.equal(go(f,jump,()=>{blocked=go(fence(s),jump).status}).status,
  "NATIVE_CLONE_ACTION_SETTLED");
 assert.equal(blocked,"NATIVE_CLONE_MANUAL_RECONCILIATION_OR_REPLAY");
});
test("stale writer lock is preserved and blocks all changes",()=>{
 const s=storage();s.files.set("/var/lib/evejs/coop-clones.jsonl.lock","stale");
 assert.equal(go(fence(s),jump).status,"NATIVE_CLONE_LOCK_UNAVAILABLE");
 assert.equal(s.files.has("/var/lib/evejs/coop-clones.jsonl.lock"),true);
});
test("partial journal and failed fsync/write never trigger native action",()=>{
 const s=storage(),f=fence(s);let calls=0;
 s.setFail(true);
 assert.equal(go(f,jump,()=>{calls++}).status,"NATIVE_CLONE_REPAIR_REQUIRED");
 assert.equal(calls,0);
 const x=storage();x.files.set("/var/lib/evejs/coop-clones.jsonl","{oops");
 assert.equal(go(fence(x),jump,()=>{calls++}).status,"NATIVE_CLONE_REPAIR_REQUIRED");
 assert.equal(calls,0);
});
