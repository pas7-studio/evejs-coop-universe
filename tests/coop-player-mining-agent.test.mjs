import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createMiningAgent}=require("../integration/coopPlayerMiningAgent.cjs");
const CORP=9921,EMPLOYER=2122,SYSTEM=30000001,FLEET=3001,AGENT=8101,STATION=6001;
function make(){
 const session={characterID:901,userid:10,corporationID:CORP,socket:{destroyed:false}};
 let people=[session],otherMission=null,enabled=true,manager=true,member=true,
  agent={agentID:AGENT,stationID:STATION,solarSystemID:SYSTEM,corporationID:EMPLOYER,isInSpace:false},
  fleets=[{fleetID:FLEET,systemID:SYSTEM,source:"startup"}],orders=[],inspectCalls=0;
 const shift={version:1,status:"FUNDED",operationID:"coop-mining-shift:"+"a".repeat(32),
  corporationID:CORP,employerCorpID:EMPLOYER,systemID:SYSTEM,fleetID:FLEET,
  minerIDs:[200,201],haulerIDs:[300],wageCents:12450,
  directive:"MINE",commandState:"IDLE",commandSeq:0};
 const agentSvc=createMiningAgent({enabled:()=>enabled,getAgent:()=>agent,
  getMission:()=>otherMission,getSessions:()=>people,
  getFleetRecords:()=>fleets,inspectShift:()=>{inspectCalls++;return shift;},
  assignOrder:payload=>{orders.push(payload);return {status:"ORDER_QUEUED",commandSeq:payload.expectedSeq+1};},
  access:{isMember:()=>member,canIndustry:()=>manager}});
 return {session,shift,orders,agentSvc,inspectCalls:()=>inspectCalls,
  enable:v=>enabled=v,member:v=>member=v,manager:v=>manager=v,mission:v=>otherMission=v,
  agent:v=>agent=v,sessions:v=>people=v,fleets:v=>fleets=v,
  open:(id=null,s=session)=>agentSvc.doAction({session:s,agentID:AGENT,actionID:id})};
}
test("feature OFF does not intercept any stock agent dialogue",()=>{
 const x=make();x.enable(false);assert.equal(x.open(),null);assert.equal(x.orders.length,0);
});
test("real funded native fleet is visible using stock Agent dialogue response",()=>{
 const x=make(),r=x.open();
 assert.equal(r.success,true);assert.match(r.data.agentSays[0],/original system/);
 assert.match(r.data.agentSays[0],/Paid wage:/);
 assert.deepEqual(r.data.actions,[[3,3],[1,1]]);
});
test("Accept emits only authenticated original GameStore MINE order, not ISK or ore",()=>{
 const x=make(),r=x.open(3);
 assert.match(r.data.agentSays[0],/ORDER_QUEUED/);
 assert.equal(x.orders.length,1);assert.equal(x.orders[0].command,"MINE");
 assert.equal(x.orders[0].fleetID,FLEET);assert.equal(x.orders[0].expectedSeq,0);
});
test("stock agent mission always wins, even when mining shift exists",()=>{
 const x=make();x.mission({missionID:1});
 assert.equal(x.open(),null);assert.equal(x.open(3),null);assert.equal(x.orders.length,0);
});
test("native agent from wrong employer cannot control player's fleet",()=>{
 const x=make();x.agent({agentID:AGENT,stationID:STATION,
  solarSystemID:SYSTEM,corporationID:EMPLOYER+2,isInSpace:false});
 assert.equal(x.open(3),null);assert.equal(x.orders.length,0);
});
test("unauthenticated or revoked corporation member cannot view or issue",()=>{
 const x=make();x.member(false);
 assert.equal(x.open(),null);assert.equal(x.open(3),null);
 x.member(true);x.session.userid=0;assert.equal(x.open(3),null);assert.equal(x.orders.length,0);
});
test("one native live character session required; duplicate login denied",()=>{
 const x=make();x.sessions([x.session,{...x.session}]);
 assert.equal(x.open(),null);assert.equal(x.open(3),null);
});
test("missing/offline agent, in-space agent and ordinary stock locations cannot issue",()=>{
 const x=make();x.agent({agentID:AGENT,solarSystemID:SYSTEM,
  corporationID:EMPLOYER,isInSpace:true,stationID:null});
 assert.equal(x.open(3),null);assert.equal(x.orders.length,0);
});
test("multiple funded original fleets refuse arbitrary implicit selection",()=>{
 const x=make();x.fleets([{fleetID:FLEET,systemID:SYSTEM,source:"startup"},
  {fleetID:FLEET,systemID:SYSTEM,source:"startup"}]);
 const r=x.open(3);assert.match(r.data.agentSays[0],/Multiple verified mining shifts/);
 assert.equal(x.orders.length,0);
});
test("unfunded source or incompatible owner has no new client interaction",()=>{
 const x=make();x.shift.status="CLOSED";assert.equal(x.open(),null);
 x.shift.status="FUNDED";x.shift.corporationID=CORP+1;
 assert.equal(x.open(3),null);assert.equal(x.orders.length,0);
});
test("non-manager can see physical fleet state but no salary or command",()=>{
 const x=make();x.manager(false);const r=x.open();
 assert.match(r.data.agentSays[0],/NPC mining fleet/);
 assert.doesNotMatch(r.data.agentSays[0],/Paid wage:/);
 assert.deepEqual(r.data.actions,[[1,1]]);
 const out=x.open(3);assert.match(out.data.agentSays[0],/permission denied/);
 assert.equal(x.orders.length,0);
});
test("Accept after confirmed MINE dispatch cannot replay order",()=>{
 const x=make();x.shift.commandState="NATIVE_REQUESTED";x.shift.directive="MINE";
 assert.deepEqual(x.open().data.actions,[[1,1]]);
 x.open(3);assert.equal(x.orders.length,0);
});
test("Accept on native HOLD queues MINE resume only with original command seq",()=>{
 const x=make();x.shift.directive="HOLD";x.shift.commandState="NATIVE_REQUESTED";x.shift.commandSeq=7;
 const r=x.open(3);assert.match(r.data.agentSays[0],/ORDER_QUEUED/);
 assert.equal(x.orders[0].expectedSeq,7);assert.equal(x.orders[0].command,"MINE");
});
test("pending/unknown native issue does not advertise a new command",()=>{
 const x=make();x.shift.commandState="ISSUING";x.shift.directive="HOLD";
 assert.deepEqual(x.open().data.actions,[[1,1]]);
});
test("stock agent View never causes command or money mutation",()=>{
 const x=make();x.open();x.open(1);x.open(2);
 assert.equal(x.orders.length,0);
});
test("native mission briefing uses no fake mission or payout ID",()=>{
 const x=make();const b=x.agentSvc.briefing({session:x.session,agentID:AGENT});
 assert.equal(b["Mission ID"],null);assert.match(b["Mission Briefing ID"],/separate from cargo title/);
});
test("arbitrary unknown client agent action cannot issue a different order",()=>{
 const x=make();x.open(234);x.open(9);x.open(6);
 assert.equal(x.orders.length,0);
});
