import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {evaluate}=require('../integration/coopWarCombatPolicy.cjs');
const source={itemID:501,kind:'ship',nativeNpc:true,corporationID:31};
const victim={itemID:502,kind:'ship',nativeNpc:true,corporationID:32};
const attack={entityID:501,systemID:202,manualOrder:{type:'attack',targetID:502,allowWeapons:true}};
const defense={entityID:502,systemID:202};
const war={version:1,wars:{w1:{state:'ACTIVE',attackerFactionID:11,defenderFactionID:22}},
 campaigns:{c1:{warID:'w1',state:'ASSAULT',targetSystemID:202}}};
const fleet={version:1,ships:{
 '501':{entityID:501,pilotID:'coop-pilot-001',systemID:202,corporationID:31,factionID:11,warID:'w1',campaignID:'c1'},
 '502':{entityID:502,pilotID:'coop-pilot-002',systemID:202,corporationID:32,factionID:22,warID:'w1',campaignID:'c1'}}};
const faction=corp=>corp===31?11:corp===32?22:null;
const ctx=()=>({warState:structuredClone(war),fleetState:structuredClone(fleet),
 attacker:{...source},target:{...victim},attackerController:structuredClone(attack),
 targetController:{...defense},getFactionForCorporation:faction});
test('an active native war assault authorizes only opposite-faction registered NPCs',()=>{
 const out=evaluate(ctx());
 assert.equal(out.status,'AUTHORIZED');
 assert.equal(out.campaignID,'c1');
});
test('a native attack order is mandatory at the damage gate',()=>{
 const a=ctx();a.attackerController.manualOrder=null;
 assert.equal(evaluate(a).reason,'EXPLICIT_ATTACK_ORDER_REQUIRED');
 a.attackerController.manualOrder={type:'attack',targetID:999};
 assert.equal(evaluate(a).reason,'EXPLICIT_ATTACK_ORDER_REQUIRED');
 a.attackerController.manualOrder={type:'attack',targetID:502,allowWeapons:false};
 assert.equal(evaluate(a).reason,'EXPLICIT_ATTACK_ORDER_REQUIRED');
 a.requireAttackIntent=false;assert.equal(evaluate(a).status,'AUTHORIZED');
});
test('ceasefire, preparing campaign, or faction spoof cannot create hostility',()=>{
 const a=ctx();a.warState.wars.w1.state='ENDED';
 assert.equal(evaluate(a).reason,'NO_ACTIVE_NATIVE_ASSAULT');
 a.warState.wars.w1.state='ACTIVE';a.warState.campaigns.c1.state='PREPARING';
 assert.equal(evaluate(a).reason,'NO_ACTIVE_NATIVE_ASSAULT');
 a.warState.campaigns.c1.state='ASSAULT';a.target.corporationID=31;
 assert.equal(evaluate(a).reason,'NATIVE_SHIP_PROOF_MISMATCH');
});
test('a single enlisted attacker cannot attack an arbitrary neutral or player',()=>{
 const a=ctx();delete a.fleetState.ships['502'];
 assert.equal(evaluate(a).reason,'WAR_REGISTERED_TARGET_REQUIRED');
 const b=ctx();b.target.nativeNpc=false;
 assert.equal(evaluate(b).reason,'NATIVE_SHIP_PROOF_MISMATCH');
 const c=ctx();delete c.fleetState.ships['501'];delete c.fleetState.ships['502'];
 assert.equal(evaluate(c).status,'NOT_WAR');
});
test('same corporate allegiance, mismatched system or duplicated pilot denies combat',()=>{
 const a=ctx();a.fleetState.ships['502'].corporationID=31;
 a.target.corporationID=31;
 assert.equal(evaluate(a).reason,'SDE_FACTION_MISMATCH');
 const b=ctx();b.fleetState.ships['502'].systemID=203;
 assert.equal(evaluate(b).reason,'WAR_FLEET_IDENTITY_CONFLICT');
 const c=ctx();c.fleetState.ships['502'].pilotID='coop-pilot-001';
 assert.equal(evaluate(c).reason,'WAR_FLEET_IDENTITY_CONFLICT');
});
