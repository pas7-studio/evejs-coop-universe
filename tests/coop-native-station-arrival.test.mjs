import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const path=require('node:path');
const source=fs.readFileSync(new URL('../integration/coopNativeStationArrival.cjs',import.meta.url),'utf8');
const compiled={exports:{}};
new Function('require','module','exports',source)(id=>{
 if(id==='./coopNativeWarehouse')return {createWarehouse:()=>{throw Error('Unexpected real warehouse construction')}};
 if(id==='./coopEconomyDestination')return require('../integration/coopEconomyDestination.cjs');
 return require(id);
},compiled,compiled.exports);
const {createStationArrival}=compiled.exports;
function fixture(options={}){
 let time=1_000_000;
 const station={stationID:60010001,corporationID:1000035,solarSystemID:30000144};
 const center={x:2_000_000,y:10,z:-3_000_000};
 const point={itemID:station.stationID,kind:'station',position:center,radius:800};
 const ship={kind:'ship',itemID:980001,nativeNpc:true,transient:false,mode:'STOP',pendingWarp:null,position:{x:0,y:0,z:0},radius:100};
 const scene={systemID:station.solarSystemID,staticEntities:[point],getEntityByID:id=>id===ship.itemID?ship:null};
 const fleet={fleetID:77,systemID:station.solarSystemID,haulerEntityIDs:[ship.itemID]};
 const nativeEntity={entityID:ship.itemID,systemID:station.solarSystemID,transient:false};
 const cargo=new Map([[9980,{cargoID:9980,entityID:ship.itemID,coopHaulFleetID:77,coopHaulFromMinerID:9811,typeID:34,quantity:25,moduleID:0,transient:false}]]);
 const deposits=[],warps=[],flushed=[];let warehouseStatus='COMMITTED';
 const store={listNativeCargoForEntity:id=>id===ship.itemID?[...cargo.values()]:[],buildNativeCargoItems:id=>[...cargo.values()]};
 const warehouse={deposit:x=>{deposits.push(x);if(warehouseStatus==='COMMITTED')cargo.delete(x.cargoID);return {status:warehouseStatus};}};
 const dir=createStationArrival({getStations:id=>id===scene.systemID?[station]:[],getStation:id=>id===station.stationID?station:null,
  getCorporation:id=>id===1000035?{corporationID:id}:null,
  isNpcCorporation:id=>id===1000035,
  getNativeEntity:id=>id===ship.itemID?nativeEntity:null,
  getScene:id=>id===scene.systemID?scene:null,store,items:{},
  flush:t=>{flushed.push(t);return {success:options.flushFails!==t}},warpToPoint:(id,p)=>{warps.push({id,p});return {success:!options.warpFails}},
  root:'/tmp/test-coop-warehouse',warehouse,clock:()=>time});
 return {dir,scene,fleet,ship,point,station,warps,flushed,deposits,cargo, nativeEntity,
  setTime:t=>time=t,now:()=>time,setWarehouseStatus:s=>warehouseStatus=s};
}
function arrive(f){f.ship.position={...f.point.position,x:f.point.position.x+800};f.ship.mode='STOP';f.ship.pendingWarp=null;}
test('physical station warp is issued from real native station, not origin/timer',()=>{
 const f=fixture();assert.equal(f.dir.start(f.scene,f.fleet,f.now()).status,'EN_ROUTE');
 assert.equal(f.warps.length,1);assert.equal(f.warps[0].id,980001);
 assert.equal(f.dir.tick(f.scene,f.fleet,f.now()+90000).status,'AWAITING_PHYSICAL_ARRIVAL');assert.equal(f.deposits.length,0);
});
test('actual physical station coordinates and dwell are required before native custody deposit',()=>{
 const f=fixture();assert.equal(f.dir.start(f.scene,f.fleet,f.now()).status,'EN_ROUTE');
 arrive(f);f.ship.mode='WARP';assert.equal(f.dir.tick(f.scene,f.fleet,1001000).status,'AWAITING_PHYSICAL_ARRIVAL');
 f.ship.mode='STOP';f.ship.pendingWarp={};assert.equal(f.dir.tick(f.scene,f.fleet,1002000).status,'AWAITING_PHYSICAL_ARRIVAL');
 f.ship.pendingWarp=null;assert.equal(f.dir.tick(f.scene,f.fleet,1003000).status,'ARRIVAL_DWELL_PENDING');
 assert.equal(f.dir.tick(f.scene,f.fleet,1004000).status,'ARRIVAL_DWELL_PENDING');
 f.setTime(1006000);const result=f.dir.tick(f.scene,f.fleet,1006000);
 assert.equal(result.status,'DELIVERED');assert.equal(f.deposits.length,1);
 assert.deepEqual(f.deposits[0],{cargoID:9980,haulerID:980001,fleetID:77,systemID:30000144,stationID:60010001,corporationID:1000035});
 assert.equal(f.cargo.size,0);assert.equal(f.fleet.coopStationArrival,undefined);
});
test('does not teleport ore from distant ship when timer fires',()=>{
 const f=fixture();f.dir.start(f.scene,f.fleet,f.now());
 f.setTime(1010000);assert.equal(f.dir.tick(f.scene,f.fleet,1010000).status,'AWAITING_PHYSICAL_ARRIVAL');assert.equal(f.cargo.size,1);
});
test('rejects destroyed hauler and does not create inventory',()=>{const f=fixture();f.dir.start(f.scene,f.fleet,f.now());f.ship.nativeNpc=false;assert.equal(f.dir.tick(f.scene,f.fleet,f.now()+6000).status,'HAULER_LOST_OR_NOT_DURABLE');assert.equal(f.deposits.length,0)});
test('rejects transient hauler or transient native cargo',()=>{
 const f=fixture();f.ship.transient=true;assert.equal(f.dir.start(f.scene,f.fleet,f.now()).status,'HAULER_NOT_DURABLE');
 f.ship.transient=false;f.cargo.get(9980).transient=true;assert.equal(f.dir.start(f.scene,f.fleet,f.now()).status,'CARGO_NOT_DURABLE');assert.equal(f.warps.length,0);
});
test('rejects made-up station with absent SDE record',()=>{const f=fixture();f.scene.staticEntities=[{...f.point,itemID:999999}];assert.equal(f.dir.start(f.scene,f.fleet,f.now()).status,'NO_NATIVE_NPC_STATION');});
test('rejects station corporation mismatch or incorrect system',()=>{const f=fixture();f.station.corporationID=1200000;assert.equal(f.dir.start(f.scene,f.fleet,f.now()).status,'NO_NATIVE_NPC_STATION');});
test('failed warp command never records arrival intent',()=>{const f=fixture({warpFails:true});assert.equal(f.dir.start(f.scene,f.fleet,f.now()).status,'WARP_COMMAND_FAILED');assert.equal(f.fleet.coopStationArrival,undefined);});
test('failed native store flush blocks warp before cargo changes',()=>{const f=fixture({flushFails:'npcCargo'});assert.equal(f.dir.start(f.scene,f.fleet,f.now()).status,'PERSISTENCE_UNCERTAIN');assert.equal(f.warps.length,0);assert.equal(f.cargo.size,1);});
test('failed native warehouse credit holds fleet for operator repair',()=>{
 const f=fixture();f.dir.start(f.scene,f.fleet,f.now());arrive(f);f.dir.tick(f.scene,f.fleet,1005000);f.setTime(1009000);f.setWarehouseStatus('TARGET_FLUSH_UNCERTAIN');
 assert.equal(f.dir.tick(f.scene,f.fleet,f.now()).status,'WAREHOUSE_TARGET_FLUSH_UNCERTAIN');assert.equal(f.fleet.coopStationArrival.stationID,f.station.stationID);assert.equal(f.cargo.size,1);
});
test('timeout blocks without treating deadline as arrival',()=>{const f=fixture();f.dir.start(f.scene,f.fleet,f.now());assert.equal(f.dir.tick(f.scene,f.fleet,f.now()+16*60*1000).status,'ARRIVAL_TIMED_OUT_REPAIR_REQUIRED');assert.equal(f.deposits.length,0)});
test('fleet does not restart delivery while route in progress',()=>{const f=fixture();f.dir.start(f.scene,f.fleet,f.now());assert.equal(f.dir.start(f.scene,f.fleet,f.now()+5000).status,'ROUTE_ALREADY_ACTIVE');assert.equal(f.warps.length,1)});
test('no cargo skips unneeded station warp without creating goods',()=>{const f=fixture();f.cargo.clear();assert.equal(f.dir.start(f.scene,f.fleet,f.now()).status,'NO_ORE_TO_DELIVER');assert.equal(f.warps.length,0)});
test('a fleet with no physical trip returns home instead of stalling forever',()=>{
 const {checkReturn}=compiled.exports;
 const previous=process.env.EVEJS_COOP_NPC_STATION_DELIVERY;
 process.env.EVEJS_COOP_NPC_STATION_DELIVERY='1';
 try{
  let ticked=0;
  const director={
   tick:()=>{ticked++;return {status:'AWAITING_PHYSICAL_ARRIVAL',terminal:false};},
   start:()=>({status:'EN_ROUTE',terminal:false})
  };
  const scene={systemID:30000144};
  const stalled=checkReturn(scene,{fleetID:7,systemID:30000144,haulerEntityIDs:[]},1000,director);
  assert.equal(stalled.status,'NO_ACTIVE_TRIP');
  assert.equal(stalled.terminal,true,'nothing is in flight, so the fleet must resume mining');
  assert.equal(ticked,0,'a fleet without a trip must never be ticked');
  const live=checkReturn(scene,{fleetID:7,systemID:30000144,
   coopStationArrival:{fleetID:7,systemID:30000144,haulers:{}}},1000,director);
  assert.equal(live.terminal,false);
  assert.equal(ticked,1,'a real trip is still advanced');
 }finally{
  if(previous===undefined)delete process.env.EVEJS_COOP_NPC_STATION_DELIVERY;
  else process.env.EVEJS_COOP_NPC_STATION_DELIVERY=previous;
 }
});

