import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {audit,HOUR_MS}=require('../integration/coopMoonNativeCycleAudit.cjs');
const types={34:{typeID:34,groupID:1136,volume:0.1},81143:{typeID:81143,groupID:5000,volume:0.2},16666:{typeID:16666,groupID:427,volume:1}};
const lookupType=id=>types[id]||null;
const item=(id,type,quantity,flag,ownerID=20)=>({itemID:id,typeID:type,quantity,stacksize:quantity,singleton:0,flagID:flag,locationID:4501,ownerID});
function build(){return {
 before:{structureID:4501,ownerCorpID:20,typeID:81826,devFlags:{autoMoonFuelState:{nextCycleAt:100*HOUR_MS}}},
 after:{structureID:4501,ownerCorpID:20,typeID:81826,devFlags:{autoMoonFuelState:{nextCycleAt:101*HOUR_MS}}},
 profile:{structureID:4501,ownerID:20,moonID:5001,autoMoonMiningCycleOutput:{16666:30}},
 fuelProfile:{typeID:81826, fuelGroupID:1136,hourlyFuelBlocks:5,hourlyMagmaticGas:200},
 fuelBefore:[item(1,34,15,172),item(2,81143,300,172)],fuelAfter:[item(1,34,10,172),item(2,81143,100,172)],
 materialsBefore:[item(3,16666,80,186)],materialsAfter:[item(3,16666,110,186)],lookupType
};}
test('matching actual native inventory deltas are not falsely claimed as an atomic transaction',()=>{
 const r=audit(build());assert.equal(r.status,'MATCHED_NATIVE_BALANCES_NOT_ATOMIC_PROOF');
 assert.equal(r.cycles,1);assert.equal(r.materialDeltas['16666'],30);
 assert.equal(r.atomicityVerified,false);assert.equal(r.gameplayVerified,false);
});
test('fuel without output is a hard failure, not success',()=>{
 const v=build();v.materialsAfter=v.materialsBefore;
 assert.equal(audit(v).status,'FUEL_BURNED_WITHOUT_MOON_OUTPUT');
});
test('partial, inflated and negative output changes are rejected',()=>{
 for(const q of [109,111,70]){
  const v=build();v.materialsAfter=[item(3,16666,q,186)];
  assert.equal(audit(v).status,'MOON_OUTPUT_QUANTITY_MISMATCH');
 }
});
test('fuel underpayment, missing gas and invented fuel inputs reject',()=>{
 for(const q of [9,11,15]){const v=build();v.fuelAfter[0].quantity=q;v.fuelAfter[0].stacksize=q;
  assert.equal(audit(v).status,'NATIVE_FUEL_DEBIT_MISMATCH');}
 const w=build();w.fuelAfter[1].quantity=300;w.fuelAfter[1].stacksize=300;
 assert.equal(audit(w).status,'NATIVE_FUEL_DEBIT_MISMATCH');
});
test('native item owner, bay flag, location, type and duplicate itemID are mandatory',()=>{
 for(const change of [{ownerID:21},{locationID:7777},{flagID:172},{typeID:999},{itemID:0}]){
  const v=build();v.materialsAfter=[{...v.materialsAfter[0],...change}];
  assert.equal(audit(v).status,'INVALID_NATIVE_INVENTORY_SNAPSHOT');
 }
 const dup=build();dup.materialsAfter=[...dup.materialsAfter,dup.materialsAfter[0]];
 assert.equal(audit(dup).status,'INVALID_NATIVE_INVENTORY_SNAPSHOT');
});
test('owner changes, destroyed/reforced structure and false corp identity are never treated as output proof',()=>{
 for(const patch of [{ownerCorpID:21},{destroyedAt:999},{structureID:5501},{typeID:999}]){
  const v=build();Object.assign(v.after,patch);
  assert.equal(audit(v).status,'INVALID_NATIVE_MOON_STRUCTURE');
 }
});
test('wrong, replayed or too many fuel cycle hours fail',()=>{
 for(const next of [100*HOUR_MS,100*HOUR_MS+999,200*HOUR_MS]){
  const v=build();v.after.devFlags.autoMoonFuelState.nextCycleAt=next;
  assert.ok(['INVALID_FUEL_CYCLE','UNBOUNDED_CATCHUP'].includes(audit(v).status));
 }
});
test('no authored moon output, guessed moon ID, wrong fuel profile refuse production',()=>{
 for(const patch of [{moonID:0},{ownerID:30},{structureID:777}]){
  const v=build();Object.assign(v.profile,patch);
  assert.equal(audit(v).status,'NO_AUTHORITATIVE_MOON_PROFILE');
 }
 const v=build();v.profile.autoMoonMiningCycleOutput={};
 assert.equal(audit(v).status,'NO_AUTHORED_MOON_OUTPUT');
 const x=build();x.profile.autoMoonMiningCycleOutput={34:10};
 assert.equal(audit(x).status,'INVALID_MOON_OUTPUT_RECIPE');
});
