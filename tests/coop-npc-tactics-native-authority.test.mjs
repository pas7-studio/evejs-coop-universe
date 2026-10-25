import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {createTactics}=require('../integration/coopNpcTactics.cjs');
const SYSTEM=30000144;
const ship=(id,x,opts={})=>({itemID:id,kind:'ship',nativeNpc:true,
  systemID:SYSTEM,mode:'STOP',position:{x,y:0,z:0},...opts});
function harness({attacker=ship(990,10000),victim=ship(101,0),helper=ship(201,12000),
  includeHelper=true,authorizePlayerDefense=()=>false,now=1000000}={}){
 let time=now;
 const entries=[victim,attacker,...(includeHelper?[helper]:[])];
 const entities=new Map(entries.map(s=>[s.itemID,s]));
 const controllers={101:{entityID:101,systemID:SYSTEM,lastAggressorID:attacker.itemID,lastAggressedAtMs:time-5000},
  201:{entityID:201,systemID:SYSTEM,currentTargetID:0,manualOrder:null}};
 const assignments=[{pilotID:'coop-pilot-001',entityID:101,systemID:SYSTEM,role:'miner',faction:'friendly'},
  ...(includeHelper?[{pilotID:'coop-pilot-002',entityID:201,systemID:SYSTEM,role:'patrol',faction:'friendly'}]:[])];
 const scene={systemID:SYSTEM,getEntityByID:id=>entities.get(id)||null,sessions:new Map()};
 const orders=[];
 const callbacks={
  warpToPoint:(id,where)=>{orders.push(['retreat',id,where]);return {success:true}},
  warpToEntity:(id,target)=>{orders.push(['warp',id,target]);return {success:true}},
  attack:(id,target)=>{orders.push(['attack',id,target]);return {success:true}},
  stopOrder:id=>{orders.push(['stop',id]);return {success:true}},
  resumeBehavior:id=>{orders.push(['resume',id]);return {success:true}},
 };
 const tactics=createTactics({clock:()=>time,...callbacks,authorizePlayerDefense});
 const tick=()=>tactics.tick({systemID:SYSTEM,scene,assignments,controllers,
  health:()=>({armor:1,structure:1}),isScrambled:()=>false,
  waypoints:[{id:44,kind:'station',position:{x:2000000,y:0,z:0}}]});
 return {victim,attacker,helper,controllers,assignments,scene,entities,
  tactics,orders,tick,advance:ms=>time+=ms};
}
test('false assignments cannot command a player hull, a wreck or a recycled ship ID',()=>{
 for(const replacement of [
   ship(201,10000,{nativeNpc:false}),
   ship(201,10000,{kind:'wreck'}),
   ship(201,10000,{itemID:999}),
   ship(201,10000,{session:{characterID:800}}),
 ]){
  const h=harness();h.entities.set(201,replacement);
  assert.equal(h.tick().events.filter(e=>e.kind==='reinforcement-attack').length,0);
  assert.equal(h.orders.filter(o=>o[0]==='attack').length,0);
 }
});
test('duplicate pilot IDs, duplicate entity links and invalid controller identities fail closed',()=>{
 for(const mode of ['duplicatePilot','duplicateShip','staleController','wrongSystem','lostController']){
  const h=harness();
  if(mode==='duplicatePilot')h.assignments.push({...h.assignments[1],entityID:333});
  if(mode==='duplicateShip')h.assignments.push({...h.assignments[1],pilotID:'coop-pilot-333'});
  if(mode==='staleController')h.controllers[201].entityID=999;
  if(mode==='wrongSystem')h.controllers[201].systemID=SYSTEM+1;
  if(mode==='lostController')delete h.controllers[201];
  assert.equal(h.tick().events.filter(e=>e.kind==='reinforcement-attack').length,0,mode);
  assert.equal(h.orders.filter(o=>o[0]==='attack').length,0,mode);
 }
});
test('stale, future or spoofed victim controller aggression never orders a response',()=>{
 for(const mode of ['stale','future','wrongID','noController']){
  const h=harness();
  if(mode==='stale')h.controllers[101].lastAggressedAtMs=1000000-120001;
  if(mode==='future')h.controllers[101].lastAggressedAtMs=1000001;
  if(mode==='wrongID')h.controllers[101].entityID=120;
  if(mode==='noController')delete h.controllers[101];
  assert.deepEqual(h.orders,[]);
  assert.equal(h.tick().events.length,0,mode);
 }
});
test('reinforcements cannot override an in-flight warp, existing target or manual order',()=>{
 for(const mode of ['warp','target','manual']){
  const h=harness();
  if(mode==='warp')h.helper.mode='WARP';
  if(mode==='target')h.controllers[201].currentTargetID=777;
  if(mode==='manual')h.controllers[201].manualOrder={type:'haul',targetID:44};
  h.tick();
  assert.equal(h.orders.filter(o=>o[0]==='attack').length,0,mode);
 }
});
test('a real client ship can trigger NPC retreat but not an unauthorized PvP reinforcement',()=>{
 const attacker=ship(990,10000,{nativeNpc:false,pilotCharacterID:700});
 const h=harness({attacker});h.victim.conditionState={damage:0.7};
 h.scene.sessions.set(7,{characterID:700,socket:{destroyed:false},
  _space:{systemID:SYSTEM,shipID:990,initialStateSent:true}});
 // Make victim wounded by substituting native health only for this tick.
 const result=h.tactics.tick({systemID:SYSTEM,scene:h.scene,assignments:h.assignments,
  controllers:h.controllers,health:entity=>entity===h.victim?{armor:0.1,structure:0.4}:{armor:1,structure:1},
  isScrambled:()=>false,waypoints:[{id:44,kind:'station',position:{x:2000000,y:0,z:0}}]});
 assert.equal(result.events.filter(e=>e.kind==='npc-retreat').length,1);
 assert.equal(h.orders.filter(o=>o[0]==='attack').length,0);
});
test('player defense requires independently authorized current native session',()=>{
 let calls=0;
 const attacker=ship(990,10000,{nativeNpc:false,pilotCharacterID:700});
 const h=harness({attacker,authorizePlayerDefense:()=>{calls++;return true}});
 const session={characterID:700,socket:{destroyed:false},
  _space:{systemID:SYSTEM,shipID:990,initialStateSent:true}};
 h.scene.sessions.set(7,session);
 assert.equal(h.tick().events.filter(e=>e.kind==='reinforcement-attack').length,1);
 assert.equal(calls,1);
 const h2=harness({attacker:ship(990,10000,{nativeNpc:false,pilotCharacterID:700}),authorizePlayerDefense:()=>true});
 h2.scene.sessions.set(7,{...session,characterID:999});
 assert.equal(h2.tick().events.filter(e=>e.kind==='reinforcement-attack').length,0);
});
test('retreat ACK with no native arrival never sends stop/resume or claims recovery',()=>{
 const h=harness({includeHelper:false});
 const t=h.tactics;
 const result=t.tick({systemID:SYSTEM,scene:h.scene,assignments:h.assignments,
  controllers:h.controllers,health:()=>({armor:0.15,structure:0.3}),isScrambled:()=>false,
  waypoints:[{id:44,kind:'station',position:{x:2000000,y:0,z:0}}]});
 assert.equal(result.events.filter(e=>e.kind==='npc-retreat').length,1);
 h.advance(180000);
 assert.equal(h.tick().events.filter(e=>e.kind==='npc-tactical-recovered').length,0);
 assert.deepEqual(h.orders.map(o=>o[0]),['retreat']);
});
test('reinforcement warp cannot silently retarget a recycled enemy ship',()=>{
 const h=harness({attacker:ship(990,1000000),victim:ship(101,800000),helper:ship(201,0)});
 assert.deepEqual(h.tick().events.map(e=>e.kind),['reinforcement-warp','npc-help-request']);
 h.helper.position.x=990000;
 h.entities.set(990,ship(990,1010000));
 h.advance(31000);h.tick();
 assert.equal(h.orders.filter(o=>o[0]==='attack').length,0);
});
test('same-faction native aggressor does not cause friendly patrol attacks',()=>{
 const h=harness();h.assignments.push({pilotID:'coop-pilot-003',entityID:990,
  systemID:SYSTEM,role:'pirate',faction:'friendly'});
 h.controllers[990]={entityID:990,systemID:SYSTEM};
 h.tick();assert.equal(h.orders.length,0);
});
test('no direct player-piloted NPC ship spoofing through assignments',()=>{
 const h=harness();
 h.scene.sessions.set(1,{characterID:70,_space:{shipID:201,systemID:SYSTEM,
  initialStateSent:true},socket:{destroyed:false}});
 h.tick();assert.equal(h.orders.length,0);
});
