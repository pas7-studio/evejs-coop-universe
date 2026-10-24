import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {entitySample,launch}=require('../integration/coopCombatProbe.cjs');
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
