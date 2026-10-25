import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {makePlayerIndustryFence}=require("../integration/coopPlayerIndustryFence.cjs");
function store(){
 const files=new Map(),handles=new Map();
 let counter=0,failWrites=false;
 const api={
  mkdirSync:()=>{},
  readFileSync:(file)=>{if(!files.has(file)){
   const e=Error("ENOENT");e.code="ENOENT";throw e;
  }return files.get(file)},
  openSync:(file,mode)=>{
   if(mode==="wx"&&files.has(file))throw Error("EEXIST");
   if(mode==="wx")files.set(file,"");
   if(mode==="a"&&!files.has(file))files.set(file,"");
   const fd=++counter;handles.set(fd,{file,mode});return fd;
  },
  writeSync:(fd,buf,offset=0,len=buf.length)=>{
   const row=handles.get(fd);if(!row)throw Error("BAD_FD");
   if(failWrites&&row.mode==="a")throw Error("DISK_ERROR");
   const payload=typeof buf==="string"?buf:buf.data;
   files.set(row.file,(row.mode==="a"?files.get(row.file):"")+payload.slice(offset,offset+len));
   return len;
  },
  fsyncSync:()=>{},closeSync:fd=>handles.delete(fd),
  unlinkSync:file=>{if(!files.delete(file))throw Error("ENOENT")}
 };
 return {api,files,setWriteFail(v){failWrites=v}};
}
const install={ok:true,kind:"INSTALL",ownerID:501,characterID:901,
 blueprintID:222,activityID:1,facilityID:333,runs:2,cost:120};
const deliver={ok:true,kind:"DELIVER",ownerID:501,characterID:902,
 blueprintID:222,jobID:710,activityID:1,runs:2,cost:120};
const mk=storage=>makePlayerIndustryFence({file:"/var/lib/evejs/p-industry.jsonl",
 storage:storage.api,clock:()=>123456});
