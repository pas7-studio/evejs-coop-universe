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

// Owner requirement 2026-10-27: an enlisted player is ONE SHIP IN A FLEET. He is
// never a priority target: the same ranked list decides, and only the hull whose
// nearest legal candidate he is will engage him.
function meleeFixture(){
 const f=fixture();
 // A real enemy (faction 22) player hull between the two faction-11 hulls.
 const playerShip={itemID:900,kind:'ship',corporationID:99,
  position:{x:6000,y:0,z:0},session:{characterID:140000005}};
 f.ships.set(900,playerShip);
 f.scene.sessions.set('s1',{characterID:140000005,_space:{shipID:900}});
 // A third faction-11 hull farther away, so the player is one of several targets.
 f.ships.set(503,{itemID:503,kind:'ship',nativeNpc:true,corporationID:31,
  position:{x:20000,y:0,z:0}});
 f.state.fleetState.ships['503']={entityID:503,systemID:202,warID:'w1',
  campaignID:'c1',factionID:11};
 return {f,playerShip};
}
test('the player is one candidate among several, never the only or first target',()=>{
 const {f,playerShip}=meleeFixture();
 const director=createWarBattleDirector({env,maxOrders:3,cooldownMs:120000,
  clock:()=>2000000,authority:{snapshots:()=>f.state,
   evaluatePair:(a,b)=>a.itemID!==b.itemID?{status:'AUTHORIZED',warID:'w1',campaignID:'c1'}:{status:'BLOCKED'}},
  getController:id=>({entityID:id,systemID:202,manualOrder:null,currentTargetID:0}),
  bridge:{issue:x=>({success:true,data:{targetID:x.execute().data?.targetID}})},
  sceneForSystem:id=>id===202?f.scene:null,
  issueNativeAttack:(id,targetID)=>({success:true,data:{targetID}}),
  isAmmoDepleted:()=>false,isTactical:()=>false,
  playerOpponents:({shipRow})=>shipRow.factionID===11?
   [{characterID:140000005,entityID:900,entity:playerShip}]:[]});
 const r=director.tick({systemIDs:[202]});
 // Every hull that acted published its ranked candidates.
 assert.equal(Array.isArray(r.selections),true);
 const byShip=new Map(r.selections.map(s=>[s.shipID,s]));
 const hull501=byShip.get(501);
 assert.equal(Array.isArray(hull501.candidates),true);
 const kinds=hull501.candidates.map(c=>c.kind);
 assert.equal(kinds.includes('MILITIA_PLAYER'),true,'the player really is a candidate');
 assert.equal(kinds.includes('WAR_SHIP'),true,'native hulls are candidates too');
 // 501 sits at x=0: 502 (x=10000) and the player (x=6000) are both in range, so
 // the nearest is the player - chosen by distance, not because it is a player.
 const first=hull501.candidates[0];
 assert.equal(first.entityID,900);
 assert.equal(first.chosen,true);
 // 503 (x=20000) sees the player at 14000 m and 502 at 10000 m: the native hull
 // wins on distance, so the player is NOT the preferred target of every hull.
 const hull503=byShip.get(503);
 assert.equal(hull503.candidates[0].entityID,502);
 assert.equal(hull503.candidates[0].kind,'WAR_SHIP');
 assert.equal(hull503.candidates.some(c=>c.entityID===900&&c.chosen===false),true);
 // At most one player order in the whole tick, and the player is never focus-fired.
 const playerOrders=r.orders.filter(o=>o.targetKind==='MILITIA_PLAYER');
 assert.equal(playerOrders.length,1);
});
test('on an exact distance tie a native hull is chosen over a player',()=>{
 const {f,playerShip}=meleeFixture();
 // Put the player exactly on top of the native opponent's distance from 501.
 playerShip.position.x=10000;
 const director=createWarBattleDirector({env,maxOrders:1,cooldownMs:120000,
  clock:()=>2000000,authority:{snapshots:()=>f.state,
   evaluatePair:()=>({status:'AUTHORIZED',warID:'w1',campaignID:'c1'})},
  getController:id=>({entityID:id,systemID:202,manualOrder:null,currentTargetID:0}),
  bridge:{issue:x=>({success:true,data:{targetID:x.execute().data?.targetID}})},
  sceneForSystem:id=>id===202?f.scene:null,
  issueNativeAttack:(id,targetID)=>({success:true,data:{targetID}}),
  isAmmoDepleted:()=>false,isTactical:()=>false,
  playerOpponents:({shipRow})=>shipRow.factionID===11?
   [{characterID:140000005,entityID:900,entity:playerShip}]:[]});
 const r=director.tick({systemIDs:[202]});
 assert.equal(r.orders.length,1);
 assert.equal(r.orders[0].targetID,502,'the native hull wins the tie');
 assert.equal(r.orders[0].targetKind,undefined);
});
