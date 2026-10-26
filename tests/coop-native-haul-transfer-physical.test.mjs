import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const {transferCargo}=require('../integration/coopNativeHaulCargo.cjs');
const flags=['EVEJS_COOP_NATIVE_HAUL_CARGO','EVEJS_COOP_NPC_STATION_DELIVERY',
 'EVEJS_COOP_NATIVE_MINING_CYCLE_ATOMIC','EVEJS_COOP_NATIVE_HAUL_TRANSFER_GUARD'];
const initial=Object.fromEntries(flags.map(k=>[k,process.env[k]]));
function flag(value='1') {for(const k of flags)process.env[k]=value;}
test.after(()=>{for(const k of flags){if(initial[k]===undefined)delete process.env[k];else process.env[k]=initial[k];}});
const typeIDs={miningShip:5001,hauler:5002,ore:34};
function fixture(opts={}){
 flag();
 const miner={kind:'ship',nativeNpc:true,itemID:91,ownerID:1000035,systemID:30000144,
  typeID:typeIDs.miningShip,transient:false,position:{x:0,y:0,z:0},radius:100,
  nativeCargoItems:[{itemID:1009,typeID:34,quantity:13,volume:0.1}]};
 const hauler={kind:'ship',nativeNpc:true,itemID:92,ownerID:1000035,systemID:30000144,
  typeID:typeIDs.hauler,transient:false,position:{x:1250,y:0,z:0},radius:100,
  nativeCargoItems:[]};
 const ships=[miner,hauler],orig=new Map(ships.map(x=>[x.itemID,{entityID:x.itemID,ownerID:x.ownerID,systemID:x.systemID,transient:false}]));
 let rows=[{cargoID:1009,entityID:91,ownerID:1000035,typeID:34,
  quantity:13,moduleID:0,categoryID:25,transient:false}];
 const actions=[], events=[],sde=new Map([[34,{typeID:34,volume:0.1,categoryID:25}],[5002,{typeID:5002,capacity:250}],
  [5001,{typeID:5001,capacity:50}]]);
 const store={getNativeEntity:id=>orig.get(id)||null,
  listNativeCargo:()=>rows.map(x=>({...x})),
  listNativeCargoForEntity:id=>rows.filter(x=>x.entityID===id).map(x=>({...x})),
  upsertNativeCargo:(row,settings)=>{
   actions.push({name:'upsert',row:{...row},settings});
   if(opts.writeOnAckFailure){rows=rows.map(x=>x.cargoID===row.cargoID?{...row}:x);return {success:false}}
   if(opts.rejectWrite)return {success:false};
   rows=rows.map(x=>x.cargoID===row.cargoID?{...row}:x);
   return {success:true};
  },
  buildNativeCargoItems:id=>rows.filter(x=>x.entityID===id).map(x=>({itemID:x.cargoID,typeID:x.typeID,quantity:x.quantity}))};
 const database={setTransientPath:(...values)=>{actions.push({name:'transient',values})},
  flushTableSync:table=>{actions.push({name:'flush',table});return {success:!opts.failFlush}}};
 const scene={systemID:30000144,getEntityByID:id=>ships.find(x=>x.itemID===id)||null};
 const fleet={systemID:30000144,fleetID:77,minerEntityIDs:[91],haulerEntityIDs:[92]};
 const probe={observe:(event,...rest)=>events.push({event,rest})};
 const dep={store,database,probe,depot:{prepare:()=>({status:"PREPARED"}),commit:()=>({status:"COMMITTED"})},
  resolveItemByTypeID:id=>sde.get(id)||null};
 return {miner,hauler,scene,fleet,store,database,actions,events,rows:()=>rows,
  orig,sde,ships,dep,run:()=>transferCargo(scene,fleet,miner,dep)};
}
test('same original cargoID physically transfers once, with durable owner/type/quantity and no mint',()=>{
 const f=fixture();assert.equal(f.run(),1.3);
 assert.equal(f.actions.filter(x=>x.name==='upsert').length,1);
 assert.equal(f.actions.filter(x=>x.name==='flush').length,1);
 assert.equal(f.rows().length,1);
 assert.deepEqual(Object.fromEntries(['cargoID','entityID','ownerID','typeID','quantity','coopHaulFleetID',
  'coopHaulFromMinerID'].map(k=>[k,f.rows()[0][k]])),
  {cargoID:1009,entityID:92,ownerID:1000035,typeID:34,quantity:13,coopHaulFleetID:77,coopHaulFromMinerID:91});
 assert.deepEqual(f.miner.nativeCargoItems,[]);
 assert.equal(f.hauler.nativeCargoItems[0].itemID,1009);
 assert.equal(f.run(),0,'same source cannot transfer twice');
 assert.equal(f.actions.filter(x=>x.name==='upsert').length,1);
});
test('recreated controller after simulated restart cannot duplicate already-loaded native cargo',()=>{
 const f=fixture();assert.equal(f.run(),1.3);
 const restoredMiner={...f.miner,nativeCargoItems:[]};
 f.ships.splice(0,1,restoredMiner);
 const volume=transferCargo(f.scene,f.fleet,restoredMiner,f.dep);
 assert.equal(volume,0);assert.equal(f.rows().length,1);
 assert.equal(f.rows()[0].cargoID,1009);assert.equal(f.rows()[0].entityID,92);
 assert.equal(f.actions.filter(x=>x.name==='upsert').length,1);
});
test('hauler outside transfer range: miner retains native cargo',()=>{
 const f=fixture();f.hauler.position.x=100000;
 assert.equal(f.run(),0);assert.equal(f.rows()[0].entityID,91);assert.equal(f.actions.length,0);
});
test('warp in progress or destroyed hull blocks physical handoff',()=>{
 for(const attr of ['pendingWarp','isWarping','destroyed','isDestroyed']){
  const f=fixture();f.hauler[attr]=true;
  assert.equal(f.run(),0,attr);assert.equal(f.rows()[0].entityID,91);
 }
});
test('wrong owner or native persisted identity blocks transfer',()=>{
 for(const variant of ['sceneOwner','minerOwner','nativeOwner','haulerTransient']){
  const f=fixture();
  if(variant==='sceneOwner')f.hauler.ownerID=999;
  if(variant==='minerOwner')f.miner.ownerID=999;
  if(variant==='nativeOwner')f.orig.get(92).ownerID=999;
  if(variant==='haulerTransient')f.hauler.transient=true;
  assert.equal(f.run(),0,variant);assert.equal(f.rows()[0].entityID,91);
 }
});
test('no cargo capacity, unknown SDE volume or oversized stack: cannot teleport or generate cargo',()=>{
 for(const variant of ['tooSmall','zeroCapacity','unknownType']){
  const f=fixture();
  if(variant==='tooSmall')f.sde.get(5002).capacity=1;
  if(variant==='zeroCapacity')f.sde.get(5002).capacity=0;
  if(variant==='unknownType')f.sde.delete(34);
  assert.equal(f.run(),0,variant);assert.equal(f.rows()[0].entityID,91);
  assert.equal(f.actions.length,0);
 }
});
test('forged/corrupt original cargo fields fail preflight without native mutation',()=>{
 for(const variant of ['wrongOwner','wrongType','wrongQuantity','badModule','oldFleet','transient','missingCache']){
  const f=fixture();
  const orig=f.rows()[0];
  if(variant==='wrongOwner')orig.ownerID=999;
  if(variant==='wrongType')orig.typeID=123;
  if(variant==='wrongQuantity')orig.quantity=99;
  if(variant==='badModule')orig.moduleID=555;
  if(variant==='oldFleet')orig.coopHaulFleetID=88;
  if(variant==='transient')orig.transient=true;
  if(variant==='missingCache')f.miner.nativeCargoItems=[];
  assert.equal(f.run(),0,variant);
  assert.equal(f.actions.length,0,variant);
 }
});
test('flush failure marks both native actors for operator reconciliation, no retry',()=>{
 const f=fixture({failFlush:true});
 assert.equal(f.run(),0);assert.equal(f.miner.coopHaulNeedsOperatorRepair,'HAUL_SOURCE_FLUSH_UNCERTAIN');
 assert.equal(f.hauler.coopHaulNeedsOperatorRepair,'HAUL_SOURCE_FLUSH_UNCERTAIN');
 assert.equal(f.actions.filter(x=>x.name==='upsert').length,1);
 assert.equal(f.run(),0);assert.equal(f.actions.filter(x=>x.name==='upsert').length,1);
});
test('lost acknowledgement after possible mutation quarantines both, not a free repeat',()=>{
 const f=fixture({writeOnAckFailure:true});assert.equal(f.run(),0);
 assert.equal(f.rows()[0].entityID,92,'ambiguous write may have changed the row');
 assert.equal(f.miner.coopHaulNeedsOperatorRepair,'HAUL_SOURCE_MOVE_UNCERTAIN');
 assert.equal(f.hauler.coopHaulNeedsOperatorRepair,'HAUL_SOURCE_MOVE_UNCERTAIN');
 assert.equal(f.run(),0);assert.equal(f.actions.filter(x=>x.name==='upsert').length,1);
});
test('second hauler may take a stack only if in range, independently owned and within capacity',()=>{
 const f=fixture();f.sde.get(5002).capacity=0.5;
 const second={...f.hauler,itemID:93,nativeCargoItems:[],position:{x:1500,y:0,z:0}};
 f.ships.push(second);f.orig.set(93,{entityID:93,ownerID:1000035,systemID:30000144,transient:false});
 f.fleet.haulerEntityIDs.push(93);
 f.dep.resolveCargoCapacityM3=(ship)=>ship.itemID===93?10:0.5;
 assert.equal(f.run(),1.3);assert.equal(f.rows()[0].entityID,93);
});
test('no ownership validation or physical native scene when feature flag OFF',()=>{
 const f=fixture();delete process.env.EVEJS_COOP_NATIVE_HAUL_TRANSFER_GUARD;
 // Old path stays unmodified and reads the same original cargoID.
 const moved=f.run();assert.equal(moved,1.3);
 assert.equal(f.rows()[0].entityID,92);
 assert.equal(f.events.some(e=>e.event==='living-hauler-loaded'),true);
});
test('strict gate requires native persistent mining and haul flags and remains fail-closed',()=>{
 for(const k of flags.slice(0,3)){
  const f=fixture();delete process.env[k];
  assert.equal(f.run(),0,k);assert.equal(f.actions.length,0,k);
 }
});

