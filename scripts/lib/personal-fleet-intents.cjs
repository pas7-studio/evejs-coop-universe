'use strict';
// PF-04 NON-DEPLOYED pure durable intent policy. No native dispatch, no
// GameStore writes, and no default enablement. The engine fork must persist
// every returned transition before invoking its existing coopNpcOrderBridge.
// All authority arguments (authenticatedIssuer, actorProof, targetPermitted,
// leaseAvailable, and native evidence) MUST be constructed by trusted server
// adapters, never forwarded directly from client payloads.
const TYPES=new Set(['FOLLOW','ATTACK','DEFEND','WARP','RETREAT','RETURN_TO_BASE']);
const PHASES=new Set(['QUEUED','ISSUING','NATIVE_REQUESTED','COMPLETED',
  'NATIVE_REJECTED','OUTCOME_UNKNOWN']);
const PILOT=/^coop-pilot-[0-9]{3,}$/;
const TOKEN=/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/;
const HASH=/^[a-f0-9]{64}$/;
const pos=x=>Number.isSafeInteger(x)&&x>0;
const token=x=>typeof x==='string'&&TOKEN.test(x);
const object=x=>!!x&&typeof x==='object'&&!Array.isArray(x);
const deny=reason=>({status:'BLOCKED',reason});
const actor=(a,r)=>a?.pilotID===r.pilotID&&a?.nativeEntityID===r.nativeEntityID&&
 a?.systemID===r.systemID&&a?.assignmentGeneration===r.assignmentGeneration&&
 a?.ownerCharacterID===r.issuerCharacterID&&
 a?.fleetRevision===r.fleetRevision&&a?.custodyActive===true;
function valid(row){
 return object(row)&&row.version===1&&token(row.operationID)&&
 token(row.fleetID)&&PILOT.test(row.pilotID)&&pos(row.nativeEntityID)&&
 pos(row.systemID)&&pos(row.issuerCharacterID)&&pos(row.assignmentGeneration)&&
 Number.isSafeInteger(row.fleetRevision)&&row.fleetRevision>=0&&TYPES.has(row.type)&&PHASES.has(row.phase)&&
 HASH.test(row.payloadHash)&&pos(row.createdAt)&&pos(row.expiresAt)&&
 row.expiresAt>row.createdAt&&Number.isSafeInteger(row.revision)&&row.revision>=0&&
 (row.targetID===null||pos(row.targetID))&&
 (['FOLLOW','ATTACK','DEFEND','WARP'].includes(row.type)?pos(row.targetID):row.targetID===null)&&
 Array.isArray(row.receipts)&&row.receipts.length<=12&&
 row.receipts.every(x=>object(x)&&token(x.id)&&token(x.type));
}
function issue(command,{now,authenticatedIssuer,actorProof,targetPermitted}={}){
 if(!object(command)||!token(command.operationID)||!token(command.fleetID)||
  !PILOT.test(command.pilotID)||!pos(command.nativeEntityID)||
  !pos(command.systemID)||!pos(command.issuerCharacterID)||
  !pos(command.assignmentGeneration)||!Number.isSafeInteger(command.fleetRevision)||
  command.fleetRevision<0||
  !TYPES.has(command.type)||!HASH.test(command.payloadHash)||
  !pos(command.createdAt)||!pos(command.expiresAt)||command.expiresAt<=command.createdAt||
  command.expiresAt-command.createdAt>300000||
  !Number.isSafeInteger(now)||now<command.createdAt||now>=command.expiresAt||
  (['FOLLOW','ATTACK','DEFEND','WARP'].includes(command.type)?!pos(command.targetID):
   command.targetID!==null))
  return deny('PF_INTENT_INVALID_OR_EXPIRED');
 if(authenticatedIssuer!==command.issuerCharacterID)return deny('PF_ISSUER_UNAUTHORIZED');
 if(!actor(actorProof,command))return deny('PF_ACTOR_CUSTODY_UNVERIFIED');
 if(targetPermitted!==true)return deny('PF_TARGET_LEGALITY_UNVERIFIED');
 return {status:'QUEUED',intent:Object.freeze({
  version:1,operationID:command.operationID,fleetID:command.fleetID,
  pilotID:command.pilotID,nativeEntityID:command.nativeEntityID,
  systemID:command.systemID,issuerCharacterID:command.issuerCharacterID,
  assignmentGeneration:command.assignmentGeneration,fleetRevision:command.fleetRevision,
  type:command.type,targetID:command.targetID,payloadHash:command.payloadHash,
  createdAt:command.createdAt,expiresAt:command.expiresAt,
  phase:'QUEUED',revision:0,receipts:[]})};
}
function step(row,{to,expectedRevision,now,proof}={}){
 if(!valid(row))return deny('PF_INTENT_RECORD_CORRUPT');
 if(row.revision!==expectedRevision)return deny('PF_INTENT_STALE_REVISION');
 if(!Number.isSafeInteger(now)||now<row.createdAt)return deny('PF_INTENT_CLOCK_INVALID');
 const allowed={
  QUEUED:['ISSUING','NATIVE_REJECTED'],
  ISSUING:['NATIVE_REQUESTED','NATIVE_REJECTED','OUTCOME_UNKNOWN'],
  NATIVE_REQUESTED:['COMPLETED','OUTCOME_UNKNOWN'],
  COMPLETED:[],NATIVE_REJECTED:[],OUTCOME_UNKNOWN:[]
 };
 if(!allowed[row.phase].includes(to))return deny('PF_INTENT_ILLEGAL_TRANSITION');
 if(row.phase==='QUEUED'&&now>=row.expiresAt)return deny('PF_INTENT_EXPIRED');
 const evidence={
  ISSUING:'DURABLE_DISPATCH_FENCE',NATIVE_REQUESTED:'NATIVE_ORDER_ACK',
  NATIVE_REJECTED:row.phase==='QUEUED'?'PRE_DISPATCH_REJECTION':'NATIVE_DEFINITE_NO_EFFECT',
  COMPLETED:'ORIGINAL_NATIVE_EFFECT_VERIFIED',
  OUTCOME_UNKNOWN:'NATIVE_OUTCOME_UNCERTAIN'
 }[to];
 if(proof?.type!==evidence||!token(proof.id)||
  proof.operationID!==row.operationID||
  proof.nativeEntityID!==row.nativeEntityID||
  proof.assignmentGeneration!==row.assignmentGeneration)
  return deny('PF_INTENT_EVIDENCE_REQUIRED');
 if(to==='COMPLETED'&&(proof.effectType!==row.type||
  proof.systemID!==row.systemID||proof.physicalComplete!==true))
  return deny('PF_INTENT_NATIVE_COMPLETION_UNVERIFIED');
 if(row.receipts.some(x=>x.id===proof.id))return deny('PF_INTENT_PROOF_REPLAY');
 return {status:'APPLIED',intent:Object.freeze({...row,phase:to,revision:row.revision+1,
  receipts:[...row.receipts,{id:proof.id,type:evidence}]})};
}
function replay(row,{operationID,payloadHash}={}){
 if(!valid(row))return deny('PF_INTENT_RECORD_CORRUPT');
 if(row.operationID!==operationID||row.payloadHash!==payloadHash)
  return deny('PF_INTENT_REPLAY_CONFLICT');
 // A retried request NEVER issues native work. Reconcile ISSUING/UNKNOWN
 // from original receipts; even a completed request is only a receipt.
 return {status:'DUPLICATE',phase:row.phase,revision:row.revision,
  dispatchAllowed:false};
}
function dispatchPreflight(row,{now,authenticatedIssuer,actorProof,
 targetPermitted,leaseAvailable}={}){
 if(!valid(row))return deny('PF_INTENT_RECORD_CORRUPT');
 if(row.phase!=='QUEUED')return deny('PF_INTENT_ALREADY_DISPATCHED');
 if(!Number.isSafeInteger(now)||now<row.createdAt||now>=row.expiresAt)
  return deny('PF_INTENT_EXPIRED');
 if(authenticatedIssuer!==row.issuerCharacterID)return deny('PF_ISSUER_UNAUTHORIZED');
 if(!actor(actorProof,row))return deny('PF_ACTOR_CUSTODY_UNVERIFIED');
 if(targetPermitted!==true)return deny('PF_TARGET_LEGALITY_UNVERIFIED');
 if(leaseAvailable!==true)return deny('PF_NATIVE_ARBITER_BLOCKED');
 return {status:'READY_TO_FENCE',nativeAction:row.type.toLowerCase().replaceAll('_','-')};
}

