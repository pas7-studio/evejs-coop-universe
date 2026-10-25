import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {createDepot}=require('../integration/coopNativeDepot.cjs');
const {unloadCargo,haulFlag}=require('../integration/coopNativeHaulCargo.cjs');
function fixture(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'evejs-depot-'));const file=path.join(dir,'depot.json');
 const depot=createDepot({file,clock:()=>123456});
 const cargo=new Map([[333,{cargoID:333,typeID:34,quantity:50,moduleID:0,entityID:500,coopHaulFleetID:44}]]);
 const store={
   listNativeCargoForEntity:entityID=>[...cargo.values()].filter(x=>x.entityID===entityID),
   removeNativeCargo:id=>{cargo.delete(Number(id));return {success:true}},
   buildNativeCargoItems:entityID=>[...cargo.values()].filter(x=>x.entityID===entityID)
 };
 const hauler={kind:'ship',itemID:500,nativeCargoItems:[{itemID:333,volume:0.1}]};
 const scene={getEntityByID:id=>id===500?hauler:null};
 const fleet={fleetID:44,systemID:30000144,haulerEntityIDs:[500]};
 const observed=[];const probe={observe:(...args)=>observed.push(args)};
 return {dir,file,depot,cargo,store,hauler,scene,fleet,probe,observed,delivery:{cargoID:333,typeID:34,quantity:50,haulerID:500}};
}
test('depot prepare does not credit virtual supply; commit credits exactly once, durable across reopen',()=>{
 const f=fixture();
 try{
  assert.equal(f.depot.prepare({systemID:f.fleet.systemID,fleetID:44,item:f.delivery}).status,'PREPARED');
  assert.equal(f.depot.snapshot().totals['30000144'],undefined);
  assert.equal(f.depot.snapshot().pending['333'].quantity,50);
  assert.equal(f.depot.commit({systemID:f.fleet.systemID,fleetID:44,item:f.delivery}).status,'COMMITTED');
  assert.equal(f.depot.commit({systemID:f.fleet.systemID,fleetID:44,item:f.delivery}).status,'ALREADY_COMMITTED');
  assert.equal(createDepot({file:f.file}).snapshot().totals['30000144'],50);
 }finally{fs.rmSync(f.dir,{recursive:true,force:true})}
});
test('unload persists pending receipt before deleting cargo then commits only after physical disappearance',()=>{
 const f=fixture(),calls=[];
 const remove=f.store.removeNativeCargo;
 f.store.removeNativeCargo=id=>{calls.push(f.depot.snapshot().pending[String(id)]?.quantity);return remove(id)};
 try{
  assert.equal(unloadCargo(f.scene,f.fleet,f).status,'DELIVERED');
  assert.deepEqual(calls,[50]);assert.equal(f.cargo.size,0);
  assert.equal(f.depot.snapshot().totals['30000144'],50);
  assert.equal(f.observed.length,1);
  assert.equal(unloadCargo(f.scene,f.fleet,f).status,'NO_CARGO');
  assert.equal(f.depot.snapshot().totals['30000144'],50);
 }finally{fs.rmSync(f.dir,{recursive:true,force:true})}
});
test('no depot or failing preparation never removes native cargo',()=>{
 const f=fixture();
 try{
  assert.equal(unloadCargo(f.scene,f.fleet,{...f,depot:{record:()=>({})}}).status,'BLOCKED_DEPOT_UNAVAILABLE');
  assert.equal(unloadCargo(f.scene,f.fleet,{...f,depot:{prepare:()=>{throw Error('disk full')},commit:()=>({})}}).status,'NEEDS_REPAIR');
  assert.equal(f.cargo.size,1);
 }finally{fs.rmSync(f.dir,{recursive:true,force:true})}
});
test('remove failure remains pending and is safely retryable with identical cargo ID',()=>{
 const f=fixture(),remove=f.store.removeNativeCargo;
 try{
  f.store.removeNativeCargo=()=>({success:false});
  assert.equal(unloadCargo(f.scene,f.fleet,f).status,'NEEDS_REPAIR');
  assert.equal(f.depot.snapshot().pending['333'].quantity,50);
  assert.equal(f.depot.snapshot().totals['30000144'],undefined);
  f.store.removeNativeCargo=remove;
  assert.equal(unloadCargo(f.scene,f.fleet,f).status,'DELIVERED');
  assert.equal(f.depot.snapshot().totals['30000144'],50);
 }finally{fs.rmSync(f.dir,{recursive:true,force:true})}
});
test('crash after source removal but before receipt commit does not invent supply',()=>{
 const f=fixture();
 try{
  const broken={prepare:x=>f.depot.prepare(x),commit:()=>{throw Error('simulated power failure')}};
  assert.equal(unloadCargo(f.scene,f.fleet,{...f,depot:broken}).status,'NEEDS_REPAIR');
  assert.equal(f.cargo.size,0);
  const recovered=createDepot({file:f.file});
  assert.equal(recovered.snapshot().pending['333'].quantity,50);
  assert.equal(recovered.snapshot().totals['30000144'],undefined);
  assert.equal(unloadCargo(f.scene,f.fleet,{...f,depot:recovered}).status,'NO_CARGO');
 }finally{fs.rmSync(f.dir,{recursive:true,force:true})}
});
test('replayed reused cargo ID cannot credit or remove a second cargo after commit',()=>{
 const f=fixture();
 try{
  assert.equal(unloadCargo(f.scene,f.fleet,f).status,'DELIVERED');
  f.cargo.set(333,{cargoID:333,typeID:34,quantity:50,moduleID:0,entityID:500,[haulFlag]:44});
  assert.equal(unloadCargo(f.scene,f.fleet,f).status,'NEEDS_REPAIR');
  assert.equal(f.cargo.has(333),true);
  assert.equal(f.depot.snapshot().totals['30000144'],50);
 }finally{fs.rmSync(f.dir,{recursive:true,force:true})}
});
test('depot commit cannot accept wrong quantity, fleet or system',()=>{
 const f=fixture();
 try{
  f.depot.prepare({systemID:30000144,fleetID:44,item:f.delivery});
  assert.equal(f.depot.commit({systemID:30000144,fleetID:44,item:{...f.delivery,quantity:100}}).status,'NOT_PREPARED_OR_MISMATCH');
  assert.equal(f.depot.prepare({systemID:30000144,fleetID:55,item:f.delivery}).status,'CONFLICT');
  assert.equal(f.depot.snapshot().totals['30000144'],undefined);
 }finally{fs.rmSync(f.dir,{recursive:true,force:true})}
});

