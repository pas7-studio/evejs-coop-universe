import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createNativeRearm}=require("../integration/coopNpcNativeRearm.cjs");
const SID=30000144,PILOT="coop-pilot-004",STATION=60010001,SHIP=101;
function fixture(){
 let now=1000000,failedWrite=false;
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"npc-real-rearm-"));
 const cargo={cargoID:2001,entityID:SHIP,ownerID:900,typeID:34,
  groupID:83,categoryID:8,quantity:8,singleton:false,
  moduleID:0,flagID:5,transient:false};
 const stock=[cargo],modules=[{moduleID:1001,entityID:SHIP,ownerID:900,
  typeID:700,flagID:27,categoryID:7,moduleState:{online:true}}];
 const native={entityID:SHIP,systemID:SID,typeID:603,ownerID:900};
 const ship={kind:"ship",itemID:SHIP,nativeNpc:true,position:{x:1000,y:0,z:0}};
 const station={kind:"station",itemID:STATION,position:{x:0,y:0,z:0}};
 const scene={systemID:SID,staticEntities:[station],sessions:new Map(),
  getEntityByID:id=>id===SHIP?ship:id===STATION?station:null};
 const ctrl={entityID:SHIP,systemID:SID,currentTargetID:0};
 const links={[PILOT]:{pilotID:PILOT,entityID:SHIP,systemID:SID}};
 const registry={snapshot:()=>({links})};
 const worldStation={stationID:STATION,solarSystemID:SID};
 const store={
  getNativeEntity:id=>id===SHIP?native:null,
  listNativeModulesForEntity:id=>id===SHIP?modules.map(x=>({...x})):[],
  listNativeCargoForEntity:id=>id===SHIP?stock.map(x=>({...x})):[],
  upsertNativeCargo:row=>{
   if(failedWrite)return {success:false};
   const i=stock.findIndex(x=>Number(x.cargoID)===Number(row.cargoID));
   if(i<0)return {success:false};
   stock[i]={...row};return {success:true};
  },
  buildNativeCargoItems:id=>stock.filter(x=>x.entityID===id).map(x=>({
   itemID:x.cargoID,typeID:x.typeID,moduleID:x.moduleID,
   quantity:x.quantity,ownerID:x.ownerID,flagID:x.flagID})),
  buildNativeFittedItems:id=>modules.filter(m=>m.entityID===id).map(m=>({
   itemID:m.moduleID,typeID:m.typeID,flagID:m.flagID,
   ownerID:m.ownerID,moduleState:m.moduleState}))
 };
 function receipt(extra={}){
  const r={version:1,phase:"SETTLED",source:"EVEJS_SEED_MARKET",
   pilotID:PILOT,entityID:SHIP,systemID:SID,cargoID:2001,
   typeID:34,quantity:8,stationID:STATION,
   marketOrderID:"900000000001",price:4,at:999999,...extra};
  fs.mkdirSync(path.join(root,"purchases"),{recursive:true});
  fs.writeFileSync(path.join(root,"purchases","2001.json"),JSON.stringify(r));
 }
 receipt();
 const make=()=>createNativeRearm({store,registry,
  sceneForSystem:()=>scene,getController:()=>ctrl,
  getStation:id=>id===STATION?worldStation:null,
  resolveType:id=>id===34?{typeID:34,categoryID:8,volume:0.1}:
   {typeID:id,categoryID:6,volume:2},
  compatible:(module,typeID)=>Number(module.typeID)===700&&Number(typeID)===34,
  verifyCombatCharge:(live,module)=>live.nativeCargoItems?.find(c=>
   Number(c.moduleID)===Number(module.itemID))||null,
  root,clock:()=>now});
 const args=(other={})=>({pilotID:PILOT,entityID:SHIP,systemID:SID,
  stationID:STATION,cargoID:2001,moduleID:1001,...other});
 const plan=()=>make().candidates({pilotID:PILOT,entityID:SHIP,
  systemID:SID,stationID:STATION,allowedTypes:[34]});
 return {root,stock,modules,native,ship,station,scene,ctrl,store,links,
  receipt,make,args,plan,fail:v=>failedWrite=v,
  cleanup:()=>fs.rmSync(root,{recursive:true,force:true})};
}
test("real purchased charge is bound to exact native weapon; no new cargo minted",()=>{
 const f=fixture();try{
  const first=f.make().candidates({pilotID:PILOT,entityID:SHIP,
   systemID:SID,stationID:STATION,allowedTypes:[34,35]});
  assert.equal(first.status,"REARM_READY");assert.equal(first.cargoID,2001);
  const result=f.make().load(f.args());
  assert.equal(result.status,"NATIVE_NPC_CHARGE_LOADED");
  assert.equal(result.chargeItemsCreated,undefined);
  assert.equal(result.cargoItemsCreated,0);
  assert.equal(result.iskGranted,false);
  assert.equal(f.stock.length,1);
  assert.equal(f.stock[0].cargoID,2001);
  assert.equal(f.stock[0].quantity,8);
  assert.equal(f.stock[0].moduleID,1001);
  assert.equal(f.stock[0].flagID,27);
  assert.equal(f.ship.nativeCargoItems[0].moduleID,1001);
 }finally{f.cleanup();}
});
test("already loaded charge cannot buy or reload duplicate stock",()=>{
 const f=fixture();try{
  assert.equal(f.make().load(f.args()).status,"NATIVE_NPC_CHARGE_LOADED");
  assert.equal(f.make().load(f.args()).status,"ALREADY_LOADED");
  assert.equal(f.plan().status,"NO_NATIVE_UNLOADED_COMPATIBLE_MODULE");
  assert.equal(f.stock.length,1);
 }finally{f.cleanup();}
});
test("missing real purchased cargo requests only compatible native seed buy",()=>{
 const f=fixture();try{
  f.stock.splice(0,1);
  const plan=f.plan();
  assert.equal(plan.status,"REARM_NEEDS_PURCHASE");
  assert.equal(plan.typeID,34);assert.equal(plan.moduleID,1001);
 }finally{f.cleanup();}
});
test("missing or forged market receipt never authorizes charge loading",()=>{
 const f=fixture();try{
  f.receipt({marketOrderID:"non-numeric"});
  assert.equal(f.make().load(f.args()).status,"NATIVE_PURCHASE_RECEIPT_NOT_VERIFIED");
  f.receipt({pilotID:"coop-pilot-022"});
  assert.equal(f.make().load(f.args()).status,"NATIVE_PURCHASE_RECEIPT_NOT_VERIFIED");
  assert.equal(f.stock[0].moduleID,0);
 }finally{f.cleanup();}
});
test("native charge incompatibility, wrong type or missing fitted module fail closed",()=>{
 const f=fixture();try{
  f.stock[0].typeID=35;
  assert.equal(f.make().load(f.args()).status,"NATIVE_PURCHASE_RECEIPT_NOT_VERIFIED");
  f.stock[0].typeID=34;f.modules[0].typeID=999;
  assert.equal(f.make().load(f.args()).status,"NATIVE_PURCHASE_RECEIPT_NOT_VERIFIED");
  f.modules.splice(0);
  assert.equal(f.make().load(f.args()).status,"NATIVE_MODULE_NOT_UNIQUE");
 }finally{f.cleanup();}
});
test("player-controlled or fighting hull cannot rearm itself",()=>{
 const f=fixture();try{
  f.scene.sessions.set(1,{characterID:77,_space:{shipID:SHIP}});
  assert.equal(f.make().load(f.args()).status,"NO_NATIVE_STATION_OR_SHIP");
  f.scene.sessions.clear();f.ctrl.currentTargetID=99;
  assert.equal(f.make().load(f.args()).status,"NO_NATIVE_STATION_OR_SHIP");
  f.ctrl.currentTargetID=0;f.ship.mode="WARP";
  assert.equal(f.make().load(f.args()).status,"NO_NATIVE_STATION_OR_SHIP");
 }finally{f.cleanup();}
});
test("native ammo is not loaded unless same physical ship reaches same real station",()=>{
 const f=fixture();try{
  f.ship.position.x=100000;
  assert.equal(f.make().load(f.args()).status,"NO_NATIVE_STATION_OR_SHIP");
  f.ship.position.x=1000;f.scene.staticEntities=[];
  assert.equal(f.make().load(f.args()).status,"NO_NATIVE_STATION_OR_SHIP");
 }finally{f.cleanup();}
});
test("conflicting or duplicated pilot identity cannot authorize native resupply",()=>{
 const f=fixture();try{
  f.links["coop-pilot-009"]={pilotID:"coop-pilot-009",
   entityID:SHIP,systemID:SID};
  assert.equal(f.make().load(f.args()).status,"NO_NATIVE_STATION_OR_SHIP");
 }finally{f.cleanup();}
});
test("failed single native cargo update preserves the original bought item",()=>{
 const f=fixture();try{
  f.fail(true);
  assert.equal(f.make().load(f.args()).status,"NATIVE_REARM_OUTCOME_UNVERIFIED");
  assert.equal(f.stock[0].moduleID,0);
  assert.equal(f.stock[0].quantity,8);
  assert.equal(f.stock.length,1);
 }finally{f.cleanup();}
});
test("stale rearm lock after crash fences all native cargo writes",()=>{
 const f=fixture();try{
  fs.mkdirSync(path.join(f.root,"rearm-locks"),{recursive:true});
  fs.writeFileSync(path.join(f.root,"rearm-locks","2001.lock"),"crashed");
  assert.equal(f.make().load(f.args()).status,"NATIVE_REARM_LOCK_UNSAFE");
  assert.equal(f.stock[0].moduleID,0);
 }finally{f.cleanup();}
});
test("purchase receipt must belong to exact cargo ID and station",()=>{
 const f=fixture();try{
  f.receipt({stationID:STATION+1});
  assert.equal(f.make().load(f.args()).status,"NATIVE_PURCHASE_RECEIPT_NOT_VERIFIED");
  f.receipt({cargoID:3000});
  assert.equal(f.make().load(f.args()).status,"NATIVE_PURCHASE_RECEIPT_NOT_VERIFIED");
 }finally{f.cleanup();}
});
