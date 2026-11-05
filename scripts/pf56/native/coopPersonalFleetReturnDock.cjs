'use strict';
/** PF56 original-ship return/docking candidate; OFF until stock ItemStore and
 * all NPC/storage writers are transactionally fenced. No session spoofing,
 * synthetic ship, station teleport, cargo overwrite or automatic crash retry.
 * The only side-effects outside original GameStore are trusted injected native
 * return/dock calls, each preceded by a committed one-shot intent.
 */
const crypto=require('node:crypto');
const T='corporationRuntime',ITEMS='items',SEP='\u001f';
const PREFIX='coop-personal-fleet'+SEP+'return-dock-v1:';
const OPS='coop-personal-fleet'+SEP+'return-ops-v1';
const CLAIMS='coop-personal-fleet'+SEP+'actor-claims-v1';
const DEPLOY='coop-personal-fleet'+SEP+'deploy-v1:';
const LAST_ORDER='coop-personal-fleet'+SEP+'manual-order-v1:';
const TOKEN=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const PILOT=/^coop-pilot-[0-9]{3,}$/;
const HEX=/^[0-9a-f]{64}$/;
const id=x=>Number.isSafeInteger(x)&&x>0;
const obj=x=>!!x&&typeof x==='object'&&!Array.isArray(x);
const clone=x=>structuredClone(x);
const sha=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const deny=reason=>({status:'BLOCKED',reason});
const key=x=>PREFIX+x;
const signature=c=>sha(['PF56_RETURN',c.operationID,c.assignmentID,c.ownerCharacterID,
 c.pilotID,c.shipItemID,c.stationID,c.systemID,c.reservationGeneration,c.actorGeneration]);
const valid=c=>obj(c)&&TOKEN.test(c.operationID)&&c.operationID.length<=115&&TOKEN.test(c.assignmentID)&&
 PILOT.test(c.pilotID)&&[c.ownerCharacterID,c.shipItemID,c.stationID,c.systemID,
 c.reservationGeneration,c.actorGeneration].every(id)&&obj(c.session)&&
 c.session.characterID===c.ownerCharacterID&&id(c.session.userid)&&
 c.session.socket?.destroyed!==true;
const vector=v=>obj(v)&&['x','y','z'].every(p=>Number.isFinite(v[p]));
const gap=p=>Math.max(0,Math.hypot(p.shipPosition.x-p.stationPosition.x,
 p.shipPosition.y-p.stationPosition.y,p.shipPosition.z-p.stationPosition.z)-
 p.shipRadius-p.stationRadius);
