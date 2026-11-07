'use strict';
/**
 * Source-bound original PF56 arrival and tick-bounded dwell witness.
 * Does NOT dock, warp, bypass player-session authorization, or invent a ship.
 * Only the trusted EveJS server tick may call sample(); no public chat API.
 */
const {randomUUID}=require('node:crypto');
const gameStore=require('../gameStore');
const worldData=require('./worldData');
const runtime=require('./runtime');
const registry=require('./npc/npcRegistry');
const pf56=require('./coopPersonalFleetReturnDock');
const SEP='\u001f',TABLE='corporationRuntime',ITEMS='items';
const KEY='coop-personal-fleet'+SEP+'station-dwell-v1:';
const MIN_INTERVAL_MS=25,MAX_GAP_MS=350,MAX_AGE_MS=100,MIN_DWELL_MS=2000;
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const positive=x=>Number.isSafeInteger(x)&&x>0;
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const vector=x=>object(x)&&['x','y','z'].every(k=>finite(x[k]));
const srcNonce=randomUUID(); // always changes after a real Node process restart
const sceneIds=new WeakMap();let nextScene=1;
function sceneEpoch(scene){
 if(!object(scene))return null;
 if(!sceneIds.has(scene))sceneIds.set(scene,`${srcNonce}.${nextScene++}`);
 return sceneIds.get(scene);
}
const validRow=r=>object(r)&&positive(r.shipItemID)&&positive(r.ownerCharacterID)&&
 positive(r.systemID)&&positive(r.stationID)&&positive(r.actorGeneration)&&
 typeof r.assignmentID==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(r.assignmentID)&&
 typeof r.pilotID==='string'&&/^coop-pilot-\d{3,}$/.test(r.pilotID)&&
 typeof r.operationID==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(r.operationID)&&
 typeof r.signature==='string'&&/^[0-9a-f]{64}$/.test(r.signature);
