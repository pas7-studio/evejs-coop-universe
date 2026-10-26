import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const factory=require('../integration/coopStructureFactory.cjs');

// A real structure type row as structureState.getStructureTypeByID returns it.
const ASTRAHUS={typeID:35832,name:'Astrahus',defaultQuantumCoreTypeID:56201};
const TYPES=new Map([[35832,ASTRAHUS]]);
const resolveStructureType=id=>TYPES.get(Number(id))||null;
// 1000043 really belongs to faction 500014 in the coop world.
const factionForCorporation=id=>Number(id)===1000043?500014:0;

const base={systemID:30000144,typeID:35832,factionID:500014,ownerCorpID:1000043,
 position:{x:1000,y:-2000,z:3000},name:'Perimeter Anchor',nowMs:1700000000000};
const deps={resolveStructureType,factionForCorporation};

test('plan produces a normalized record from real inputs',()=>{
 const result=factory.plan(base,deps);
 assert.equal(result.status,'PLANNED');
 const record=result.record;
 assert.equal(record.typeID,35832);
 assert.equal(record.solarSystemID,30000144);
 assert.equal(record.ownerCorpID,1000043);
 assert.equal(record.ownerID,1000043);
 assert.equal(record.name,'Perimeter Anchor');
 assert.equal(record.itemName,'Perimeter Anchor');
 assert.deepEqual(record.position,{x:1000,y:-2000,z:3000});
 assert.deepEqual(record.rotation,[0,0,0]);
 assert.equal(record.state,factory.SHIELD_VULNERABLE);
 assert.equal(record.stateStartedAt,1700000000000);
 assert.equal(record.upkeepState,factory.FULL_POWER);
 assert.equal(record.hasQuantumCore,true);
 assert.equal(record.quantumCoreItemTypeID,56201);
 assert.equal(record.devFlags.coop.factionID,500014);
 assert.equal(record.devFlags.coop.factory,factory.DEFAULT_FACTORY_TAG);
 assert.match(record.description,/500014/);
 // plan is pure: no writer was involved
 assert.equal(result.structureID,undefined);
});

test('an unknown typeID is refused, not defaulted',()=>{
 const result=factory.plan({...base,typeID:99999999},deps);
 assert.equal(result.status,'REFUSED');
 assert.equal(result.reason,'UNKNOWN_TYPE_ID');
});

test('an invalid position is refused',()=>{
 for(const position of [null,{x:1,y:2},{x:1,y:'a',z:3},{x:Infinity,y:0,z:0}]){
  const result=factory.plan({...base,position},deps);
  assert.equal(result.status,'REFUSED',JSON.stringify(position));
  assert.equal(result.reason,'INVALID_POSITION');
 }
});

test('a non-numeric faction is refused instead of coerced',()=>{
 for(const factionID of ['500014',null,undefined,0,-1,3.5]){
  const result=factory.plan({...base,factionID},deps);
  assert.equal(result.status,'REFUSED',String(factionID));
  assert.equal(result.reason,'INVALID_FACTION');
 }
});

test('a corporation outside the claimed faction is refused',()=>{
 const result=factory.plan({...base,factionID:500010},deps);
 assert.equal(result.status,'REFUSED');
 assert.equal(result.reason,'CORPORATION_FACTION_MISMATCH');
 assert.equal(result.corporationFactionID,500014);
});

test('an unresolvable corporation faction is refused',()=>{
 const result=factory.plan({...base,ownerCorpID:424242},deps);
 assert.equal(result.status,'REFUSED');
 assert.equal(result.reason,'UNKNOWN_CORPORATION_FACTION');
});

test('missing system, owner corporation and name are refused',()=>{
 assert.equal(factory.plan({...base,systemID:0},deps).reason,'SYSTEM_ID_REQUIRED');
 assert.equal(factory.plan({...base,ownerCorpID:0},deps).reason,'OWNER_CORPORATION_REQUIRED');
 assert.equal(factory.plan({...base,name:'   '},deps).reason,'NAME_REQUIRED');
});

test('deploy writes through the native structure writer and reports the new id',()=>{
 const calls=[];
 const structureState={createStructure(record,options){
  calls.push({record,options});
  return {success:true,data:{...record,structureID:1020000000001}};
 }};
 const result=factory.deploy(base,{...deps,structureState});
 assert.equal(result.status,'DEPLOYED');
 assert.equal(result.structureID,1020000000001);
 assert.equal(result.systemID,30000144);
 assert.equal(result.factionID,500014);
 assert.equal(calls.length,1);
 assert.equal(calls[0].options.emitLive,true);      // the live scene must learn about it
 assert.equal(calls[0].record.typeID,35832);
});

test('a refused plan never reaches the writer',()=>{
 let called=0;
 const structureState={createStructure(){called++;return {success:true,data:{}}}};
 const result=factory.deploy({...base,factionID:'Caldari'},{...deps,structureState});
 assert.equal(result.status,'REFUSED');
 assert.equal(called,0);
});

test('a writer failure is reported, never claimed as deployed',()=>{
 const structureState={createStructure(){return {success:false,errorMsg:'WRITE_FAILED'}}};
 const result=factory.deploy(base,{...deps,structureState});
 assert.equal(result.status,'FAILED');
 assert.equal(result.reason,'CREATE_STRUCTURE_FAILED');
 assert.equal(result.errorMsg,'WRITE_FAILED');
});

test('a missing writer is a failure, not a silent success',()=>{
 const result=factory.deploy(base,{...deps,structureState:{}});
 assert.equal(result.status,'FAILED');
 assert.equal(result.reason,'STRUCTURE_WRITER_UNAVAILABLE');
});

test('verify reads the row back through the native system reader',()=>{
 const structureState={listStructuresForSystem(systemID){
  assert.equal(systemID,30000144);
  return [{structureID:1020000000001,typeID:35832,ownerCorpID:1000043,name:'Perimeter Anchor',
   state:110,devFlags:{coop:{factionID:500014}}}];
 }};
 const present=factory.verify({systemID:30000144,structureID:1020000000001},{structureState});
 assert.equal(present.status,'PRESENT');
 assert.equal(present.factionID,500014);
 assert.equal(present.ownerCorpID,1000043);
 const missing=factory.verify({systemID:30000144,structureID:1},{structureState});
 assert.equal(missing.status,'MISSING');
 const unknown=factory.verify({systemID:30000144,structureID:1},{structureState:{}});
 assert.equal(unknown.status,'UNKNOWN');
 assert.equal(unknown.reason,'STRUCTURE_READER_UNAVAILABLE');
});
