import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createMiningAgent}=require("../integration/coopPlayerMiningAgent.cjs");
const SYSTEM=30000144,FLEET=4011,EMPLOYER=1231,PLAYER=3413,AGENT=8081;
function fixture(){
 const session={characterID:71,userid:90,corporationID:PLAYER,socket:{destroyed:false}};
 let authorized=true,quotesEnabled=true,mutations=0,mission=null,live=[session],funded=null,
  candidates=[{source:"startup",systemID:SYSTEM,fleetID:FLEET}],everViewed=false;
 const quote={version:1,agentID:AGENT,corporationID:PLAYER,
  employerCorpID:EMPLOYER,systemID:SYSTEM,fleetID:FLEET,
  cycles:3,wageCents:75000,rateRevision:1,minerCount:2,haulerCount:1,
  operationID:"coop-mining-shift:"+"a".repeat(32)};
 const agent=createMiningAgent({
  getAgent:()=>({agentID:AGENT,corporationID:EMPLOYER,
   solarSystemID:SYSTEM,stationID:6001,isInSpace:false}),
  getMission:()=>mission,getSessions:()=>live,getFleetRecords:()=>candidates,
  inspectShift:()=>funded,
  assignOrder:()=>({status:"ORDER_QUEUED"}),
  getHirePreview:(_args,{view})=>{
   if(!quotesEnabled)return {status:"NO_NATIVE_EMPLOYER_OFFER"};
   if(view)everViewed=true;
   return {status:"AVAILABLE",quote};
  },
  acceptHire:args=>{
   if(!everViewed)return {status:"REOPEN_AGENT_TO_CONFIRM_WAGE"};
   if(!authorized)return {status:"NATIVE_CORPORATION_PERMISSION_DENIED"};
   mutations++;funded={...quote,status:"FUNDED",directive:"MINE",
    commandState:"IDLE",commandSeq:0,minerIDs:[11,12],haulerIDs:[13]};
   return {status:"FUNDED",wageCents:75000};
  },
  access:{isMember:()=>authorized,canIndustry:()=>authorized},
  enabled:()=>true
 });
 const request=(actionID=null)=>agent.doAction({session,agentID:AGENT,actionID});
 return {agent,session,quote,request,
  paid:()=>mutations,mission:v=>mission=v,allow:v=>authorized=v,available:v=>quotesEnabled=v,
  fleets:v=>candidates=v,sessions:v=>live=v,returnedFunded:()=>funded};
}
test("fresh native agent View shows employer price and real fleet size",()=>{
 const x=fixture(),r=x.request();
 assert.match(r.data.agentSays[0],/750\.00 ISK/);
 assert.match(r.data.agentSays[0],/2 original miners and 1 haulers/);
 assert.deepEqual(r.data.actions,[[3,3],[1,1]]);
 assert.equal(x.paid(),0);
});
test("stock Agent Accept transitions into funded native shift, not fake mission",()=>{
 const x=fixture();x.request();const a=x.request(3);
 assert.match(a.data.agentSays[0],/FUNDED/);assert.equal(x.paid(),1);
 const after=x.request();assert.match(after.data.agentSays[0],/NPC mining fleet/);
 assert.doesNotMatch(after.data.agentSays[0],/offers 2 original/);
 assert.equal(x.paid(),1);
});
test("direct Accept without original View cannot hire",()=>{
 const x=fixture();const r=x.request(3);
 assert.match(r.data.agentSays[0],/REOPEN_AGENT_TO_CONFIRM_WAGE/);
 assert.equal(x.paid(),0);
});
test("an authorized corporate member without industry role sees no hiring offer",()=>{
 const x=fixture();x.allow(false);
 assert.equal(x.request(),null);assert.equal(x.request(3),null);assert.equal(x.paid(),0);
});
test("native mission wins over hiring and must not be altered",()=>{
 const x=fixture();x.mission({missionID:91});
 assert.equal(x.request(),null);assert.equal(x.request(3),null);assert.equal(x.paid(),0);
});
test("no wage policy means no agent offer or payment",()=>{
 const x=fixture();x.available(false);assert.equal(x.request(),null);
 assert.equal(x.request(3),null);assert.equal(x.paid(),0);
});
test("two original candidate fleets refuse silent selection",()=>{
 const x=fixture();x.fleets([{source:"startup",systemID:SYSTEM,fleetID:FLEET},
 {source:"startup",systemID:SYSTEM,fleetID:FLEET+1}]);
 assert.equal(x.request(),null);assert.equal(x.request(3),null);assert.equal(x.paid(),0);
});
test("same Agent accepts only one original candidate not synthetic spawned mine workers",()=>{
 const x=fixture();x.fleets([{source:"player_spawn",systemID:SYSTEM,fleetID:FLEET}]);
 assert.equal(x.request(),null);assert.equal(x.paid(),0);
});
test("native Agent briefing describes real wage, has no fictional missionID",()=>{
 const x=fixture();const b=x.agent.briefing({session:x.session,agentID:AGENT});
 assert.match(b["Mission Briefing ID"],/750\.00 ISK/);
 assert.equal(b["Mission ID"],null);assert.equal(x.paid(),0);
});
test("second live session for same character cannot buy NPC wages",()=>{
 const x=fixture();x.sessions([x.session,{...x.session}]);
 assert.equal(x.request(),null);assert.equal(x.request(3),null);assert.equal(x.paid(),0);
});
