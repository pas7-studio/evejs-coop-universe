import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createAmmoSupply}=require("../integration/coopNpcAmmoSupply.cjs");
const SID=30000144,PILOT="coop-pilot-005",STATION=60010101;
function fixture(){
 let now=1000000,scrambled=false,warpSuccess=true;
 const pirate={itemID:101,kind:"ship",nativeNpc:true,
  position:{x:0,y:0,z:0}};
 const station={itemID:STATION,kind:"station",
  position:{x:800000,y:0,z:0}};
 const scene={systemID:SID,staticEntities:[station],sessions:new Map(),
  getEntityByID:id=>id===101?pirate:id===STATION?station:null};
 const native={entityID:101,systemID:SID,ownerID:777};
 const modules=[{moduleID:401,entityID:101,ownerID:777,
  categoryID:7,typeID:12000,flagID:27}];
 const weapon={itemID:401,typeID:12000,flagID:27};
 const weapons=[weapon];
 const cargo=[];
 const controller={entityID:101,systemID:SID,currentTargetID:0};
 const assignments=[{pilotID:PILOT,entityID:101,systemID:SID}];
 const orders=[];
 const store={getNativeEntity:id=>id===101?native:null,
  listNativeModulesForEntity:()=>modules.map(x=>({...x})),
  listNativeCargoForEntity:()=>cargo.map(x=>({...x}))};
 const create=()=>createAmmoSupply({store,
  getWeaponModules:()=>weapons,
  resolveFamily:m=>m.family||"projectileTurret",
  isOptional:m=>m.optional===true,
  compatible:(m,type)=>Number(type)===35,
  getController:()=>controller,
  getStation:id=>id===STATION?{stationID:STATION,solarSystemID:SID}:null,
  warp:(id,target,options)=>{orders.push({kind:"warp",id,target,options});
   return {success:warpSuccess};},
  orbit:(id,target,range)=>{orders.push({kind:"orbit",id,target,range});
   return {success:true};},
  isScrambled:()=>scrambled,clock:()=>now,cooldownMs:60000});
 const director=create();
 return {pirate,station,scene,native,modules,weapon,weapons,cargo,controller,
  assignments,orders,director,create,
  inspect:()=>director.inspect({scene,entityID:101,pilotID:PILOT,assignments}),
  tick:(other={})=>director.tick({scene,assignments,...other}),
  advance:ms=>now+=ms,
  scrambled:v=>scrambled=v,warpWorks:v=>warpSuccess=v};
}
test("real native empty turret requires resupply; issue real station warp",()=>{
 const f=fixture();
 assert.equal(f.inspect().status,"AMMO_EXHAUSTED");
 const result=f.tick();
 assert.equal(result.orders.length,1);
 assert.equal(result.orders[0].action,"NATIVE_AMMO_RESUPPLY_WARP");
 assert.equal(result.events[0].kind,"npc-ammo-exhausted");
 assert.deepEqual([...f.director.activeIDs(SID)],[101]);
 assert.equal(f.orders.length,1);
 assert.equal(f.orders[0].target,STATION);
});
test("native weapon with actually loaded charge must continue raid",()=>{
 const f=fixture();f.cargo.push({cargoID:501,entityID:101,ownerID:777,
  moduleID:401,categoryID:8,typeID:35,quantity:5,transient:false});
 assert.equal(f.inspect().status,"AMMO_AVAILABLE");
 assert.equal(f.tick().orders.length,0);
 assert.equal(f.director.activeIDs(SID).size,0);
});
test("real compatible loose ammunition is sufficient for native reload",()=>{
 const f=fixture();f.cargo.push({cargoID:501,entityID:101,ownerID:777,
  moduleID:0,categoryID:8,typeID:35,quantity:2,transient:false});
 assert.equal(f.inspect().status,"AMMO_AVAILABLE");
 assert.equal(f.inspect().loose,1);
});
test("charge-optional and synthetic hull weapons are never forced into ammo scarcity",()=>{
 const f=fixture();f.weapon.optional=true;
 assert.equal(f.inspect().status,"NOT_APPLICABLE");
 f.weapon.optional=false;f.weapons.push({itemID:99100,
  npcSyntheticHullWeapon:true});
 assert.equal(f.inspect().status,"NOT_APPLICABLE");
});
test("another usable actual fitted weapon means NPC still has combat capability",()=>{
 const f=fixture();f.modules.push({moduleID:402,entityID:101,
  ownerID:777,categoryID:7,typeID:12001,flagID:28});
 f.weapons.push({itemID:402,typeID:12001,flagID:28});
 f.cargo.push({cargoID:502,entityID:101,ownerID:777,
  moduleID:402,categoryID:8,typeID:35,quantity:1});
 assert.equal(f.inspect().status,"AMMO_AVAILABLE");
});
test("no verified native fitted weapon, ghost module or duplicate module fail safe",()=>{
 const f=fixture();f.weapons.splice(0);
 assert.equal(f.inspect().status,"NOT_APPLICABLE");
 f.weapons.push(f.weapon);f.modules.splice(0);
 assert.equal(f.inspect().status,"NATIVE_FITTING_NOT_VERIFIED");
 f.modules.push({moduleID:401,entityID:101,ownerID:777,categoryID:7},
  {moduleID:401,entityID:101,ownerID:777,categoryID:7});
 assert.equal(f.inspect().status,"DUPLICATED_MODULE");
});
test("no repeated warp spam between 30-second world ticks",()=>{
 const f=fixture();assert.equal(f.tick().orders.length,1);
 f.advance(30000);assert.equal(f.tick().orders.length,0);
 f.advance(31000);assert.equal(f.tick().orders.length,1);
 assert.equal(f.orders.length,2);
});
test("an NPC depleted during combat can warp only when not scrambled and a safe destination exists",()=>{
 const f=fixture();
 f.controller.currentTargetID=999;
 f.scrambled(true);assert.equal(f.tick().orders.length,0);
 f.scrambled(false);
 f.controller.lastAggressorID=888;
 f.controller.lastAggressedAtMs=999500;
 f.scene.getEntityByID=id=>id===101?f.pirate:
  id===STATION?f.station:
  id===888?{itemID:888,position:{x:1000,y:0,z:0}}:null;
 assert.equal(f.tick().orders.length,1);
 assert.equal(f.orders[0].kind,"warp");
});
test("short orbit is forbidden while native combat remains active",()=>{
 const f=fixture();f.station.position.x=90000;
 f.controller.currentTargetID=998;
 assert.equal(f.tick().orders.length,0);
 assert.equal(f.orders.length,0);
});
test("physical arrival at real station is evidence only, never mints supplies",()=>{
 const f=fixture();f.station.position.x=4000;
 const result=f.tick();
 assert.equal(result.orders.length,0);
 assert.equal(result.events.find(e=>e.kind==="npc-ammo-awaiting-supply")
  .noAmmoSpawned,true);
 assert.equal(f.cargo.length,0);
});
test("actual reloaded native cargo clears resupply lease and releases raid",()=>{
 const f=fixture();f.tick();assert.equal(f.director.activeIDs(SID).has(101),true);
 f.cargo.push({cargoID:502,entityID:101,ownerID:777,
  moduleID:401,categoryID:8,typeID:35,quantity:6});
 const result=f.tick();
 assert.equal(result.events[0].kind,"npc-ammo-resupplied");
 assert.equal(f.director.activeIDs(SID).size,0);
});
test("never target a fake station or issue player-controlled warp commands",()=>{
 const f=fixture();f.station.kind="stargate";
 assert.equal(f.tick().orders.length,0);
 f.station.kind="station";
 f.scene.sessions.set("human",{_space:{shipID:101},characterID:11});
 assert.equal(f.inspect().status,"NATIVE_SHIP_NOT_VERIFIED");
 assert.equal(f.tick().orders.length,0);
});
test("conflicting pilot binding cannot command ammo withdrawal",()=>{
 const f=fixture();f.assignments.push({pilotID:"coop-pilot-006",
  entityID:101,systemID:SID});
 assert.equal(f.inspect().status,"PILOT_NOT_UNIQUE");
 assert.equal(f.tick().orders.length,0);
});
test("order arbiter block and failed warp do not claim physical travel",()=>{
 const f=fixture();f.warpWorks(false);
 assert.equal(f.tick().orders.length,0);
 f.advance(30001);
 assert.equal(f.tick({blockedIDs:new Set([101])}).orders.length,0);
});

test("unverified native fitting never cancels a previously proven ammo shortage",()=>{
 const f=fixture();f.tick();
 assert.equal(f.director.activeIDs(SID).has(101),true);
 f.modules.splice(0);
 assert.equal(f.inspect().status,"NATIVE_FITTING_NOT_VERIFIED");
 assert.equal(f.tick().orders.length,0);
 assert.equal(f.director.activeIDs(SID).has(101),true);
 f.modules.push({moduleID:401,entityID:101,ownerID:777,
  categoryID:7,typeID:12000,flagID:27});
 f.cargo.push({cargoID:502,entityID:101,ownerID:777,
  moduleID:401,categoryID:8,typeID:35,quantity:8});
 assert.equal(f.tick().events[0].kind,"npc-ammo-resupplied");
 assert.equal(f.director.activeIDs(SID).size,0);
});