const installed={success:true,data:{jobID:710}},delivered={success:true,data:{jobID:710}};
test("native installation executes once; duplicate after reconnect blocked while active",()=>{
 const s=store(),f=mk(s);let charges=0;
 const r=f.execute({proof:install,captureNative:()=>({}),nativeExecute:()=>{charges++;return installed},
  verifyNative:({nativeResult})=>nativeResult?.data?.jobID===710});
 assert.equal(r.status,"NATIVE_INDUSTRY_OPERATION_SETTLED");
 assert.equal(r.nativeJobID,710);
 assert.equal(mk(s).execute({proof:install,captureNative:()=>({}),nativeExecute:()=>{charges++;return installed},
  verifyNative:()=>true,readPreviousJob:()=>({jobID:710,blueprintID:222,status:1})}).status,
  "PREVIOUS_NATIVE_BLUEPRINT_JOB_STILL_ACTIVE");
 assert.equal(charges,1);
});
test("after native delivery/cancel same BPO may start a new *paid* cycle",()=>{
 const s=store(),f=mk(s);
 let calls=0;const exec=opts=>f.execute({proof:install,captureNative:()=>({}),nativeExecute:()=>{calls++;return installed},
  verifyNative:()=>true,...opts});
 assert.equal(exec().cycle,1);
 const second=exec({readPreviousJob:()=>({jobID:710,blueprintID:222,status:101})});
 assert.equal(second.status,"NATIVE_INDUSTRY_OPERATION_SETTLED");
 assert.equal(second.cycle,2);assert.equal(calls,2);
});
test("exception after partial material or wallet debit is blocked forever until reconciliation",()=>{
 const s=store();let calls=0;
 const one=mk(s).execute({proof:install,captureNative:()=>({}),nativeExecute:()=>{calls++;throw Error("after ore debit")},
  verifyNative:()=>true});
 assert.equal(one.status,"NATIVE_INDUSTRY_MANUAL_RECONCILIATION");
 assert.equal(makePlayerIndustryFence({file:"/var/lib/evejs/p-industry.jsonl",storage:s.api})
  .execute({proof:install,captureNative:()=>({}),nativeExecute:()=>{calls++;return installed},
   verifyNative:()=>true}).status,"NATIVE_INDUSTRY_MANUAL_RECONCILIATION");
 assert.equal(calls,1);
});
test("delivery is one-shot regardless of new claim from second authorized character",()=>{
 const s=store(),a=mk(s),b=mk(s);let items=0;
 const r=a.execute({proof:deliver,captureNative:()=>({}),nativeExecute:()=>{items+=2;return delivered},
  verifyNative:()=>true});
 assert.equal(r.status,"NATIVE_INDUSTRY_OPERATION_SETTLED");
 assert.equal(b.execute({proof:{...deliver,characterID:901},captureNative:()=>({}),nativeExecute:()=>{items+=2;return delivered},
  verifyNative:()=>true}).status,"NATIVE_DELIVERY_ALREADY_SETTLED");
 assert.equal(items,2);
});
test("delivery interrupted after output grant before job state commit is unknown",()=>{
 const s=store(),f=mk(s);
 const r=f.execute({proof:deliver,captureNative:()=>({}),nativeExecute:()=>delivered,verifyNative:()=>false});
 assert.equal(r.status,"NATIVE_INDUSTRY_MANUAL_RECONCILIATION");
 assert.equal(mk(s).inspect(deliver).status,"NATIVE_INDUSTRY_MANUAL_RECONCILIATION");
});
test("concurrent install during pending reservation is refused",()=>{
 const s=store(),f=mk(s);let blocked;
 const r=f.execute({proof:install,captureNative:()=>({}),nativeExecute:()=>{
  blocked=mk(s).execute({proof:install,captureNative:()=>({}),nativeExecute:()=>installed,verifyNative:()=>true}).status;
  return installed;},verifyNative:()=>true});
 assert.equal(blocked,"NATIVE_INDUSTRY_MANUAL_RECONCILIATION");
 assert.equal(r.status,"NATIVE_INDUSTRY_OPERATION_SETTLED");
});
test("unsupported/forged native operation proof never calls native code",()=>{
 const s=store(),f=mk(s);let calls=0;
 const r=f.execute({proof:{...deliver,ok:false},captureNative:()=>({}),nativeExecute:()=>{calls++;return delivered},
  verifyNative:()=>true});
 assert.equal(r.status,"INVALID_NATIVE_INDUSTRY_EXECUTION");
 assert.equal(calls,0);
});
test("stale lock on disk blocks operation instead of guessing whether paid",()=>{
 const s=store();s.files.set("/var/lib/evejs/p-industry.jsonl.lock","dead");
 assert.equal(mk(s).execute({proof:install,captureNative:()=>({}),nativeExecute:()=>installed,
  verifyNative:()=>true}).status,"NATIVE_INDUSTRY_LOCK_UNAVAILABLE");
});
test("corrupt/incomplete journal never automatically repeats payout",()=>{
 const s=store();s.files.set("/var/lib/evejs/p-industry.jsonl",'{"version":1,"status":"PREPARED"}');
 assert.equal(mk(s).execute({proof:install,captureNative:()=>({}),nativeExecute:()=>installed,
  verifyNative:()=>true}).status,"NATIVE_INDUSTRY_REPAIR_REQUIRED");
});
test("disk write failure before native call prevents any side effect",()=>{
 const s=store();s.setWriteFail(true);let calls=0;
 const r=mk(s).execute({proof:install,captureNative:()=>({}),nativeExecute:()=>{calls++;return installed},
  verifyNative:()=>true});
 assert.equal(r.status,"NATIVE_INDUSTRY_REPAIR_REQUIRED");assert.equal(calls,0);
});
test("even successful return with no native receipt remains quarantined",()=>{
 const s=store();const result=mk(s).execute({proof:install,captureNative:()=>({}),nativeExecute:()=>installed,
  verifyNative:()=>false});
 assert.equal(result.status,"NATIVE_INDUSTRY_MANUAL_RECONCILIATION");
});
test("manual delete of a lock is never performed by fence on resume",()=>{
 const s=store();s.files.set("/var/lib/evejs/p-industry.jsonl.lock","stale");
 assert.equal(mk(s).inspect(install).status,"NATIVE_INDUSTRY_LOCK_UNAVAILABLE");
 assert.equal(s.files.has("/var/lib/evejs/p-industry.jsonl.lock"),true);
});
