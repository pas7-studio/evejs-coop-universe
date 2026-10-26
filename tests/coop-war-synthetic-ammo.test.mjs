import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {createAmmoGate}=require('../integration/coopNpcWeaponAmmoGate.cjs');
const env={EVEJS_COOP_NPC_STRICT_AMMO:'1',EVEJS_COOP_FACTION_WAR:'1',
 EVEJS_COOP_FACTION_WAR_FLEETS:'1',EVEJS_COOP_FACTION_WAR_COMBAT:'1'};
const entity={itemID:501,kind:'ship',nativeNpc:true};
const moduleItem={npcSyntheticHullWeapon:true};
function probe(isWarHull,environment=env){
 return createAmmoGate({env:environment,isWarHull,store:{},dogma:{},capability:{}})
  .check({entity,moduleItem});
}
test('registered warship cannot activate free synthetic hull weapon',()=>{
 assert.equal(probe(()=>'ASSIGNED').status,'WAR_SYNTHETIC_WEAPON_FORBIDDEN');
 assert.equal(probe(()=>'UNKNOWN').allowed,false);
 assert.equal(probe(()=>{throw Error('db lost')}).allowed,false);
});
test('other PvE NPCs keep original synthetic fallback when not in war fleet',()=>{
 assert.equal(probe(()=>'UNASSIGNED').status,'SYNTHETIC_HULL_WEAPON');
 const legacy={...env,EVEJS_COOP_FACTION_WAR_COMBAT:'0'};
 assert.equal(probe(()=>null,legacy).status,'SYNTHETIC_HULL_WEAPON');
});
