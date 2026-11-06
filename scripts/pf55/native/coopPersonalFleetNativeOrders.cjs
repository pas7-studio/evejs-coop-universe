'use strict';
/**
 * PF-55 candidate: durable single-flight personal NPC orders.
 * NOT gameplay-active. Only the original in-process native command authority
 * may supply the injected executor / reconciliation witness.
 *
 * The original EveJS npcRuntime manual orders are memory-first. A successful
 * return does NOT prove a restart-durable order. We deliberately never claim
 * an ACK without an independent original-native persistent order witness.
 */
const {createHash}=require('node:crypto');
const TABLE='corporationRuntime',ITEMS='items',SEP='\u001f';
const LEDGER_PREFIX='coop-personal-fleet'+SEP+'manual-order-v1:';
const OP_INDEX='coop-personal-fleet'+SEP+'manual-order-operations-v1';
const DEPLOY_PREFIX='coop-personal-fleet'+SEP+'deploy-v1:';
const CLAIMS='coop-personal-fleet'+SEP+'actor-claims-v1';
const RETURN='coop-personal-fleet'+SEP+'return-dock-v1:';
const DOCK_ATTEMPT='coop-personal-fleet'+SEP+'dock-native-attempt-v1:';
const SCENE_ATTEMPT='coop-personal-fleet'+SEP+'dock-scene-attempt-v1:';
const TERMINAL='coop-personal-fleet'+SEP+'terminal-v1:';
const PILOT=/^coop-pilot-[0-9]{3,}$/;
const TOKEN=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const HASH=/^[a-f0-9]{64}$/;
const ID=x=>Number.isSafeInteger(x)&&x>0;
const OBJ=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const copy=x=>structuredClone(x);
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const blocked=reason=>({status:'BLOCKED',reason});
const key=shipItemID=>LEDGER_PREFIX+shipItemID;
const ACTIONS=new Set(['FOLLOW','HOLD','ATTACK','DEFEND','WARP']);
const targetRequired=a=>a!=='HOLD';
function valid(c){
 if(!OBJ(c)||!TOKEN.test(c.operationID)||!TOKEN.test(c.assignmentID)||
  !PILOT.test(c.pilotID)||!ID(c.ownerCharacterID)||!ID(c.shipItemID)||
  !ID(c.systemID)||!ID(c.actorGeneration)||!ACTIONS.has(c.action)||
  !OBJ(c.session)||c.session.characterID!==c.ownerCharacterID||
  !ID(c.session.userid)||c.session.socket?.destroyed===true)return false;
 if(targetRequired(c.action)!==ID(c.targetEntityID))return false;
 if(c.action==='HOLD'&&c.targetEntityID!==null&&c.targetEntityID!==undefined)return false;
 if(c.action!=='FOLLOW'&&c.action!=='DEFEND'&&c.followRangeMeters!==undefined&&
    c.followRangeMeters!==null)return false;
 if(['FOLLOW','DEFEND'].includes(c.action)&&
    (!Number.isSafeInteger(c.followRangeMeters)||c.followRangeMeters<500||
     c.followRangeMeters>100000))return false;
 if(c.targetEntityID===c.shipItemID)return false;
 return true;
}
function signature(c){return sha([c.operationID,c.assignmentID,c.pilotID,c.ownerCharacterID,
 c.shipItemID,c.systemID,c.actorGeneration,c.action,c.targetEntityID??null,
 c.followRangeMeters??null]);}
