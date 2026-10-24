import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {createCombatEvidence,verifyWreck}=require('../integration/coopNativeCombatEvidence.cjs');
const systemID=30000142;
const links=[{pilotID:'coop-pilot-001',entityID:51,systemID},{pilotID:'coop-pilot-002',entityID:52,systemID}];
const makeScene=()=>{
 const ships=new Map([[51,{itemID:51,kind:'ship',hp:{shield:300,armor:90,structure:50}}],
  [52,{itemID:52,kind:'ship',hp:{shield:200,armor:90,structure:50}}]]);
 return {ships,scene:{getEntityByID:id=>ships.get(id),sessions:new Map()}};
};
test('two actual physical NPC health samples show loss, but never a fabricated kill',()=>{
 let now=1000;const {scene,ships}=makeScene();
 const monitor=createCombatEvidence({clock:()=>now});
 const opts={systemID,scene,links,getHealth:s=>s.hp,getController:id=>id===51?{currentTargetID:52}:null};
 assert.equal(monitor.sample(opts).damageEvents,0);
 ships.get(52).hp.shield=160;now+=30000;
 const evidence=monitor.sample(opts);
 assert.equal(evidence.damageEvents,1);
 assert.equal(evidence.correlatedNpcDamage,1);
 assert.equal(evidence.events[0].healthLossHP,40);
 assert.deepEqual(evidence.events[0].attackerPilotIDs,['coop-pilot-001']);
 assert.match(evidence.events[0].attribution,/NOT_KILL_CREDIT/);
 assert.equal(monitor.sample(opts).damageEvents,0);
});
test('real shield regeneration does not count as damage',()=>{
 let now=1;const {scene,ships}=makeScene();
 const m=createCombatEvidence({clock:()=>now});
 const opts={systemID,scene,links,getHealth:s=>s.hp,getController:()=>null};
 m.sample(opts);now+=2000;ships.get(52).hp.shield=240;
 assert.equal(m.sample(opts).damageEvents,0);
});
test('no player ship or invalid named NPC may count as NPC-on-NPC combat',()=>{
 let now=1;const {scene,ships}=makeScene();
 scene.sessions.set('a',{characterID:3,_space:{shipID:51}});
 const m=createCombatEvidence({clock:()=>now});
 const opts={systemID,scene,links,getHealth:s=>s.hp,getController:()=>({currentTargetID:52})};
 m.sample(opts);now+=2000;ships.get(52).hp.shield=100;
 assert.equal(m.sample(opts).correlatedNpcDamage,0);
});
test('no missing native HP can become fake damage',()=>{
 let now=1;const {scene}=makeScene();const m=createCombatEvidence({clock:()=>now});
 const opts={systemID,scene,links,getHealth:()=>({shield:NaN,armor:0,structure:0}),getController:()=>null};
 assert.equal(m.sample(opts).damageEvents,0);now+=2000;
 assert.equal(m.sample(opts).damageEvents,0);
});
const makeWreck=()=>{
 const wreckID=1001;
 const wreck={wreckID,systemID,sourceEntityID:52,launcherID:52};
 const items=[{wreckItemID:5,wreckID,typeID:34,quantity:100}];
 const entity={nativeNpcWreck:true,itemID:wreckID,launcherID:52};
 const scene={getEntityByID:id=>id===wreckID?entity:null};
 return {wreckID,wreck,items,entity,scene};
};
test('only native persisted wreck plus native scene entity and stored items proves loot',()=>{
 const a=makeWreck();
 const opts={systemID,npcID:52,wreckID:a.wreckID,scene:a.scene,links,
  getWreck:()=>a.wreck,getWreckItems:()=>a.items};
 const out=verifyWreck(opts);
 assert.equal(out.status,'PHYSICAL_NATIVE_WRECK_VERIFIED');
 assert.equal(out.lootStatus,'ITEMS_STORED');
 assert.equal(out.storedQuantity,100);
 a.items=[];
 assert.equal(verifyWreck(opts).lootStatus,'NATIVE_WRECK_EMPTY');
});
test('false wreck IDs, wrong ship source, vanished physical wreck never certify loot',()=>{
 const a=makeWreck();
 const opts={systemID,npcID:52,wreckID:a.wreckID,scene:a.scene,links,
  getWreck:()=>a.wreck,getWreckItems:()=>a.items};
 assert.equal(verifyWreck({...opts,npcID:7}).status,'UNLINKED_NPC');
 a.wreck.sourceEntityID=51;
 assert.equal(verifyWreck(opts).status,'NATIVE_WRECK_UNVERIFIED');
 a.wreck.sourceEntityID=52;a.entity.nativeNpcWreck=false;
 assert.equal(verifyWreck(opts).status,'WRECK_NOT_PHYSICAL');
 a.entity.nativeNpcWreck=true;a.items=[{wreckItemID:5,wreckID:1002,typeID:34,quantity:100}];
 assert.equal(verifyWreck(opts).status,'INVALID_STORED_ITEMS');
});