const blocked=reason=>Object.freeze({status:'BLOCKED',reason});
function createOriginalStationDwell({orderWitness,enabled=()=>false,
 allWritersFenced=()=>false,clock=()=>Date.now()}={}){
 const atomic=gameStore?.coopAtomicNativeRows;
 if(atomic?.mode!=='SERVER_INTERNAL_FLAGGED'||typeof atomic.transact!=='function'||
    typeof atomic.isPoisoned!=='function'||
    typeof worldData.getStationByID!=='function'||
    typeof runtime.scenes?.get!=='function'||
    typeof registry.getControllerByEntityID!=='function'||
    typeof pf56.arrivalValid!=='function'||typeof pf56.signature!=='function'||
    typeof pf56.key!=='function'||typeof orderWitness?.verifyNativeActor!=='function'||
    [enabled,allWritersFenced,clock].some(x=>typeof x!=='function'))
   throw Error('PF56_ORIGINAL_TICK_DWELL_SOURCE_REQUIRED');
 const on=()=>enabled()===true&&allWritersFenced()===true&&atomic.isPoisoned()===false;
 const key=assignmentID=>KEY+assignmentID;
 function canonical(row,tx,{allowDocking=false}={}){
  if(!on()||!validRow(row)||!object(tx)||
     orderWitness.verifyNativeActor(row,tx)!==true)return null;
  const saved=tx.get(TABLE,pf56.key(row.assignmentID));
  if(!object(saved)||saved.signature!==row.signature||
     saved.signature!==pf56.signature(row)||
     saved.operationID!==row.operationID||saved.shipItemID!==row.shipItemID||
     saved.ownerCharacterID!==row.ownerCharacterID||saved.actorGeneration!==row.actorGeneration||
     !(allowDocking?['RETURNING','ARRIVAL_OBSERVED','DOCK_ISSUING']:['RETURNING','ARRIVAL_OBSERVED']).includes(saved.phase)||
     saved.returnDispatchCount!==1)return null;
  const originalItems=tx.get(ITEMS,'items'),item=originalItems?.[String(row.shipItemID)];
  if(item?.itemID!==row.shipItemID||item.ownerID!==row.ownerCharacterID||
     item.categoryID!==6||item.flagID!==0||item.locationID!==row.systemID||
     item.spaceState?.systemID!==row.systemID)return null;
  const scene=runtime.scenes.get(row.systemID),actor=scene?.getEntityByID?.(row.shipItemID),
    controller=registry.getControllerByEntityID(row.shipItemID),
    station=worldData.getStationByID(row.stationID),
    staticBall=scene?.getEntityByID?.(row.stationID);
  // Only physical original NPC stations whose geometry exists in BOTH
  // original SDE and the same loaded original scene. Unknown -> no docking.
  if(scene?.systemID!==row.systemID||!object(actor)||
     actor.itemID!==row.shipItemID||
     (actor.entityID!==undefined&&actor.entityID!==row.shipItemID)||
     actor.ownerID!==row.ownerCharacterID||actor.nativeNpc!==true||
     !object(controller)||controller.entityID!==row.shipItemID||
     controller.systemID!==row.systemID||
     station?.stationID!==row.stationID||station.solarSystemID!==row.systemID||
     !object(staticBall)||!vector(station.position)||!vector(staticBall.position)||
     staticBall.itemID!==row.stationID||
     (staticBall.entityID!==undefined&&staticBall.entityID!==row.stationID)||
     !finite(staticBall.radius)||staticBall.radius<1||
     Math.hypot(station.position.x-staticBall.position.x,
       station.position.y-staticBall.position.y,
       station.position.z-staticBall.position.z)>100||
     !vector(actor.position)||!vector(actor.velocity)||
     !finite(actor.radius)||actor.radius<0||!object(actor))return null;
  const epoch=sceneEpoch(scene);
  const speed=Math.hypot(actor.velocity.x,actor.velocity.y,actor.velocity.z);
  const proof={source:'ORIGINAL_EVEJS_SCENE_STATION_V1',sceneEpoch:epoch,
    systemID:row.systemID,stationID:row.stationID,shipItemID:row.shipItemID,
    entityID:row.shipItemID,controllerEntityID:row.shipItemID,
    ownerCharacterID:row.ownerCharacterID,pilotID:row.pilotID,
    actorGeneration:row.actorGeneration,
    shipPosition:{...actor.position},stationPosition:{...staticBall.position},
    shipRadius:actor.radius,stationRadius:staticBall.radius,
    warpInactive:String(actor.mode||'').toUpperCase()!=='WARP'&&
      !actor.warpState&&!actor.pendingWarp&&actor.isWarping!==true,
    shipStopped:String(actor.mode||'').toUpperCase()==='STOP'&&speed<=0.25,
    stationDockAccess:true,
    noDuplicatePhysicalEntity:scene.getEntityByID(row.shipItemID)===actor,
    nativeControllerPresent:true};
  if(!pf56.arrivalValid(proof,row))return null;
  // A second matching item in another loaded scene is an ownership ambiguity.
  for(const [system,other] of runtime.scenes){
   if(system!==row.systemID&&other?.getEntityByID?.(row.shipItemID))return null;
  }
  return proof;
 }
 function verifyStationArrival(row,tx){try{return canonical(row,tx);}catch{return null;}}
 function sample(row){
  if(!on()||!validRow(row))return blocked('PF56_DWELL_DISABLED_OR_ROW_INVALID');
  try{return atomic.transact([TABLE,ITEMS],tx=>{
    const prior=tx.get(TABLE,key(row.assignmentID)),p=canonical(row,tx);
    if(prior===undefined)return blocked('PF56_DWELL_SOURCE_UNREADABLE');
    if(!p){if(prior!==null)tx.del(TABLE,key(row.assignmentID));
      return blocked('PF56_DWELL_ACTOR_OUTSIDE_STATION_OR_UNVERIFIED');}
    const now=clock();if(!positive(now))return blocked('PF56_DWELL_CLOCK_INVALID');
    if(prior!==null&&(!object(prior)||prior.version!==1||
      prior.assignmentID!==row.assignmentID||
      !positive(prior.lastSeenMs)||now<=prior.lastSeenMs))
      return blocked('PF56_DWELL_CLOCK_OR_RECORD_CORRUPT');
    if(prior!==null&&now-prior.lastSeenMs<MIN_INTERVAL_MS)
      return {status:'UNCHANGED',sinceMs:prior.continuousSinceMs};
    const same=prior!==null&&prior.signature===row.signature&&
      prior.sceneEpoch===p.sceneEpoch&&prior.shipItemID===row.shipItemID&&
      prior.stationID===row.stationID&&prior.actorGeneration===row.actorGeneration&&
      now-prior.lastSeenMs<=MAX_GAP_MS&&positive(prior.continuousSinceMs)&&
      Number.isSafeInteger(prior.samples)&&prior.samples>=1;
    const next={version:1,source:'ORIGINAL_EVEJS_TICK_STATION_DWELL_V1',
      signature:row.signature,assignmentID:row.assignmentID,
      shipItemID:row.shipItemID,stationID:row.stationID,systemID:row.systemID,
      ownerCharacterID:row.ownerCharacterID,pilotID:row.pilotID,
      actorGeneration:row.actorGeneration,sceneEpoch:p.sceneEpoch,
      continuousSinceMs:same?prior.continuousSinceMs:now,
      lastSeenMs:now,samples:same?Math.min(prior.samples+1,1000000):1};
    tx.put(TABLE,key(row.assignmentID),next);
    return {status:'OBSERVED',sinceMs:next.continuousSinceMs,
      dwellMs:now-next.continuousSinceMs,samples:next.samples};
  });}catch{return blocked('PF56_DWELL_ATOMIC_READ_OR_COMMIT_UNCERTAIN');}
 }
 function verifyContinuousDwell(row,tx){
  try{
   if(!on()||!validRow(row)||!object(tx)||!positive(row.arrivedAtMs))return null;
   const p=canonical(row,tx),last=tx.get(TABLE,key(row.assignmentID)),now=clock();
   if(!p||!object(last)||last.version!==1||
      last.source!=='ORIGINAL_EVEJS_TICK_STATION_DWELL_V1'||
      last.signature!==row.signature||last.assignmentID!==row.assignmentID||
      last.shipItemID!==row.shipItemID||last.stationID!==row.stationID||
      last.systemID!==row.systemID||last.actorGeneration!==row.actorGeneration||
      last.sceneEpoch!==p.sceneEpoch||row.sceneEpoch!==p.sceneEpoch||
      !positive(last.continuousSinceMs)||last.continuousSinceMs>row.arrivedAtMs||
      !positive(last.lastSeenMs)||last.lastSeenMs>now||
      now-last.lastSeenMs>MAX_AGE_MS||!positive(last.samples)||last.samples<8||
      now-last.continuousSinceMs<MIN_DWELL_MS)return null;
   return {source:'ORIGINAL_EVEJS_CONTINUOUS_DOCK_DWELL_V1',
     shipItemID:row.shipItemID,stationID:row.stationID,systemID:row.systemID,
     sceneEpoch:p.sceneEpoch,continuousSinceMs:last.continuousSinceMs,
     checkedAtMs:now,noDepartures:true,nativeMonitorPersisted:true};
  }catch{return null;}
 }
 function verifyOriginalDockReady(row,tx){
  // This check runs AGAIN in the native PF66 transaction, after PF56 has
  // committed DOCK_ISSUING but before the original ItemStore is touched.
  try{
   if(!on()||!validRow(row)||!object(tx))return false;
   const stored=tx.get(TABLE,pf56.key(row.assignmentID));
   if(!object(stored)||stored.phase!=='DOCK_ISSUING'||
      stored.dockDispatchCount!==1||stored.signature!==row.signature||
      stored.operationID!==row.operationID||
      typeof stored.arrivalProofHash!=='string'||
      !/^[0-9a-f]{64}$/.test(stored.arrivalProofHash)||
      !positive(stored.arrivedAtMs)||!object(stored.manifest)||
      pf56.manifestValid(stored.manifest,stored)!==true)return false;
   const proof=canonical(row,tx,{allowDocking:true});
   const receipt=tx.get(TABLE,key(row.assignmentID)),now=clock();
   if(!proof||!object(receipt)||receipt.version!==1||
      receipt.source!=='ORIGINAL_EVEJS_TICK_STATION_DWELL_V1'||
      receipt.signature!==row.signature||receipt.stationID!==row.stationID||
      receipt.shipItemID!==row.shipItemID||receipt.actorGeneration!==row.actorGeneration||
      receipt.sceneEpoch!==proof.sceneEpoch||receipt.sceneEpoch!==stored.sceneEpoch||
      !positive(receipt.continuousSinceMs)||
      receipt.continuousSinceMs>stored.arrivedAtMs||
      !positive(receipt.lastSeenMs)||receipt.lastSeenMs>now||
      now-receipt.lastSeenMs>MAX_AGE_MS||receipt.samples<8||
      now-receipt.continuousSinceMs<MIN_DWELL_MS)return false;
   return true;
  }catch{return false;}
 }
 return Object.freeze({sample,verifyStationArrival,verifyContinuousDwell,
   verifyOriginalDockReady,
   inspect(row){if(!validRow(row))return blocked('PF56_DWELL_INVALID_INSPECT');
    try{return atomic.transact([TABLE],tx=>tx.get(TABLE,key(row.assignmentID)));}
    catch{return blocked('PF56_DWELL_READ_UNCERTAIN');}}
 });
}
module.exports=Object.freeze({createOriginalStationDwell,KEY,MIN_INTERVAL_MS,MAX_GAP_MS,MAX_AGE_MS});
