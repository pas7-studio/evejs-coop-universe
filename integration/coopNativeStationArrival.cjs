"use strict";
// Source-of-truth physical station arrival gate for NPC mining haulers.
// A warp order or elapsed timer is NEVER proof of an arrival or a delivery.
const {createWarehouse} = require("./coopNativeWarehouse");
// The resolver deploys as .js next to this file, but is stored as .cjs in the
// orchestration repo, so resolve either spelling instead of keeping a stale copy.
function loadEconomyDestination(){
 try{return require("./coopEconomyDestination");}
 catch(error){return require("./coopEconomyDestination.cjs");}
}
const pos = value => Number.isSafeInteger(Number(value)) && Number(value)>0 ? Number(value) : 0;
const vector = value => value && ["x","y","z"].every(k => typeof value[k]==="number" && Number.isFinite(value[k]));
const distance = (a,b) => Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
const truthy = result => result===true || (result && result.success===true);
const pause = status => ({status,terminal:false});
const DEADLINE_MS = 15*60*1000;
const ARRIVAL_DWELL_MS = 2000;
const MAX_SURFACE_GAP_METERS = 2500;
function createStationArrival({getStations, getStation, getCorporation, isNpcCorporation,
 getNativeEntity, getScene, store, items, flush, warpToPoint, root, probe={observe:()=>{}},clock=()=>Date.now(),warehouse=null,manifest=null,escortGate=null,destinationOracle=null,warpFence=null}={}){
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
 const arrivals=new Map(),activeNativeEscortWarps=new Map();
 const strictMotion=()=>escortEnabled&&
  process.env.EVEJS_COOP_ESCORT_PEACEFUL_PAYOUT==="1"&&
  process.env.EVEJS_COOP_ESCORT_ROUTE_WITNESS==="1"&&
  process.env.EVEJS_COOP_ESCORT_NATIVE_WARP_OBSERVER==="1";
 // Only true confirmed NPC warps can be sampled. Never infer position from
 // timer, navigation commands, forecast points or player RPC.
 function noteNativeMotion(entity,now){
  if(!strictMotion()||entity?.nativeNpc!==true||!pos(entity.itemID)||
   !Number.isFinite(now)||!entity.sessionlessWarpIngress)
   return pause("ESCORT_NATIVE_MOTION_DISABLED_OR_NOT_WARPING");
  const active=activeNativeEscortWarps.get(Number(entity.itemID));
  if(!active)return pause("ESCORT_NATIVE_MOTION_NOT_REGISTERED");
  const trip=active.fleet?.coopStationArrival;
  if(!trip||trip!==active.trip||trip.manifestID!==active.manifestKey||
   trip.systemID!==active.systemID||trip.fleetID!==active.fleetID||
   !Object.prototype.hasOwnProperty.call(trip.haulers,String(entity.itemID)))
   return pause("ESCORT_NATIVE_MOTION_TRIP_NOT_ACTIVE");
  let scene;try{scene=getScene(active.systemID)}
  catch{return pause("ESCORT_NATIVE_MOTION_SCENE_UNAVAILABLE")}
  if(scene?.systemID!==active.systemID||
   scene.getEntityByID?.(Number(entity.itemID))!==entity)
   return pause("ESCORT_NATIVE_MOTION_ENTITY_NOT_CURRENT");
  const point=isValidStation(scene,getStation(trip.stationID),trip.systemID);
  if(!point||point.corporationID!==trip.corporationID)
   return pause("ESCORT_NATIVE_MOTION_STATION_CHANGED");
  if(typeof escortGate?.recordEscortRouteSample!=="function")
   return pause("ESCORT_NATIVE_MOTION_AUTHORITY_UNAVAILABLE");
  try{return escortGate.recordEscortRouteSample(trip.manifestID,scene,point)}
  catch{return pause("ESCORT_NATIVE_MOTION_SAMPLE_UNAVAILABLE")}
 }

 const manifestEnabled=process.env.EVEJS_COOP_NATIVE_HAUL_MANIFEST==="1";
 const escortEnabled=process.env.EVEJS_COOP_ESCORT_ROUTE_GATE==="1";
 const durableWarpFence=escortEnabled&&process.env.EVEJS_COOP_ESCORT_WARP_FENCE==="1"?
  (warpFence||require("./coopEscortWarpFence").createWarpFence({root,clock})):null;
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
  if(escortEnabled&&(!durableWarpFence||
   ["inspectSource","prepare","confirm"].some(k=>typeof durableWarpFence[k]!=="function")))
   return pause("ESCORT_DURABLE_WARP_FENCE_REQUIRED");
  if(escortEnabled&&process.env.EVEJS_COOP_ESCORT_PEACEFUL_PAYOUT==="1"&&
   (process.env.EVEJS_COOP_ESCORT_DEPARTURE_WITNESS!=="1"||
    typeof escortGate?.recordEscortDeparture!=="function"))
   return pause("ESCORT_DURABLE_DEPARTURE_WITNESS_REQUIRED");
  if(escortEnabled&&process.env.EVEJS_COOP_ESCORT_PEACEFUL_PAYOUT==="1"&&
   process.env.EVEJS_COOP_ESCORT_ROUTE_WITNESS==="1"&&
   (process.env.EVEJS_COOP_ESCORT_NATIVE_WARP_OBSERVER!=="1"||
    typeof escortGate?.recordEscortRouteSample!=="function"))
   return pause("ESCORT_NATIVE_MOTION_OBSERVER_REQUIRED");
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
  const cargo=ships.flatMap(id=>(store.listNativeCargoForEntity(id)||[]).filter(row=>
   pos(row.cargoID)&&pos(row.typeID)&&pos(row.quantity)&&Number(row.coopHaulFleetID)===fleetID));
  if(cargo.some(row=>row.transient===true))return pause("CARGO_NOT_DURABLE");
  if(!cargo.length)return {status:"NO_ORE_TO_DELIVER",terminal:true};
  // The fleet picks the station that really pays for the ore it carries. The
  // buyer list is the live seed book of the fleet's own region, capped by the
  // remaining volume, so no station is ever preferred by ID. Without a known
  // book we keep the plain physical route and say so in telemetry.
  let destination=candidates[0],economy=null;
  if(destinationOracle){
   try{
    const ship=findShip(scene,ships[0],systemID);
    const measured=candidates.map(candidate=>({...candidate,distanceMeters:
     ship&&vector(ship.position)&&vector(candidate.position)?
      Math.round(distance(ship.position,candidate.position)):null}));
    economy=destinationOracle.decide({cargo,candidates:measured,systemID});
    if(economy?.status==="CHOSEN"){
     const picked=candidates.find(candidate=>candidate.stationID===economy.stationID);
     if(picked)destination=picked;
     else economy={...economy,status:"CHOSEN_STATION_NOT_PHYSICAL"};
    }
   }catch(error){economy={status:"ORACLE_FAILED",reason:String(error?.message||error).slice(0,80)};}
   if(typeof probe?.observe==="function")
    probe.observe("living-economy-destination",null,{spaceState:{systemID}},{
     fleetID,status:economy?.status||"UNKNOWN",regionID:economy?.regionID||0,
     stationID:destination.stationID,
     chosenRevenue:economy?.revenue||0,filled:economy?.filled||0,
     unfilled:economy?.unfilled||0,totalQuantity:economy?.totalQuantity||0,
     cargoTypes:economy?.cargoTypes||[],
     top:(economy?.ranked||[]).slice(0,3).map(entry=>({stationID:entry.stationID,
      revenue:entry.revenue,filled:entry.filled,unfilled:entry.unfilled}))
    });
  }
  if(strictMotion()){
   const first=scene.getEntityByID?.(ships[0]);
   if(!vector(first?.position)||distance(first.position,destination.position)<10000)
    return pause("ESCORT_ROUTE_TOO_SHORT_FOR_WITNESS");
  }
   if(escortEnabled){
   if(ships.length!==1)return pause("ESCORT_REQUIRES_ONE_NATIVE_HAULER");
   let source;try{source=durableWarpFence.inspectSource({systemID,fleetID,haulerID:ships[0],cargoIDs:cargo.map(x=>Number(x.cargoID))})}
   catch{return pause("ESCORT_WARP_FENCE_SOURCE_UNAVAILABLE")}
   if(source?.status!=="WARP_SOURCE_CLEAR")return pause("ESCORT_"+(source?.status||"WARP_FENCE_UNVERIFIED"));
  }
  // Flush existing physical NPC entities and native cargo before moving.
  for(const name of ["npcEntities","npcCargo"]){if(!flush(name)?.success)return pause("PERSISTENCE_UNCERTAIN");}
  // Real NPC cargo + native hauler must be observed BEFORE an escort offer.
  // Consent is a prerequisite, not permission to create funds or warp:
  // the independent native Stage E binding still authorizes both.
  let preparingEventID=null,approvedDepartPilots=null;
  // Paid escort NEVER departs without discoverable source and an explicit
  // independently priced, two-character contract acceptance. Optional native
  // NPC routes remain unchanged with the paid escort flag OFF.
  if(escortEnabled&&(
   process.env.EVEJS_COOP_OPPORTUNITY_BOARD!=="1"||
   process.env.EVEJS_COOP_EVENT_VOLUNTEERS!=="1"||
   process.env.EVEJS_COOP_ESCORT_PAID_ACCEPT!=="1"))
   return pause("ESCORT_DISCOVERY_AND_PAID_CONSENT_REQUIRED");
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
   // Native corporation quote must be durably prepared while the original
   // source cargo and source NPC still exist; never accept client pricing.
   let quoted;try{quoted=require("./coopEscortPricedOffers")
    .offerFromNative({eventID:preparingEventID,route:{
     systemID,fleetID,stationID:destination.stationID,
     corporationID:destination.corporationID,haulerID:ships[0],
     cargoIDs:cargo.map(x=>Number(x.cargoID)).sort((a,b)=>a-b)
    }})}
   catch{return pause("ESCORT_NATIVE_CORPORATE_QUOTE_UNAVAILABLE")}
   if(!["NATIVE_QUOTE_DURABLY_PREPARED","NATIVE_QUOTE_READY"].includes(quoted?.status))
    return pause("ESCORT_"+(quoted?.status||"PAID_QUOTE_NOT_VERIFIED"));
   let duo;try{duo=require("./coopEscortVolunteers")
    .readVerifiedNativePair(preparingEventID)}
   catch{return pause("ESCORT_VOLUNTEER_RECEIPT_UNAVAILABLE")}
   if(duo?.status!=="VERIFIED_NATIVE_DUO_VOLUNTEER"||
    duo.eventID!==preparingEventID||
    duo.systemID!==systemID||duo.entityID!==ships[0]||
    !Array.isArray(duo.pilots)||duo.pilots.length!==2||
    duo.pilots.some(x=>!pos(x.characterID)||!pos(x.shipID)))
    return pause("ESCORT_AWAITING_TWO_NATIVE_VOLUNTEERS");
   let paid;try{paid=require("./coopEscortPricedOffers")
    .readNativeAccepted(preparingEventID)}
   catch{return pause("ESCORT_PAID_ACCEPTANCE_READER_UNAVAILABLE")}
   if(paid?.status!=="DURABLE_TWO_PILOT_PAID_ACCEPTANCE"||
    paid.eventID!==preparingEventID||
    paid.quote?.systemID!==systemID||
    paid.quote?.fleetID!==fleetID||
    paid.quote?.stationID!==destination.stationID||
    paid.quote?.corporationID!==destination.corporationID||
    paid.quote?.haulerID!==ships[0]||
    paid.characters?.length!==2||
    paid.characters[0]!==duo.pilots[0].characterID||
    paid.characters[1]!==duo.pilots[1].characterID||
    paid.fleetID!==duo.fleetID)
    return pause("ESCORT_AWAITING_TWO_PAID_ACCEPTANCES");
   approvedDepartPilots=duo.pilots.map(x=>({characterID:x.characterID,shipID:x.shipID}));
  }
  // Fast, non-writing source grid proof BEFORE persisting the native cargo
  // manifest. Full durable actor/escrow authority is still rechecked in Stage
  // E before debit; this preflight avoids orphan manifest on absent pilots.
  if(escortEnabled&&process.env.EVEJS_COOP_ESCORT_PEACEFUL_PAYOUT==="1"){
   const npc=scene.getEntityByID?.(ships[0]);
   const onGrid=p=>p&&["x","y","z"].every(k=>Number.isFinite(p[k]));
   const sessions=typeof scene.sessions?.values==="function"?
    [...scene.sessions.values()]:null;
   if(!Array.isArray(approvedDepartPilots)||approvedDepartPilots.length!==2||
    !Array.isArray(sessions)||!onGrid(npc?.position))
    return pause("ESCORT_DEPARTURE_ON_GRID_PREFLIGHT_UNAVAILABLE");
   for(const pilot of approvedDepartPilots){
    const active=sessions.filter(x=>x?.characterID===pilot.characterID&&
     x?.socket?.destroyed!==true&&x?._space?.initialStateSent===true&&
     x._space.systemID===systemID&&x._space.shipID===pilot.shipID);
    if(active.length!==1)return pause("ESCORT_DEPARTURE_PILOT_NOT_AT_SOURCE");
    const ship=scene.getEntityByID?.(pilot.shipID);
    if(ship?.itemID!==pilot.shipID||ship.kind!=="ship"||
     ship.nativeNpc===true||ship.transient===true||
     !onGrid(ship.position)||
     Math.hypot(ship.position.x-npc.position.x,
      ship.position.y-npc.position.y,
      ship.position.z-npc.position.z)>150000)
     return pause("ESCORT_DEPARTURE_PILOT_NOT_ON_NPC_GRID");
   }
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
   const originalRoute={manifestKey:manifestProof.key,systemID,fleetID,
    stationID:destination.stationID,corporationID:destination.corporationID,
    haulerIDs:ships.slice()};
   if(process.env.EVEJS_COOP_ESCORT_PEACEFUL_PAYOUT==="1"){
    let witness;try{witness=escortGate.recordEscortDeparture(originalRoute,scene)}
    catch{return pause("ESCORT_DEPARTURE_WITNESS_UNAVAILABLE")}
    if(!["DURABLE_NATIVE_ESCORT_DEPARTURE_WITNESS",
     "DURABLE_ESCORT_DEPARTURE_REPLAY"].includes(witness?.status))
     return pause("ESCORT_"+(witness?.status||"DEPARTURE_WITNESS_BLOCKED"));
   }
   let funded;try{funded=escortGate.fundBeforeWarp({
    manifestKey:manifestProof.key,systemID,fleetID,stationID:destination.stationID,
    corporationID:destination.corporationID,haulerIDs:ships.slice()
   })}catch{return pause("ESCORT_PREWARP_FUNDING_UNAVAILABLE")}
   if(funded?.status!=="FUNDED_BEFORE_WARP"||
      funded.manifestKey!==manifestProof.key||typeof funded.contractID!=="string")
    return pause("ESCORT_"+(funded?.status||"FUNDING_UNVERIFIED"));
   // A native warp ACK can be lost after the ship physically moved.
   // Until ALL warp results are explicitly accepted, forbid an in-process retry.
   let intent;try{intent=durableWarpFence.prepare({
    manifestKey:manifestProof.key,contractID:funded.contractID,
    systemID,fleetID,haulerID:ships[0],stationID:destination.stationID,
    corporationID:destination.corporationID,cargoIDs:manifestProof.cargoIDs.slice()})}
   catch{return pause("ESCORT_WARP_INTENT_UNAVAILABLE")}
   if(intent?.status!=="DURABLE_WARP_PREPARED")
    return pause("ESCORT_"+(intent?.status||"WARP_INTENT_UNVERIFIED"));
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
   const sceneBeat=Math.max(250,Math.min(5000,Number(scene._tickIntervalMs)||1000));
   const realIngress=strictMotion()?
    Math.min(30000,Math.max(6000,sceneBeat*6)):0;
   let ack,warpError=null;
   try{ack=warpToPoint(id,target,{forceImmediateStart:true,
    broadcastWarpStartToVisibleSessions:true,visibilitySuppressMs:250,
    ingressDurationMs:Math.max(250,Number(options.ingressDurationMs)||250,
     realIngress)});}catch(error){ack=null;warpError=String(error?.message||error).slice(0,120);}
   if(!truthy(ack)){delete fleet.coopStationArrival;
    for(const raw of ships)arrivals.delete(raw);
    // A rejected warp is the difference between "the fleet is working" and
    // "the fleet is silently stuck", so it must never be swallowed.
    const rejection={fleetID,haulerID:id,stationID:destination.stationID,
     systemID,errorMsg:String(ack?.errorMsg||ack?.error||warpError||"").slice(0,120),
     ackKeys:ack&&typeof ack==="object"?Object.keys(ack).slice(0,8):[]};
    noteRouteStatus(fleet,"WARP_COMMAND_FAILED");
    if(typeof probe?.observe==="function")
     probe.observe("living-npc-station-warp-rejected",null,{spaceState:{systemID}},rejection);
    return pause("WARP_COMMAND_FAILED");}
   arrivals.set(id,{fleetID,stationID:destination.stationID,arrivedAt:0});
  }
  if(escortEnabled){
   let committed;try{committed=durableWarpFence.confirm(manifestProof.key)}
   catch{return pause("ESCORT_WARP_ACK_JOURNAL_UNAVAILABLE")}
   if(committed?.status!=="DURABLE_WARP_ACK_CONFIRMED")
    return pause("ESCORT_"+(committed?.status||"WARP_ACK_UNVERIFIED"));
  }
  if(strictMotion()){
   for(const id of ships)activeNativeEscortWarps.set(id,{
    fleet,trip:result,manifestKey:result.manifestID,systemID,fleetID});
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
  if(escortEnabled&&fleet?.coopEscortWarpOutcomeUncertain)
   return pause("ESCORT_WARP_OUTCOME_NEEDS_OPERATOR_REPAIR");
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
  // Trusted native server tick only: observe the physical NPC + both real
  // members at two distinct mid-route checkpoints. Observer cannot grant ISK,
  // create cargo or warp; missing evidence will deny only opt-in payout.
  if(escortEnabled&&trip.manifestID&&
   process.env.EVEJS_COOP_ESCORT_PEACEFUL_PAYOUT==="1"&&
   process.env.EVEJS_COOP_ESCORT_ROUTE_WITNESS==="1"){
   let routeNote;try{routeNote=escortGate?.recordEscortRouteSample?.(
    trip.manifestID,scene,point)}
   catch{routeNote={status:"ROUTE_SAMPLE_UNAVAILABLE"}}
   if(routeNote?.status==="NATIVE_ROUTE_CHECKPOINT_DURABLY_RECORDED")
    probe.observe("living-npc-escort-route-checkpoint",null,
     {spaceState:{systemID:trip.systemID}},
     {fleetID:trip.fleetID,manifestKey:trip.manifestID,
      checkpoint:routeNote.stage});
  }
  let stackCount=0,oreQuantity=0;
  for(const rawID of Object.keys(trip.haulers)){
   const id=Number(rawID),ship=findShip(scene,id,trip.systemID);
   if(!ship){
    // Missing in-scene ship is NOT loss evidence. Only the authoritative
    // native wreck/outcome journal can release existing corporate escrow.
    if(escortEnabled&&trip.manifestID&&
     process.env.EVEJS_COOP_ESCORT_REFUNDS==="1"&&
     typeof escortGate?.refundNativeWreck==="function"){
     let refund;try{refund=escortGate.refundNativeWreck(trip.manifestID)}
     catch{refund={status:"NATIVE_REFUND_OUTCOME_UNCERTAIN_REPAIR_REQUIRED"}}
     if(refund?.status==="REFUNDED"){
      for(const raw of Object.keys(trip.haulers)){
       arrivals.delete(Number(raw));activeNativeEscortWarps.delete(Number(raw));
      }
      delete fleet.coopStationArrival;
      return {status:"ESCORT_NATIVE_HAULER_LOSS_REFUNDED",terminal:true,
       contractID:refund.contractID,
       amountISK:refund.amountISK,earnedPlayerISK:0};
     }
    }
    return pause("HAULER_LOST_OR_NOT_DURABLE");
   }
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
  // With a durable full native manifest, a crash/failed notification may
  // follow the LAST committed warehouse debit but precede this in-memory
  // counter update. The cargo is then correctly empty on the next tick.
  // The *full* manifest proof, NOT an empty hull, must decide completion.
  if(!stackCount&&!trip.completedStackCount&&!manifestDirector)
   return pause("EMPTY_DELIVERY_NOT_PROVEN");
  trip.completedStackCount=(trip.completedStackCount||0)+stackCount;
  let manifestVerified=null,alifeDeliveryWitness=null;
  if(manifestDirector){
   manifestVerified=manifestDirector.verify({key:trip.manifestID,systemID:trip.systemID,
    fleetID:trip.fleetID,stationID:trip.stationID,corporationID:trip.corporationID,
    haulerIDs:Object.keys(trip.haulers).map(Number)});
   if(manifestVerified?.status!=="FULL_NATIVE_CARGO_DELIVERY_VERIFIED")
    return pause(manifestVerified?.status||"MANIFEST_FULL_CARGO_UNVERIFIED");
   alifeDeliveryWitness=require("./coopAlifeNativeDeliveryEvidence")
    .verifyFullNativeDelivery(trip,manifestVerified);
   if(alifeDeliveryWitness?.status!=="NATIVE_FULL_MANIFEST_WITNESSED")
    return pause(alifeDeliveryWitness?.reason||"ALIFE_NATIVE_DELIVERY_PROOF_UNVERIFIED");
   // Reconcile ALL committed cargo stacks rather than just stacks observed
   // on this tick. Never synthesize inventory or a new warehouse receipt.
   stackCount=alifeDeliveryWitness.stacks;
   oreQuantity=alifeDeliveryWitness.quantity;
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
  if(process.env.EVEJS_COOP_OPPORTUNITY_BOARD==="1"){
   try{require("./coopWorldOpportunityBoard").noteNativeConvoyOutcome(
    scene,trip,{status:"DELIVERED",terminal:true})}
   catch(error){console.warn("[CoopOpportunityBoard] arrival",String(error?.message||error).slice(0,120))}
  }
  let escortSettlement=null;
  if(escortEnabled){
   try{escortSettlement=process.env.EVEJS_COOP_ESCORT_PEACEFUL_PAYOUT==="1"?
    (typeof escortGate?.settlePeacefulDelivery==="function"?
     escortGate.settlePeacefulDelivery(trip.manifestID,scene):
     {status:"ESCORT_PEACEFUL_SETTLEMENT_NOT_WIRED"}):
    (typeof escortGate?.settleVerifiedNativeRaid==="function"?
     escortGate.settleVerifiedNativeRaid(trip.manifestID):
     {status:"ESCORT_SETTLEMENT_NOT_WIRED"})}
   catch{escortSettlement={status:"ESCORT_SETTLEMENT_UNCERTAIN_REPAIR_REQUIRED"}}
  }
  // A-Life SETTLE is a read-only observation of the native warehouse's
  // already-COMMITTED manifest. Failure to append telemetry cannot re-debit
  // items, trigger a repeat settlement or block physical cargo ownership.
  if(alifeDeliveryWitness){try{
   probe.observe("alife-native-delivery-settled",null,
    {spaceState:{systemID:trip.systemID}},alifeDeliveryWitness);
  }catch(error){console.warn("[CoopALifeDelivery] telemetry",String(error?.message||error).slice(0,80));}}
  for(const raw of Object.keys(trip.haulers)){
   arrivals.delete(Number(raw));activeNativeEscortWarps.delete(Number(raw));
  }
  delete fleet.coopStationArrival;
  return {status:"DELIVERED",terminal:true,stacks:stackCount,quantity:oreQuantity,
   ...(escortEnabled?{escortSettlementStatus:escortSettlement?.status||"UNAVAILABLE"}:{}),
   ...(manifestVerified?{nativeFullManifestProof:manifestVerified}:{})};
 }
 return {start,tick,noteNativeMotion,verify:stableAt,warehouse:factory,manifest:manifestDirector,
  oracle:destinationOracle};
}
let runtimeDirector;
function getRuntimeDirector(){
 if(runtimeDirector)return runtimeDirector;
 const worldData=require("./worldData"),store=require("./npc/nativeNpcStore");
 const nativeItems=require("../services/inventory/itemStore");
 const repo=require("../gameStore");
 const corporations=require("../services/corporation/corporationState");
 const runtime=require("./runtime");
 if(process.env.EVEJS_COOP_ESCORT_ROUTE_GATE==="1"&&
    process.env.EVEJS_COOP_ESCORT_RUNTIME_MOUNT==="1"){
   const binding=require("./coopEscortNativeBootstrap").installNativeEscorts();
   if(binding?.status!=="ESCORT_NATIVE_RUNTIME_BOUND")
    console.warn("[CoopEscort] native paid runtime not installed:",binding?.status||"UNAVAILABLE");
 }
 runtimeDirector=createStationArrival({
  getStations:worldData.getStationsForSystem,getStation:worldData.getStationByID,
  getCorporation:corporations.getCorporationRecord,isNpcCorporation:corporations.isNpcCorporationID,
  getNativeEntity:store.getNativeEntity,getScene:id=>runtime.getScene?.(id)||runtime.ensureScene(id),
  store,items:nativeItems,flush:table=>repo.flushTableSync(table),
  // A durable native hauler has no session, so the session-bound
  // space/runtime.warpToPoint() silently rejects it. Use the same sessionless
  // NPC warp the stock mining code uses, otherwise every station trip failed
  // with WARP_COMMAND_FAILED and the ore never left the belt.
  warpToPoint:(id,p,opts)=>require("./npc/npcRuntime").warpToPoint(id,p,opts),
  root:process.env.EVEJS_COOP_NPC_WAREHOUSE_DIR||"/var/lib/evejs/coop-native-warehouse",
  probe:require("./coopRuntimeProbe"),
  destinationOracle:process.env.EVEJS_COOP_ECONOMY_DESTINATION==="1"?
   loadEconomyDestination().createDestinationOracle({
    call:(method,params)=>require("../services/market/marketDaemonClient")
     .marketDaemonClient.call(method,params),
    getOreTypes:systemID=>require("../services/mining/miningVisuals")
     .getSolarSystemOreTypeRecords(systemID),
    getSystemRegion:systemID=>worldData.getSolarSystemByID(systemID),
    probe:require("./coopRuntimeProbe")}):null,
  escortGate:process.env.EVEJS_COOP_ESCORT_ROUTE_GATE==="1"?
   require("./coopEscortNativeBinding").routeGate():null});
 return runtimeDirector;
}
// Which ore this system should prefer, from real belt ore crossed with real
// buyers. Read-only: it advises the next haul, it never spawns or moves a ship.
function observePreferredOre({systemID,reason="periodic"}={}){
 if(process.env.EVEJS_COOP_ECONOMY_DESTINATION!=="1")return null;
 const director=getRuntimeDirector();
 return director.oracle?.observePreferredOre?.({systemID,reason})||null;
}
function routeFromHaul(scene,fleet,runtime,now,ingressDurationMs){
 if(process.env.EVEJS_COOP_NPC_STATION_DELIVERY!=="1")return pause("DISABLED");
 const result=getRuntimeDirector().start(scene,fleet,now,{ingressDurationMs});
 if(result.status==="NO_ORE_TO_DELIVER")fleet.coopStationNoCargo=true;
 if(result.status!=="EN_ROUTE"&&result.status!=="NO_ORE_TO_DELIVER")
  noteRouteStatus(fleet,result.status);
 return result;
}
// A stalled haul used to be completely silent. One event per fleet and status
// per two minutes makes the physical blocker visible without log spam.
const routeStatusAt=new Map();
function noteRouteStatus(fleet,status){
 const fleetID=pos(fleet?.fleetID),now=Date.now(),key=fleetID+":"+status;
 if(!fleetID||now-(routeStatusAt.get(key)||0)<120000)return;
 routeStatusAt.set(key,now);
 try{
  require("./coopRuntimeProbe").observe("living-npc-station-route",null,
   {spaceState:{systemID:pos(fleet?.systemID)}},{fleetID,status,
    fleetState:String(fleet?.state||""),haulers:(fleet?.haulerEntityIDs||[]).length});
 }catch(_error){/* diagnostics must never break the native route */}
}
function noteNativeMotion(entity,now){
 if(!runtimeDirector||process.env.EVEJS_COOP_ESCORT_NATIVE_WARP_OBSERVER!=="1")
  return pause("ESCORT_NATIVE_MOTION_NOT_INSTALLED");
 return runtimeDirector.noteNativeMotion(entity,now);
}
function checkReturn(scene,fleet,now,director=null){
 const run=director||getRuntimeDirector();
 if(process.env.EVEJS_COOP_NPC_STATION_DELIVERY!=="1")return pause("DISABLED");
 if(fleet?.coopStationNoCargo){delete fleet.coopStationNoCargo;return {status:"NO_CARGO",terminal:true};}
 if(process.env.EVEJS_COOP_ESCORT_ROUTE_GATE==="1"&&
    fleet?.coopEscortPredepartureEventID&&!fleet?.coopStationArrival){
   return run.start(scene,fleet,now);
 }
 // Nothing is physically in flight, so there is nothing left to wait for. This
 // is also the self-healing exit for a fleet that stalled without any trip.
 if(!fleet?.coopStationArrival){
  noteRouteStatus(fleet,"NO_ACTIVE_TRIP");
  return {status:"NO_ACTIVE_TRIP",terminal:true};
 }
 // Dwell and physical-arrival waits are progress, not blockers.
 const arrival=run.tick(scene,fleet,now);
 if(arrival?.terminal!==true&&arrival?.status!=="AWAITING_PHYSICAL_ARRIVAL"&&
  arrival?.status!=="ARRIVAL_DWELL_PENDING")noteRouteStatus(fleet,arrival?.status||"UNKNOWN");
 return arrival;
}
module.exports={createStationArrival,routeFromHaul,checkReturn,observePreferredOre,noteNativeMotion};