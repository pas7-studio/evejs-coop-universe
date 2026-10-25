import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createStoryMissionSettlementFence}=require("../integration/coopStoryMissionSettlementFence.cjs");
function storage(){
 const files=new Map();
 let fd=0;
 const handles=new Map();
 const api={
  mkdirSync:()=>{},
  openSync:(name,mode)=>{
   if(mode==="wx"&&files.has(name))throw Error("EEXIST");
   if(mode==="wx")files.set(name,"");
   if(mode==="a"&&!files.has(name))files.set(name,"");
   const h=++fd;handles.set(h,{name,mode});return h;
  },
  writeSync:(h,value)=>{
   const row=handles.get(h);if(!row)throw Error("BADFD");
   files.set(row.name,(row.mode==="a"?files.get(row.name):"")+value);
   return value.length;
  },
  readFileSync:(name)=>{if(!files.has(name)){const e=Error("ENOENT");e.code="ENOENT";throw e;}return files.get(name)},
  fsyncSync:()=>{},
  closeSync:h=>{if(!handles.delete(h))throw Error("BADFD")},
  unlinkSync:name=>{if(!files.delete(name))throw Error("ENOENT")}
 };
 return {api,files};
}
const M={characterID:1001,agentID:11,missionSequence:50,contentID:2,missionTemplateID:"client:2"};
const P={ok:true,reason:"PERSONAL_COMPLETE_PREFLIGHT_ONLY",rewardAtomicityVerified:false,
 ...M};
const native=({clear=true,completed=true}={})=>({
 characterID:1001,
 missionsByAgentID:clear?{}:{"11":{contentID:2,missionSequence:50}},
 history:completed?[{agentID:11,missionSequence:50,contentID:2,runtimeStatus:"completed"}]:[]
});
const make=(s,file="/state/story.jsonl")=>createStoryMissionSettlementFence({
 file,storage:s.api,clock:()=>1720000000000});
test("pregrant journal fences one native reward across restart",()=>{
 const s=storage(),first=make(s);
 const start=first.begin({preflight:P,mission:M});
 assert.equal(start.status,"PREPARED");
 assert.equal(make(s).begin({preflight:P,mission:M}).status,
  "NATIVE_STORY_MISSION_REQUIRES_MANUAL_RECONCILIATION");
 let nativeCalls=0;nativeCalls++;
 const end=first.finish({ticket:start.ticket,nativeResult:{success:true},readNativeState:()=>native()});
 assert.equal(end.status,"NATIVE_STORY_MISSION_SETTLED");
 assert.equal(make(s).begin({preflight:P,mission:M}).status,
  "NATIVE_STORY_MISSION_ALREADY_SETTLED");
 assert.equal(nativeCalls,1);
});
test("uncertain native failure never retries after disconnect/restart",()=>{
 const s=storage(),f=make(s),r=f.begin({preflight:P,mission:M});
 assert.equal(f.finish({ticket:r.ticket,nativeResult:{success:false},
  readNativeState:()=>native({clear:false})}).status,
  "NATIVE_STORY_MISSION_REQUIRES_MANUAL_RECONCILIATION");
 assert.equal(make(s).begin({preflight:P,mission:M}).status,
  "NATIVE_STORY_MISSION_REQUIRES_MANUAL_RECONCILIATION");
});
test("successful callback without matching native history is ambiguous",()=>{
 const s=storage(),f=make(s),r=f.begin({preflight:P,mission:M});
 assert.equal(f.finish({ticket:r.ticket,nativeResult:{success:true},
  readNativeState:()=>native({completed:false})}).status,
  "NATIVE_STORY_MISSION_REQUIRES_MANUAL_RECONCILIATION");
 assert.equal(make(s).inspect(M).status,"NATIVE_STORY_MISSION_REQUIRES_MANUAL_RECONCILIATION");
});
test("preflight must bind character, agent, sequence, content and template",()=>{
 const s=storage(),f=make(s);
 for(const field of ["characterID","agentID","missionSequence","contentID","missionTemplateID"]){
  assert.equal(f.begin({preflight:{...P,[field]:field==="missionTemplateID"?"forged":999},
   mission:M}).status,"UNVERIFIED_NATIVE_MISSION_COMPLETION");
 }
 assert.equal(f.inspect(M).status,"NOT_SEEN");
});
test("distinct native characters cannot share a once-only settlement claim",()=>{
 const s=storage(),f=make(s),m2={...M,characterID:1002},p2={...P,characterID:1002};
 assert.equal(f.begin({preflight:P,mission:M}).status,"PREPARED");
 assert.equal(f.begin({preflight:p2,mission:m2}).status,"PREPARED");
});
test("corrupt journal and incomplete writes fail closed, not mint rewards",()=>{
 const s=storage();
 s.files.set("/state/story.jsonl",'{"version":1,"state":"PREPARED"}');
 assert.equal(make(s).begin({preflight:P,mission:M}).status,
  "STORY_MISSION_FENCE_REPAIR_REQUIRED");
 assert.equal(make(s).inspect(M).status,"STORY_MISSION_FENCE_REPAIR_REQUIRED");
});
test("stale writer lock after crash blocks another payout",()=>{
 const s=storage();s.files.set("/state/story.jsonl.lock","stale");
 assert.equal(make(s).begin({preflight:P,mission:M}).status,
  "STORY_MISSION_FENCE_LOCK_UNAVAILABLE");
});
test("forged ticket cannot finalize durable claim",()=>{
 const s=storage(),f=make(s),r=f.begin({preflight:P,mission:M});
 assert.equal(f.finish({ticket:{...r.ticket},nativeResult:{success:true},
  readNativeState:()=>native()}).status,"UNRECOGNIZED_STORY_MISSION_TICKET");
 assert.equal(f.finish({ticket:r.ticket,nativeResult:{success:true},
  readNativeState:()=>native()}).status,"NATIVE_STORY_MISSION_SETTLED");
});

