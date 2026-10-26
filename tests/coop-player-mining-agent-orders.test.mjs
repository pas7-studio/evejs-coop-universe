import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createMiningAgentOrderMenu,availableCommands}=require("../integration/coopPlayerMiningAgentOrders.cjs");
const SYSTEM=30000144,CORP=81001,NPC=81002,AGENT=9001;
const OP=n=>"coop-mining-shift:"+String(n).padStart(32,"a");
function fixture(){
 const session={characterID:1001,userid:88,corporationID:CORP,socket:{destroyed:false}};
 const agent={agentID:AGENT,stationID:600001,corporationID:NPC,solarSystemID:SYSTEM};
 let now=1793030000000,enabled=true,allow=true,docked=true,throwing=false;
 const issued=[],events=[];
 const row=(fleetID,directive="MINE",commandState="NATIVE_REQUESTED",commandSeq=2)=>({
  version:1,status:"FUNDED",corporationID:CORP,employerCorpID:NPC,
  systemID:SYSTEM,fleetID,operationID:OP(fleetID),directive,commandState,commandSeq
 });
 const rows=[row(101),row(102,"HOLD")];
 const menu=createMiningAgentOrderMenu({enabled:()=>enabled,clock:()=>now,
  access:{isMember:()=>allow,canIndustry:()=>allow},
  verifyAgentContact:()=>docked,
  assignOrder:v=>{issued.push(v);if(throwing)throw Error("LOST_ACK");
    return {status:"ORDER_QUEUED",commandSeq:v.expectedSeq+1}},
  observe:(e,v)=>events.push([e,v])});
 const interact=(actionID=null,r=rows,s=session)=>menu.interact({session:s,agent,rows:r,actionID});
 return {session,agent,rows,row,menu,interact,issued,events,now:v=>now=v,
  enabled:v=>enabled=v,allow:v=>allow=v,docked:v=>docked=v,throwing:v=>throwing=v};
}
test("original native funded MINE shift exposes HOLD HAUL RETREAT",()=>{
 const x=fixture();assert.deepEqual(availableCommands(x.rows[0]),["HOLD","HAUL","RETREAT"]);
 assert.deepEqual(availableCommands(x.rows[1]),["MINE","RETREAT"]);
});
test("source native IDLE MINE supports only the initial MINE",()=>{
 const x=fixture();assert.deepEqual(availableCommands(x.row(103,"MINE","IDLE",0)),["MINE"]);
});
test("HAUL, RETREAT, PENDING, ISSUING and DISPATCH_UNKNOWN cannot be overridden",()=>{
 const x=fixture();for(const state of ["PENDING","ISSUING","DISPATCH_UNKNOWN"])
  assert.deepEqual(availableCommands(x.row(103,"MINE",state)),[]);
 assert.deepEqual(availableCommands(x.row(103,"HAUL")),[]);
 assert.deepEqual(availableCommands(x.row(103,"RETREAT")),[]);
});
test("OFF creates no new in-game action or server mutation",()=>{
 const x=fixture();x.enabled(false);
 assert.equal(x.interact().reason,"CORPORATION_OR_STATION_AUTHORITY_DENIED");
 assert.equal(x.issued.length,0);
});
test("stock View Mission previews one verified fleet+command, does not issue",()=>{
 const x=fixture();const r=x.interact(1);
 assert.equal(r.status,"PREVIEW");assert.equal(r.selected.fleetID,101);
 assert.equal(r.selected.command,"HOLD");
 assert.deepEqual(r.actions,[[2,2],[3,3],[1,1]]);
 assert.equal(x.issued.length,0);
});
test("Request Mission cycles through real candidate orders and fleets",()=>{
 const x=fixture();x.interact(1);
 const visited=[];for(let i=0;i<5;i++)visited.push(x.interact(2).selected.command+":"+x.interact(1).selected.fleetID);
 assert.deepEqual(visited,["HAUL:101","RETREAT:101","MINE:102","RETREAT:102","HOLD:101"]);
 assert.equal(x.issued.length,0);
});
test("Accept without a prior View can never issue",()=>{
 const x=fixture();assert.equal(x.interact(3).reason,"REOPEN_NATIVE_AGENT_TO_CONFIRM_ORDER");
 assert.equal(x.issued.length,0);
});
test("Accept after View issues exactly selected native fleet/command and revision",()=>{
 const x=fixture();x.interact(1);x.interact(2);x.interact(2);
 const r=x.interact(3);
 assert.equal(r.status,"ORDER_QUEUED");assert.equal(x.issued.length,1);
 assert.equal(x.issued[0].fleetID,101);assert.equal(x.issued[0].command,"RETREAT");
 assert.equal(x.issued[0].expectedSeq,2);
 assert.equal(x.issued[0].operationID,OP(101));
 assert.equal(x.events.length,1);assert.equal(x.events[0][1].status,"ORDER_QUEUED");
});
test("double Accept never reuses session command selection",()=>{
 const x=fixture();x.interact(1);x.interact(3);
 assert.equal(x.interact(3).reason,"REOPEN_NATIVE_AGENT_TO_CONFIRM_ORDER");
 assert.equal(x.issued.length,1);
});
test("expired View pin never issues a native warp or cargo move",()=>{
 const x=fixture();x.interact(1);x.now(1793030000000+120001);
 assert.equal(x.interact(3).reason,"REOPEN_NATIVE_AGENT_TO_CONFIRM_ORDER");
 assert.equal(x.issued.length,0);
});
test("revoked corp role or station contact before Accept fails closed",()=>{
 for(const fail of [x=>x.allow(false),x=>x.docked(false)]){
  const x=fixture();x.interact(1);fail(x);
  assert.equal(x.interact(3).reason,"CORPORATION_OR_STATION_AUTHORITY_DENIED");
  assert.equal(x.issued.length,0);
 }
});
test("native GameStore command revision changes invalidate stale View selection",()=>{
 const x=fixture();x.interact(1);x.rows[0].commandSeq++;
 assert.equal(x.interact(3).reason,"REOPEN_NATIVE_AGENT_TO_CONFIRM_ORDER");
 assert.equal(x.issued.length,0);
});
test("physical original shift disappearing invalidates selected order",()=>{
 const x=fixture();x.interact(1);x.rows.splice(0,1);
 assert.equal(x.interact(3).reason,"REOPEN_NATIVE_AGENT_TO_CONFIRM_ORDER");
 assert.equal(x.issued.length,0);
});
test("duplicate or foreign player corp fleet rows fail closed without automatic selection",()=>{
 const x=fixture();x.interact(1,[x.rows[0],x.rows[0]]);
 assert.equal(x.interact(3,[x.rows[0],x.rows[0]]).reason,"CORPORATION_OR_STATION_AUTHORITY_DENIED");
 assert.equal(x.interact(3,[{...x.rows[0],corporationID:999}]).reason,"CORPORATION_OR_STATION_AUTHORITY_DENIED");
 assert.equal(x.issued.length,0);
});
test("unknown stock client action 5/6/7/9 is never mapped to a command",()=>{
 const x=fixture();x.interact(1);
 for(const a of [5,6,7,9,900])assert.equal(x.interact(a).reason,"UNSUPPORTED_STOCK_AGENT_ACTION");
 assert.equal(x.issued.length,0);
});
test("same character with a new session object cannot reuse another login selection",()=>{
 const x=fixture();x.interact(1);
 const other={...x.session};
 assert.equal(x.interact(3,x.rows,other).reason,"REOPEN_NATIVE_AGENT_TO_CONFIRM_ORDER");
 assert.equal(x.issued.length,0);
});
test("agent selector cannot issue a command if native receipt ACK is uncertain",()=>{
 const x=fixture();x.interact(1);x.throwing(true);
 assert.equal(x.interact(3).reason,"NATIVE_MINING_ORDER_OUTCOME_UNKNOWN");
 x.throwing(false);assert.equal(x.interact(3).reason,"REOPEN_NATIVE_AGENT_TO_CONFIRM_ORDER");
 assert.equal(x.issued.length,1);
});
test("a healthy telemetry observer cannot mutate or veto a native command",()=>{
 const x=fixture();x.interact(1);x.interact(3);
 assert.equal(x.events[0][1].fleetID,101);
 assert.equal(x.issued.length,1);
});
test("no viable native command has no Accept button",()=>{
 const x=fixture();const rows=[x.row(200,"HAUL"),x.row(201,"MINE","PENDING")];
 const r=x.interact(1,rows);assert.equal(r.status,"NO_SAFE_ORDER");
 assert.deepEqual(r.actions,[[1,1]]);assert.equal(x.issued.length,0);
});

