import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createNpcMarketTrader}=require("../integration/coopNativeNpcMarket.cjs");
const {createNativeRearm}=require("../integration/coopNpcNativeRearm.cjs");
const SID=30000144,SHIP=101,STATION=60010001,PILOT="coop-pilot-004";
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"npc-earned-rearm-e2e-"));
 let time=1000000,seedBuy=20,seedAmmo=30,newID=10000;
 const ship={kind:"ship",itemID:SHIP,nativeNpc:true,typeID:603,
  position:{x:1000,y:0,z:0}};
 const station={kind:"station",itemID:STATION,
  position:{x:0,y:0,z:0},radius:1000};
 const scene={systemID:SID,staticEntities:[station],sessions:new Map(),
  getEntityByID:id=>id===SHIP?ship:id===STATION?station:null};
 const native={entityID:SHIP,ownerID:900,typeID:603,systemID:SID};
 const ctrl={entityID:SHIP,systemID:SID,currentTargetID:0};
 const modules=[{moduleID:1001,entityID:SHIP,ownerID:900,typeID:700,
  groupID:57,categoryID:7,flagID:27,moduleState:{online:true}}];
 const cargo=[{cargoID:9001,entityID:SHIP,ownerID:900,typeID:34,quantity:3,
  groupID:18,categoryID:4,singleton:false,moduleID:0,flagID:5,
  sourceWreckID:201,sourceWreckItemID:501}];
 const store={
  getNativeEntity:id=>id===SHIP?native:null,
  listNativeModulesForEntity:id=>id===SHIP?modules.map(m=>({...m})):[],
  listNativeCargoForEntity:id=>cargo.filter(c=>c.entityID===id).map(c=>({...c})),
  removeNativeCargo:id=>{const i=cargo.findIndex(c=>c.cargoID===id);
   if(i<0)return {success:false};cargo.splice(i,1);return {success:true};},
  upsertNativeCargo:row=>{const i=cargo.findIndex(c=>c.cargoID===row.cargoID);
   if(i>=0)cargo[i]={...row};else cargo.push({...row});return {success:true};},
  buildNativeCargoItems:id=>cargo.filter(c=>c.entityID===id).map(c=>({
   itemID:c.cargoID,typeID:c.typeID,ownerID:c.ownerID,
   moduleID:c.moduleID,quantity:c.quantity,flagID:c.flagID})),
  buildNativeFittedItems:id=>modules.filter(m=>m.entityID===id).map(m=>({
   itemID:m.moduleID,typeID:m.typeID,flagID:m.flagID,ownerID:m.ownerID,
   moduleState:m.moduleState})),
  allocateCargoID:()=>({success:true,data:++newID})
 };
 const registry={snapshot:()=>({links:{[PILOT]:{pilotID:PILOT,
  systemID:SID,entityID:SHIP}}})};
 const worldStation={stationID:STATION,solarSystemID:SID,regionID:10000002};
 const resolveType=id=>id===603?{typeID:603,capacity:200,volume:1}:
  id===35?{typeID:35,categoryID:8,groupID:83,volume:0.1,name:"Bought charge"}:
  {typeID:id,categoryID:4,groupID:18,volume:1,name:"Recovered ore"};
 const calls=[];
 const call=async(method,args)=>{
  calls.push({method,args});
  if(method==="GetOrders")return {buys:[{source:"seed",
   order_id:"900000000001",station_id:STATION,type_id:34,price:20,
   vol_remaining:seedBuy}],
   sells:[{source:"seed",order_id:"900000000002",
    station_id:STATION,type_id:35,price:4,vol_remaining:seedAmmo}]};
  if(method==="FillOrder"){
   seedBuy-=args.fill_quantity;
   return {order_id:"900000000001",filled_quantity:args.fill_quantity,
    bid:true,station_id:STATION,type_id:34,price:20};
  }
  if(method==="AdjustSeedStock"){
   seedAmmo+=args.delta_quantity;
   return {station_id:STATION,type_id:35,quantity:seedAmmo,price:4};
  }
  if(method==="RecordTrade")return {success:true};
  throw Error("UNEXPECTED_RPC");
 };
 const trader=createNpcMarketTrader({root,call,store,registry,
  getStation:()=>worldStation,sceneForSystem:()=>scene,getController:()=>ctrl,
  resolveType,clock:()=>time,maxQuantity:5,cooldownMs:30000,maxPrice:1000});
 const rearm=()=>createNativeRearm({root,store,registry,
  getStation:()=>worldStation,sceneForSystem:()=>scene,
  getController:()=>ctrl,resolveType,clock:()=>time,
  compatible:(m,type)=>Number(m.typeID)===700&&Number(type)===35,
  verifyCombatCharge:(live,module)=>live.nativeCargoItems?.find(c=>
   Number(c.moduleID)===Number(module.itemID))||null});
 const marketParams=(side,typeID,extra={})=>({scene,entityID:SHIP,
  pilotID:PILOT,stationID:STATION,side,typeID,sellTypes:[34],
  buyTypes:[35],...extra});
 const ammoPlan=()=>rearm().candidates({pilotID:PILOT,
  entityID:SHIP,systemID:SID,stationID:STATION,allowedTypes:[35]});
 return {root,trader,rearm,store,marketParams,ammoPlan,scene,ship,
  cargo,modules,calls,advance:()=>time+=30001,
  getStock:()=>({seedBuy,seedAmmo}),
  cleanup:()=>fs.rmSync(root,{recursive:true,force:true})};
}
test("real earned sale funds seeded ammo purchase, loaded into same existing native weapon",async()=>{
 const f=fixture();try{
  assert.equal(f.ammoPlan().status,"REARM_NEEDS_PURCHASE");
  assert.equal((await f.trader.execute(f.marketParams("buy",35))).status,
   "INSUFFICIENT_EARNED_ISK");
  assert.equal(f.getStock().seedAmmo,30);
  const sold=await f.trader.execute(f.marketParams("sell",34,{
   cargoID:9001,verifyCargo:r=>r.sourceWreckItemID===501}));
  assert.equal(sold.status,"TRADE_SETTLED");
  assert.equal(sold.balance,60);assert.equal(f.getStock().seedBuy,17);
  f.advance();
  const bought=await f.trader.execute(f.marketParams("buy",35));
  assert.equal(bought.status,"TRADE_SETTLED");
  assert.equal(bought.balance,40);
  assert.equal(bought.quantity,5);
  assert.equal(f.getStock().seedAmmo,25);
  assert.equal(f.ammoPlan().status,"REARM_READY");
  assert.equal(f.ammoPlan().cargoID,bought.cargoID);
  const loaded=f.rearm().load({pilotID:PILOT,entityID:SHIP,
   systemID:SID,stationID:STATION,cargoID:bought.cargoID,moduleID:1001});
  assert.equal(loaded.status,"NATIVE_NPC_CHARGE_LOADED");
  assert.equal(loaded.nativeModuleVisible,true);
  assert.equal(loaded.cargoItemsCreated,0);
  assert.equal(f.cargo.length,1);
  assert.equal(f.cargo[0].cargoID,bought.cargoID);
  assert.equal(f.cargo[0].moduleID,1001);
  assert.equal(f.cargo[0].quantity,5);
  assert.equal(f.ship.nativeCargoItems[0].moduleID,1001);
  assert.equal(f.ammoPlan().status,"NO_NATIVE_UNLOADED_COMPATIBLE_MODULE");
  assert.equal(f.trader.snapshot().pilots[PILOT].tradeCount,2);
  assert.equal(f.calls.filter(c=>c.method==="FillOrder").length,1);
  assert.equal(f.calls.filter(c=>c.method==="AdjustSeedStock").length,1);
 }finally{f.cleanup();}
});
test("after real purchase restart can finish fitting same cargo without new seed buy",async()=>{
 const f=fixture();try{
  assert.equal((await f.trader.execute(f.marketParams("sell",34))).status,"TRADE_SETTLED");
  f.advance();
  const bought=await f.trader.execute(f.marketParams("buy",35));
  assert.equal(bought.status,"TRADE_SETTLED");
  const loaded=f.rearm().load({pilotID:PILOT,entityID:SHIP,
   systemID:SID,stationID:STATION,cargoID:bought.cargoID,moduleID:1001});
  assert.equal(loaded.status,"NATIVE_NPC_CHARGE_LOADED");
  const newProcess=f.rearm();
  assert.equal(newProcess.load({pilotID:PILOT,entityID:SHIP,
   systemID:SID,stationID:STATION,cargoID:bought.cargoID,moduleID:1001}).status,
   "ALREADY_LOADED");
  assert.equal(f.calls.filter(c=>c.method==="AdjustSeedStock").length,1);
  assert.equal(f.cargo.length,1);
 }finally{f.cleanup();}
});
