'use strict';
/** PF56 source-bound return movement and station arrival reader. These are
 * NOT a docking authority: EveJS stock docking is session-based. A separate
 * verified ORIGINAL sessionless dock function must be implemented in the fork.
 */
const {matchesOriginalPersonalFleetActor}=require('./coopPersonalFleetNativeActorProof.cjs');
const pos=x=>Number.isSafeInteger(x)&&x>0;
const vec=v=>!!v&&['x','y','z'].every(k=>typeof v[k]==='number'&&Number.isFinite(v[k]));
function createOriginalReturnExecutor({npcRuntime,orderBridge,sceneForSystem,
 getController,getCanonicalStation,verifyPersonalClaim,enabled=()=>false}={}){
 if(typeof npcRuntime?.warpToPoint!=='function'||typeof orderBridge?.issue!=='function'||
  [sceneForSystem,getController,getCanonicalStation,verifyPersonalClaim,enabled]
  .some(x=>typeof x!=='function'))throw Error('PF56_NATIVE_RETURN_RUNTIME_REQUIRED');
 function context(row){
  if(enabled()!==true||verifyPersonalClaim(row)!==true)return null;
  const scene=sceneForSystem(row.systemID),entity=scene?.getEntityByID?.(row.shipItemID),
   controller=getController(row.shipItemID),station=getCanonicalStation(row.stationID);
  if(scene?.systemID!==row.systemID||
   !matchesOriginalPersonalFleetActor(row,entity,controller)||
   station?.stationID!==row.stationID||
   station.systemID!==row.systemID||!vec(station.position)||
   !Number.isFinite(station.radius)||station.radius<0)return null;
  return {scene,entity,controller,station};
 }
 function execute(row){
  const ctx=context(row);
  if(!ctx)return {success:false,errorMsg:'PF56_ORIGINAL_NATIVE_RETURN_SOURCE_MISSING'};
  const range=ctx.station.radius+750;
  const destination={...ctx.station.position,x:ctx.station.position.x+range};
  return orderBridge.issue({entityID:row.shipItemID,systemID:row.systemID,
   owner:'PERSONAL_FLEET',action:'pf-return-base',holdMs:120000,
   execute(){
    const again=context(row);
    if(!again)return {success:false,errorMsg:'PF56_NATIVE_SOURCE_CHANGED'};
    return npcRuntime.warpToPoint(row.shipItemID,destination,
     {forceImmediateStart:true,broadcastWarpStartToVisibleSessions:true});
   }});
 }
 return Object.freeze({execute,context});
}
function createNativeStationArrivalReader({sceneForSystem,getController,
 getCanonicalStation,getSceneEpoch,verifyPersonalClaim,enabled=()=>false}={}){
 if([sceneForSystem,getController,getCanonicalStation,getSceneEpoch,
  verifyPersonalClaim,enabled].some(f=>typeof f!=='function'))
  throw Error('PF56_STATION_READER_AUTHORITIES_REQUIRED');
 return function read(row){
  if(enabled()!==true||verifyPersonalClaim(row)!==true)return null;
  const scene=sceneForSystem(row.systemID),entity=scene?.getEntityByID?.(row.shipItemID),
   controller=getController(row.shipItemID),station=getCanonicalStation(row.stationID),
   sceneEpoch=getSceneEpoch(scene);
  // A false positive arrival proof could permit destruction of an original
  // ship title. Require the exact same native PF actor as the return writer.
  if(scene?.systemID!==row.systemID||
   !matchesOriginalPersonalFleetActor(row,entity,controller)||
   station?.stationID!==row.stationID||
   station?.systemID!==row.systemID||typeof sceneEpoch!=='string'||
   !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(sceneEpoch)||
   !vec(entity.position)||!vec(station.position)||!vec(entity.velocity)||
   !Number.isFinite(entity.radius)||entity.radius<0||
   !Number.isFinite(station.radius)||station.radius<0)return null;
  const mode=String(entity.mode||'STOP').toUpperCase();
  const speed=Math.hypot(entity.velocity.x,entity.velocity.y,entity.velocity.z);
  return {source:'ORIGINAL_EVEJS_SCENE_STATION_V1',sceneEpoch,
   systemID:row.systemID,stationID:row.stationID,shipItemID:row.shipItemID,
   entityID:row.shipItemID,controllerEntityID:row.shipItemID,
   ownerCharacterID:row.ownerCharacterID,pilotID:row.pilotID,
   actorGeneration:row.actorGeneration,shipPosition:{...entity.position},
   stationPosition:{...station.position},shipRadius:entity.radius,
   stationRadius:station.radius,warpInactive:mode!=='WARP'&&
    !entity.warpState&&!entity.pendingWarp&&entity.isWarping!==true,
   shipStopped:mode==='STOP'&&speed<=0.25,
   stationDockAccess:station.canDockPersonalNpc===true,
   noDuplicatePhysicalEntity:scene.getEntityByID(row.shipItemID)===entity,
   nativeControllerPresent:true};
 };
}
module.exports={createOriginalReturnExecutor,createNativeStationArrivalReader};
