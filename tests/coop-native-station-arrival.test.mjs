import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const path=require('node:path');
const source=fs.readFileSync(new URL('../integration/coopNativeStationArrival.cjs',import.meta.url),'utf8');
const compiled={exports:{}};
new Function('require','module','exports',source)(id=>id==='./coopNativeWarehouse'?{createWarehouse:()=>{throw Error('Unexpected real warehouse construction')}}:require(id),compiled,compiled.exports);
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
  flush:t=>{flushed.push(t);return {success:options.flushFails!==t}},warpToPoint:(id,p)=>{warps.push({id,p});
   return options.warpFails?{success:false,errorMsg:'WARP_REJECTED_BY_NATIVE'}:{success:true}},
  root:'/tmp/test-coop-warehouse',warehouse,clock:()=>time,
  probe:options.probe||{observe:()=>{}}});
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
test('opt-in ALIFE trace names the exact station blocker once per contiguous block',()=>{
 const events=[];
 const probe={observe:(name,_session,_ship,extra)=>events.push({name,extra})};
 process.env.EVEJS_COOP_ALIFE_TRACE='1';
 try{
  const f=fixture({probe});
  // A station whose corporation is not an NPC corporation: the gate must not warp.
  f.station.corporationID=1200000;
  assert.equal(f.dir.start(f.scene,f.fleet,f.now()).status,'NO_NATIVE_NPC_STATION');
  f.dir.start(f.scene,f.fleet,f.now());
  const blockers=events.filter(e=>e.name==='alife-blocker');
  assert.equal(blockers.length,1,'one event per contiguous blocker, not per tick');
  assert.equal(blockers[0].extra.module,'station-arrival');
  assert.equal(blockers[0].extra.status,'NO_NATIVE_NPC_STATION');
  assert.equal(blockers[0].extra.stationCount,1);
  assert.equal(blockers[0].extra.stationSample[0].npcCorp,false);
  assert.equal(f.warps.length,0);
  // A real route clears the blocker, so a later block is reported again.
  const ok=fixture({probe});assert.equal(ok.dir.start(ok.scene,ok.fleet,ok.now()).status,'EN_ROUTE');
  delete ok.fleet.coopStationArrival;ok.station.corporationID=1200000;
  assert.equal(ok.dir.start(ok.scene,ok.fleet,ok.now()).status,'NO_NATIVE_NPC_STATION');
  assert.equal(events.filter(e=>e.name==='alife-blocker').length,2);
  // Diagnostics are opt-in: the same block stays silent with trace off.
  delete process.env.EVEJS_COOP_ALIFE_TRACE;
  const before=events.length;
  const quiet=fixture({probe});
  quiet.station.corporationID=1200000;
  quiet.dir.start(quiet.scene,quiet.fleet,quiet.now());
  assert.equal(events.length,before,'no diagnostics without EVEJS_COOP_ALIFE_TRACE=1');
 }finally{delete process.env.EVEJS_COOP_ALIFE_TRACE;}
});
test('native warp rejection keeps the engine reason instead of discarding it',()=>{
 const f=fixture({warpFails:true});
 const events=[];
 const probe={observe:(name,_s,_sh,extra)=>events.push({name,extra})};
 process.env.EVEJS_COOP_ALIFE_TRACE='1';
 try{
  const g=fixture({warpFails:true,probe});
  assert.equal(g.dir.start(g.scene,g.fleet,g.now()).status,'WARP_COMMAND_FAILED');
  const blocker=events.find(e=>e.name==='alife-blocker');
  assert.equal(blocker.extra.status,'WARP_COMMAND_FAILED');
  assert.equal(blocker.extra.reason,'WARP_REJECTED_BY_NATIVE');
  assert.equal(blocker.extra.haulerID,980001);
  assert.equal(f.dir.start(f.scene,f.fleet,f.now()).status,'WARP_COMMAND_FAILED');
  assert.equal(f.fleet.coopStationArrival,undefined,'a rejected warp never records an arrival intent');
 }finally{delete process.env.EVEJS_COOP_ALIFE_TRACE;}
});