// A crash after a native call cannot be resolved by reissuing that call.
// Only a trusted independent original-native witness can resolve uncertainty.
function reconcile(row,{to,expectedRevision,proof}={}){
 if(!valid(row))return deny('PF_INTENT_RECORD_CORRUPT');
 if(row.phase!=='OUTCOME_UNKNOWN')return deny('PF_INTENT_NOT_UNKNOWN');
 if(row.revision!==expectedRevision)return deny('PF_INTENT_STALE_REVISION');
 if(!['NATIVE_REQUESTED','COMPLETED','NATIVE_REJECTED'].includes(to))
  return deny('PF_INTENT_RECONCILIATION_TARGET_INVALID');
 if(proof?.type!=='INDEPENDENT_NATIVE_RECONCILIATION'||
  !token(proof.id)||proof.operationID!==row.operationID||
  proof.nativeEntityID!==row.nativeEntityID||
  proof.assignmentGeneration!==row.assignmentGeneration||
  proof.payloadHash!==row.payloadHash||proof.resolvedPhase!==to||
  row.receipts.some(x=>x.id===proof.id))
  return deny('PF_INTENT_RECONCILIATION_PROOF_REQUIRED');
 if(to==='NATIVE_REQUESTED'&&proof.originalNativeInFlight!==true)
  return deny('PF_INTENT_NATIVE_RECONCILIATION_INCOMPLETE');
 if(to==='COMPLETED'&&(proof.originalEffectComplete!==true||
  proof.effectType!==row.type||proof.systemID!==row.systemID))
  return deny('PF_INTENT_NATIVE_RECONCILIATION_INCOMPLETE');
 if(to==='NATIVE_REJECTED'&&proof.provenNeverIssued!==true)
  return deny('PF_INTENT_NATIVE_RECONCILIATION_INCOMPLETE');
 if(row.receipts.length>=12)return deny('PF_INTENT_RECEIPT_CAP_REACHED');
 return {status:'RECONCILED',intent:Object.freeze({...row,phase:to,
  revision:row.revision+1,receipts:[...row.receipts,{
   id:proof.id,type:'INDEPENDENT_NATIVE_RECONCILIATION'}]})};
}
module.exports={TYPES,PHASES,valid,issue,step,replay,dispatchPreflight,reconcile};