test('the station sells what a real buyer pays for before the warehouse takes it',()=>{
 const f=fixture();
 const calls=[];
 const dir=createStationArrival({getStations:id=>id===f.scene.systemID?[f.station]:[],
  getStation:id=>id===f.station.stationID?f.station:null,
  getCorporation:id=>id===1000035?{corporationID:id}:null,
  isNpcCorporation:id=>id===1000035,
  getNativeEntity:id=>id===f.ship.itemID?f.nativeEntity:null,
  getScene:id=>id===f.scene.systemID?f.scene:null,
  store:{listNativeCargoForEntity:id=>id===f.ship.itemID?[...f.cargo.values()]:[],
   buildNativeCargoItems:()=>[]},
  items:{},flush:()=>({success:true}),warpToPoint:()=>({success:true}),
  root:'/tmp/test-coop-warehouse',
  warehouse:{deposit:x=>{calls.push(['deposit',x.cargoID]);return {status:'COMMITTED'}}},
  beforeDeposit:args=>{calls.push(['sale',args.stationID,args.cargoIDs.length]);
   // The buyer takes the whole stack, exactly like a settled native fill.
   for(const cargoID of args.cargoIDs)f.cargo.delete(cargoID);
   return {status:'SOLD',sold:[{typeID:34,quantity:25,price:100,balance:2500}]}},
  clock:()=>f.now()});
 const fleet={fleetID:77,systemID:f.scene.systemID,haulerEntityIDs:[f.ship.itemID]};
 assert.equal(dir.start(f.scene,fleet,f.now()).status,'EN_ROUTE');
 arrive(f);
 dir.tick(f.scene,fleet,f.now());
 f.setTime(f.now()+3000);
 const result=dir.tick(f.scene,fleet,f.now());
 assert.deepEqual(calls[0][0],'sale','the sale must happen before any deposit');
 assert.equal(calls.filter(c=>c[0]==='deposit').length,0,'a sold stack is never deposited');
 assert.equal(result.status,'DELIVERED');
 assert.equal(f.cargo.size,0);
});