test("initial agent gift has its own pregrant claim, separate from mission payout",()=>{
 const s=storage(),f=make(s);
 const giftProof={...P,reason:"PERSONAL_ACCEPT_AUTHORIZED",giftAtomicityVerified:false};
 const begun=f.begin({preflight:giftProof,mission:M,kind:"ACCEPT_GIFT"});
 assert.equal(begun.status,"PREPARED");
 const nativeAccepted=()=>({missionsByAgentID:{"11":{
  agentID:11,contentID:2,missionSequence:50,missionTemplateID:"client:2",
  runtimeStatus:"accepted"}},history:[]});
 assert.equal(f.finish({ticket:begun.ticket,nativeResult:{success:true},
  readNativeState:nativeAccepted}).status,"NATIVE_STORY_MISSION_SETTLED");
 assert.equal(make(s).begin({preflight:giftProof,mission:M,kind:"ACCEPT_GIFT"}).status,
  "NATIVE_STORY_MISSION_ALREADY_SETTLED");
 assert.equal(f.inspect(M).status,"NOT_SEEN");
});
test("gift crash while mission is still offered blocks second initial gift",()=>{
 const s=storage(),f=make(s);
 const p={...P,reason:"PERSONAL_ACCEPT_AUTHORIZED",giftAtomicityVerified:false};
 const r=f.begin({preflight:p,mission:M,kind:"ACCEPT_GIFT"});
 assert.equal(r.status,"PREPARED");
 assert.equal(make(s).begin({preflight:p,mission:M,kind:"ACCEPT_GIFT"}).status,
  "NATIVE_STORY_MISSION_REQUIRES_MANUAL_RECONCILIATION");
 assert.equal(f.finish({ticket:r.ticket,nativeResult:{success:true},
  readNativeState:()=>({missionsByAgentID:{"11":{runtimeStatus:"offered"}}})}).status,
  "NATIVE_STORY_MISSION_REQUIRES_MANUAL_RECONCILIATION");
});
