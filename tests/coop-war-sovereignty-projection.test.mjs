import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {CLAIM_TYPE_IDS,planProjection,applyProjection}=
 require("../integration/coopWarSovereigntyProjection.cjs");

const warState=()=>({territories:{
 "30000142":{systemID:30000142,militaryControllerFactionID:500011,state:"SECURE"},
 "30000143":{systemID:30000143,militaryControllerFactionID:500014,state:"CONTESTED"},
 "30000144":{systemID:30000144,militaryControllerFactionID:500014,state:"CONTESTED"},
}});

test("military control is reported for every held system",()=>{
 const plan=planProjection({warState:warState()});
 assert.equal(plan.status,"PLANNED");
 assert.equal(plan.systems.length,3);
 assert.deepEqual(plan.systems.map(s=>s.systemID),[30000142,30000143,30000144]);
 assert.equal(plan.systems[0].factionID,500011);
});

test("a native claim needs a real sov structure AND a real claim",()=>{
 const bare=planProjection({warState:warState()});
 assert.equal(bare.counts.NATIVE_SOV_CLAIM,0);
 assert.equal(bare.counts.MILITARY_CONTROL_ONLY_NOT_SDE_SOVEREIGNTY,3);
 for(const system of bare.systems){
  assert.equal(system.mode,"MILITARY_CONTROL_ONLY_NOT_SDE_SOVEREIGNTY");
  assert.equal(system.reason,"NO_NATIVE_SOV_STRUCTURE");
  assert.deepEqual(system.sovStructureIDs,[]);
 }
 const withTcu=planProjection({warState:warState(),
  structures:[{structureID:42,solarSystemID:30000143,
   typeID:CLAIM_TYPE_IDS.TERRITORIAL_CLAIM_UNIT}],
  getSystemSovClaim:()=>({allianceID:99000000})});
 assert.equal(withTcu.counts.NATIVE_SOV_CLAIM,1);
 const claimed=withTcu.systems.find(s=>s.systemID===30000143);
 assert.equal(claimed.mode,"NATIVE_SOV_CLAIM");
 assert.deepEqual(claimed.sovStructureIDs,[42]);
 assert.equal(claimed.nativeClaimAllianceID,99000000);
});

test("a structure without a native claim record is not a claim",()=>{
 const plan=planProjection({warState:warState(),
  structures:[{structureID:42,solarSystemID:30000143,
   typeID:CLAIM_TYPE_IDS.INFRASTRUCTURE_HUB}],
  getSystemSovClaim:()=>null});
 const system=plan.systems.find(s=>s.systemID===30000143);
 assert.equal(system.mode,"MILITARY_CONTROL_ONLY_NOT_SDE_SOVEREIGNTY");
 assert.equal(system.reason,"NATIVE_CLAIM_NOT_WRITTEN");
 assert.deepEqual(system.sovStructureIDs,[42]);
});

test("a non-claim structure never backs a claim",()=>{
 const plan=planProjection({warState:warState(),
  structures:[{structureID:1,solarSystemID:30000143,typeID:35832}],
  getSystemSovClaim:()=>({allianceID:99000000})});
 assert.equal(plan.counts.NATIVE_SOV_CLAIM,0);
});

test("nothing is written for military control only",()=>{
 const plan=planProjection({warState:warState()});
 const writes=[];
 const applied=applyProjection({plan,writeClaim:system=>{
  writes.push(system.systemID);
  return {status:"APPLIED"};
 }});
 assert.equal(applied.status,"NO_NATIVE_CLAIM_TO_WRITE");
 assert.equal(writes.length,0);
 assert.equal(applied.refused.length,3);
});

test("a real claim is written through the caller's native writer only",()=>{
 const plan=planProjection({warState:warState(),
  structures:[{structureID:42,solarSystemID:30000143,
   typeID:CLAIM_TYPE_IDS.TERRITORIAL_CLAIM_UNIT}],
  getSystemSovClaim:()=>({allianceID:99000000})});
 const writes=[];
 const applied=applyProjection({plan,writeClaim:system=>{
  writes.push(system.systemID);
  return {status:"APPLIED"};
 }});
 assert.equal(applied.status,"PROJECTED");
 assert.deepEqual(writes,[30000143]);
 assert.equal(applyProjection({plan}).reason,"NATIVE_SOV_WRITER_REQUIRED");
});

test("a missing territory record is refused, not guessed",()=>{
 assert.equal(planProjection({}).reason,"NO_WAR_TERRITORY");
 assert.equal(planProjection({warState:{}}).reason,"NO_WAR_TERRITORY");
 assert.equal(applyProjection({}).reason,"NO_PLAN");
});
