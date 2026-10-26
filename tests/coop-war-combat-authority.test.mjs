import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const api=require('../integration/coopWarCombatAuthority.cjs');
const {KEY:WARKEY}=require('../integration/coopFactionWarStore.cjs');
const {KEY:FLEETKEY}=require('../integration/coopWarFleetRegistry.cjs');
const env={EVEJS_COOP_FACTION_WAR:'1',EVEJS_COOP_FACTION_WAR_FLEETS:'1',
 EVEJS_COOP_FACTION_WAR_COMBAT:'1',EVEJS_COOP_NPC_ORDER_ARBITER:'1',
 EVEJS_COOP_NATIVE_ATOMIC_ROWS:'1',EVEJS_COOP_NPC_STRICT_AMMO:'1',
 EVEJS_COOP_NPC_AMMO_DURABLE_CYCLE:'1',EVEJS_COOP_NPC_BANK_ATOMIC:'1',
 EVEJS_COOP_NPC_BANK_OUTCOME_WITNESS:'1'};
function sample(){
 const states={
  [WARKEY]:{version:1,processed:{},territories:{},enlistments:{},history:[],
   wars:{w1:{warID:'w1',state:'ACTIVE',attackerFactionID:11,defenderFactionID:22}},
   campaigns:{c1:{warID:'w1',state:'ASSAULT',targetSystemID:202}}},
  [FLEETKEY]:{version:1,processed:{},history:[],ships:{
   '501':{entityID:501,pilotID:'coop-pilot-001',systemID:202,corporationID:31,factionID:11,warID:'w1',campaignID:'c1',fleetID:'ff'},
   '502':{entityID:502,pilotID:'coop-pilot-002',systemID:202,corporationID:32,factionID:22,warID:'w1',campaignID:'c1',fleetID:'zz'}}}};
 const store={read:(_table,path)=>{
  const key=path.slice(1);return states[key]?{success:true,data:states[key]}:{success:false};
 }};
 const npc={501:{entityID:501,systemID:202,corporationID:31},
  502:{entityID:502,systemID:202,corporationID:32}};
 const controllers={501:{entityID:501,systemID:202,manualOrder:{type:'attack',targetID:502}},
  502:{entityID:502,systemID:202}};
 const auth=api.createWarCombatAuthority({gameStore:store,env,
  getNativeEntity:id=>npc[id],getController:id=>controllers[id],
  getFactionForCorporation:id=>id===31?11:id===32?22:0});
 const a={itemID:501,kind:'ship',nativeNpc:true,corporationID:31};
 const b={itemID:502,kind:'ship',nativeNpc:true,corporationID:32};
 return {states,npc,controllers,auth,a,b};
}
test('read-only native GameStore war/fleet state authorizes actual native attack intent',()=>{
 const f=sample();assert.equal(api.combatEnabled(env),true);
 assert.equal(api.ammoEnabled(env),true);
 assert.equal(f.auth.allowsNativeEngagement(f.a,f.b),true);
});
test('dropped atomic ammo flag, incomplete store or ceasefire blocks damage',()=>{
 const f=sample();
 const flags={...env,EVEJS_COOP_NPC_BANK_OUTCOME_WITNESS:'0'};
 const a=api.createWarCombatAuthority({gameStore:{read:()=>({success:false})},env,
  getController:()=>null,getNativeEntity:()=>null,getFactionForCorporation:()=>0});
 assert.equal(api.ammoEnabled(flags),false);
 assert.equal(a.allowsNativeEngagement(f.a,f.b),false);
 f.states[WARKEY].wars.w1.state='ENDED';
 assert.equal(f.auth.allowsNativeEngagement(f.a,f.b),false);
});
test('native entity authority disagrees with clients or source record => refuse',()=>{
 const f=sample();f.npc[502].corporationID=40;
 assert.equal(f.auth.allowsNativeEngagement(f.a,f.b),false);
});