test("native cargo transit exposes only safely deferred HOLD, no HAUL or RETREAT",()=>{
 const x=fixture();x.rows[0].nativeState="haulereturn";
 assert.deepEqual(availableCommands(x.rows[0]),["HOLD"]);
 x.rows[0].nativeState="loaded";
 assert.deepEqual(availableCommands(x.rows[0]),["HOLD"]);
});
test("native NPC combat phase keeps RETREAT visible but never peaceful HAUL",()=>{
 const x=fixture();x.rows[0].nativeState="panic";
 assert.deepEqual(availableCommands(x.rows[0]),["RETREAT"]);
 x.rows[0].nativeState="aggressed";
 assert.deepEqual(availableCommands(x.rows[0]),["RETREAT"]);
});
test("HOLD that has not physically stopped the original miners offers no MINE resume",()=>{
 const x=fixture();x.rows[1].nativeState="hauling";
 assert.deepEqual(availableCommands(x.rows[1]),[]);
 x.rows[1].nativeState="coop-hold";
 assert.deepEqual(availableCommands(x.rows[1]),["MINE","RETREAT"]);
});
test("physical phase change after user preview invalidates old selected command",()=>{
 const x=fixture();x.rows[0].nativeState="mining";x.interact(1);x.interact(2);
 x.rows[0].nativeState="hauling";
 assert.equal(x.interact(3).reason,"REOPEN_NATIVE_AGENT_TO_CONFIRM_ORDER");
 assert.equal(x.issued.length,0);
});

test("native completed HAUL explicitly permits MINE only with original settled state",()=>{
 const x=fixture(),row=x.row(500,"HAUL","NATIVE_COMPLETED");
 row.nativeState="mining";
 assert.deepEqual(availableCommands(row),["MINE"]);
 row.nativeState="haulereturn";
 assert.deepEqual(availableCommands(row),[]);
});
test("native completed RETREAT permits safe original MINE resume but no second warp",()=>{
 const x=fixture(),row=x.row(500,"RETREAT","NATIVE_COMPLETED");
 row.nativeState="retreating";
 assert.deepEqual(availableCommands(row),["MINE"]);
 row.nativeState="panic";
 assert.deepEqual(availableCommands(row),[]);
});
test("uncompleted original HAUL/RETREAT remain locked even when ships appear landed",()=>{
 const x=fixture();for(const cmd of ["HAUL","RETREAT"]){
  const r=x.row(500,cmd,"NATIVE_REQUESTED");
  r.nativeState="mining";
  assert.deepEqual(availableCommands(r),[]);
 }
});