function lastNoHauler(f){
  const found=f.events.filter(x=>x.event==='living-haul-no-hauler');
  return found[found.length-1];
}
test('an out-of-range hauler leaves a named reason instead of silent zero',()=>{
 const f=fixture();
 f.hauler.position={x:9000,y:0,z:0};
 assert.equal(f.run(),0);
 const event=lastNoHauler(f);
 assert.ok(event,'no living-haul-no-hauler event');
 assert.equal(event.rest[event.rest.length-1].skipped[0].why,'out-of-range');
 assert.equal(event.rest[event.rest.length-1].skipped[0].rangeMeters,8800);
 assert.equal(f.actions.filter(x=>x.name==='upsert').length,0);
});
test('a hull whose SDE capacity is unknown is reported, never guessed',()=>{
 const f=fixture();
 f.sde.set(typeIDs.hauler,{typeID:typeIDs.hauler});
 assert.equal(f.run(),0);
 const event=lastNoHauler(f);
 assert.ok(event);
 assert.equal(event.rest[event.rest.length-1].skipped[0].why,'no-capacity');
 assert.equal(event.rest[event.rest.length-1].skipped[0].typeID,typeIDs.hauler);
});
test('a full hauler reports the volumes it compared',()=>{
 const f=fixture();
 f.rows().push({cargoID:1010,entityID:92,ownerID:1000035,typeID:34,
   quantity:2490,moduleID:0,categoryID:25,transient:false});
 assert.equal(f.run(),0);
 const event=lastNoHauler(f);
 assert.ok(event);
 assert.equal(event.rest[event.rest.length-1].skipped[0].why,'full');
 assert.equal(event.rest[event.rest.length-1].skipped[0].capacityM3,250);
});
test('a successful transfer reports no skip event',()=>{
 const f=fixture();
 assert.equal(f.run(),1.3);
 assert.equal(f.events.filter(x=>x.event==='living-haul-no-hauler').length,0);
});
