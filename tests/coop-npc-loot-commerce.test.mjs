import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createLootCommerce}=require("../integration/coopNpcLootCommerce.cjs");
const SID=30000144,PILOT="coop-pilot-011",SHIP=101,STATION=60010111;
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"npc-loot-market-"));
 fs.mkdirSync(path.join(root,"tx"),{recursive:true});
 let now=1000000;
 const ship={itemID:SHIP,kind:"ship",nativeNpc:true,
  position:{x:600000,y:0,z:0}};
 const station={itemID:STATION,kind:"station",position:{x:0,y:0,z:0}};
 const scene={systemID:SID,staticEntities:[station],
  getEntityByID:id=>id===SHIP?ship:id===STATION?station:null,sessions:new Map()};
 const nativeStation={stationID:STATION,solarSystemID:SID,regionID:10000002};
 const controller={entityID:SHIP,systemID:SID,currentTargetID:0};
 const cargo={cargoID:3001,entityID:SHIP,ownerID:777,groupID:17,categoryID:8,
  typeID:34,quantity:4,moduleID:0,sourceWreckID:201,
  sourceWreckItemID:501,singleton:false,transient:false};
 const stocks=[cargo,{...cargo,cargoID:3002,sourceWreckItemID:502,typeID:35}];
 const tx={version:1,phase:"SETTLED",itemID:501,wreckID:201,entityID:SHIP,
  cargoID:3001,pilotID:PILOT,ownerID:777,typeID:34,quantity:7,
  newCargo:{...cargo,quantity:7}};
 fs.writeFileSync(path.join(root,"tx","501.json"),JSON.stringify(tx));
 const assignments=[{pilotID:PILOT,entityID:SHIP,systemID:SID}];
 const calls=[];
 let success=true;
 const make=()=>createLootCommerce({root,clock:()=>now,
  store:{listNativeCargoForEntity:()=>stocks},
  sceneForSystem:()=>scene,getController:()=>controller,
  getStation:id=>id===STATION?nativeStation:null,
  warp:(id,target)=>{calls.push(["warp",id,target]);return {success};},
  orbit:(id,target,range)=>{calls.push(["orbit",id,target,range]);return {success};},
  commandCooldownMs:60000});
 const commerce=make();
 return {root,ship,station,scene,cargo,stocks,tx,controller,commerce,make,
  calls,assignments,
  tick:(extra={})=>commerce.tick({assignments,...extra}),
  advance:ms=>now+=ms,
  succeed:value=>{success=value},
  cleanup:()=>fs.rmSync(root,{recursive:true,force:true})};
}
test("only SETTLED native wreck custody receipt authenticates recovered cargo",()=>{
 const f=fixture();try{
  assert.equal(f.commerce.verifiedCargo({pilotID:PILOT,entityID:SHIP,cargo:f.cargo}),true);
  assert.equal(f.commerce.stock({pilotID:PILOT,entityID:SHIP}).length,1);
  assert.equal(f.commerce.verifiedCargo({pilotID:"coop-pilot-012",entityID:SHIP,cargo:f.cargo}),false);
  const journal=path.join(f.root,"tx","501.json");
  f.tx.phase="PREPARED";fs.writeFileSync(journal,JSON.stringify(f.tx));
  assert.equal(f.commerce.stock({pilotID:PILOT,entityID:SHIP}).length,0);
 }finally{f.cleanup();}
});
test("proven cargo triggers real native warp to actual station and leases ship",()=>{
 const f=fixture();try{
  const r=f.tick();assert.equal(r.orders.length,1);
  assert.equal(r.orders[0].action,"NATIVE_WARP_TO_STATION");
  assert.deepEqual(f.calls,[["warp",SHIP,STATION]]);
  assert.deepEqual([...f.commerce.activeIDs(SID)],[SHIP]);
 }finally{f.cleanup();}
});
test("repeated 30 second world ticks do not spam native warp",()=>{
 const f=fixture();try{
  assert.equal(f.tick().orders.length,1);f.advance(30000);
  assert.equal(f.tick().orders.length,0);assert.equal(f.calls.length,1);
  f.advance(31000);
  assert.equal(f.tick().orders.length,1);
 }finally{f.cleanup();}
});
test("close station uses genuine orbit; only physical arrival certifies market readiness",()=>{
 const f=fixture();try{
  f.ship.position.x=100000;
  const r=f.tick();assert.equal(r.orders[0].action,"NATIVE_ORBIT_STATION");
  assert.deepEqual(f.calls,[["orbit",SHIP,STATION,2000]]);
  assert.equal(f.commerce.readyFor({pilotID:PILOT,entityID:SHIP,systemID:SID,
   stationID:STATION,cargoID:3001}),false);
  f.ship.position.x=3500;f.advance(61000);
  const result=f.tick();assert.equal(result.ready.length,1);
  assert.equal(f.commerce.readyFor({pilotID:PILOT,entityID:SHIP,systemID:SID,
   stationID:STATION,cargoID:3001}),true);
  assert.equal(f.commerce.readyFor({pilotID:PILOT,entityID:SHIP,systemID:SID,
   stationID:STATION,cargoID:3002}),false);
 }finally{f.cleanup();}
});
test("ship moving away after physical station arrival invalidates market-ready proof",()=>{
 const f=fixture();try{
  f.ship.position.x=1000;f.tick();f.ship.position.x=20000;
  assert.equal(f.commerce.readyFor({pilotID:PILOT,entityID:SHIP,systemID:SID,
   stationID:STATION,cargoID:3001}),false);
 }finally{f.cleanup();}
});
test("partial sale preserves provenance but adding extra items above source amount fails",()=>{
 const f=fixture();try{
  f.cargo.quantity=2;
  assert.equal(f.commerce.verifiedCargo({pilotID:PILOT,entityID:SHIP,cargo:f.cargo}),true);
  f.cargo.quantity=8;
  assert.equal(f.commerce.verifiedCargo({pilotID:PILOT,entityID:SHIP,cargo:f.cargo}),false);
 }finally{f.cleanup();}
});
test("no real station or wrong system station means no route or market sale",()=>{
 const f=fixture();try{
  f.scene.staticEntities=[];
  assert.equal(f.tick().orders.length,0);
  f.scene.staticEntities=[f.station];f.station.kind="stargate";
  assert.equal(f.tick().orders.length,0);
  f.station.kind="station";f.scene.systemID=SID+1;
  assert.equal(f.tick().orders.length,0);
 }finally{f.cleanup();}
});
test("player ship, warp state or native combat lock reject cargo routing",()=>{
 const f=fixture();try{
  f.scene.sessions.set(1,{characterID:77,_space:{shipID:SHIP}});
  assert.equal(f.tick().orders.length,0);
  f.scene.sessions.clear();f.controller.currentTargetID=201;
  assert.equal(f.tick().orders.length,0);
  f.controller.currentTargetID=0;f.ship.mode="WARP";
  assert.equal(f.tick().orders.length,0);
  assert.equal(f.calls.length,0);
 }finally{f.cleanup();}
});
test("conflicting native pilot identity refuses source-verified cargo delivery",()=>{
 const f=fixture();try{
  f.assignments.push({pilotID:"coop-pilot-099",entityID:SHIP,systemID:SID});
  assert.equal(f.tick().orders.length,0);
  f.assignments.pop();
  f.assignments.push({pilotID:PILOT,entityID:999,systemID:SID});
  assert.equal(f.tick().orders.length,0);
 }finally{f.cleanup();}
});
test("fake native cargo owner/type/source ID cannot reuse settled wreck receipt",()=>{
 const f=fixture();try{
  for(const prop of ["ownerID","typeID","sourceWreckID","sourceWreckItemID"]){
   const bad={...f.cargo,[prop]:Number(f.cargo[prop])+1};
   assert.equal(f.commerce.verifiedCargo({pilotID:PILOT,entityID:SHIP,cargo:bad}),false);
  }
  fs.unlinkSync(path.join(f.root,"tx","501.json"));
  assert.equal(f.commerce.stock({pilotID:PILOT,entityID:SHIP}).length,0);
 }finally{f.cleanup();}
});
test("blocked order owner and native failure don't pretend a physical station trip",()=>{
 const f=fixture();try{
  assert.equal(f.tick({blockedIDs:new Set([SHIP])}).orders.length,0);
  f.succeed(false);
  assert.equal(f.tick().orders.length,0);
  assert.equal(f.calls.length,1);
 }finally{f.cleanup();}
});
