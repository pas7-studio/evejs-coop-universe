"use strict";
// EX-03B2: opt-in source-native NPC scanner charge -> physical probe custody.
// One ORIGINAL non-singleton native cargo unit (quantity=1, cargoID) becomes
// ONE durable in-flight probe with that SAME cargoID as its physical itemID.
// Flush the single source cargo row BEFORE spawning; never mint replacement.
// Crash recovery reprojects that exact cargoID. No player-character probe API.
const positive=n=>Number.isSafeInteger(n)&&n>0;
const vec=p=>p&&["x","y","z"].every(k=>typeof p[k]==="number"&&Number.isFinite(p[k]));
const named=s=>typeof s==="string"&&/^coop-pilot-[0-9]{3,}$/.test(s);
const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
function createNativeNpcProbeFlight({getNativeEntity,getController,
 listNativeModulesForEntity,listNativeCargoForEntity,upsertNativeCargo,
 flushNpcCargo,refreshNativeCargoProjection,compatibleCharges,resolveProbeRange,buildProbeSceneEntity,
 clock=()=>Date.now(),flightTtlMs=3600000,maxProbes=8}={}){
 const funcs=[getNativeEntity,getController,listNativeModulesForEntity,
  listNativeCargoForEntity,upsertNativeCargo,flushNpcCargo,refreshNativeCargoProjection,compatibleCharges,
  resolveProbeRange,buildProbeSceneEntity,clock];
 if(funcs.some(f=>typeof f!=="function")||
    !Number.isSafeInteger(flightTtlMs)||flightTtlMs<60000||flightTtlMs>3600000||
    !Number.isSafeInteger(maxProbes)||maxProbes<4||maxProbes>8)
  throw Error("NPC_NATIVE_PROBE_FLIGHT_AUTHORITIES_REQUIRED");
 const blocked=new Set(); // flush failure: quarantine locally until operator repair
 const deny=reason=>({status:"BLOCKED",reason,nativeCargoDebited:false});
 function context({scene,entityID,assignments}){
  if(!positive(entityID)||!positive(scene?.systemID)||!vec(scene.getEntityByID?.(entityID)?.position)||
   typeof scene.spawnDynamicEntity!=="function"||
   !Array.isArray(assignments)||assignments.length>2048)return null;
  const links=assignments.filter(a=>a?.entityID===entityID&&
   a.systemID===scene.systemID&&named(a.pilotID));
  if(links.length!==1||assignments.some(a=>a.pilotID===links[0].pilotID&&
   (a.entityID!==entityID||a.systemID!==scene.systemID)))return null;
  let native,controller,modules,cargo;
  try{
   native=getNativeEntity(entityID);controller=getController(entityID);
   modules=listNativeModulesForEntity(entityID);
   cargo=listNativeCargoForEntity(entityID);
  }catch{return null}
  const ship=scene.getEntityByID(entityID);
  if(!ship||ship.itemID!==entityID||ship.kind!=="ship"||ship.nativeNpc!==true||
   ship.transient===true||ship.session?.characterID||
   ship.pendingWarp||ship.warpState||ship.isWarping||
   String(ship.mode||"").toUpperCase().includes("WARP")||
   !native||native.entityID!==entityID||native.systemID!==scene.systemID||
   !positive(native.ownerID)||!positive(native.corporationID)||
   native.transient===true||ship.ownerID!==native.ownerID||
   ship.corporationID!==native.corporationID||
   !controller||controller.entityID!==entityID||controller.systemID!==scene.systemID||
   !Array.isArray(modules)||modules.length>256||
   !Array.isArray(cargo)||cargo.length>512||
   new Set(cargo.map(row=>row?.cargoID)).size!==cargo.length||
   new Set(modules.map(row=>row?.moduleID)).size!==modules.length)return null;
  return {native,ship,scene,controller,modules,cargo,pilotID:links[0].pilotID};
 }
 function launcherFor(ctx,row){
  const compatible=ctx.modules.filter(m=>m?.moduleID===row.moduleID&&
   m.entityID===ctx.native.entityID&&m.ownerID===ctx.native.ownerID&&
   m.groupID===481&&m.categoryID===7&&m.moduleState?.online===true&&
   m.moduleState?.incapacitated!==true&&m.transient!==true);
  if(compatible.length!==1)return null;
  let types;
  try{types=compatibleCharges(compatible[0].typeID)}catch{return null}
  return Array.isArray(types)&&types.includes(row.typeID)?compatible[0]:null;
 }
 function validFlight(ctx,row,now){
  if(row.entityID!==ctx.native.entityID||row.ownerID!==ctx.native.ownerID||
   !positive(row.cargoID)||row.groupID!==479||row.categoryID!==8||
   row.singleton===true||row.transient===true||row.quantity!==0||
   !launcherFor(ctx,row))return false;
  const p=row.deployedProbe;
  if(!p||p.status!=="IN_SPACE"||p.probeID!==row.cargoID||
   p.entityID!==row.entityID||p.ownerID!==row.ownerID||
   p.systemID!==ctx.scene.systemID||p.typeID!==row.typeID||
   !Number.isSafeInteger(p.launchedAtMs)||p.launchedAtMs>now||
   now-p.launchedAtMs>flightTtlMs||
   !vec(p.position)||!positive(p.rangeStep)||p.rangeStep>8||
   !(typeof p.scanRange==="number"&&Number.isFinite(p.scanRange)&&p.scanRange>0))
   return false;
  try{
   const range=resolveProbeRange(row.typeID,p.rangeStep,p.scanRange);
   return range?.rangeStep===p.rangeStep&&
    Math.abs(range?.scanRange-p.scanRange)<0.001;
  }catch{return false}
 }
 function materialize(ctx,row,now){
  if(!validFlight(ctx,row,now))return deny("NPC_PROBE_FLIGHT_INVALID_OR_EXPIRED");
  // Once cargo is durably IN_SPACE it must disappear from the live
  // NPC ship's cargo projection before any native scan or probe spawn.
  let projected=false;
  try{projected=refreshNativeCargoProjection(ctx.ship,ctx.native.entityID)===true}
  catch{projected=false}
  if(!projected)return deny("NPC_PROBE_CARGO_PROJECTION_NOT_REFRESHED");
  if(blocked.has(row.cargoID))return deny("NPC_PROBE_CARGO_NEEDS_OPERATOR_REPAIR");
  const p=row.deployedProbe,existing=ctx.scene.getEntityByID(p.probeID);
  if(existing){
   const same=existing.itemID===p.probeID&&existing.kind==="probe"&&
    existing.typeID===row.typeID&&existing.ownerID===ctx.native.ownerID&&
    (!positive(existing.systemID)||existing.systemID===ctx.scene.systemID)&&
    vec(existing.position)&&dist(existing.position,p.position)<=1;
   return same?{status:"NATIVE_PROBE_ALREADY_PRESENT",cargoID:row.cargoID}:
    deny("NPC_PROBE_NATIVE_SCENE_ID_COLLISION");
  }
  let physical;
  try{
   physical=buildProbeSceneEntity({
    probeID:p.probeID,typeID:row.typeID,
    pos:[p.position.x,p.position.y,p.position.z],
    destination:[p.position.x,p.position.y,p.position.z],
    rangeStep:p.rangeStep,scanRange:p.scanRange,state:1
   },{ownerID:ctx.native.ownerID,systemID:ctx.scene.systemID});
  }catch{return deny("NPC_PROBE_NATIVE_ENTITY_BUILD_FAILED")}
  if(!physical||physical.itemID!==p.probeID||physical.kind!=="probe"||
    physical.ownerID!==ctx.native.ownerID||physical.typeID!==row.typeID||
    !vec(physical.position)||dist(physical.position,p.position)>1)
   return deny("NPC_PROBE_NATIVE_ENTITY_MISMATCH");
  let spawn;
  try{spawn=ctx.scene.spawnDynamicEntity(physical,{broadcast:true})}
  catch{return deny("NPC_PROBE_NATIVE_SPAWN_FAILED")}
  if(spawn?.success!==true)return deny("NPC_PROBE_NATIVE_SPAWN_FAILED");
  const landed=ctx.scene.getEntityByID(p.probeID);
  if(!landed||landed.itemID!==p.probeID||landed.kind!=="probe"||
   landed.typeID!==row.typeID||landed.ownerID!==ctx.native.ownerID||
   !vec(landed.position)||dist(landed.position,p.position)>1)
   return deny("NPC_PROBE_NATIVE_SPAWN_UNCONFIRMED");
  return {status:"NATIVE_PROBE_MATERIALIZED",cargoID:row.cargoID};
 }
 function tick({scene,entityID,assignments=[]}={}){
  const now=clock(),ctx=context({scene,entityID,assignments});
  if(!ctx||!Number.isSafeInteger(now)||now<=0)
   return deny("NPC_PROBE_NATIVE_AUTHORITY_MISSING");
  const flights=ctx.cargo.filter(row=>row?.deployedProbe?.status==="IN_SPACE");
  if(flights.length>maxProbes)return deny("NPC_PROBE_ACTIVE_LIMIT");
  for(const row of flights){
   const result=materialize(ctx,row,now);
   if(result.status==="BLOCKED")return result;
  }
  if(flights.length>=maxProbes)return {status:"NATIVE_PROBE_CAPACITY_REACHED",active:flights.length};
  // Only original distinct singleton *units* of non-singleton scanner charges
  // can be deployed. Stacked cargo needs separate authoritative split support.
  const candidates=ctx.cargo.filter(row=>row?.entityID===entityID&&
   row.ownerID===ctx.native.ownerID&&positive(row.cargoID)&&
   row.groupID===479&&row.categoryID===8&&row.quantity===1&&
   row.singleton!==true&&row.transient!==true&&!row.deployedProbe&&
   !blocked.has(row.cargoID)&&launcherFor(ctx,row));
  if(!candidates.length)return {status:"NO_NATIVE_PROBE_CHARGE",active:flights.length};
  const row=candidates.sort((a,b)=>a.cargoID-b.cargoID)[0];
  // The probe is launched close to the REAL ship, not a secret site position.
  const angle=(row.cargoID%8)*Math.PI/4;
  const position={x:ctx.ship.position.x+10000*Math.cos(angle),
   y:ctx.ship.position.y,z:ctx.ship.position.z+10000*Math.sin(angle)};
  if(!vec(position))return deny("NPC_PROBE_POSITION_INVALID");
  let range;
  try{range=resolveProbeRange(row.typeID,4,0)}catch{
   return deny("NPC_PROBE_NATIVE_RANGE_UNAVAILABLE")}
  if(!range||!positive(range.rangeStep)||range.rangeStep>8||
   !(typeof range.scanRange==="number"&&Number.isFinite(range.scanRange)&&range.scanRange>0))
   return deny("NPC_PROBE_NATIVE_RANGE_UNAVAILABLE");
  const changed={...row,quantity:0,deployedProbe:{
   status:"IN_SPACE",probeID:row.cargoID,entityID,
   ownerID:ctx.native.ownerID,systemID:ctx.scene.systemID,
   typeID:row.typeID,launchedAtMs:now,position,
   rangeStep:range.rangeStep,scanRange:range.scanRange
  }};
  let persisted;
  try{persisted=upsertNativeCargo(changed)}catch{
   blocked.add(row.cargoID);return deny("NPC_PROBE_CARGO_DEBIT_FAILED")}
  if(persisted?.success!==true){blocked.add(row.cargoID);
   return deny("NPC_PROBE_CARGO_DEBIT_FAILED")}
  // Atomicity barrier: cargo row is durable before any native scene spawn.
  // A crash here leaves a resumable in-flight receipt, never a free probe.
  let flushed;
  try{flushed=flushNpcCargo()}catch{
   blocked.add(row.cargoID);return deny("NPC_PROBE_CARGO_DURABILITY_UNCONFIRMED")}
  if(flushed?.success!==true){blocked.add(row.cargoID);
   return deny("NPC_PROBE_CARGO_DURABILITY_UNCONFIRMED")}
  const physical=materialize(ctx,changed,now);
  return physical.status==="NATIVE_PROBE_MATERIALIZED"?
   {status:"NATIVE_PROBE_LAUNCHED",cargoID:row.cargoID,nativeCargoDebited:true,
    physicalProbeID:row.cargoID}:
   {status:"NATIVE_PROBE_PENDING_RECONCILIATION",reason:physical.reason||null,
    cargoID:row.cargoID,nativeCargoDebited:true};
 }
 return Object.freeze({tick});
}
module.exports={createNativeNpcProbeFlight};
