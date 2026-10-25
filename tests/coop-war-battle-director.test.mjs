import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {createWarBattleDirector}=require('../integration/coopWarBattleDirector.cjs');
const env={EVEJS_COOP_FACTION_WAR:'1',EVEJS_COOP_FACTION_WAR_FLEETS:'1',
 EVEJS_COOP_FACTION_WAR_COMBAT:'1',EVEJS_COOP_NPC_ORDER_ARBITER:'1',
 EVEJS_COOP_NATIVE_ATOMIC_ROWS:'1',EVEJS_COOP_NPC_STRICT_AMMO:'1',
 EVEJS_COOP_NPC_AMMO_DURABLE_CYCLE:'1',EVEJS_COOP_NPC_BANK_ATOMIC:'1',
 EVEJS_COOP_NPC_BANK_OUTCOME_WITNESS:'1'};
function fixture(){
 let now=1000000,issued=0,sceneLookups=0,blocked=false;
 const ships=new Map([[501,{itemID:501,kind:'ship',nativeNpc:true,corporationID:31,
  position:{x:0,y:0,z:0}}],[502,{itemID:502,kind:'ship',nativeNpc:true,corporationID:32,
  position:{x:10000,y:0,z:0}}]]);
 const scene={systemID:202,sessions:new Map(),getEntityByID:id=>ships.get(id)};
 const state={fleetState:{ships:{
  '501':{entityID:501,systemID:202,warID:'w1',campaignID:'c1',factionID:11},
  '502':{entityID:502,systemID:202,warID:'w1',campaignID:'c1',factionID:22}}}};
 const accepted=[];
 const director=createWarBattleDirector({env,maxOrders:1,cooldownMs:120000,
  clock:()=>now,authority:{snapshots:()=>state,
   evaluatePair:(a,b)=>a.itemID!==b.itemID&&!blocked?
    {status:'AUTHORIZED',warID:'w1',campaignID:'c1'}:{status:'BLOCKED'}},
  bridge:{issue:x=>{accepted.push({owner:x.owner,action:x.action,
    target:x.execute().data?.targetID});return {success:true}}},
  sceneForSystem:id=>{sceneLookups++;return id===202?scene:null},
  issueNativeAttack:(id,targetID)=>{issued++;return {success:true,data:{targetID}}},
  isAmmoDepleted:()=>false,isTactical:()=>false});
 return {director,env,ships,scene,state,accepted,advance:ms=>now+=ms,
  get issued(){return issued},get lookups(){return sceneLookups},
  block:x=>blocked=x};
}
test('bounded native battle pass through WAR bridge only, orders are not kills',()=>{
 const f=fixture(),r=f.director.tick({systemIDs:[202]});
 assert.equal(r.orders.length,1);
 assert.equal(r.orders[0].status,'NATIVE_ATTACK_ORDER_ACCEPTED');
 assert.deepEqual(f.accepted[0].owner,'WAR');
 assert.equal(f.issued,1);
 assert.equal(Object.hasOwn(r.orders[0],'damage'),false); // no synthetic damage or kill credit
});
test('one order per cooldown; never create scenes for missing systems',()=>{
 const f=fixture();f.director.tick({systemIDs:[202]});
 assert.equal(f.director.tick({systemIDs:[202]}).orders.length,0);
 f.advance(120001);
 assert.equal(f.director.tick({systemIDs:[202]}).orders.length,1);
 assert.equal(f.director.tick({systemIDs:[999]}).orders.length,0);
 assert.equal(f.lookups,3);
});
test('player ship, warp, out of range and disabled ammo prevent attack',()=>{
 const f=fixture();f.ships.get(501).mode='WARP';
 assert.equal(f.director.tick({systemIDs:[202]}).orders.length,0);
 f.ships.get(501).mode='IDLE';f.ships.get(502).position.x=500000;
 assert.equal(f.director.tick({systemIDs:[202]}).orders.length,0);
 f.ships.get(502).position.x=1000;
 f.scene.sessions.set('p',{_space:{shipID:502}});
 assert.equal(f.director.tick({systemIDs:[202]}).orders.length,0);
 f.scene.sessions.clear();f.env.EVEJS_COOP_NPC_BANK_OUTCOME_WITNESS='0';
 assert.equal(f.director.tick({systemIDs:[202]}).status,'DISABLED_OR_UNSAFE_AMMO');
});
test('attack proof is re-read after target selection before native issue',()=>{
 const f=fixture();f.block(true);
 const r=f.director.tick({systemIDs:[202]});
 assert.equal(r.orders.length,0);assert.equal(f.issued,0);
});
