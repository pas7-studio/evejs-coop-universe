import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const core=require("../integration/coopFactionWarCore.cjs");
const {KEY:WAR_KEY,TABLE}=require("../integration/coopFactionWarStore.cjs");
const {KEY:OBJECTIVE_KEY,createWarObjectiveAdjudicator}=
 require("../integration/coopWarObjectiveAdjudicator.cjs");
const {KEY:KILL_KEY,createWarStructureCombatProof}=
 require("../integration/coopWarNativeStructureCombatProof.cjs");
function fixture(){
 const env={EVEJS_COOP_FACTION_WAR:"1",EVEJS_COOP_FACTION_WAR_FLEETS:"1",
  EVEJS_COOP_FACTION_WAR_NATIVE_OBJECTIVES:"1",
  EVEJS_COOP_NATIVE_ATOMIC_ROWS:"1"};
 let now=100000,damageAllowed=true;
 const s=core.empty();
 s.wars.w1={warID:"w1",attackerFactionID:11,defenderFactionID:22,state:"ACTIVE"};
 s.territories["202"]={systemID:202,militaryControllerFactionID:22,
  originalOwnerFactionID:22,state:"CONTESTED",revision:2};
 s.campaigns.c1={campaignID:"c1",warID:"w1",
  state:"ASSAULT",targetSystemID:202,sourceSystemID:101,
  objectiveEvidence:[],revision:2};
 const db=new Map([[WAR_KEY,s]]);
 const structure={structureID:700,typeID:1010,solarSystemID:202,
  ownerCorpID:32,destroyedAt:null,state:7,
  position:{x:0,y:0,z:0}};
 const killmail={killID:9000,solarSystemID:202,
  victimCorporationID:32,victimShipTypeID:1010,
  finalCorporationID:31,victimDamageTaken:1500.5,
  finalDamageDone:150.25};
 const native={getNativeStructure:id=>id===700?structure:null,
  getFactionForCorporation:corp=>corp===32?22:corp===31?11:null,
  getNativeKillmail:id=>id===killmail.killID?killmail:null};
 const gameStore={coopAtomicNativeRows:{transact:([table],fn)=>{
  assert.equal(table,TABLE);
  const txRows=new Map([...db].map(([k,v])=>[k,structuredClone(v)]));
  const tx={get:(_,key)=>txRows.get(key)||null,
   put:(_,key,value)=>txRows.set(key,structuredClone(value))};
  const result=fn(tx);
  db.clear();for(const [k,v] of txRows)db.set(k,v);
  return result;
 }}};
 const proof=createWarStructureCombatProof({gameStore,env,
  clock:()=>now,...native});
 const adjudicator=createWarObjectiveAdjudicator({gameStore,env,
  clock:()=>now,getNativeStructure:native.getNativeStructure,
  getFactionForCorporation:native.getFactionForCorporation,
  verifyNativeCombatDestruction:x=>damageAllowed&&
   proof.verifyNativeCombatDestruction(x),
  observeNativeControl:d=>({status:"UNCONTESTED_NATIVE_ATTACKER",
   systemID:202,attackerFactionID:11,defenderFactionID:22,
   attackerCount:1,defenderCount:0,physicalProof:true})});
 const payload=()=>({targetEntity:{itemID:700,kind:"structure",typeID:1010,
   systemID:202,ownerCorpID:32},
  attackerEntity:{itemID:501,kind:"ship",corporationID:31},
  destroyResult:{success:true,data:{structure:{destroyedAt:now}}},
  record:{...killmail}});
 const bind={eventID:"b-c1",campaignID:"c1",
  structureID:700,expectedRevision:2};
 const neutral={eventID:"n-c1",campaignID:"c1",
  structureID:700,expectedRevision:2,combatProofID:"structure-kill:9000"};
 return {env,db,structure,killmail,proof,adjudicator,payload,
  bind,neutral,now:()=>now,
  tick:ms=>{now+=ms},disableCombat:()=>{damageAllowed=false}};
}
test("native killmail proof binds structure ID not present in vanilla killmail record",()=>{
 const f=fixture();
 assert.equal(f.adjudicator.bind(f.bind).status,"APPLIED");
 f.tick(1000);f.structure.destroyedAt=f.now();
 const recorded=f.proof.noteFromNativeKillmail(f.payload());
 assert.equal(recorded.status,"RECORDED");
 assert.equal(recorded.receipt.structureID,700);
 assert.equal(recorded.receipt.killID,9000);
 assert.equal(recorded.receipt.damageTaken,1500.5);
 assert.equal(f.db.get(KILL_KEY).byStructure["700"].proofID,"structure-kill:9000");
 assert.equal(f.adjudicator.neutralize(f.neutral).status,"APPLIED");
 assert.equal(f.db.get(WAR_KEY).campaigns.c1.objectiveEvidence.length,1);
});
test("destroyedAt from GM action alone grants no objective and no receipt",()=>{
 const f=fixture();f.adjudicator.bind(f.bind);
 f.tick(1000);f.structure.destroyedAt=f.now();
 assert.equal(f.adjudicator.neutralize(f.neutral).reason,
  "NATIVE_COMBAT_DESTRUCTION_NOT_PROVEN");
 assert.equal(f.db.get(KILL_KEY),undefined);
 assert.equal(f.db.get(WAR_KEY).campaigns.c1.objectiveEvidence.length,0);
});
test("combat hook refuses to persist killmail for unbound military structure",()=>{
 const f=fixture();f.structure.destroyedAt=f.now();
 assert.equal(f.proof.noteFromNativeKillmail(f.payload()).reason,
  "NO_BOUND_WAR_STRUCTURE");
 assert.equal(f.db.get(KILL_KEY),undefined);
});
test("native killmail with wrong corporation/weapon damage/faction refuses origin",()=>{
 const f=fixture();f.adjudicator.bind(f.bind);
 f.tick(1000);f.structure.destroyedAt=f.now();
 const forged=f.payload();forged.record.finalCorporationID=999;
 assert.equal(f.proof.noteFromNativeKillmail(forged).reason,
  "STORED_NATIVE_COMBAT_KILLMAIL_UNVERIFIED");
 const noDamage=f.payload();noDamage.record.finalDamageDone=0;
 assert.equal(f.proof.noteFromNativeKillmail(noDamage).reason,
  "NOT_NATIVE_STRUCTURAL_COMBAT_KILL");
 const wrongID=f.payload();wrongID.targetEntity.itemID=701;
 assert.equal(f.proof.noteFromNativeKillmail(wrongID).reason,
  "STRUCTURE_NOT_PREBOUND_TO_ASSAULT");
 assert.equal(f.db.get(KILL_KEY),undefined);
});
test("native killmail source cannot be replayed as a second lethal structure",()=>{
 const f=fixture();f.adjudicator.bind(f.bind);
 f.tick(1000);f.structure.destroyedAt=f.now();
 const input=f.payload();
 assert.equal(f.proof.noteFromNativeKillmail(input).status,"RECORDED");
 assert.equal(f.proof.noteFromNativeKillmail(input).status,"DUPLICATE");
 const other=f.payload();other.record.killID=9001;
 assert.equal(f.proof.noteFromNativeKillmail(other).reason,
  "STORED_NATIVE_COMBAT_KILLMAIL_UNVERIFIED");
 assert.equal(Object.keys(f.db.get(KILL_KEY).byStructure).length,1);
});
test("native killmail proof cannot be used after source record is changed",()=>{
 const f=fixture();f.adjudicator.bind(f.bind);
 f.tick(1000);f.structure.destroyedAt=f.now();
 assert.equal(f.proof.noteFromNativeKillmail(f.payload()).status,"RECORDED");
 f.killmail.finalCorporationID=777;
 assert.equal(f.adjudicator.neutralize(f.neutral).reason,
  "NATIVE_COMBAT_DESTRUCTION_NOT_PROVEN");
 assert.equal(f.db.get(WAR_KEY).campaigns.c1.objectiveEvidence.length,0);
});
test("native killmail source and four live observations capture only military control",()=>{
 const f=fixture();f.adjudicator.bind(f.bind);
 f.tick(1000);f.structure.destroyedAt=f.now();
 assert.equal(f.proof.noteFromNativeKillmail(f.payload()).status,"RECORDED");
 assert.equal(f.adjudicator.neutralize(f.neutral).status,"APPLIED");
 for(let i=1;i<=4;i++){
  f.tick(30000);
  assert.equal(f.adjudicator.sample({
   campaignID:"c1",eventID:"s"+i,expectedRevision:3
  }).status,"APPLIED");
 }
 const result=f.adjudicator.capture({
  campaignID:"c1",eventID:"capture",expectedRevision:3,
  captureProofID:"verified-native-siege"});
 assert.equal(result.status,"APPLIED");
 assert.equal(f.db.get(WAR_KEY).campaigns.c1.state,"OCCUPIED");
 assert.equal(f.db.get(WAR_KEY).territories["202"].militaryControllerFactionID,11);
 assert.equal(f.db.get(WAR_KEY).territories["202"].originalOwnerFactionID,22);
 assert.equal(f.db.get(KILL_KEY).byStructure["700"].killID,9000);
});
