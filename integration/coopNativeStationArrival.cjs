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
 getNativeEntity, getScene, store, items, flush, warpToPoint, root, probe={observe:()=>{}},clock=()=>Date.now(),warehouse=null,manifest=null,escortGate=null}={}){
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
 const manifestEnabled=process.env.EVEJS_COOP_NATIVE_HAUL_MANIFEST==="1";
 const escortEnabled=process.env.EVEJS_COOP_ESCORT_ROUTE_GATE==="1";
 const manifestDirector=manifestEnabled?
  (manifest||require("./coopNativeHaulManifest").createManifest({root,store,items,getNativeEntity,clock})):null;
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
  if(escortEnabled&&(!manifestEnabled||
    typeof escortGate?.fundBeforeWarp!=="function"||
    typeof escortGate?.recordDelivered!=="function"))
   return pause("ESCORT_ROUTE_GATE_UNAVAILABLE");
  if(!systemID||systemID!==pos(fleet?.systemID)||!fleetID||!Array.isArray(fleet.haulerEntityIDs)||
     !fleet.haulerEntityIDs.length)return pause("INVALID_FLEET");
  if(fleet.coopEscortWarpOutcomeUncertain)
   return pause("ESCORT_WARP_OUTCOME_NEEDS_OPERATOR_REPAIR");
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
  // Real NPC cargo + native hauler must be observed BEFORE an escort offer.
  // Consent is a prerequisite, not permission to create funds or warp:
  // the independent native Stage E binding still authorizes both.
  let preparingEventID=null;
  if(escortEnabled&&process.env.EVEJS_COOP_OPPORTUNITY_BOARD==="1"){
   if(process.env.EVEJS_COOP_EVENT_VOLUNTEERS!=="1")
    return pause("ESCORT_VOLUNTEER_GATE_DISABLED");
   let event;try{event=require("./coopWorldOpportunityBoard")
    .noteNativeConvoyPreparing(scene,fleet,destination.stationID,
     cargo.map(x=>Number(x.cargoID)))}
   catch{return pause("ESCORT_PREPARING_SOURCE_UNAVAILABLE")}
   if(!["EVENT_PUBLISHED","NATIVE_PREPARING_EVENT_READY"].includes(event?.status)||
    typeof event.id!=="string")
    return pause("ESCORT_"+(event?.status||"PREPARING_EVENT_FAILED"));
   preparingEventID=event.id;
   fleet.coopEscortPredepartureEventID=preparingEventID;
   let duo;try{duo=require("./coopEscortVolunteers")
    .readVerifiedNativePair(preparingEventID)}
   catch{return pause("ESCORT_VOLUNTEER_RECEIPT_UNAVAILABLE")}
   if(duo?.status!=="VERIFIED_NATIVE_DUO_VOLUNTEER"||
    duo.eventID!==preparingEventID||
    duo.systemID!==systemID||duo.entityID!==ships[0]||
    !Array.isArray(duo.pilots)||duo.pilots.length!==2||
    duo.pilots.some(x=>!pos(x.characterID)||!pos(x.shipID)))
    return pause("ESCORT_AWAITING_TWO_NATIVE_VOLUNTEERS");
  }
  let manifestProof=null;
  if(manifestDirector){
   manifestProof=manifestDirector.prepare({systemID,fleetID,stationID:destination.stationID,
    corporationID:destination.corporationID,startedAt:now,haulerIDs:ships});
   if(manifestProof?.status!=="MANIFEST_DURABLY_PREPARED")
    return pause(manifestProof?.status||"MANIFEST_PREPARE_UNAVAILABLE");
  }
  if(escortEnabled){
   if(!manifestProof?.key)return pause("ESCORT_PREWARP_MANIFEST_REQUIRED");
   let funded;try{funded=escortGate.fundBeforeWarp({
    manifestKey:manifestProof.key,systemID,fleetID,stationID:destination.stationID,
    corporationID:destination.corporationID,haulerIDs:ships.slice()
   })}catch{return pause("ESCORT_PREWARP_FUNDING_UNAVAILABLE")}
   if(funded?.status!=="FUNDED_BEFORE_WARP"||
      funded.manifestKey!==manifestProof.key||typeof funded.contractID!=="string")
    return pause("ESCORT_"+(funded?.status||"FUNDING_UNVERIFIED"));
   // A native warp ACK can be lost after the ship physically moved.
   // Until ALL warp results are explicitly accepted, forbid an in-process retry.
   fleet.coopEscortWarpOutcomeUncertain=true;
  }
  const result={stationID:destination.stationID,corporationID:destination.corporationID,
   systemID,fleetID,startedAt:now,haulers:Object.fromEntries(ships.map(id=>[id,{arrivedAt:0}]))};
  if(manifestProof){
   result.manifestID=manifestProof.key;
   result.expectedCargoIDs=manifestProof.cargoIDs;
  }
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
  let preparingNoticeStatus="NOT_REQUIRED";
  if(escortEnabled){
   delete fleet.coopEscortWarpOutcomeUncertain;
   if(preparingEventID){
    let close;try{close=require("./coopWorldOpportunityBoard")
     .noteNativePreparingDeparted(scene,fleet,preparingEventID,result)}
    catch{close={status:"PREPARING_DEPARTURE_WRITE_UNCERTAIN"}}
    preparingNoticeStatus=close?.status||"PREPARING_DEPARTURE_WRITE_UNCERTAIN";
    if(preparingNoticeStatus==="NATIVE_PREPARING_EVENT_CLOSED")
     delete fleet.coopEscortPredepartureEventID;
   }
  }
  probe.observe("living-npc-station-warp-requested",null,{spaceState:{systemID}},
   {fleetID,stationID:destination.stationID,haulers:ships.length});
  // Publish the actual native started convoy; no promise of a paid contract.
  if(process.env.EVEJS_COOP_OPPORTUNITY_BOARD==="1"){
   try{require("./coopWorldOpportunityBoard").noteNativeConvoy(
    scene,fleet,{status:"EN_ROUTE",stationID:destination.stationID})}
   catch(error){console.warn("[CoopOpportunityBoard] convoy",String(error?.message||error).slice(0,120))}
  }
  return {status:"EN_ROUTE",terminal:false,stationID:destination.stationID,
   ...(escortEnabled?{predepartureNoticeStatus:preparingNoticeStatus}:{})};
 }
 function tick(scene,fleet,now=clock()){
  const trip=fleet?.coopStationArrival;
  if(!trip)return pause("ROUTE_NOT_STARTED");
  if(Number(scene?.systemID)!==trip.systemID||Number(fleet?.fleetID)!==trip.fleetID)
   return pause("FLEET_MISMATCH");
  // A warp may have succeeded while the informational notice fsync ACK
  // failed. Retry ONLY closing the notice; never warp or debit again.
  if(fleet?.coopEscortPredepartureEventID&&
    process.env.EVEJS_COOP_OPPORTUNITY_BOARD==="1"){
   try{const closed=require("./coopWorldOpportunityBoard")
    .noteNativePreparingDeparted(scene,fleet,
     fleet.coopEscortPredepartureEventID,trip);
    if(closed?.status==="NATIVE_PREPARING_EVENT_CLOSED")
     delete fleet.coopEscortPredepartureEventID;
   }catch{/* informational repair remains pending, cargo route unaffected */}
  }
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
   if(manifestDirector&&(!trip.manifestID||!Array.isArray(trip.expectedCargoIDs)))
    return pause("MANIFEST_TRIP_CONTEXT_MISSING");
   if(manifestDirector&&cargo.some(item=>!trip.expectedCargoIDs.includes(Number(item.cargoID))))
    return pause("MANIFEST_NEW_UNDECLARED_CARGO");
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
  let manifestVerified=null;
  if(manifestDirector){
   manifestVerified=manifestDirector.verify({key:trip.manifestID,systemID:trip.systemID,
    fleetID:trip.fleetID,stationID:trip.stationID,corporationID:trip.corporationID,
    haulerIDs:Object.keys(trip.haulers).map(Number)});
   if(manifestVerified?.status!=="FULL_NATIVE_CARGO_DELIVERY_VERIFIED")
    return pause(manifestVerified?.status||"MANIFEST_FULL_CARGO_UNVERIFIED");
  }
  if(stackCount)probe.observe("living-npc-station-delivered",null,{spaceState:{systemID:trip.systemID}},
   {fleetID:trip.fleetID,stationID:trip.stationID,stacks:stackCount,oreQuantity});
  if(escortEnabled){
   const terminal={status:"DELIVERED",terminal:true,nativeFullManifestProof:manifestVerified};
   let written;try{written=escortGate.recordDelivered({
    manifestKey:trip.manifestID,trip,terminalProof:terminal
   })}catch{return pause("ESCORT_TERMINAL_JOURNAL_UNAVAILABLE")}
   if(written?.status!=="DURABLE_NATIVE_DELIVERY_RECORDED"||
     written.manifestKey!==trip.manifestID)
    return pause("ESCORT_"+(written?.status||"TERMINAL_WRITE_BLOCKED"));
  }
  // Physical delivery already has an authoritative warehouse and fsync.
  // Payout is optional, but never presumed: an absent pirate wreck or
  // uncertain native funds leaves a visible pending settlement, not fake ISK.
  let escortSettlement=null;
  if(escortEnabled){
   try{escortSettlement=typeof escortGate?.settleVerifiedNativeRaid==="function"?
    escortGate.settleVerifiedNativeRaid(trip.manifestID):
    {status:"ESCORT_SETTLEMENT_NOT_WIRED"}}
   catch{escortSettlement={status:"ESCORT_SETTLEMENT_UNCERTAIN_REPAIR_REQUIRED"}}
  }
  if(process.env.EVEJS_COOP_OPPORTUNITY_BOARD==="1"){
   try{require("./coopWorldOpportunityBoard").noteNativeConvoyOutcome(
    scene,trip,{status:"DELIVERED",terminal:true})}
   catch(error){console.warn("[CoopOpportunityBoard] arrival",String(error?.message||error).slice(0,120))}
  }
  for(const raw of Object.keys(trip.haulers))arrivals.delete(Number(raw));
  delete fleet.coopStationArrival;
  return {status:"DELIVERED",terminal:true,stacks:stackCount,quantity:oreQuantity,
   ...(escortEnabled?{escortSettlementStatus:escortSettlement?.status||"UNAVAILABLE"}:{}),
   ...(manifestVerified?{nativeFullManifestProof:manifestVerified}:{})};
 }
 return {start,tick,verify:stableAt,warehouse:factory,manifest:manifestDirector};
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
  probe:require("./coopRuntimeProbe"),
  // Stable server-only forwarding object: a late binding works, while no
  // real native authority means NO warp (never silently unpaid).
  escortGate:process.env.EVEJS_COOP_ESCORT_ROUTE_GATE==="1"?
   require("./coopEscortNativeBinding").routeGate():null});
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
 if(process.env.EVEJS_COOP_ESCORT_ROUTE_GATE==="1"&&
    fleet?.coopEscortPredepartureEventID&&!fleet?.coopStationArrival){
   return getRuntimeDirector().start(scene,fleet,now);
 }
 return getRuntimeDirector().tick(scene,fleet,now);
}
module.exports={createStationArrival,routeFromHaul,checkReturn};