test('conservation audit derives exact committed ore by native type and flags pending',()=>{
 const f=fixture();
 try{
  assert.equal(f.depot.audit().status,'OK');
  f.depot.prepare({systemID:30000144,fleetID:44,item:f.delivery});
  assert.equal(f.depot.audit().status,'PENDING_CUSTODY_RECONCILIATION');
  f.depot.commit({systemID:30000144,fleetID:44,item:f.delivery});
  const audit=createDepot({file:f.file}).audit();
  assert.equal(audit.status,'OK');
  assert.equal(audit.bySystemType['30000144']['34'],50);
  assert.equal(audit.totals['30000144'],50);
 }finally{fs.rmSync(f.dir,{recursive:true,force:true})}
});
test('corrupt virtual depot total cannot pass native conservation audit',()=>{
 const f=fixture();
 try{
  f.depot.prepare({systemID:30000144,fleetID:44,item:f.delivery});
  f.depot.commit({systemID:30000144,fleetID:44,item:f.delivery});
  const s=JSON.parse(fs.readFileSync(f.file,'utf8'));s.totals['30000144']=999;
  fs.writeFileSync(f.file,JSON.stringify(s));
  assert.equal(createDepot({file:f.file}).audit().status,'NEEDS_OPERATOR_REPAIR');
 }finally{fs.rmSync(f.dir,{recursive:true,force:true})}
});