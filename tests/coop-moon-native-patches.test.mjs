import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {Script} from 'node:vm';
const require=createRequire(import.meta.url);
const read=require('../scripts/coop-moon-extraction-read-patch.cjs');
const fuel=require('../scripts/coop-moon-fuel-output-patch.cjs');
const fence=require('../integration/coopMoonFuelOutputFence.cjs');
const srcRead=`class MoonExtractionsService {
  Handle_GetExtractionAndEventIDFromStructureID(args = [], session) {
    const structureID=args[0];
    const extraction = structureID ? {} : null;
    return extraction;
  }
  Handle_GetExtractionsForCorp(args = [], session) {
    const corpID=args[0];
    const rows = Object.values(this._getState().extractions)
      .filter(Boolean);
    return rows;
  }
  Handle_GetMoonResourcesForStructure(args = [], session) {
    const structureID=args[0];
    const profile = structureID ? {} : null;
    return profile;
  }
  Handle_StartNewExtraction(args = [], session) {
    const structureID=args[0];
    const profile={structureID,ownerID:20,moonID:3,solarSystemID:44};
    const access={structure:{structureID,ownerCorpID:20,moonID:3,solarSystemID:44}};
    const state={};
    const existing = getActiveExtractionForStructure(state, structureID);
    return existing;
  }
  Handle_FractureChunkWithStructure(args = [], session) {return null;}
}`;
const srcFuel=`function prepareAutoMoonMinerServiceStateTransition(
  structure, serviceID, serviceState, options = {},
) {
  const profile = {serviceID:10};
  const fuelResult = consumeMetenoxFuel(1,profile,5,0);
  return fuelResult;
}
function clearOfflineAutoMoonFuelState(structure, profile, nowMs) {return structure;}
function applyAutoMoonMinerFuelCycle(structure, nowMs = Date.now()) {
  const profile = {serviceID:10};
  const fuelResult = consumeMetenoxFuel(1,profile,5,200);
  return fuelResult;
}
module.exports = {applyAutoMoonMinerFuelCycle};`;
test('read patch is bounded, reversible, idempotent and LF/CRLF exact',()=>{
 for(const source of [srcRead,srcRead.replace(/\n/g,'\r\n')]){
  const applied=read.patch(source,read.FILE);
  assert.equal(read.specs.every(x=>applied.includes(x.statement)),true);
  assert.equal(read.patch(applied,read.FILE),applied);
  assert.equal(read.patch(applied,read.FILE,{remove:true}),source);
  assert.equal(read.patch(source,read.FILE,{remove:true}),source);
  new Script(applied);
 }
});
test('read patch denies mismatched or tampered native functions',()=>{
 assert.throws(()=>read.patch(srcRead,'wrong.js'),/UNSUPPORTED/);
 assert.throws(()=>read.patch(srcRead.replace('    const rows = Object.values(this._getState().extractions)','    const rows = []'),read.FILE),/ANCHOR_MISMATCH/);
 assert.throws(()=>read.patch(srcRead+'\n'+srcRead,read.FILE),/CONTEXT_MISMATCH/);
});
test('moon read flag OFF unchanged and flag ON calls 3 native checks',()=>{
 const patched=read.patch(srcRead,read.FILE);
 const permissions=require('../integration/coopMoonExtractionReadAccess.cjs');
 const session={characterID:1,corporationID:20};
 const nativeRequire=()=>permissions;
 const compile=flag=>new Function('require','process','structureState','throwWrappedUserError','getActiveExtractionForStructure',patched+';return MoonExtractionsService;')(
   nativeRequire,{env:{EVEJS_COOP_NATIVE_MOON_READ_ACL:flag}},
   {getStructureByID:id=>({structureID:id,ownerCorpID:20,ownerID:20})},e=>{throw Error(e)},()=>null);
 for(const flag of ['0','1']){
  const S=compile(flag),s=new S();s._getState=()=>({extractions:{a:{}}});
  assert.ok(s.Handle_GetExtractionAndEventIDFromStructureID([501],session));
  assert.ok(s.Handle_GetExtractionsForCorp([20],session));
  assert.ok(s.Handle_GetMoonResourcesForStructure([501],session));
  assert.equal(s.Handle_StartNewExtraction([501],session),null);
 }
 const S=compile('1'),s=new S();s._getState=()=>({extractions:{a:{}}});
 assert.throws(()=>s.Handle_GetExtractionsForCorp([21],session),/StructureDefenseDenied/);
});
test('fuel patch is bounded, reversible, idempotent and LF/CRLF exact',()=>{
 for(const source of [srcFuel,srcFuel.replace(/\n/g,'\r\n')]){
  const applied=fuel.patch(source,fuel.FILE);
  assert.equal(fuel.specs.every(x=>applied.includes(x.statement)),true);
  assert.equal(fuel.patch(applied,fuel.FILE),applied);
  assert.equal(fuel.patch(applied,fuel.FILE,{remove:true}),source);
  assert.equal(fuel.patch(source,fuel.FILE,{remove:true}),source);
  new Script(applied);
 }
});
test('fuel patch refuses missing anchors and unsupported paths',()=>{
 assert.throws(()=>fuel.patch(srcFuel,'nope'),/UNSUPPORTED/);
 assert.throws(()=>fuel.patch(srcFuel.replace('const fuelResult = consumeMetenoxFuel','const consumed = consumeMetenoxFuel'),fuel.FILE),/ANCHOR_MISMATCH/);
 assert.throws(()=>fuel.patch(srcFuel+srcFuel,fuel.FILE),/CONTEXT_MISMATCH/);
});
test('opt-in fuel fence prevents fuel payment on both native service activation and hourly tick',()=>{
 const patched=fuel.patch(srcFuel,fuel.FILE);
 for(const flag of ['0','1']){
  let consumed=0;
  const instance=new Function('require','process','consumeMetenoxFuel','offlineAutoMoonService',
    patched.replace('module.exports = {applyAutoMoonMinerFuelCycle};','')+
    ';return [prepareAutoMoonMinerServiceStateTransition,applyAutoMoonMinerFuelCycle];')(
      ()=>fence,{env:{EVEJS_COOP_NATIVE_MOON_OUTPUT_FENCE:flag}},
      ()=>{consumed++;return {success:true}},
      ()=>({changed:true,blocked:true}));
  if(flag==='0'){
   assert.equal(instance[0]({},10,1).success,true);
   assert.equal(instance[1]({},10).success,true);
   assert.equal(consumed,2);
  }else{
   assert.equal(instance[0]({},10,1).errorMsg,fence.CODE);
   assert.equal(instance[1]({},10).blocked,true);
   assert.equal(consumed,0);
  }
 }
});
