"use strict";
// Source-of-truth physical station arrival gate for NPC mining haulers.
// A warp order or elapsed timer is NEVER proof of an arrival or a delivery.
const {createWarehouse} = require("./coopNativeWarehouse");
const pos = value => Number.isSafeInteger(Number(value)) && Number(value)>0 ? Number(value) : 0;
const vector = value => value && ["x","y","z"].every(k => typeof value[k]==="number" && Number.isFinite(value[k]));
const distance = (a,b) => Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
const truthy = result => result===true || (result && result.success===true);
const pause = status => ({status,terminal:false});
const DEADLINE_MS = 15*60*1000;
const ARRIVAL_DWELL_MS = 2000;
const MAX_SURFACE_GAP_METERS = 2500;
function createStationArrival({getStations, getStation, getCorporation, isNpcCorporation,
 getNativeEntity, getScene, store, items, flush, warpToPoint, root, probe={observe:()=>{}},clock=()=>Date.now(),warehouse=null}={}){
 if(typeof getStations!=="function"||typeof getStation!=="function"||
    typeof getCorporation!=="function"||typeof isNpcCorporation!=="function"||
    typeof getNativeEntity!=="function"||typeof getScene!=="function"||
    !store||!items||typeof flush!=="function"||typeof warpToPoint!=="function"||!root)
  throw Error("STATION_ARRIVAL_DEPENDENCIES_REQUIRED");
 const isValidStation=(scene, station, systemID) => {
  const id=pos(station?.stationID),corp=pos(station?.corporationID||station?.ownerID);
  if(!id||!corp||Number(station.solarSystemID)!==systemID||
     isNpcCorporation(corp)!==true||!getCorporation(corp))return null;
  const canonical=getStation(id);
  if(!canonical||Number(canonical.stationID)!==id||
    Number(canonical.solarSystemID)!==systemID||
    Number(canonical.corporationID||canonical.ownerID)!==corp)return null;
  const point=(scene?.staticEntities||[]).find(e=>e.kind==="station"&&Number(e.itemID)===id);
  if(!point||!vector(point.position))return null;
  return {stationID:id,corporationID:corp,systemID,position:{...point.position},radius:Math.max(0,Number(point.radius)||0)};
 };
 const findShip=(scene,id,systemID)=>{
  const ship=scene?.getEntityByID?.(id);
  if(!ship||ship.kind!=="ship"||ship.nativeNpc!==true||Number(ship.itemID)!==id||
    Number(scene.systemID)!==systemID)return null;
  const durable=getNativeEntity(id);
  return durable&&Number(durable.entityID||durable.itemID)===id&&
     Number(durable.systemID)===systemID&&ship.transient!==true&&durable.transient!==true?ship:null;
 };
 const stableAt=(ship,point)=>{
  if(!ship||!vector(ship.position)||ship.mode==="WARP"||ship.pendingWarp||ship.warpState||
      ship.isWarping===true)return false;
  return Math.max(0,distance(ship.position,point.position)-
    Math.max(0,Number(ship.radius)||0)-point.radius)<=MAX_SURFACE_GAP_METERS;
 };
 const arrivals=new Map();
 const factory=warehouse||createWarehouse({root,store,items,flush,getStation,getCorporation,isNpcCorporation,
  verifyArrival:args=>{
   const scene=getScene(args.systemID),point=scene&&isValidStation(scene,getStation(args.stationID),args.systemID);
   const ship=scene&&findShip(scene,args.haulerID,args.systemID);
   const active=arrivals.get(args.haulerID);
   return Boolean(point&&point.stationID===args.stationID&&stableAt(ship,point)&&
      active&&active.fleetID===args.fleetID&&active.stationID===args.stationID&&
      active.arrivedAt>0&&clock()-active.arrivedAt>=ARRIVAL_DWELL_MS);
  },
  verifyDurableCargo:(cargo,args)=>cargo.transient!==true&&
      Number(cargo.entityID)===args.haulerID&&Number(cargo.coopHaulFleetID)===args.fleetID&&
      Number(cargo.coopHaulFromMinerID)>0});
 function start(scene,fleet,now=clock(),options={}){
  const systemID=pos(scene?.systemID),fleetID=pos(fleet?.fleetID);
  if(!systemID||systemID!==pos(fleet?.systemID)||!fleetID||!Array.isArray(fleet.haulerEntityIDs)||
     !fleet.haulerEntityIDs.length)return pause("INVALID_FLEET");
  if(fleet.coopStationArrival)return pause("ROUTE_ALREADY_ACTIVE");
  const ships=fleet.haulerEntityIDs.map(pos).filter(Boolean);
  if(ships.length!==fleet.haulerEntityIDs.length||new Set(ships).size!==ships.length)return pause("INVALID_HAULERS");
  if(ships.some(id=>!findShip(scene,id,systemID)))return pause("HAULER_NOT_DURABLE");
  const candidates=(getStations(systemID)||[])
    .map(s=>isValidStation(scene,s,systemID)).filter(Boolean)
    .sort((a,b)=>a.stationID-b.stationID);
  if(!candidates.length)return pause("NO_NATIVE_NPC_STATION");
  const destination=candidates[0];
  const cargo=ships.flatMap(id=>(store.listNativeCargoForEntity(id)||[]).filter(row=>
   pos(row.cargoID)&&pos(row.typeID)&&pos(row.quantity)&&Number(row.coopHaulFleetID)===fleetID));
  if(cargo.some(row=>row.transient===true))return pause("CARGO_NOT_DURABLE");
  if(!cargo.length)return {status:"NO_ORE_TO_DELIVER",terminal:true};
  // Flush existing physical NPC entities and native cargo before moving.
  for(const name of ["npcEntities","npcCargo"]){if(!flush(name)?.success)return pause("PERSISTENCE_UNCERTAIN");}
  const result={stationID:destination.stationID,corporationID:destination.corporationID,
   systemID,fleetID,startedAt:now,haulers:Object.fromEntries(ships.map(id=>[id,{arrivedAt:0}]))};
  fleet.coopStationArrival=result; // In-memory intent is never proof of inventory.
  for(const [index,id] of ships.entries()){
   const target={...destination.position,x:destination.position.x+750+index*100};
   let ack;
   try{ack=warpToPoint(id,target,{forceImmediateStart:true,
    broadcastWarpStartToVisibleSessions:true,visibilitySuppressMs:250,
    ingressDurationMs:Math.max(250,Number(options.ingressDurationMs)||250)});}catch(_){ack=null;}
   if(!truthy(ack)){delete fleet.coopStationArrival;
    for(const raw of ships)arrivals.delete(raw);return pause("WARP_COMMAND_FAILED");}
   arrivals.set(id,{fleetID,stationID:destination.stationID,arrivedAt:0});
  }
  probe.observe("living-npc-station-warp-requested",null,{spaceState:{systemID}},
   {fleetID,stationID:destination.stationID,haulers:ships.length});
  return {status:"EN_ROUTE",terminal:false,stationID:destination.stationID};
 }
 function tick(scene,fleet,now=clock()){
  const trip=fleet?.coopStationArrival;
  if(!trip)return pause("ROUTE_NOT_STARTED");
  if(Number(scene?.systemID)!==trip.systemID||Number(fleet?.fleetID)!==trip.fleetID)
   return pause("FLEET_MISMATCH");
  if(now-trip.startedAt>DEADLINE_MS)return pause("ARRIVAL_TIMED_OUT_REPAIR_REQUIRED");
  const point=isValidStation(scene,getStation(trip.stationID),trip.systemID);
  if(!point||point.corporationID!==trip.corporationID)return pause("STATION_IDENTITY_CHANGED");
  let stackCount=0,oreQuantity=0;
  for(const rawID of Object.keys(trip.haulers)){
   const id=Number(rawID),ship=findShip(scene,id,trip.systemID);
   if(!ship)return pause("HAULER_LOST_OR_NOT_DURABLE");
   const arrival=trip.haulers[id];
   if(!stableAt(ship,point)){arrival.arrivedAt=0;
    arrivals.set(id,{fleetID:trip.fleetID,stationID:trip.stationID,arrivedAt:0});
    return pause("AWAITING_PHYSICAL_ARRIVAL");}
   if(!arrival.arrivedAt){arrival.arrivedAt=now;
    arrivals.set(id,{fleetID:trip.fleetID,stationID:trip.stationID,arrivedAt:now});
    return pause("ARRIVAL_DWELL_PENDING");}
   if(now-arrival.arrivedAt<ARRIVAL_DWELL_MS)return pause("ARRIVAL_DWELL_PENDING");
   const cargo=(store.listNativeCargoForEntity(id)||[]).filter(row=>
    pos(row.cargoID)&&Number(row.coopHaulFleetID)===trip.fleetID&&Number(row.moduleID||0)===0);
   for(const item of cargo){
    const result=factory.deposit({cargoID:Number(item.cargoID),haulerID:id,
      fleetID:trip.fleetID,systemID:trip.systemID,stationID:trip.stationID,
      corporationID:trip.corporationID});
    if(!["COMMITTED","ALREADY_COMMITTED"].includes(result.status)){
     probe.observe("living-npc-warehouse-blocked",null,{spaceState:{systemID:trip.systemID}},
      {fleetID:trip.fleetID,cargoID:item.cargoID,reason:result.status});
     return pause("WAREHOUSE_"+result.status);
    }
    stackCount++;oreQuantity+=Number(item.quantity);
   }
   if(typeof store.buildNativeCargoItems==="function")ship.nativeCargoItems=store.buildNativeCargoItems(id);
  }
  // No cargo remaining is evidence of completion only if at least one
  // previously committed source receipt exists in this trip.
  if(!stackCount&&!trip.completedStackCount)return pause("EMPTY_DELIVERY_NOT_PROVEN");
  trip.completedStackCount=(trip.completedStackCount||0)+stackCount;
  if(stackCount)probe.observe("living-npc-station-delivered",null,{spaceState:{systemID:trip.systemID}},
   {fleetID:trip.fleetID,stationID:trip.stationID,stacks:stackCount,oreQuantity});
  for(const raw of Object.keys(trip.haulers))arrivals.delete(Number(raw));
  delete fleet.coopStationArrival;
  return {status:"DELIVERED",terminal:true,stacks:stackCount,quantity:oreQuantity};
 }
 return {start,tick,verify:stableAt,warehouse:factory};
}
let runtimeDirector;
function getRuntimeDirector(){
 if(runtimeDirector)return runtimeDirector;
 const worldData=require("./worldData"),store=require("./npc/nativeNpcStore");
 const nativeItems=require("../services/inventory/itemStore");
 const repo=require("../gameStore");
 const corporations=require("../services/corporation/corporationState");
 const runtime=require("./runtime");
 runtimeDirector=createStationArrival({
  getStations:worldData.getStationsForSystem,getStation:worldData.getStationByID,
  getCorporation:corporations.getCorporationRecord,isNpcCorporation:corporations.isNpcCorporationID,
  getNativeEntity:store.getNativeEntity,getScene:id=>runtime.getScene?.(id)||runtime.ensureScene(id),
  store,items:nativeItems,flush:table=>repo.flushTableSync(table),
  warpToPoint:(id,p,opts)=>runtime.warpToPoint(id,p,opts),
  root:process.env.EVEJS_COOP_NPC_WAREHOUSE_DIR||"/var/lib/evejs/coop-native-warehouse",
  probe:require("./coopRuntimeProbe")});
 return runtimeDirector;
}
function routeFromHaul(scene,fleet,runtime,now,ingressDurationMs){
 if(process.env.EVEJS_COOP_NPC_STATION_DELIVERY!=="1")return pause("DISABLED");
 const result=getRuntimeDirector().start(scene,fleet,now,{ingressDurationMs});
 if(result.status==="NO_ORE_TO_DELIVER")fleet.coopStationNoCargo=true;
 return result;
}
function checkReturn(scene,fleet,now){
 if(process.env.EVEJS_COOP_NPC_STATION_DELIVERY!=="1")return pause("DISABLED");
 if(fleet?.coopStationNoCargo){delete fleet.coopStationNoCargo;return {status:"NO_CARGO",terminal:true};}
 return getRuntimeDirector().tick(scene,fleet,now);
}
module.exports={createStationArrival,routeFromHaul,checkReturn};