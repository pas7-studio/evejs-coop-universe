import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createNativeJobAgent}=require("../integration/coopNativeJobAgent.cjs");
const {patch}=require("../scripts/coop-native-job-agent-patch.cjs");
const OLD=process.env.EVEJS_COOP_NATIVE_JOB_AGENT;
process.env.EVEJS_COOP_NATIVE_JOB_AGENT="1";
const NOW=100000, ID="convoy-30000144-77-123";
const event=()=>({
 id:ID,source:"NATIVE_VERIFIED",type:"CONVOY",stage:"PREPARING",
 phase:"ACTIVE",systemID:30000144,entityID:901,stationID:60000001,
 createdAt:NOW-1000,expiresAt:NOW+10000,
 summary:"Native convoy has goods at risk"});
const quote=()=>({
 eventID:ID,contractID:"escort-30000144-77-123",
 corporationID:1000152,systemID:30000144,haulerID:901,
 stationID:60000001,amountISK:600000,expiresAt:NOW+10000});
function fixture(opts={}){
 const session={characterID:701,socket:{destroyed:false},_space:{systemID:30000144}};
 const peer={characterID:702,socket:{destroyed:false},_space:{systemID:30000144}};
 const agent={agentID:500003,ownerName:"SDE Corporate Agent",stationID:60000001,
  solarSystemID:30000144,corporationID:1000152,isInSpace:false};
 const jobs=opts.events||[event()];
 let quotes=opts.quote===undefined?quote():opts.quote;
 let nativeMission=opts.mission||null;
 const called=[];
 const service=createNativeJobAgent({
  listEvents:()=>({status:"READY",events:jobs}),
  readEvent:id=>({status:"READY",event:jobs.find(x=>x.id===id)}),
  readQuote:()=>quotes?{status:"READY",quote:quotes}:{status:"NOT_FOUND"},
  readAccepted:()=>opts.accepted?{status:"DURABLE_TWO_PILOT_PAID_ACCEPTANCE",
    contractID:quote().contractID,amountISK:600000,characters:[701,702]}:
    {status:"NOT_FOUND"},
  getAgent:id=>id===agent.agentID?agent:null,
  getMission:()=>nativeMission,
  getSessions:()=>[session,peer],
  dispatch:x=>{called.push(x.argumentText);return opts.dispatch?
    opts.dispatch(x):{status:x.argumentText.startsWith("interest")?"INTEREST_RECORDED":
      x.argumentText.startsWith("volunteer")?"WAITING_FOR_OTHER_VOLUNTEER":
      "WAITING_FOR_OTHER_PAID_ACCEPTOR"};},
  clock:()=>NOW
 });
 const action=(a,who=session)=>service.doAction({session:who,agentID:agent.agentID,actionID:a});
 const start=()=>action(null);
 return {session,peer,agent,jobs,service,called,action,start,
  changeMission:v=>nativeMission=v,changeQuote:v=>quotes=v};
}
test("opening a native SDE corporate agent shows live NPC hauling work with stock Accept button",()=>{
 const f=fixture(),r=f.start();
 assert.equal(r.data.actions[0][0],3);
 assert.match(r.data.agentSays[0],/600,000 ISK TOTAL/);
 assert.match(r.data.agentSays[0],/QUOTE/);
 assert.equal(f.called.length,0);
});
test("stock agent not matching real corporation retains normal missions",()=>{
 const f=fixture();f.agent.corporationID++;
 assert.equal(f.start(),null);
});
test("ordinary existing agent mission is never shadowed by a co-op job",()=>{
 const f=fixture({mission:{missionID:501}});
 assert.equal(f.start(),null);
});
test("different solar system of actual agent is not eligible",()=>{
 const f=fixture();f.agent.solarSystemID++;
 assert.equal(f.start(),null);
});
test("invalid NPC session cannot open or accept an agent job",()=>{
 const f=fixture();f.session.socket.destroyed=true;
 assert.equal(f.start(),null);
 assert.equal(f.action(3),null);
});
test("unpriced convoy never claims a funded mission",()=>{
 const f=fixture({quote:null});
 assert.equal(f.start(),null);
});
test("native button view and briefing carry no fabricated EVE mission ID",()=>{
 const f=fixture();f.start();
 assert.equal(f.action(1).data.actions[0][0],3);
 const info=f.service.briefing({session:f.session,agentID:f.agent.agentID});
 assert.equal(info["Mission ID"],null);
 assert.equal(info["ContentID"],null);
 assert.match(info["Mission Briefing ID"],/NPC hauler escort/);
});
test("agent Accept only invokes native interest and volunteer; no direct wallet operations",()=>{
 const f=fixture();f.start();const r=f.action(3);
 assert.deepEqual(f.called,["interest "+ID,"volunteer "+ID]);
 assert.match(r.data.agentSays[0],/fleetmate/);
});
test("agent Accept completes both explicit existing priced gates when real duo was verified",()=>{
 const f=fixture({dispatch:x=>({
  status:x.argumentText.startsWith("interest")?"INTEREST_RECORDED":
   x.argumentText.startsWith("volunteer")?"VERIFIED_NATIVE_DUO_VOLUNTEER":
   "WAITING_FOR_OTHER_PAID_ACCEPTOR"})});
 f.start();const r=f.action(3);
 assert.deepEqual(f.called,["interest "+ID,"volunteer "+ID,"accept "+ID]);
 assert.match(r.data.agentSays[0],/OTHER pilot/);
});
test("successful dual signature is NOT represented as already paid",()=>{
 const f=fixture({dispatch:x=>({status:x.argumentText.startsWith("interest")?
  "INTEREST_RECORDED":x.argumentText.startsWith("volunteer")?
  "DUO_ALREADY_CONFIRMED":"DURABLE_TWO_PILOT_PAID_ACCEPTANCE"})});
 f.start();const r=f.action(3);
 assert.match(r.data.agentSays[0],/contingent/);
 assert.doesNotMatch(r.data.agentSays[0],/you have received/);
});
test("a native volunteer rejection never touches paid acceptance",()=>{
 const f=fixture({dispatch:x=>({status:x.argumentText.startsWith("interest")?
  "INTEREST_RECORDED":"NOT_TWO_AUTHENTIC_NATIVE_PILOTS"})});
 f.start();const r=f.action(3);
 assert.equal(f.called.length,2);
 assert.match(r.data.agentSays[0],/not yet verified/);
});
test("a forged duplicate character session cannot open corporate offer",()=>{
 const f=fixture();f.session.characterID=f.peer.characterID;
 assert.equal(f.start(),null);
});
test("stale selected source refuses client Accept without accepting unrelated native mission",()=>{
 const f=fixture();f.start();f.jobs.length=0;
 const r=f.action(3);
 assert.match(r.data.agentSays[0],/expired or changed/);
 assert.equal(f.called.length,0);
});
test("new job cannot replace selected immutable ID between view and accept",()=>{
 const f=fixture();f.start();f.jobs.unshift({...event(),id:"convoy-30000144-77-888"});
 const r=f.action(3);
 assert.deepEqual(f.called,["interest "+ID,"volunteer "+ID]);
 assert.match(r.data.agentSays[0],/600,000/);
});
test("changed source ship or quote cannot be accepted after initial view",()=>{
 const f=fixture();f.start();f.changeQuote({...quote(),haulerID:999});
 const r=f.action(3);assert.match(r.data.agentSays[0],/expired or changed/);
 assert.equal(f.called.length,0);
});
test("both signed pilots see View only, never another Accept money action",()=>{
 const f=fixture({accepted:true});f.start();
 const r=f.action(1);assert.deepEqual(r.data.actions,[[1,1]]);
});
test("other numeric agent action never grants money or native mission",()=>{
 const f=fixture();f.start();
 assert.deepEqual(f.action(6).data.actions,[[1,1]]);
 assert.equal(f.called.length,0);
});
test("disabled native agent gate leaves stock EveJS dialogue untouched",()=>{
 const f=fixture();process.env.EVEJS_COOP_NATIVE_JOB_AGENT="0";
 try{assert.equal(f.start(),null);assert.equal(f.called.length,0)}
 finally{process.env.EVEJS_COOP_NATIVE_JOB_AGENT="1"}
});
test("source and original pinned hook patch are reversible and idempotent",()=>{
 const original=[
 "class A {",
 "  Handle_DoAction(args, session) {",
 "    const agentID = this._resolveBoundAgentID(session);",
 "    const actionID = args && args.length > 0 ? args[0] : null;",
 "  }",
 "  Handle_GetMissionBriefingInfo(args, session) {",
 "  }","}"
 ].join("\n");
 const on=patch(original);
 assert.match(on,/EVEJS_COOP_NATIVE_JOB_AGENT/);
 assert.equal(patch(on),on);
 assert.equal(patch(on,{remove:true}),original);
});
process.on("exit",()=>{if(OLD===undefined)delete process.env.EVEJS_COOP_NATIVE_JOB_AGENT;
 else process.env.EVEJS_COOP_NATIVE_JOB_AGENT=OLD});
