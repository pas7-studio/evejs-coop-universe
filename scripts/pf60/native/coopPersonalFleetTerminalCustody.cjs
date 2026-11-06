'use strict';
/** PF60 original ItemStore terminal custody handshake, INERT until the true
 * native writer, game-store, and independent event witnesses are installed.
 * No ship, cargo, module, wallet, wreck or pilot is created or destroyed here.
 * The executor is single-shot and MUST be a narrowly scoped original native
 * cleanup primitive, NEVER generic PF59-blocked NPC cascade or scene removal.
 */
const crypto=require('node:crypto');
const T='corporationRuntime',ITEMS='items',WRECK='npcWrecks';
const SEP='\u001f',P='coop-personal-fleet'+SEP;
const KEY=P+'terminal-v1:',SHIP=P+'terminal-ship-v1:',DEPLOY=P+'deploy-v1:',
  HANDOFF=P+'handoff-v1:',LOCK=P+'handoff-ship-v1:',RETURN=P+'return-dock-v1:',
  LEDGER=P+'contract-lifecycle-v1',INDEX=P+'index-v1',CLAIMS=P+'actor-claims-v1';
const TOKEN=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;
const PILOT=/^coop-pilot-[0-9]{3,}$/;
const HASH=/^[0-9a-f]{64}$/;
const positive=x=>Number.isSafeInteger(x)&&x>0;
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const clone=x=>structuredClone(x);
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const block=reason=>({status:'BLOCKED',reason});
const terminalKey=assignment=>KEY+assignment;
const terminalShipKey=ship=>SHIP+ship;
function validCommand(c){return obj(c)&&typeof c.operationID==='string'&&
 typeof c.assignmentID==='string'&&typeof c.pilotID==='string'&&
 TOKEN.test(c.operationID)&&TOKEN.test(c.assignmentID)&&PILOT.test(c.pilotID)&&['DOCK','LOSS'].includes(c.mode)&&
 [c.shipItemID,c.ownerCharacterID,c.systemID,c.generation,c.actorGeneration,c.typeID].every(positive)&&
 (c.mode==='DOCK'?positive(c.stationID)&&c.wreckID===undefined:
  positive(c.wreckID)&&c.stationID===undefined);}
function sameIdentity(a,c){return obj(a)&&a.assignmentID===c.assignmentID&&
 a.shipItemID===c.shipItemID&&a.ownerCharacterID===c.ownerCharacterID&&
 a.pilotID===c.pilotID&&a.systemID===c.systemID;}
