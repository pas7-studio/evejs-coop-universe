import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const require=createRequire(import.meta.url);
const {createRegistry}=require('../integration/coopIdentityRegistry.cjs');
const {createBridge}=require('../integration/coopNpcMaterializer.cjs');
test('physical NPC identity restored after bridge restart without duplicate native spawn',()=>{
 const dir=mkdtempSync(join(tmpdir(),'coop-identity-'));
 try{
  const file=join(dir,'links.json'),live=new Set(),pilot={id:'coop-pilot-001',name:'Wanderer 001',faction:'frontier'};
  let calls=0;
  const exists=(_system,id)=>live.has(id);
  const spawn=()=>{calls++;live.add(8001);return {success:true,data:{spawned:[{entity:{itemID:8001}}]}}};
  const first=createBridge({registry:createRegistry({file,exists}),spawn,exists,limit:1});
  assert.equal(first.reconcile(30000142,[pilot])[0].entityID,8001);
  const restored=createBridge({registry:createRegistry({file,exists}),spawn,exists,limit:1});
  assert.deepEqual(restored.reconcile(30000142,[pilot]),[{pilotID:pilot.id,entityID:8001,reused:true}]);
  assert.equal(calls,1);
  const stored=createRegistry({file,exists}).get(pilot.id);
  assert.equal(stored.name,'Wanderer 001');
  assert.equal(stored.faction,'frontier');
  live.delete(8001);
  const registry=createRegistry({file,exists});
  assert.equal(registry.prune(),1);
  assert.equal(registry.get(pilot.id),null);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('registry refuses unknown pilot ID and invalid entity ID',()=>{
 const dir=mkdtempSync(join(tmpdir(),'coop-identity-'));
 try{
  const registry=createRegistry({file:join(dir,'links.json'),exists:()=>true});
  assert.throws(()=>registry.link({id:'external'},30000142,8001),/invalid materialization link/);
  assert.throws(()=>registry.link({id:'coop-pilot-001'},30000142,0),/invalid materialization link/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test("native gate identity relocation preserves same ship and is durable after restart",()=>{
 const dir=mkdtempSync(join(tmpdir(),"coop-identity-jump-"));
 try{
  let actual=30000142;
  const exists=(system,id)=>system===actual&&id===9001;
  const file=join(dir,"links.json"),pilot={id:"coop-pilot-005",name:"Rook",faction:"frontier",role:"trader"};
  const registry=createRegistry({file,exists});
  registry.link(pilot,30000142,9001);
  assert.equal(registry.relocate(pilot.id,30000142,9001,30000144).status,"SOURCE_STILL_PHYSICAL");
  actual=30000144;
  assert.equal(registry.relocate(pilot.id,30000142,9001,30000144).status,"RELOCATED");
  assert.equal(registry.get(pilot.id).entityID,9001);
  assert.equal(registry.get(pilot.id).systemID,30000144);
  assert.equal(createRegistry({file,exists}).get(pilot.id).systemID,30000144);
  assert.equal(registry.relocate(pilot.id,30000142,9001,30000144).status,"STALE_SOURCE");
 }finally{rmSync(dir,{recursive:true,force:true})}
});
test("registry refuses destination without physical native same-ID ship",()=>{
 const dir=mkdtempSync(join(tmpdir(),"coop-identity-jump-"));
 try{
  const file=join(dir,"links.json"),registry=createRegistry({file,exists:()=>false});
  registry.link({id:"coop-pilot-005"},30000142,9001);
  assert.equal(registry.relocate("coop-pilot-005",30000142,9001,30000144).status,
   "DESTINATION_NOT_PHYSICAL");
  assert.equal(registry.snapshot().links["coop-pilot-005"].systemID,30000142);
 }finally{rmSync(dir,{recursive:true,force:true})}
});
