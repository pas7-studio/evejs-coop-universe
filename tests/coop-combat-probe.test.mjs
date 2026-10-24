import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {entitySample,launch,wreckSamples}=require('../integration/coopCombatProbe.cjs');
test('health layers report exact upstream condition fields without mutation',()=>{
 const e={itemID:77,kind:'npc',mode:'ORBIT',conditionState:{shieldCharge:0.6,armorDamage:0.25,damage:0.1}};
 const copy=structuredClone(e);
 assert.deepEqual(entitySample(e),{itemID:77,kind:'npc',mode:'ORBIT',shieldCharge:0.6,armorDamage:0.25,structureDamage:0.1,destroyed:false});
 assert.deepEqual(e,copy);
});
test('missing entity is reported as missing, not alive or destroyed',()=>assert.equal(entitySample(null),null));
test('disabled invalid scene never changes inputs',()=>{
 const events=[];
 assert.equal(launch({scene:{},shipIDs:[10],npcIDs:[20],probe:{observe:x=>events.push(x)}}),undefined);
 assert.equal(events.length,0);
});

test('wreck tracking correlates only native wrecks from our NPC and does not mutate scene',()=>{
 const scene={dynamicEntities:new Map([
  [300,{itemID:300,launcherID:88,nativeNpcWreck:true,kind:'wreck',isEmpty:false,position:{x:1,y:2,z:3}}],
  [301,{itemID:301,launcherID:99,nativeNpcWreck:true,kind:'wreck',isEmpty:true,position:{x:9,y:9,z:9}}],
  [302,{itemID:302,launcherID:88,nativeNpcWreck:false,kind:'ship'}],
 ])};
 const original=structuredClone([...scene.dynamicEntities]);
 assert.deepEqual(wreckSamples(scene,[88]),[{wreckID:300,sourceNpcID:88,kind:'wreck',isEmpty:false,position:{x:1,y:2,z:3}}]);
 assert.deepEqual([...scene.dynamicEntities],original);
});
test('missing scene maps produce no fabricated wreck',()=>assert.deepEqual(wreckSamples({},[88]),[]));
