import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createMiningAgent}=require("../integration/coopPlayerMiningAgent.cjs");
const {createMiningAgentOrderMenu}=require("../integration/coopPlayerMiningAgentOrders.cjs");
const SYS=30000144,NPC=9002,CORP=9003,AGENT=9102;
function fixture(){
 const session={characterID:101,userid:112,corporationID:CORP,socket:{destroyed:false}};
 let role=true,member=true,mission=null,enabled=true,menuEnabled=true,
  docked=true,records=[],issued=[],now=1793030000000;
 const row=(n,cmd="MINE")=>({version:1,status:"FUNDED",
  operationID:"coop-mining-shift:"+String(n).padStart(32,"a"),
  corporationID:CORP,employerCorpID:NPC,systemID:SYS,fleetID:n,
  minerIDs:[200+n],haulerIDs:[300+n],wageCents:1000,
  directive:cmd,commandState:"NATIVE_REQUESTED",commandSeq:3});
 records=[row(10),row(11,"HOLD")];
 const menu=createMiningAgentOrderMenu({enabled:()=>menuEnabled,clock:()=>now,
  access:{isMember:()=>member,canIndustry:()=>role},
  verifyAgentContact:()=>docked,
  assignOrder:r=>{issued.push(r);return {status:"ORDER_QUEUED"}}});
 const agent=createMiningAgent({access:{isMember:()=>member,canIndustry:()=>role},
  enabled:()=>enabled,getAgent:()=>({agentID:AGENT,corporationID:NPC,
   solarSystemID:SYS,stationID:6001,isInSpace:false}),
  getMission:()=>mission,getSessions:()=>[session],
  getFleetRecords:()=>records.map(r=>({fleetID:r.fleetID,systemID:SYS,source:"startup"})),
  inspectShift:f=>records.find(r=>r.fleetID===f.fleetID)||null,
  assignOrder:()=>{throw Error("legacy order path must not run")},
  orderMenu:menu});
 const open=(actionID=null)=>agent.doAction({session,agentID:AGENT,actionID});
 return {session,agent,open,issued,records,
  role:v=>role=v,member:v=>member=v,docked:v=>docked=v,mission:v=>mission=v,
  menu:v=>menuEnabled=v,now:v=>now=v};
}
test("actual Agent routes two paid fleets to safe order selection without guessing",()=>{
 const x=fixture(),r=x.open(1);
 assert.match(r.data.agentSays[0],/Fleet 10 \/ HOLD/);
 assert.deepEqual(r.data.actions,[[2,2],[3,3],[1,1]]);
 assert.equal(x.issued.length,0);
});
test("native Request Mission cycles exact fleet and command, Accept queues selected one",()=>{
 const x=fixture();x.open(1);x.open(2);x.open(2);x.open(2);
 const r=x.open(3);
 assert.match(r.data.agentSays[0],/ORDER_QUEUED/);
 assert.equal(x.issued.length,1);
 assert.equal(x.issued[0].fleetID,11);assert.equal(x.issued[0].command,"MINE");
});
test("normal stock mission wins even with multiple funded miner fleets",()=>{
 const x=fixture();x.mission({missionID:4});
 assert.equal(x.open(),null);assert.equal(x.open(3),null);
 assert.equal(x.issued.length,0);
});
test("non-manager never sees multi-fleet command buttons",()=>{
 const x=fixture();x.role(false);
 const r=x.open(1);
 assert.match(r.data.agentSays[0],/Multiple verified mining shifts/);
 assert.equal(x.open(3).data.actions.length,0);
 assert.equal(x.issued.length,0);
});
test("revoke docked station between View and Accept blocks native shift order",()=>{
 const x=fixture();x.open(1);x.docked(false);
 assert.match(x.open(3).data.agentSays[0],/CORPORATION_OR_STATION_AUTHORITY_DENIED/);
 assert.equal(x.issued.length,0);
});
test("native in-game orders are completely inactive when the D3 flag is OFF",()=>{
 const x=fixture();x.menu(false);
 assert.match(x.open(1).data.agentSays[0],/Multiple verified mining shifts/);
 assert.equal(x.issued.length,0);
});
test("agent briefing is read-only and shows original workflow buttons",()=>{
 const x=fixture();const b=x.agent.briefing({session:x.session,agentID:AGENT});
 assert.match(b["Mission Briefing ID"],/Request Mission browses/);
 assert.equal(b["Mission ID"],null);assert.equal(x.issued.length,0);
});
test("a stale native command revision never issues another Accept from Agent",()=>{
 const x=fixture();x.open(1);x.records[0].commandSeq++;
 assert.match(x.open(3).data.agentSays[0],/REOPEN_NATIVE_AGENT_TO_CONFIRM_ORDER/);
 assert.equal(x.issued.length,0);
});
