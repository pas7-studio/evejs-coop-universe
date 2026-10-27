import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createStationArrival}=require("../integration/coopNativeStationArrival.cjs");
const SYSTEM=30000144,STATION=60010001,STATION_CORP=1000035,SHIP=980001,FLEET=77,CARGO=9980;
function fixture(){
 let time=1_000_000;
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"coop-arrival-gate-"));
 const station={stationID:STATION,corporationID:STATION_CORP,solarSystemID:SYSTEM};
 const point={itemID:STATION,kind:"station",position:{x:2_000_000,y:10,z:-3_000_000},radius:800};
 const ship={kind:"ship",itemID:SHIP,nativeNpc:true,transient:false,mode:"STOP",pendingWarp:null,
  position:{...point.position,x:point.position.x+800},radius:100};
 const scene={systemID:SYSTEM,staticEntities:[point],getEntityByID:id=>id===SHIP?ship:null};
 const nativeEntity={entityID:SHIP,systemID:SYSTEM,transient:false};
 const cargo=new Map([[CARGO,{cargoID:CARGO,entityID:SHIP,ownerID:1000129,coopHaulFleetID:FLEET,
  coopHaulFromMinerID:9811,typeID:34,quantity:25,moduleID:0,transient:false}]]);
 const stock=new Map();
 const store={listNativeCargoForEntity:id=>id===SHIP?[...cargo.values()]:[],
  listNativeCargo:()=>[...cargo.values()],
  removeNativeCargo:id=>{const had=cargo.delete(Number(id));return {success:had}},
  buildNativeCargoItems:id=>[...cargo.values()]};
 const items={findWarehouseItem:({cargoID})=>stock.get(Number(cargoID))||null,
  grantUniqueNpcDepotItem:({ownerID,stationID,typeID,quantity,cargoID})=>{
   const itemID=70000+Number(cargoID);
   stock.set(Number(cargoID),{itemID,typeID,quantity,ownerID,locationID:stationID,
    customInfo:"coop-warehouse:v1:cargo:"+cargoID});
   return {success:true,itemID}}};
 const director=createStationArrival({getStations:id=>id===SYSTEM?[station]:[],
  getStation:id=>id===STATION?station:null,
  getCorporation:id=>[STATION_CORP,1000129].includes(id)?{corporationID:id}:null,
  isNpcCorporation:id=>[STATION_CORP,1000129].includes(id),
  getNativeEntity:id=>id===SHIP?nativeEntity:null,
  getScene:id=>id===SYSTEM?scene:null,store,items,
  flush:()=>({success:true}),warpToPoint:()=>({success:true}),
  root,clock:()=>time});
 return {root,station,point,ship,scene,nativeEntity,cargo,stock,director,
  setTime:t=>time=t,now:()=>time,
  explain:extra=>director.explainArrival({systemID:SYSTEM,stationID:STATION,fleetID:FLEET,
   haulerID:SHIP,cargoID:CARGO,arrivedAtMs:0,...extra})};
}
test("the arrival gate names the exact failing term instead of a bare refusal",()=>{
 const f=fixture();
 assert.equal(f.explain({arrivedAtMs:f.now()-5000}).term,"VERIFIED");
 // 2 501 m of real surface gap: outside the 2 500 m landing surface.
 f.ship.position={...f.point.position,x:f.point.position.x+800+2501+100};
 const gap=f.explain();
 assert.equal(gap.ok,false);assert.equal(gap.term,"SURFACE_GAP_TOO_LARGE");
 assert.equal(gap.maxSurfaceGapMeters,2500);assert.ok(gap.gapMeters>2500);
});
test("a warping or non-durable hauler is refused for its own reason",()=>{
 const f=fixture();
 f.ship.mode="WARP";assert.equal(f.explain().term,"HAULER_WARPING");
 f.ship.mode="STOP";f.ship.pendingWarp={};assert.equal(f.explain().term,"HAULER_WARPING");
 f.ship.pendingWarp=null;f.nativeEntity.systemID=30000145;
 assert.equal(f.explain().term,"HAULER_NOT_DURABLE_IN_SCENE");
});
test("physical arrival without dwell is reported as DWELL_PENDING",()=>{
 const f=fixture();
 const pending=f.explain({arrivedAtMs:f.now()});
 assert.equal(pending.ok,false);assert.equal(pending.term,"DWELL_PENDING");assert.equal(pending.dwelled,false);
 assert.equal(f.explain({arrivedAtMs:f.now()-2000}).ok,true);
});
test("dwell is measured on the native tick clock the trip used, not on the wall clock",()=>{
 const f=fixture();
 // Live shape: the native tick ran 2 041 ms ahead of Date.now(), so a hauler that
 // was physically on the station (gap 0 m) reported DWELL_PENDING forever.
 const tickAhead=f.now()+4000;
 const arrived=tickAhead-3000; // 1 000 ms in the future of the wall clock
 assert.equal(f.explain({arrivedAtMs:arrived,nowMs:tickAhead}).term,"VERIFIED");
 assert.equal(f.explain({arrivedAtMs:arrived}).term,"DWELL_PENDING");
 assert.equal(f.explain({arrivedAtMs:tickAhead-500,nowMs:tickAhead}).term,"DWELL_PENDING");
});
test("a refused deposit carries the gate term and mutates nothing",()=>{
 const f=fixture();
 const args={cargoID:CARGO,haulerID:SHIP,fleetID:FLEET,systemID:SYSTEM,
  stationID:STATION,corporationID:1000129};
 const pending=f.director.warehouse.deposit({...args,arrivedAtMs:0});
 assert.equal(pending.status,"ARRIVAL_NOT_VERIFIED");
 assert.equal(pending.detail.term,"DWELL_PENDING");
 assert.equal(pending.detail.dwelled,false);
 assert.equal(f.cargo.size,1);assert.equal(f.stock.size,0);
 // Same call, 2 601 m of surface gap: the refusal must say WHY, not just refuse.
 f.ship.position={...f.point.position,x:f.point.position.x+800+2501+100};
 const far=f.director.warehouse.deposit({...args,arrivedAtMs:f.now()-5000});
 assert.equal(far.status,"ARRIVAL_NOT_VERIFIED");
 assert.equal(far.detail.term,"SURFACE_GAP_TOO_LARGE");
 assert.ok(far.detail.gapMeters>far.detail.maxSurfaceGapMeters);
 assert.equal(f.cargo.size,1);assert.equal(f.stock.size,0);
});
