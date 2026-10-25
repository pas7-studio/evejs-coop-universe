import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createNpcMarketTrader}=require("../integration/coopNativeNpcMarket.cjs");
const SID=30000144,PILOT="coop-pilot-011",SHIP=101,STATION=60010111;
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"npc-loot-sale-"));
 let valid=true,now=1000000,changedDuringQuote=false,seedRemaining=50;
 const station={stationID:STATION,solarSystemID:SID,regionID:10000002};
 const ship={itemID:SHIP,kind:"ship",nativeNpc:true,position:{x:500,y:0,z:0}};
 const scene={systemID:SID,staticEntities:[{itemID:STATION,
  kind:"station",position:{x:0,y:0,z:0}}],getEntityByID:id=>id===SHIP?ship:null,
  sessions:new Map()};
 const controller={entityID:SHIP,systemID:SID,currentTargetID:0};
 const original={cargoID:3001,entityID:SHIP,ownerID:777,sourceWreckID:201,
  sourceWreckItemID:501,quantity:3,typeID:34,singleton:false,moduleID:0};
 const unrelated={cargoID:3002,entityID:SHIP,ownerID:777,
  quantity:8,typeID:34,singleton:false,moduleID:0};
 const cargos=[original,unrelated],calls=[];
 const store={
  getNativeEntity:id=>id===SHIP?{entityID:SHIP,systemID:SID,ownerID:777,typeID:40}:null,
  listNativeCargoForEntity:id=>cargos.filter(c=>c.entityID===id).map(c=>({...c})),
  removeNativeCargo:id=>{const i=cargos.findIndex(c=>c.cargoID===id);
   if(i>=0)cargos.splice(i,1);return {success:true};},
  upsertNativeCargo:r=>{const i=cargos.findIndex(c=>c.cargoID===r.cargoID);
   if(i>=0)cargos[i]={...r};else cargos.push({...r});return {success:true};},
  buildNativeCargoItems:id=>cargos.filter(c=>c.entityID===id).map(c=>({
   itemID:c.cargoID,locationID:id,typeID:c.typeID,quantity:c.quantity,
   ownerID:c.ownerID,moduleID:0})),
  allocateCargoID:()=>({success:true,data:4001})
 };
 const call=async(method,params)=>{
  calls.push(method);
  if(method==="GetOrders"){
   if(changedDuringQuote)valid=false;
   return {buys:[{source:"seed",station_id:STATION,type_id:34,
    order_id:"9100000000001",vol_remaining:seedRemaining,price:20}]};
  }
  if(method==="FillOrder"){
   seedRemaining-=params.fill_quantity;
   return {order_id:params.order_id,filled_quantity:params.fill_quantity,
    station_id:STATION,type_id:34,price:20,bid:true};
  }
  if(method==="RecordTrade")return {success:true};
  throw Error("unexpected "+method);
 };
 const market=()=>createNpcMarketTrader({root,call,store,
  registry:{snapshot:()=>({links:{[PILOT]:{pilotID:PILOT,
   systemID:SID,entityID:SHIP}}})},
  getStation:id=>id===STATION?station:null,sceneForSystem:()=>scene,
  getController:()=>controller,
  resolveType:id=>({typeID:id,volume:1,capacity:100}),
  clock:()=>now,cooldownMs:30000,maxQuantity:10});
 const offer=(other={})=>({scene,pilotID:PILOT,entityID:SHIP,
  stationID:STATION,side:"sell",typeID:34,
  sellTypes:[34],buyTypes:[],cargoID:3001,
  verifyCargo:row=>valid&&row.sourceWreckItemID===501&&
   row.sourceWreckID===201,...other});
 return {root,cargos,original,unrelated,store,scene,ship,market,offer,calls,
  changedDuringQuote:v=>{changedDuringQuote=v},
  valid:v=>{valid=v},
  remaining:()=>seedRemaining,
  cleanup:()=>fs.rmSync(root,{recursive:true,force:true})};
}
test("seed BUY order sells exact authenticated loot ID, preserves unrelated same-type stack",async()=>{
 const f=fixture();try{
  const result=await f.market().execute(f.offer());
  assert.equal(result.status,"TRADE_SETTLED");
  assert.equal(result.cargoID,3001);
  assert.equal(result.quantity,3);
  assert.equal(result.balance,60);
  assert.equal(result.npcLedgerOnly,true);
  assert.deepEqual(result.lootSource,{sourceWreckItemID:501,sourceWreckID:201});
  assert.equal(f.cargos.length,1);assert.equal(f.cargos[0].cargoID,3002);
  assert.equal(f.cargos[0].quantity,8);
  assert.equal(f.remaining(),47);
  assert.equal(f.calls.filter(x=>x==="FillOrder").length,1);
 }finally{f.cleanup();}
});
test("wrong native cargo ID or forged provenance refuses trade before any RPC",async()=>{
 const f=fixture();try{
  const trader=f.market();
  assert.equal((await trader.execute(f.offer({cargoID:999}))).status,
   "NATIVE_LOOT_CARGO_NOT_VERIFIED");
  assert.equal((await trader.execute(f.offer({verifyCargo:()=>false}))).status,
   "NATIVE_LOOT_CARGO_NOT_VERIFIED");
  assert.equal(f.calls.length,0);
  assert.equal(f.cargos.length,2);
 }finally{f.cleanup();}
});
test("loot provenance lost while awaiting seeded order book refuses market fill",async()=>{
 const f=fixture();try{
  f.changedDuringQuote(true);
  assert.equal((await f.market().execute(f.offer())).status,"MARKET_PREFLIGHT_STALE");
  assert.equal(f.calls.filter(x=>x==="FillOrder").length,0);
  assert.equal(f.cargos.length,2);
  assert.equal(f.remaining(),50);
 }finally{f.cleanup();}
});
test("pirate loot cannot buy seeded market goods with this special sale permission",async()=>{
 const f=fixture();try{
  const result=await f.market().execute(f.offer({side:"buy",typeID:35,buyTypes:[35]}));
  assert.equal(result.status,"NATIVE_LOOT_CARGO_NOT_VERIFIED");
  assert.equal(f.calls.length,0);
 }finally{f.cleanup();}
});