function arrivalValid(p,r){
 return obj(p)&&p.source==='ORIGINAL_EVEJS_SCENE_STATION_V1'&&
  TOKEN.test(p.sceneEpoch)&&p.systemID===r.systemID&&
  p.stationID===r.stationID&&p.shipItemID===r.shipItemID&&
  p.entityID===r.shipItemID&&p.controllerEntityID===r.shipItemID&&
  p.ownerCharacterID===r.ownerCharacterID&&p.pilotID===r.pilotID&&
  p.actorGeneration===r.actorGeneration&&p.warpInactive===true&&
  p.stationDockAccess===true&&p.noDuplicatePhysicalEntity===true&&
  p.nativeControllerPresent===true&&p.shipStopped===true&&
  vector(p.shipPosition)&&vector(p.stationPosition)&&
  Number.isFinite(p.shipRadius)&&p.shipRadius>=0&&
  Number.isFinite(p.stationRadius)&&p.stationRadius>=0&&gap(p)<=2500;
}
function manifestValid(p,r){
 return obj(p)&&p.source==='ORIGINAL_EVEJS_ITEM_AND_CARGO_MANIFEST_V1'&&
  p.shipItemID===r.shipItemID&&p.ownerCharacterID===r.ownerCharacterID&&
  p.assignmentID===r.assignmentID&&p.actorGeneration===r.actorGeneration&&
  HEX.test(p.fittingHash)&&HEX.test(p.cargoHash)&&Array.isArray(p.cargoItemIDs)&&
  p.cargoItemIDs.length<=4096&&p.cargoItemIDs.every(id)&&
  new Set(p.cargoItemIDs).size===p.cargoItemIDs.length&&
  p.originalItemTitlesVerified===true&&p.noUnrecordedCargo===true;
}
function returnProofValid(p,r){
 return obj(p)&&p.source==='EVEJS_ORIGINAL_PERSISTED_NPC_RETURN_V1'&&
  p.operationID===r.operationID&&p.signature===r.signature&&
  p.assignmentID===r.assignmentID&&p.ownerCharacterID===r.ownerCharacterID&&
  p.pilotID===r.pilotID&&p.shipItemID===r.shipItemID&&
  p.controllerEntityID===r.shipItemID&&p.actorGeneration===r.actorGeneration&&
  p.stationID===r.stationID&&p.systemID===r.systemID&&
  p.nativeOwner==='PERSONAL_FLEET'&&p.returnOrderPersisted===true&&
  p.returnTargetVerified===true&&p.noForeignCommand===true;
}
function dockProofValid(p,r){
 return obj(p)&&p.source==='ORIGINAL_EVEJS_DOCK_COMPLETION_V1'&&
  p.operationID===r.operationID&&p.signature===r.signature&&
  p.assignmentID===r.assignmentID&&p.ownerCharacterID===r.ownerCharacterID&&
  p.pilotID===r.pilotID&&p.shipItemID===r.shipItemID&&
  p.stationID===r.stationID&&p.systemID===r.systemID&&
  p.actorGeneration===r.actorGeneration&&p.originalItemStoreCommitted===true&&
  p.nativeEntityAbsent===true&&p.nativeControllerAbsent===true&&
  p.noOtherLivePhysicalEntity===true&&p.cargoAndFittingTitlesPreserved===true&&
  p.sessionlessNativeDockReceiptPersisted===true;
}
function stockSpace(item,r){
 return obj(item)&&item.itemID===r.shipItemID&&
  item.ownerID===r.ownerCharacterID&&item.typeID===r.typeID&&
  (item.shipID===undefined||item.shipID===r.shipItemID)&&
  (item.shipTypeID===undefined||item.shipTypeID===r.typeID)&&
  item.categoryID===6&&item.singleton===1&&item.stacksize===1&&
  item.quantity===-1&&item.flagID===0&&item.locationID===r.systemID&&
  item.spaceState?.systemID===r.systemID&&vector(item.spaceState.position);
}
function stockHangar(item,r){
 return obj(item)&&item.itemID===r.shipItemID&&
  item.ownerID===r.ownerCharacterID&&item.typeID===r.typeID&&
  (item.shipID===undefined||item.shipID===r.shipItemID)&&
  (item.shipTypeID===undefined||item.shipTypeID===r.typeID)&&
  item.categoryID===6&&item.singleton===1&&item.stacksize===1&&
  item.quantity===-1&&item.flagID===4&&item.locationID===r.stationID&&
  (item.spaceState===null||item.spaceState===undefined);
}
function createPersonalFleetReturnDock({gameStore,pf52,claimsPolicy,access,
 verifyExclusiveOwnership,verifyNativeFlight,verifyOriginalReturnOrder,
 verifyStationArrival,verifyContinuousDwell,verifyOriginalManifest,verifyOriginalDockReceipt,
 verifyFinalOriginalManifest,executeNativeReturn,executeNativeDock,
 allWritersFenced=()=>false,enabled=()=>false,clock=()=>Date.now()}={}){
 const atomic=gameStore?.coopAtomicNativeRows;
 if(atomic?.mode!=='SERVER_INTERNAL_FLAGGED'||typeof atomic.transact!=='function'||
  typeof atomic.isPoisoned!=='function'||typeof access?.isOwner!=='function'||
  !pf52||typeof pf52.validateIndex!=='function'||typeof pf52.validateRoster!=='function'||
  typeof pf52.REGISTRY_KEY!=='string'||typeof pf52.ROSTER_PREFIX!=='string'||
  claimsPolicy?.KEY!==CLAIMS||typeof claimsPolicy.validate!=='function'||
  [verifyExclusiveOwnership,verifyNativeFlight,verifyOriginalReturnOrder,
   verifyStationArrival,verifyContinuousDwell,verifyOriginalManifest,verifyOriginalDockReceipt,
   verifyFinalOriginalManifest,executeNativeReturn,executeNativeDock,
   allWritersFenced,enabled,clock].some(x=>typeof x!=='function'))
  throw Error('PF56_ORIGINAL_AUTHORITIES_REQUIRED');
 function admit(c){
  if(enabled()!==true)return {status:'DISABLED'};
  if(!valid(c))return deny('PF56_INVALID_COMMAND');
  if(allWritersFenced()!==true)return deny('PF56_GLOBAL_WRITERS_NOT_FENCED');
  if(atomic.isPoisoned())return deny('PF56_GAMESTORE_POISONED');
  if(access.isOwner(c.session,c.ownerCharacterID)!==true)return deny('PF56_ACCESS_DENIED');
  return null;
 }
 function guard(c,tx){
  if(enabled()!==true||allWritersFenced()!==true||atomic.isPoisoned())
   return 'PF56_NATIVE_GATE_REVOKED';
  if(access.isOwner(c.session,c.ownerCharacterID,tx)!==true)
   return 'PF56_ACCESS_REVOKED';
  if(verifyExclusiveOwnership(c,tx)!==true)return 'PF56_WAR_MINING_EXPLORATION_NOT_FENCED';
  return null;
 }
 function readState(c,tx,{inSpace=true}={}){
  const d=tx.get(T,DEPLOY+c.assignmentID),cl=tx.get(T,CLAIMS),
   ix=tx.get(T,pf52.REGISTRY_KEY),ro=tx.get(T,pf52.ROSTER_PREFIX+c.ownerCharacterID),
   root=tx.get(ITEMS,'items');
  if([d,cl,ix,ro,root].some(x=>x===undefined||x===null))
   return {error:'PF56_ORIGINAL_AUTHORITIES_UNAVAILABLE'};
  let index,roster,claims;
  try{index=pf52.validateIndex(ix);roster=pf52.validateRoster(ro,c.ownerCharacterID);
   claims=claimsPolicy.validate(cl);}catch{return {error:'PF56_ORIGINAL_REGISTRY_CORRUPT'};}
  if(!obj(d)||d.phase!=='ACTIVE'||d.shipItemID!==c.shipItemID||
   d.ownerCharacterID!==c.ownerCharacterID||d.pilotID!==c.pilotID||
   d.assignmentID!==c.assignmentID||d.stationID!==c.stationID||
   d.systemID!==c.systemID||d.generation!==c.reservationGeneration||
   d.actorGeneration!==c.actorGeneration||!id(d.typeID))
   return {error:'PF56_PF54_ACTIVE_DEPLOYMENT_MISSING'};
  const claim=claims.claims?.[String(c.shipItemID)];
  if(!obj(claim)||claim.entityID!==c.shipItemID||claim.pilotID!==c.pilotID||
   claim.assignmentID!==c.assignmentID||claim.ownerCharacterID!==c.ownerCharacterID||
   claim.generation!==c.actorGeneration||claim.systemID!==c.systemID||
   claim.ownerType!=='PERSONAL_FLEET'||
   claims.generations[String(c.shipItemID)]!==c.actorGeneration)
   return {error:'PF56_ORIGINAL_ACTOR_CLAIM_MISSING'};
  const reserved=index.ships[String(c.shipItemID)],pilot=roster.pilots?.[c.pilotID];
  if(!obj(reserved)||!obj(pilot)||reserved.ownerCharacterID!==c.ownerCharacterID||
   reserved.pilotID!==c.pilotID||reserved.assignmentID!==c.assignmentID||
   reserved.stationID!==c.stationID||reserved.generation!==c.reservationGeneration||
   pilot.shipItemID!==c.shipItemID||pilot.assignmentID!==c.assignmentID||
   pilot.generation!==c.reservationGeneration||pilot.stationID!==c.stationID||
   pilot.status!=='HANGAR_RESERVED'||pilot.contractID!==d.contractID)
   return {error:'PF56_PF52_RESERVATION_MISSING'};
  const item=root[String(c.shipItemID)];
  if(inSpace&&!stockSpace(item,d))return {error:'PF56_ORIGINAL_SHIP_NOT_IN_SPACE'};
  return {index,roster,claims,dep:d,item,root,pilot};
 }
 function withTx(c,fn){
  const fail=admit(c);if(fail)return fail;
  try{return atomic.transact([T,ITEMS],tx=>{
   const blocked=guard(c,tx);return blocked?deny(blocked):fn(tx);
  });}catch{return deny('PF56_ATOMIC_COMMIT_OR_READ_UNCERTAIN');}
 }
 function requestReturn(c){
  const admission=withTx(c,tx=>{
   const k=key(c.assignmentID),existing=tx.get(T,k),ops=tx.get(T,OPS);
   if(existing===undefined||ops===undefined)return deny('PF56_RETURN_READ_UNCERTAIN');
   const sig=signature(c);
   if(existing!==null)return existing.operationID===c.operationID&&
    existing.signature===sig?{status:'NEEDS_RECONCILIATION',phase:existing.phase,
     operationID:c.operationID}:deny('PF56_ASSIGNMENT_RETURN_ALREADY_EXISTS');
   const opIndex=ops===null?{version:1,operations:{}}:ops;
   if(!obj(opIndex)||opIndex.version!==1||!obj(opIndex.operations)||
    Object.keys(opIndex.operations).length>=2048||Object.entries(opIndex.operations).some(([id,v])=>
     !TOKEN.test(id)||!obj(v)||!HEX.test(v.signature)||
     !TOKEN.test(v.assignmentID)||!['RETURN_ISSUING','DOCKED'].includes(v.phase)))
    return deny('PF56_OPERATION_INDEX_CORRUPT_OR_FULL');
   if(opIndex.operations[c.operationID])return deny('PF56_OPERATION_ID_REUSED');
   const state=readState(c,tx);if(state.error)return deny(state.error);
   const pendingOrder=tx.get(T,LAST_ORDER+c.shipItemID);
   if(pendingOrder===undefined)return deny('PF56_PREVIOUS_ORDER_READ_UNCERTAIN');
   if(pendingOrder!==null&&(!obj(pendingOrder)||pendingOrder.phase!=='ACKED'))
    return deny('PF56_PREVIOUS_NATIVE_ORDER_UNRESOLVED');
   if(verifyNativeFlight(c,tx)!==true)return deny('PF56_ORIGINAL_NATIVE_FLIGHT_NOT_VERIFIED');
   const at=clock();if(!id(at))return deny('PF56_INVALID_CLOCK');
   const row={version:1,phase:'RETURN_ISSUING',operationID:c.operationID,signature:sig,
    assignmentID:c.assignmentID,ownerCharacterID:c.ownerCharacterID,
    pilotID:c.pilotID,shipItemID:c.shipItemID,stationID:c.stationID,
    systemID:c.systemID,reservationGeneration:c.reservationGeneration,
    actorGeneration:c.actorGeneration,typeID:state.dep.typeID,
    requestedAtMs:at,returnDispatchCount:1,dockDispatchCount:0};
   opIndex.operations[c.operationID]={signature:sig,assignmentID:c.assignmentID,phase:row.phase};
   tx.put(T,OPS,opIndex);tx.put(T,k,row);
   return {status:'RETURN_ISSUING',row:clone(row)};
  });
  if(admission?.status!=='RETURN_ISSUING')return admission;
  // The native API is strictly after durable intent. Unknown effect never retries.
  try{const out=executeNativeReturn(clone(admission.row));
   if(out&&typeof out.then==='function')return {status:'NEEDS_RECONCILIATION',
    reason:'PF56_ASYNC_NATIVE_RETURN_UNSAFE',operationID:c.operationID};
   return {status:'NEEDS_RECONCILIATION',operationID:c.operationID,
    nativeAck:out?.success===true?'REPORTED_SUCCESS':'UNPROVEN'};
  }catch{return {status:'NEEDS_RECONCILIATION',operationID:c.operationID,
   nativeAck:'UNKNOWN'};}
 }
 function confirmReturn(c){return withTx(c,tx=>{
  const row=tx.get(T,key(c.assignmentID));
  if(!obj(row)||row.signature!==signature(c)||row.operationID!==c.operationID)
   return deny('PF56_FOREIGN_RETURN_INTENT');
  if(row.phase==='RETURNING'||row.phase==='ARRIVAL_OBSERVED'||
   row.phase==='DOCK_ISSUING'||row.phase==='DOCKED')
   return {status:'ALREADY_CONFIRMED',phase:row.phase};
  if(row.phase!=='RETURN_ISSUING')return deny('PF56_RETURN_PHASE_INVALID');
  const state=readState(c,tx);if(state.error)return deny(state.error);
  const proof=verifyOriginalReturnOrder(clone(row),tx);
  if(!returnProofValid(proof,row))return deny('PF56_ORIGINAL_RETURN_ORDER_NOT_PERSISTED');
  const next={...row,phase:'RETURNING',returnProofHash:sha(proof)};
  tx.put(T,key(c.assignmentID),next);
  return {status:'RETURNING',shipItemID:c.shipItemID};
 });}
 function observeArrival(c){return withTx(c,tx=>{
  const row=tx.get(T,key(c.assignmentID));
  if(!obj(row)||row.signature!==signature(c))return deny('PF56_RETURN_NOT_FOUND');
  if(!['RETURNING','ARRIVAL_OBSERVED'].includes(row.phase))
   return deny('PF56_ARRIVAL_PHASE_INVALID');
  const s=readState(c,tx);if(s.error)return deny(s.error);
  const p=verifyStationArrival(clone(row),tx);
  if(!arrivalValid(p,row))return deny('PF56_PHYSICAL_STATION_ARRIVAL_NOT_VERIFIED');
  const at=clock();if(!id(at))return deny('PF56_INVALID_CLOCK');
  const same=row.phase==='ARRIVAL_OBSERVED'&&row.sceneEpoch===p.sceneEpoch&&
   at>=row.arrivedAtMs;
  // If a native process/scene was restarted, dwell must restart as well.
  const next={...row,phase:'ARRIVAL_OBSERVED',arrivedAtMs:same?row.arrivedAtMs:at,
   sceneEpoch:p.sceneEpoch,stationProofHash:sha(p)};
  tx.put(T,key(c.assignmentID),next);
  return {status:'ARRIVAL_OBSERVED',dwellMs:at-next.arrivedAtMs,
   sceneEpoch:next.sceneEpoch};
 });}
 function requestDock(c){
  const admission=withTx(c,tx=>{
   const row=tx.get(T,key(c.assignmentID));
   if(!obj(row)||row.signature!==signature(c))return deny('PF56_RETURN_NOT_FOUND');
   if(row.phase!=='ARRIVAL_OBSERVED')return deny('PF56_DOCK_REQUIRES_ARRIVAL');
   const state=readState(c,tx);if(state.error)return deny(state.error);
   const now=clock();if(!id(now)||!id(row.arrivedAtMs)||now<row.arrivedAtMs||
    now-row.arrivedAtMs<2000)return deny('PF56_STATION_DWELL_NOT_COMPLETE');
   const p=verifyStationArrival(clone(row),tx);
   if(!arrivalValid(p,row)||p.sceneEpoch!==row.sceneEpoch)
    return deny('PF56_ORIGINAL_ARRIVAL_CHANGED');
   // Two point-in-time station samples do NOT prove continuous physical dwell.
   // A trusted native per-tick station monitor must attest uninterrupted dwell
   // from the exact persisted arrival timestamp through this request.
   const dwell=verifyContinuousDwell(clone(row),tx);
   if(!obj(dwell)||dwell.source!=='ORIGINAL_EVEJS_CONTINUOUS_DOCK_DWELL_V1'||
    dwell.shipItemID!==row.shipItemID||dwell.stationID!==row.stationID||
    dwell.systemID!==row.systemID||dwell.sceneEpoch!==row.sceneEpoch||
    dwell.continuousSinceMs>row.arrivedAtMs||
    !id(dwell.continuousSinceMs)||!id(dwell.checkedAtMs)||
    dwell.checkedAtMs<now-100||dwell.checkedAtMs>now+100||
    dwell.checkedAtMs-dwell.continuousSinceMs<2000||
    dwell.noDepartures!==true||dwell.nativeMonitorPersisted!==true)
    return deny('PF56_CONTINUOUS_NATIVE_STATION_DWELL_UNVERIFIED');
   const m=verifyOriginalManifest(clone(row),tx);
   if(!manifestValid(m,row))return deny('PF56_CARGO_AND_FITTING_MANIFEST_UNVERIFIED');
   const next={...row,phase:'DOCK_ISSUING',dockingAtMs:now,
    dockDispatchCount:1,manifest:clone(m),arrivalProofHash:sha(p)};
   tx.put(T,key(c.assignmentID),next);
   return {status:'DOCK_ISSUING',row:clone(next)};
  });
  if(admission?.status!=='DOCK_ISSUING')return admission;
  try{const out=executeNativeDock(clone(admission.row));
   if(out&&typeof out.then==='function')return {status:'NEEDS_RECONCILIATION',
    reason:'PF56_ASYNC_DOCK_UNSAFE',operationID:c.operationID};
   return {status:'NEEDS_RECONCILIATION',operationID:c.operationID,
    nativeAck:out?.success===true?'REPORTED_SUCCESS':'UNPROVEN'};
  }catch{return {status:'NEEDS_RECONCILIATION',operationID:c.operationID,
   nativeAck:'UNKNOWN'};}
 }
 function reconcileDock(c){return withTx(c,tx=>{
  const row=tx.get(T,key(c.assignmentID)),ops=tx.get(T,OPS);
  if(!obj(row)||row.signature!==signature(c)||!obj(ops)||ops.version!==1||
   !obj(ops.operations)||Object.keys(ops.operations).length>2048||
   Object.entries(ops.operations).some(([id,v])=>!TOKEN.test(id)||!obj(v)||
    !HEX.test(v.signature)||!TOKEN.test(v.assignmentID)||
    !['RETURN_ISSUING','DOCKED'].includes(v.phase))||
   ops.operations[c.operationID]?.signature!==row.signature||
   ops.operations[c.operationID]?.assignmentID!==c.assignmentID)
   return deny('PF56_RECONCILE_FOREIGN_OR_UNCERTAIN');
  if(row.phase==='DOCKED')return {status:'ALREADY_DOCKED',shipItemID:c.shipItemID};
  if(row.phase!=='DOCK_ISSUING'||row.dockDispatchCount!==1||
   !manifestValid(row.manifest,row))return deny('PF56_DOCK_INTENT_REQUIRED');
  const s=readState(c,tx,{inSpace:false});if(s.error)return deny(s.error);
  if(!stockHangar(s.item,row))return deny('PF56_ORIGINAL_SHIP_NOT_IN_HANGAR');
  const p=verifyOriginalDockReceipt(clone(row),tx);
  if(!dockProofValid(p,row))return deny('PF56_NATIVE_DOCK_COMPLETION_NOT_PROVEN');
  const m=verifyFinalOriginalManifest(clone(row),tx);
  if(!manifestValid(m,row)||sha(m)!==sha(row.manifest))
   return deny('PF56_CARGO_OR_FITTING_CUSTODY_CHANGED');
  const ix=s.index,roster=s.roster,claims=s.claims;
  if(Object.keys(ix.processed).length>=2048||Object.keys(claims.processed).length>=1024||
   roster.revision>=Number.MAX_SAFE_INTEGER-1||s.pilot.revision>=Number.MAX_SAFE_INTEGER-1)
   return deny('PF56_RECEIPT_OR_REVISION_CAP');
  const releaseKey='pf56:'+c.operationID;
  if(ix.processed[releaseKey]||claims.processed[releaseKey])
   return deny('PF56_RELEASE_OPERATION_COLLISION');
  delete ix.ships[String(c.shipItemID)];
  s.pilot.status='CONTRACTED';s.pilot.shipItemID=null;s.pilot.revision++;
  delete s.pilot.stationID;delete s.pilot.assignmentID;delete s.pilot.generation;
  roster.revision++;
  ix.processed[releaseKey]={signature:row.signature,receipt:{type:'HANGAR_RELEASED',
   pilotID:c.pilotID,shipItemID:c.shipItemID,generation:c.reservationGeneration}};
  delete claims.claims[String(c.shipItemID)];
  claims.processed[releaseKey]={signature:JSON.stringify(['PF56_RELEASE',releaseKey,
   c.shipItemID,c.actorGeneration]),receipt:{type:'RELEASE',entityID:c.shipItemID,
   pilotID:c.pilotID,generation:c.actorGeneration}};
  try{pf52.validateIndex(ix);pf52.validateRoster(roster,c.ownerCharacterID);
   claimsPolicy.validate(claims);}catch{return deny('PF56_RELEASE_STATE_INVALID');}
  const now=clock();if(!id(now))return deny('PF56_INVALID_CLOCK');
  tx.put(T,pf52.REGISTRY_KEY,ix);
  tx.put(T,pf52.ROSTER_PREFIX+c.ownerCharacterID,roster);
  tx.put(T,CLAIMS,claims);
  tx.put(T,DEPLOY+c.assignmentID,{...s.dep,phase:'DOCKED',dockedAtMs:now,
   originalDockProofHash:sha(p)});
  tx.put(T,key(c.assignmentID),{...row,phase:'DOCKED',dockedAtMs:now,
   originalDockProofHash:sha(p)});
  ops.operations[c.operationID]={...ops.operations[c.operationID],phase:'DOCKED'};
  tx.put(T,OPS,ops);
  return {status:'DOCKED',shipItemID:c.shipItemID,stationID:c.stationID,
   originalItemPreserved:true,hangarReservationReleased:true};
 });}
 function inspect(c){return withTx(c,tx=>{
  const row=tx.get(T,key(c.assignmentID));
  if(row===undefined)return deny('PF56_READ_UNCERTAIN');
  if(row===null)return {status:'NOT_FOUND'};
  if(row.signature!==signature(c))return deny('PF56_FOREIGN_OPERATION');
  return {status:'OK',phase:row.phase,shipItemID:row.shipItemID,
   returnDispatchCount:row.returnDispatchCount,dockDispatchCount:row.dockDispatchCount};
 });}
 return Object.freeze({requestReturn,confirmReturn,observeArrival,requestDock,
  reconcileDock,inspect});
}
module.exports={T,ITEMS,PREFIX,OPS,CLAIMS,DEPLOY,LAST_ORDER,key,signature,
 valid,arrivalValid,manifestValid,stockSpace,stockHangar,returnProofValid,dockProofValid,
 createPersonalFleetReturnDock};