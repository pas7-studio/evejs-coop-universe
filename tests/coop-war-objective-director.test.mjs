import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createWarObjectiveDirector,typesFromEnv}=
 require("../integration/coopWarObjectiveDirector.cjs");
function fixture(){
 const env={EVEJS_COOP_FACTION_WAR:"1",EVEJS_COOP_FACTION_WAR_FLEETS:"1",
  EVEJS_COOP_FACTION_WAR_NATIVE_OBJECTIVES:"1",
  EVEJS_COOP_NATIVE_ATOMIC_ROWS:"1",EVEJS_COOP_ALIFE:"1",
  EVEJS_COOP_WAR_OBJECTIVE_STRUCTURE_TYPE_IDS:"1010"};
 let now=100000,objective=null,approved=true,structures=[
  {structureID:700,solarSystemID:202,ownerCorpID:32,
   typeID:1010,destroyedAt:null}];
 let record=true,throwBind=false;
 const calls=[];
 const campaign={campaignID:"c1",warID:"w1",targetSystemID:202,
  state:"ASSAULT",revision:2};
 const war={version:1,wars:{w1:{state:"ACTIVE",
  attackerFactionID:11,defenderFactionID:22}},campaigns:{c1:campaign},
  territories:{"202":{state:"CONTESTED",
   militaryControllerFactionID:22,revision:2}}};
 const adjudicator={
  snapshot:()=>({status:"OBSERVED",
   objective:objective?{...objective}:null}),
  bind:c=>{
   calls.push({kind:"BIND",command:c});
   if(throwBind)throw Error("SQLITE_COMMIT_UNKNOWN");
   objective={campaignID:c.campaignID,state:"BOUND",structureID:700};
   return {status:"APPLIED",receipt:{kind:"BIND"}};
  },
  neutralize:c=>{
   calls.push({kind:"NEUTRALIZE",command:c});
   objective.state="NEUTRALIZED";campaign.revision=3;
   return {status:"APPLIED",receipt:{kind:"NEUTRALIZE"}};
  },
  sample:c=>{
   calls.push({kind:"SAMPLE",command:c});
   const count=calls.filter(x=>x.kind==="SAMPLE").length;
   return {status:"APPLIED",receipt:{kind:"SAMPLE",
    consecutiveSamples:count,captureReady:count>=4}};
  },
  capture:c=>{
   calls.push({kind:"CAPTURE",command:c});
   objective.state="CAPTURED";campaign.state="OCCUPIED";
   return {status:"APPLIED",receipt:{revision:4}};
  }
 };
 const director=createWarObjectiveDirector({adjudicator,
  combatProof:{receiptForStructure:()=>record?
   {status:"VERIFIED",receipt:{structureID:700,killID:9000,
    proofID:"structure-kill:9000"}}:{status:"NO_NATIVE_COMBAT_RECEIPT"}},
  readWarState:()=>war,listNativeStructures:()=>structures,
  getFactionForCorporation:corp=>corp===32?22:11,
  clock:()=>now,env,maxOperations:2});
 return {director,env,war,campaign,calls,adjudicator,
  clock:ms=>now+=ms,
  structures:x=>structures=x,receipt:x=>record=x,
  throwBind:x=>throwBind=x,
  tick:()=>director.tick({systemIDs:[202]})};
}
test("approved real native defender structure is bound to active war",()=>{
 const f=fixture();
 const out=f.tick();
 assert.equal(out.status,"OBSERVED");
 assert.equal(out.events[0].kind,"BOUND");
 assert.equal(f.calls[0].command.structureID,700);
 assert.equal(f.calls[0].command.expectedRevision,2);
});
test("no approved real structure type, no objective binding and no arbitrary target",()=>{
 const f=fixture();
 f.env.EVEJS_COOP_WAR_OBJECTIVE_STRUCTURE_TYPE_IDS="";
 assert.equal(f.tick().status,"NO_APPROVED_OBJECTIVE_TYPES");
 assert.equal(f.calls.length,0);
 f.env.EVEJS_COOP_WAR_OBJECTIVE_STRUCTURE_TYPE_IDS="1010";
 f.structures([{structureID:701,typeID:999,solarSystemID:202,
  ownerCorpID:32,destroyedAt:null}]);
 assert.equal(f.tick().events.length,0);
});
test("ambiguous two identical native defense objectives do not select at random",()=>{
 const f=fixture();f.structures([
  {structureID:700,typeID:1010,solarSystemID:202,
   ownerCorpID:32,destroyedAt:null},
  {structureID:701,typeID:1010,solarSystemID:202,
   ownerCorpID:32,destroyedAt:null}]);
 assert.equal(f.tick().events.length,0);
 assert.equal(f.calls.length,0);
});
test("source-proven killmail then four observations drives genuine military control transition",()=>{
 const f=fixture();
 assert.equal(f.tick().events[0].kind,"BOUND");
 f.clock(30000);
 assert.equal(f.tick().events[0].kind,"NEUTRALIZED");
 for(let i=1;i<=4;i++){
  f.clock(30000);
  const out=f.tick();
  if(i===4){
   assert.deepEqual(out.events.map(x=>x.kind),
    ["OBSERVED","MILITARY_CONTROL_CAPTURED"]);
  }else assert.deepEqual(out.events.map(x=>x.kind),["OBSERVED"]);
 }
 assert.equal(f.campaign.state,"OCCUPIED");
 assert.deepEqual(f.calls.map(x=>x.kind),
  ["BIND","NEUTRALIZE","SAMPLE","SAMPLE","SAMPLE","SAMPLE","CAPTURE"]);
});
test("missing true combat killmail never neutralizes objective or captures",()=>{
 const f=fixture();f.tick();f.receipt(false);
 f.clock(30000);
 assert.equal(f.tick().events.length,0);
 assert.equal(f.calls.length,1);
 assert.equal(f.campaign.state,"ASSAULT");
});
test("native SQLite unknown outcome prevents further war objective mutations",()=>{
 const f=fixture();f.throwBind(true);
 assert.equal(f.tick().status,"WAR_OBJECTIVE_COMMIT_UNCERTAIN");
 assert.equal(f.calls.length,1);
});
test("headless or other systems cannot secretly capture offline",()=>{
 const f=fixture();
 assert.equal(f.director.tick({systemIDs:[]}).events.length,0);
 assert.equal(f.director.tick({systemIDs:[303]}).events.length,0);
 assert.equal(f.calls.length,0);
});
test("feature gates off by default block native objective mutations",()=>{
 const f=fixture();
 f.env.EVEJS_COOP_FACTION_WAR_NATIVE_OBJECTIVES="0";
 assert.equal(f.tick().status,"DISABLED");
 assert.equal(f.calls.length,0);
});
test("type allowlist refuses unsafe, negative and out-of-range values",()=>{
 assert.equal(typesFromEnv({
  EVEJS_COOP_WAR_OBJECTIVE_STRUCTURE_TYPE_IDS:"1010,-1"}).size,0);
 assert.equal(typesFromEnv({
  EVEJS_COOP_WAR_OBJECTIVE_STRUCTURE_TYPE_IDS:"999999999999999999999"}).size,0);
 assert.deepEqual([...typesFromEnv({
  EVEJS_COOP_WAR_OBJECTIVE_STRUCTURE_TYPE_IDS:"1010, 1011"})],
  [1010,1011]);
});