function validateIndex(row){
 if(!OBJ(row)||row.version!==1||!OBJ(row.operations)||
    Object.keys(row.operations).length>2048)throw Error('PF55_OPERATION_INDEX_CORRUPT');
 for(const [k,v] of Object.entries(row.operations))if(!TOKEN.test(k)||!OBJ(v)||
  !HASH.test(v.signature)||!ID(v.shipItemID)||!['ISSUING','ACKED'].includes(v.phase))
  throw Error('PF55_OPERATION_INDEX_CORRUPT');
 return row;
}
function validateLedger(row){
 if(!OBJ(row)||row.version!==1||!TOKEN.test(row.operationID)||
  !HASH.test(row.signature)||!['ISSUING','ACKED'].includes(row.phase)||
  !ID(row.shipItemID)||!ID(row.actorGeneration)||!TOKEN.test(row.assignmentID)||
  !PILOT.test(row.pilotID)||!ID(row.ownerCharacterID)||!ID(row.systemID)||
  !ACTIONS.has(row.action)||!ID(row.startedAtMs)||
  (row.phase==='ACKED'&&(!ID(row.ackedAtMs)||!HASH.test(row.proofHash))))
  throw Error('PF55_ORDER_LEDGER_CORRUPT');
 return row;
}
function validateSource(c,tx,pf52){
 // PF76: a manual order must not overtake return, original ItemStore docking,
 // native scene-detach, or terminal cleanup. PF56 separately fences pending
 // PF55 ISSUING orders inside this same corporationRuntime SQLite authority.
 // Unknown reads are NOT proof of absence; never clear these durable rows.
 for(const key of [RETURN+c.assignmentID,DOCK_ATTEMPT+c.assignmentID,
                   SCENE_ATTEMPT+c.assignmentID,TERMINAL+c.assignmentID]){
  const value=tx.get(TABLE,key);
  if(value===undefined)return 'PF55_RETURN_DOCK_CUSTODY_READ_UNKNOWN';
  if(value!==null)return 'PF55_RETURN_DOCK_OR_TERMINAL_PENDING';
 }
 const dep=tx.get(TABLE,DEPLOY_PREFIX+c.assignmentID);
 const claims=tx.get(TABLE,CLAIMS);
 const index=tx.get(TABLE,pf52.REGISTRY_KEY);
 const roster=tx.get(TABLE,pf52.ROSTER_PREFIX+c.ownerCharacterID);
 if(dep===undefined||claims===undefined||index===undefined||roster===undefined||
    !OBJ(dep)||dep.phase!=='ACTIVE'||!OBJ(claims)||
    !OBJ(index)||!OBJ(roster))return 'PF55_DEPLOY_OR_CLAIM_UNAVAILABLE';
 try{pf52.validateIndex(index);pf52.validateRoster(roster,c.ownerCharacterID);}catch{
  return 'PF55_ORIGINAL_ROSTER_CORRUPT';}
 if(dep.assignmentID!==c.assignmentID||dep.shipItemID!==c.shipItemID||
    dep.ownerCharacterID!==c.ownerCharacterID||dep.pilotID!==c.pilotID||
    dep.systemID!==c.systemID||dep.actorGeneration!==c.actorGeneration)
  return 'PF55_DEPLOYMENT_NOT_ACTIVE_FOR_SHIP';
 const claim=claims.claims?.[String(c.shipItemID)];
 if(claims.version!==1||!OBJ(claims.claims)||!OBJ(claims.generations)||
    Object.keys(claims.claims).length>128||
    Object.values(claims.claims).some(v=>!OBJ(v)||!ID(v.entityID)||
     !PILOT.test(v.pilotID)||v.ownerType!=='PERSONAL_FLEET'||
     !ID(v.generation)||claims.generations[String(v.entityID)]<v.generation)||
    new Set(Object.values(claims.claims).map(v=>v.pilotID)).size!==Object.keys(claims.claims).length||
    !OBJ(claim)||claim.entityID!==c.shipItemID||
    claim.pilotID!==c.pilotID||claim.ownerCharacterID!==c.ownerCharacterID||
    claim.systemID!==c.systemID||claim.assignmentID!==c.assignmentID||
    claim.generation!==c.actorGeneration||claim.ownerType!=='PERSONAL_FLEET'||
    claims.generations[String(c.shipItemID)]!==c.actorGeneration)
  return 'PF55_ACTOR_CLAIM_NOT_PROVEN';
 const ship=index.ships?.[String(c.shipItemID)],pilot=roster.pilots?.[c.pilotID];
 if(!OBJ(ship)||!OBJ(pilot)||ship.ownerCharacterID!==c.ownerCharacterID||
    ship.pilotID!==c.pilotID||ship.assignmentID!==c.assignmentID||
    pilot.shipItemID!==c.shipItemID||pilot.assignmentID!==c.assignmentID||
    pilot.contractID!==dep.contractID)
  return 'PF55_PF52_RESERVATION_MISSING';
 const root=tx.get(ITEMS,ITEMS);
 const original=root?.[String(c.shipItemID)];
 if(!OBJ(original)||original.itemID!==c.shipItemID||
    original.ownerID!==c.ownerCharacterID||original.categoryID!==6||
    original.singleton!==1||original.flagID!==0||
    original.locationID!==c.systemID||original.spaceState?.systemID!==c.systemID)
  return 'PF55_ORIGINAL_SHIP_NOT_IN_SPACE';
 return null;
}
function validProof(proof,row){
 return OBJ(proof)&&proof.source==='EVEJS_ORIGINAL_PERSISTED_NPC_ORDER_V1'&&
  proof.operationID===row.operationID&&proof.entityID===row.shipItemID&&
  proof.controllerEntityID===row.shipItemID&&proof.shipItemID===row.shipItemID&&
  proof.ownerCharacterID===row.ownerCharacterID&&proof.pilotID===row.pilotID&&
  proof.assignmentID===row.assignmentID&&proof.actorGeneration===row.actorGeneration&&
  proof.systemID===row.systemID&&proof.action===row.action&&
  proof.signature===row.signature&&proof.orderApplied===true&&
  proof.nativeOwner==='PERSONAL_FLEET'&&proof.controllerPersisted===true&&
  proof.noForeignCommand===true;
}
function createPersonalFleetNativeOrders({gameStore,pf52,access,
 verifyExclusiveOwnership,verifyNativeActor,verifyTarget,verifyOriginalControl,
 nativeExecutor,verifyPersistedNativeOrder,
 allWritersFenced=()=>false,enabled=()=>false,clock=()=>Date.now()}={}){
 const atomic=gameStore?.coopAtomicNativeRows;
 if(atomic?.mode!=='SERVER_INTERNAL_FLAGGED'||typeof atomic.transact!=='function'||
  typeof atomic.isPoisoned!=='function'||!pf52||
  typeof pf52.validateIndex!=='function'||typeof pf52.validateRoster!=='function'||
  typeof pf52.REGISTRY_KEY!=='string'||typeof pf52.ROSTER_PREFIX!=='string'||
  typeof access?.isOwner!=='function'||typeof nativeExecutor?.supports!=='function'||
  !(typeof nativeExecutor==='function'||typeof nativeExecutor?.execute==='function')||
  [verifyExclusiveOwnership,verifyNativeActor,verifyTarget,verifyOriginalControl,
   verifyPersistedNativeOrder,allWritersFenced,enabled,clock]
   .some(x=>typeof x!=='function'))throw Error('PF55_AUTHORITIES_REQUIRED');
 function preflight(c){
  if(enabled()!==true)return {status:'DISABLED'};
  if(allWritersFenced()!==true)return blocked('PF55_GLOBAL_WRITERS_NOT_FENCED');
  if(atomic.isPoisoned())return blocked('PF55_GAMESTORE_POISONED');
  if(!valid(c))return blocked('PF55_COMMAND_INVALID');
  if(nativeExecutor.supports(c.action)!==true)
   return blocked('PF55_NATIVE_ACTION_NOT_WIRED');
  if(access.isOwner(c.session,c.ownerCharacterID)!==true)return blocked('PF55_ACCESS_DENIED');
  return null;
 }
 function guard(c,tx){
  if(enabled()!==true||allWritersFenced()!==true||atomic.isPoisoned())
   return 'PF55_AUTHORITIES_REVOKED';
  if(access.isOwner(c.session,c.ownerCharacterID,tx)!==true)
   return 'PF55_ACCESS_REVOKED';
  const source=validateSource(c,tx,pf52);
  if(source)return source;
  if(verifyExclusiveOwnership(c,tx)!==true)return 'PF55_MINING_WAR_EXPLORATION_CONFLICT';
  if(verifyNativeActor(c,tx)!==true)return 'PF55_NATIVE_ACTOR_UNVERIFIED';
  if(verifyOriginalControl(c,tx)!==true)return 'PF55_NATIVE_CONTROL_UNVERIFIED';
  if(targetRequired(c.action)&&verifyTarget(c,tx)!==true)return 'PF55_TARGET_UNVERIFIED';
  return null;
 }
 function issue(c){
  const fail=preflight(c);if(fail)return fail;
  let admission;
  try{admission=atomic.transact([TABLE,ITEMS],tx=>{
   const violation=guard(c,tx);if(violation)return blocked(violation);
   const rawOps=tx.get(TABLE,OP_INDEX),rawLast=tx.get(TABLE,key(c.shipItemID));
   if(rawOps===undefined||rawLast===undefined)return blocked('PF55_DURABLE_ORDER_READ_UNCERTAIN');
   const ix=validateIndex(rawOps===null?{version:1,operations:{}}:rawOps);
   const sig=signature(c),op=ix.operations[c.operationID];
   if(op)return op.signature===sig&&op.shipItemID===c.shipItemID?
    (op.phase==='ACKED'?{status:'DUPLICATE',operationID:c.operationID}:
     blocked('PF55_ISSUING_RECONCILIATION_REQUIRED')):
    blocked('PF55_OPERATION_ID_REUSED');
   if(Object.keys(ix.operations).length>=2048)return blocked('PF55_OPERATION_INDEX_FULL');
   const last=rawLast===null?null:validateLedger(rawLast);
   if(last&&last.phase!=='ACKED')return blocked('PF55_PREVIOUS_ORDER_OUTCOME_UNKNOWN');
   const now=clock();if(!ID(now))return blocked('PF55_CLOCK_INVALID');
   const row={version:1,phase:'ISSUING',operationID:c.operationID,signature:sig,
    assignmentID:c.assignmentID,ownerCharacterID:c.ownerCharacterID,
    pilotID:c.pilotID,shipItemID:c.shipItemID,actorGeneration:c.actorGeneration,
    systemID:c.systemID,action:c.action,targetEntityID:c.targetEntityID??null,
    followRangeMeters:c.followRangeMeters??null,startedAtMs:now};
   ix.operations[c.operationID]={signature:sig,shipItemID:c.shipItemID,phase:'ISSUING'};
   tx.put(TABLE,OP_INDEX,ix);
   tx.put(TABLE,key(c.shipItemID),row);
   return {status:'ISSUING',row:copy(row)};
  });}catch{return blocked('PF55_DURABLE_ISSUE_COMMIT_UNKNOWN');}
  if(admission?.status!=='ISSUING')return admission;
  // Durable ISSUING before the first original native effect. A crash or an
  // unknown native outcome MUST NOT cause redispatch.
  try{
   // Production native PF55 adapter returns { execute, probe, supports }.
   // The legacy callable + supports shape remains accepted for existing
   // on-disk reference fixtures, but is never assumed for the real adapter.
   const frozen=Object.freeze({...admission.row});
   const native=typeof nativeExecutor==='function'
    ? nativeExecutor(frozen) : nativeExecutor.execute(frozen);
   if(native&&typeof native.then==='function')return {status:'NEEDS_RECONCILIATION',
    reason:'PF55_ASYNC_NATIVE_ORDER_FORBIDDEN',operationID:c.operationID};
   return {status:'NEEDS_RECONCILIATION',operationID:c.operationID,
    nativeAck:native?.success===true?'REPORTED_SUCCESS':'NOT_PROVEN'};
  }catch{return {status:'NEEDS_RECONCILIATION',operationID:c.operationID,
   nativeAck:'UNKNOWN'};}
 }
 function reconcile(c){
  const fail=preflight(c);if(fail)return fail;
  try{return atomic.transact([TABLE,ITEMS],tx=>{
   const violation=guard(c,tx);if(violation)return blocked(violation);
   const raw=tx.get(TABLE,key(c.shipItemID));
   const ops=tx.get(TABLE,OP_INDEX);
   if(!raw||!ops)return blocked('PF55_ORDER_RECEIPT_UNAVAILABLE');
   const row=validateLedger(raw),ix=validateIndex(ops);
   if(row.signature!==signature(c)||row.operationID!==c.operationID||
      ix.operations[c.operationID]?.signature!==row.signature||
      ix.operations[c.operationID]?.shipItemID!==c.shipItemID)
    return blocked('PF55_RECONCILE_FOREIGN_OR_STALE');
   if(row.phase==='ACKED')return {status:'ALREADY_ACKED',operationID:c.operationID,
    proofHash:row.proofHash};
   if(row.phase!=='ISSUING'||ix.operations[c.operationID].phase!=='ISSUING')
    return blocked('PF55_RECONCILE_PHASE_MISMATCH');
   const proof=verifyPersistedNativeOrder(copy(row),tx);
   if(!validProof(proof,row))return blocked('PF55_ORIGINAL_NATIVE_ORDER_NOT_PERSISTED');
   const now=clock();if(!ID(now))return blocked('PF55_CLOCK_INVALID');
   const ack={...row,phase:'ACKED',ackedAtMs:now,proofHash:sha(proof)};
   ix.operations[c.operationID]={...ix.operations[c.operationID],phase:'ACKED'};
   tx.put(TABLE,key(c.shipItemID),ack);
   tx.put(TABLE,OP_INDEX,ix);
   return {status:'ACKED',operationID:c.operationID,shipItemID:c.shipItemID,
    proofHash:ack.proofHash};
  });}catch{return blocked('PF55_RECONCILE_COMMIT_UNCERTAIN');}
 }
 function inspect({session,ownerCharacterID,shipItemID}={}){
  if(enabled()!==true)return {status:'DISABLED'};
  if(!ID(ownerCharacterID)||!ID(shipItemID)||
    access.isOwner(session,ownerCharacterID)!==true)return blocked('PF55_ACCESS_DENIED');
  try{return atomic.transact([TABLE],tx=>{
   if(access.isOwner(session,ownerCharacterID,tx)!==true)return blocked('PF55_ACCESS_REVOKED');
   const row=tx.get(TABLE,key(shipItemID));
   if(row===undefined)return blocked('PF55_LEDGER_READ_UNCERTAIN');
   if(row===null)return {status:'NOT_FOUND'};
   const r=validateLedger(row);
   if(r.ownerCharacterID!==ownerCharacterID)return blocked('PF55_FOREIGN_LEDGER');
   return {status:'OK',operationID:r.operationID,phase:r.phase,
    action:r.action,shipItemID:r.shipItemID};
  });}catch{return blocked('PF55_LEDGER_UNAVAILABLE');}
 }
 return Object.freeze({issue,reconcile,inspect});
}
module.exports={TABLE,ITEMS,CLAIMS,OP_INDEX,DEPLOY_PREFIX,key,signature,valid,validProof,
 createPersonalFleetNativeOrders};