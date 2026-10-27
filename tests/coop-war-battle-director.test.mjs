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
  getController:id=>({entityID:id,systemID:202,manualOrder:null,currentTargetID:0}),
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
 // Each side may respond once, but the same ship cannot spam native orders.
 assert.equal(f.director.tick({systemIDs:[202]}).orders.length,1);
 assert.equal(f.director.tick({systemIDs:[202]}).orders.length,0);
 f.advance(120001);
 assert.equal(f.director.tick({systemIDs:[202]}).orders.length,1);
 assert.equal(f.director.tick({systemIDs:[999]}).orders.length,0);
 assert.equal(f.lookups,5);
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
test('an enlisted enemy player becomes a real native attack target',()=>{
 env.EVEJS_COOP_NPC_BANK_OUTCOME_WITNESS='1';
 const f=fixture();
 // No NPC opponent in range, so the militia branch decides.
 f.ships.get(502).position.x=500000;
 const playerShip={itemID:900,kind:'ship',corporationID:99,position:{x:1000,y:0,z:0},
  session:{characterID:140000005}};
 f.ships.set(900,playerShip);
 f.scene.sessions.set('s1',{characterID:140000005,_space:{shipID:900}});
 let asked=null;
 const director=createWarBattleDirector({env,maxOrders:1,cooldownMs:120000,
  clock:()=>2000000,
  authority:{snapshots:()=>f.state,
   evaluatePair:(a,b)=>a.itemID!==b.itemID?{status:'AUTHORIZED',warID:'w1',campaignID:'c1'}:{status:'BLOCKED'}},
  getController:id=>({entityID:id,systemID:202,manualOrder:null,currentTargetID:0}),
  bridge:{issue:x=>({success:true,data:{targetID:x.execute().data?.targetID}})},
  sceneForSystem:id=>id===202?f.scene:null,
  issueNativeAttack:(id,targetID,options)=>{asked={id,targetID,options};return {success:true,data:{targetID}}},
  isAmmoDepleted:()=>false,isTactical:()=>false,
  playerOpponents:({shipRow})=>shipRow.factionID===11?
   [{characterID:140000005,entityID:900,entity:playerShip}]:[]});
 const r=director.tick({systemIDs:[202]});
 assert.equal(r.orders.length,1);
 assert.equal(r.orders[0].targetKind,'MILITIA_PLAYER');
 assert.equal(r.orders[0].characterID,140000005);
 assert.equal(r.orders[0].evidence,'ACTIVE_ENLISTMENT_IN_THE_OPPOSING_FACTION');
 assert.deepEqual(asked,{id:501,targetID:900,options:{allowWeapons:true,keepLock:true,allowPodKill:false}});
});
test('no militia list means the branch does nothing (stock behaviour)',()=>{
 const f=fixture();f.ships.get(502).position.x=500000;
 const director=createWarBattleDirector({env,maxOrders:1,cooldownMs:120000,
  clock:()=>2000000,authority:{snapshots:()=>f.state,
   evaluatePair:()=>({status:'BLOCKED'})},
  getController:id=>({entityID:id,systemID:202,manualOrder:null,currentTargetID:0}),
  bridge:{issue:()=>({success:true})},sceneForSystem:id=>id===202?f.scene:null,
  issueNativeAttack:()=>({success:true}),isAmmoDepleted:()=>false,
  isTactical:()=>false,playerOpponents:()=>[]});
 assert.equal(director.tick({systemIDs:[202]}).orders.length,0);
});