function nativeSnapshot(raw,c){
 if(!obj(raw)||raw.source!=='ORIGINAL_EVEJS_NATIVE_ENTITY_CONTROLLER_V1'||
  raw.shipItemID!==c.shipItemID||raw.systemID!==c.systemID||
  raw.sceneAbsent!==true||!Array.isArray(raw.modules)||!Array.isArray(raw.cargo)||
  raw.modules.length!==0||raw.cargo.length!==0)return null;
 if(raw.entity!==null&&raw.entity?.ownerID!==c.ownerCharacterID)return null;
 for(const row of [raw.entity,raw.controller]){
  if(row===null)continue;
  if(!obj(row)||row.entityID!==c.shipItemID||row.systemID!==c.systemID||
   row.personalFleetOriginal!==true||row.personalFleetAssignmentID!==c.assignmentID||
   row.personalFleetPilotID!==c.pilotID||row.personalFleetGeneration!==c.generation)
   return null;
 }
 return {cleared:raw.entity===null&&raw.controller===null};
}
function validWitness(p,c){return obj(p)&&p.source===
  (c.mode==='DOCK'?'ORIGINAL_EVEJS_PF60_DOCK_V1':'ORIGINAL_EVEJS_PF60_LOSS_V1')&&
 sameIdentity(p,c)&&p.actorGeneration===c.actorGeneration&&
 p.noLiveSceneActor===true&&p.noCompetingWriter===true&&
 p.originalAssetsAccountedFor===true&&p.noDuplicateOriginalItemIDs===true&&
 HASH.test(p.receiptHash)&&
 (c.mode==='DOCK'?p.stationID===c.stationID&&p.originalShipInHangar===true&&
   p.originalDockReceiptPersisted===true:
   p.wreckID===c.wreckID&&p.originalShipDestroyed===true&&p.originalKillPersisted===true);
}
function createTerminalCustody({gameStore,pf52,claimsPolicy,authenticateCommand,
  verifyExclusiveOwnership,verifyOriginalTerminalWitness,readNativeIdentity,
  executeScopedNativeCleanup,allWritersFenced=()=>false,enabled=()=>false,
  clock=()=>Date.now()}={}) {
 const atomic=gameStore?.coopAtomicNativeRows;
 if(atomic?.mode!=='SERVER_INTERNAL_FLAGGED'||typeof atomic.transact!=='function'||
  typeof atomic.isPoisoned!=='function'||typeof pf52?.validateIndex!=='function'||
  typeof pf52?.validateRoster!=='function'||typeof pf52?.REGISTRY_KEY!=='string'||
  typeof pf52?.ROSTER_PREFIX!=='string'||typeof claimsPolicy?.validate!=='function'||
  [authenticateCommand,verifyExclusiveOwnership,verifyOriginalTerminalWitness,
   readNativeIdentity,executeScopedNativeCleanup,allWritersFenced,enabled,clock]
   .some(x=>typeof x!=='function'))throw Error('PF60_ORIGINAL_NATIVE_AUTHORITIES_REQUIRED');
 const on=()=>enabled()===true&&allWritersFenced()===true&&!atomic.isPoisoned();
 const pre=c=>!validCommand(c)?block('PF60_COMMAND_INVALID'):
  !on()?block('PF60_DISABLED_OR_WRITERS_UNFENCED'):null;
 const sig=c=>hash(['PF60',c.operationID,c.mode,c.assignmentID,c.pilotID,c.shipItemID,
  c.ownerCharacterID,c.systemID,c.generation,c.actorGeneration,c.typeID,
  c.mode==='DOCK'?c.stationID:c.wreckID]);
 function original(tx,c,mode){
  if(!on()||authenticateCommand(c,tx)!==true||verifyExclusiveOwnership(c,tx)!==true)
   return {error:'PF60_ORIGINAL_WRITER_OR_COMMAND_AUTHORITY_UNVERIFIED'};
  const dep=tx.get(T,DEPLOY+c.assignmentID),handoff=tx.get(T,HANDOFF+c.assignmentID),
   shipLock=tx.get(T,LOCK+c.shipItemID),items=tx.get(ITEMS,ITEMS);
  if([dep,handoff,shipLock,items].some(x=>x===undefined))return {error:'PF60_ORIGINAL_READ_UNKNOWN'};
  if(!obj(dep)||!sameIdentity(dep,c)||dep.generation!==c.generation||
   dep.actorGeneration!==c.actorGeneration||dep.typeID!==c.typeID||
   !obj(handoff)||handoff.status!=='CONSUMED'||!sameIdentity(handoff,c)||
   handoff.generation!==c.generation||!obj(shipLock)||
   shipLock.assignmentID!==c.assignmentID||
   shipLock.sourcePF54Hash!==handoff.sourcePF54Hash||
   !obj(items))return {error:'PF60_ORIGINAL_HANDOFF_CUSTODY_CHANGED'};
  const item=items[String(c.shipItemID)];
  if(c.mode==='DOCK'){
   const dock=tx.get(T,RETURN+c.assignmentID);
   if(!obj(dock)||!sameIdentity(dock,c)||
    !['DOCK_ISSUING','DOCKED'].includes(dock.phase)||
    dock.stationID!==c.stationID||dock.actorGeneration!==c.actorGeneration||
    dock.dockDispatchCount!==1||!obj(item)||
    item.itemID!==c.shipItemID||item.ownerID!==c.ownerCharacterID||
    item.categoryID!==6||item.typeID!==c.typeID||item.locationID!==c.stationID||
    item.flagID!==4||item.spaceState!=null)
    return {error:'PF60_ORIGINAL_DOCK_STATE_NOT_PROVEN'};
   if(mode==='PREPARE'&&dep.phase!=='ACTIVE')return {error:'PF60_DOCK_DEPLOY_NOT_ACTIVE'};
  }else{
   const roots=tx.get(WRECK,WRECK),returnRow=tx.get(T,RETURN+c.assignmentID);
   const wrecks=roots?.wrecks;
   if(!obj(wrecks)||Object.prototype.hasOwnProperty.call(items,String(c.shipItemID))||
    Object.values(wrecks).filter(x=>x?.sourceEntityID===c.shipItemID).length!==1||
    wrecks[String(c.wreckID)]?.sourceEntityID!==c.shipItemID||
    wrecks[String(c.wreckID)]?.systemID!==c.systemID||
    (returnRow!==null&&returnRow!==undefined&&
     (!obj(returnRow)||['DOCK_ISSUING','DOCKED'].includes(returnRow.phase))))
    return {error:'PF60_ORIGINAL_LOSS_WRECK_OR_ITEM_UNVERIFIED'};
   if(mode==='PREPARE'&&dep.phase!=='ACTIVE')return {error:'PF60_LOSS_DEPLOY_NOT_ACTIVE'};
  }
  const proof=verifyOriginalTerminalWitness(c,tx);
  if(!validWitness(proof,c))return {error:'PF60_TERMINAL_NATIVE_WITNESS_UNVERIFIED'};
  return {dep,proof};
 }
 function snapshot(c){
  try{return nativeSnapshot(readNativeIdentity(clone(c)),c);}
  catch{return null;}
 }
 function prepare(c){
  const err=pre(c);if(err)return err;
  try{return atomic.transact([T,ITEMS,WRECK],tx=>{
   const row=tx.get(T,terminalKey(c.assignmentID));
   if(row===undefined)return block('PF60_TERMINAL_READ_UNKNOWN');
   if(row!==null)return row.signature===sig(c)?
    {status:'NEEDS_RECONCILIATION',phase:row.phase}:block('PF60_ASSIGNMENT_ALREADY_CLAIMED');
   const prevShip=tx.get(T,terminalShipKey(c.shipItemID));
   if(prevShip===undefined)return block('PF60_SHIP_TERMINAL_READ_UNKNOWN');
   // A previously docked original hull may be assigned again only after a
   // fully finalized older generation. A lost hull or an in-flight terminal
   // record is never reusable. PF52 must have incremented ship generation.
   if(prevShip!==null&&(!obj(prevShip)||prevShip.phase!=='FINALIZED'||
    prevShip.mode!=='DOCK'||!positive(prevShip.generation)||
    prevShip.generation>=c.generation||prevShip.assignmentID===c.assignmentID))
    return block('PF60_SHIP_TERMINAL_ALREADY_RECORDED');
   const state=original(tx,c,'PREPARE');if(state.error)return block(state.error);
   const index=tx.get(T,pf52.REGISTRY_KEY),roster=tx.get(T,pf52.ROSTER_PREFIX+c.ownerCharacterID),
    rawClaims=tx.get(T,CLAIMS);
   let ix,ro,claims;try{ix=pf52.validateIndex(index);ro=pf52.validateRoster(roster,c.ownerCharacterID);
    claims=claimsPolicy.validate(rawClaims);}catch{return block('PF60_RESERVATION_OR_CLAIMS_CORRUPT');}
   const claimed=claims.claims?.[String(c.shipItemID)];
   if(!obj(ix.ships?.[String(c.shipItemID)])||
    ix.ships[String(c.shipItemID)].assignmentID!==c.assignmentID||
    ix.ships[String(c.shipItemID)].generation!==c.generation||
    ro.pilots?.[c.pilotID]?.shipItemID!==c.shipItemID||
    claimed?.assignmentID!==c.assignmentID||claimed.generation!==c.actorGeneration||
    claimed.ownerType!=='PERSONAL_FLEET')return block('PF60_ORIGINAL_ACTOR_CLAIM_NOT_ACTIVE');
   const native=snapshot(c);if(!native)return block('PF60_NATIVE_IDENTITY_UNVERIFIED');
   const at=clock();if(!positive(at))return block('PF60_CLOCK_INVALID');
   const record={version:1,phase:'PREPARED',signature:sig(c),mode:c.mode,
    operationID:c.operationID,assignmentID:c.assignmentID,pilotID:c.pilotID,
    shipItemID:c.shipItemID,ownerCharacterID:c.ownerCharacterID,systemID:c.systemID,
    generation:c.generation,actorGeneration:c.actorGeneration,typeID:c.typeID,
    ...(c.mode==='DOCK'?{stationID:c.stationID}:{wreckID:c.wreckID}),
    witnessHash:hash(state.proof),sourcePF54Hash:state.handoff?.sourcePF54Hash||
     tx.get(T,HANDOFF+c.assignmentID).sourcePF54Hash,
    dispatchCount:0,preparedAtMs:at};
   tx.put(T,terminalKey(c.assignmentID),record);
   tx.put(T,terminalShipKey(c.shipItemID),{assignmentID:c.assignmentID,
    signature:record.signature,phase:'PENDING'});
   return {status:'PREPARED',needsCleanup:!native.cleared};
  });}catch{return block('PF60_PREPARE_COMMIT_UNKNOWN');}
 }
 function issue(c){
  const err=pre(c);if(err)return err;
  let started;
  try{started=atomic.transact([T,ITEMS,WRECK],tx=>{
   const row=tx.get(T,terminalKey(c.assignmentID));
   if(!obj(row)||row.signature!==sig(c)||row.phase!=='PREPARED'||row.dispatchCount!==0)
    return block('PF60_REQUIRES_PREPARED_NO_REDISPATCH');
   const orig=original(tx,c,'ISSUE');if(orig.error)return block(orig.error);
   if(hash(orig.proof)!==row.witnessHash)return block('PF60_TERMINAL_WITNESS_CHANGED');
   const native=snapshot(c);if(!native)return block('PF60_NATIVE_IDENTITY_UNVERIFIED');
   if(native.cleared)return block('PF60_ALREADY_CLEARED_USE_RECONCILE');
   const now=clock();if(!positive(now))return block('PF60_CLOCK_INVALID');
   tx.put(T,terminalKey(c.assignmentID),{...row,phase:'ISSUING',dispatchCount:1,
    dispatchedAtMs:now});
   return {status:'ISSUING'};
  });}catch{return block('PF60_ISSUE_COMMIT_UNKNOWN_NO_RETRY');}
  if(started?.status!=='ISSUING')return started;
  // External native side-effect is NEVER wrapped inside the original GameStore
  // transaction. This call is exactly once and has no retry on unknown result.
  try{
   const out=executeScopedNativeCleanup(clone(c));
   if(out&&typeof out.then==='function')return {status:'OUTCOME_UNKNOWN',reason:'PF60_ASYNC_NATIVE_CLEANUP_FORBIDDEN'};
   return {status:'NEEDS_RECONCILIATION',nativeAck:out?.success===true?'REPORTED':'UNKNOWN'};
  }catch{return {status:'OUTCOME_UNKNOWN',reason:'PF60_NATIVE_CLEANUP_UNKNOWN'};}
 }
 function reconcile(c){
  const err=pre(c);if(err)return err;
  try{return atomic.transact([T,ITEMS,WRECK],tx=>{
   const row=tx.get(T,terminalKey(c.assignmentID));
   if(!obj(row)||row.signature!==sig(c))return block('PF60_UNKNOWN_TERMINAL_INTENT');
   if(row.phase==='NATIVE_CLEARED'||row.phase==='FINALIZED')
    return {status:row.phase};
   if(row.phase!=='PREPARED'&&row.phase!=='ISSUING')return block('PF60_PHASE_INVALID');
   const orig=original(tx,c,'RECONCILE');if(orig.error)return block(orig.error);
   if(hash(orig.proof)!==row.witnessHash)return block('PF60_TERMINAL_WITNESS_CHANGED');
   const native=snapshot(c);if(!native||!native.cleared)
    return block('PF60_NATIVE_ROWS_OR_SCENE_STILL_PRESENT');
   const at=clock();if(!positive(at))return block('PF60_CLOCK_INVALID');
   tx.put(T,terminalKey(c.assignmentID),{...row,phase:'NATIVE_CLEARED',clearedAtMs:at});
   return {status:'NATIVE_CLEARED'};
  });}catch{return block('PF60_RECONCILE_COMMIT_UNKNOWN');}
 }
 function finalize(c){
  const err=pre(c);if(err)return err;
  try{return atomic.transact([T,ITEMS,WRECK],tx=>{
   const row=tx.get(T,terminalKey(c.assignmentID));
   if(!obj(row)||row.signature!==sig(c))return block('PF60_UNKNOWN_TERMINAL_INTENT');
   const lock=tx.get(T,LOCK+c.shipItemID),tomb=tx.get(T,terminalShipKey(c.shipItemID));
   if(row.phase==='FINALIZED'){
    if(lock!==null||tomb?.phase!=='FINALIZED'||tomb.assignmentID!==c.assignmentID||
       tomb.signature!==row.signature)return block('PF60_FINALIZED_RECEIPT_INCONSISTENT');
    return {status:'ALREADY_FINALIZED'};
   }
   if(row.phase!=='NATIVE_CLEARED'||!obj(lock)||
    lock.assignmentID!==c.assignmentID||lock.sourcePF54Hash!==row.sourcePF54Hash||
    !obj(tomb)||tomb.assignmentID!==c.assignmentID||tomb.signature!==row.signature||
    tomb.phase!=='PENDING')return block('PF60_TERMINAL_LOCK_CHANGED');
   const orig=original(tx,c,'FINALIZE');if(orig.error)return block(orig.error);
   if(hash(orig.proof)!==row.witnessHash)return block('PF60_TERMINAL_WITNESS_CHANGED');
   const native=snapshot(c);if(!native||!native.cleared)return block('PF60_NATIVE_ROWS_REAPPEARED');
   const dep=tx.get(T,DEPLOY+c.assignmentID),ret=tx.get(T,RETURN+c.assignmentID),
    led=tx.get(T,LEDGER);
   if(c.mode==='DOCK'){
    if(dep?.phase!=='DOCKED'||ret?.phase!=='DOCKED'||ret.stationID!==c.stationID)
     return block('PF60_PF56_DOCK_RECONCILE_NOT_COMMITTED');
   }else{
    const loss=led?.losses?.[c.assignmentID];
    if(dep?.phase!=='LOST'||dep.lossWreckID!==c.wreckID||
       loss?.shipItemID!==c.shipItemID||loss.wreckID!==c.wreckID||
       loss.ownerCharacterID!==c.ownerCharacterID||loss.pilotID!==c.pilotID)
     return block('PF60_PF57_LOSS_RECONCILE_NOT_COMMITTED');
   }
   const ixRaw=tx.get(T,pf52.REGISTRY_KEY),roRaw=tx.get(T,pf52.ROSTER_PREFIX+c.ownerCharacterID),
    claimsRaw=tx.get(T,CLAIMS);
   let ix,ro,claims;try{ix=pf52.validateIndex(ixRaw);ro=pf52.validateRoster(roRaw,c.ownerCharacterID);
    claims=claimsPolicy.validate(claimsRaw);}catch{return block('PF60_FINAL_ROSTER_OR_CLAIMS_UNVERIFIED');}
   if(ix.ships?.[String(c.shipItemID)]||claims.claims?.[String(c.shipItemID)]||
    ro.pilots?.[c.pilotID]?.shipItemID!==null||
    ro.pilots?.[c.pilotID]?.status!=='CONTRACTED')
    return block('PF60_ORIGINAL_SHIP_OR_PILOT_STILL_RESERVED');
   const at=clock();if(!positive(at))return block('PF60_CLOCK_INVALID');
   // Atomic original GameStore lock release plus durable tombstone. The
   // consumed per-assignment PF58 permit stays immutable to forbid stale
   // restart/redispatch. No ItemStore or wallet writes happen here.
   // The original coopAtomicNativeRows serializer forbids null in tx.put.
   // Deleting this row is the only native-compatible lock release.
   tx.del(T,LOCK+c.shipItemID);
   tx.put(T,terminalShipKey(c.shipItemID),{...tomb,phase:'FINALIZED',mode:c.mode,
    generation:c.generation,actorGeneration:c.actorGeneration,finalizedAtMs:at});
   tx.put(T,terminalKey(c.assignmentID),{...row,phase:'FINALIZED',finalizedAtMs:at});
   return {status:'FINALIZED',shipItemID:c.shipItemID};
  });}catch{return block('PF60_FINALIZE_COMMIT_UNKNOWN');}
 }
 function inspect(c){if(!obj(c)||typeof c.assignmentID!=='string'||!TOKEN.test(c.assignmentID))return block('PF60_INVALID_INSPECT');
  try{return atomic.transact([T],tx=>{
   const x=tx.get(T,terminalKey(c.assignmentID));
   return x===undefined?block('PF60_READ_UNKNOWN'):x===null?{status:'NOT_FOUND'}:
    {status:x.phase,shipItemID:x.shipItemID,dispatchCount:x.dispatchCount};
  });}catch{return block('PF60_INSPECT_UNKNOWN');}
 }
 return Object.freeze({prepare,issue,reconcile,finalize,inspect});
}
module.exports={createTerminalCustody,validCommand,validWitness,nativeSnapshot,
 terminalKey,terminalShipKey,KEY,SHIP,DEPLOY,HANDOFF,LOCK,RETURN,LEDGER,CLAIMS};
