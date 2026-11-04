'use strict';
// PF-07 reference, NEVER a ship spawner. The fork's original ItemStore,
// native wreck and SQLite transaction are the only durable authorities.
const PILOT=/^coop-pilot-[0-9]{3,}$/;
const KEY=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const HASH=/^[a-f0-9]{64}$/;
const POS=x=>Number.isSafeInteger(x)&&x>0;
const str=x=>typeof x==='string'&&KEY.test(x);
const obj=x=>!!x&&typeof x==='object'&&!Array.isArray(x);
const denied=reason=>({status:'BLOCKED',reason});
const PHASES=new Set(['ACTIVE','LOSS_PENDING','LOSS_CONFIRMED','CLONE_RECOVERING','PILOT_AVAILABLE','OUTCOME_UNKNOWN']);
const TRANSITIONS={
 ACTIVE:{LOSS_PENDING:'ORIGINAL_NATIVE_WRECK_INTENT'},
 LOSS_PENDING:{LOSS_CONFIRMED:'ORIGINAL_NATIVE_WRECK_CONFIRMED',OUTCOME_UNKNOWN:'ORIGINAL_NATIVE_LOSS_OUTCOME_UNCERTAIN'},
 LOSS_CONFIRMED:{CLONE_RECOVERING:'DURABLE_CLONE_RECOVERY_STARTED'},
 CLONE_RECOVERING:{PILOT_AVAILABLE:'ORIGINAL_CLONE_RECOVERY_CONFIRMED'},
 PILOT_AVAILABLE:{},OUTCOME_UNKNOWN:{}
};
function valid(s){
 return obj(s)&&s.version===1&&str(s.operationID)&&PILOT.test(s.pilotID)&&
 str(s.assignmentID)&&POS(s.ownerCharacterID)&&POS(s.originalShipItemID)&&
 POS(s.nativeEntityID)&&POS(s.systemID)&&POS(s.generation)&&HASH.test(s.fittingHash)&&
 HASH.test(s.cargoHash)&&PHASES.has(s.phase)&&
 Number.isSafeInteger(s.revision)&&s.revision>=0&&
 (s.wreckID===null||POS(s.wreckID))&&
 (s.recoveryReadyAt===null||POS(s.recoveryReadyAt))&&
 Array.isArray(s.proofs)&&s.proofs.length<=12&&
 s.proofs.every(p=>obj(p)&&str(p.id)&&str(p.type))&&
 new Set(s.proofs.map(p=>p.id)).size===s.proofs.length;
}
function begin({operationID,pilotID,assignmentID,ownerCharacterID,
 originalShipItemID,nativeEntityID,systemID,generation,fittingHash,cargoHash,
 trustedActor}={}){
 const source={operationID,pilotID,assignmentID,ownerCharacterID,
  originalShipItemID,nativeEntityID,systemID,generation,fittingHash,cargoHash};
 if(!str(operationID)||!PILOT.test(pilotID)||!str(assignmentID)||
  !POS(ownerCharacterID)||!POS(originalShipItemID)||!POS(nativeEntityID)||
  !POS(systemID)||!POS(generation)||!HASH.test(fittingHash)||!HASH.test(cargoHash)||
  trustedActor?.type!=='ORIGINAL_NATIVE_SHIP_AND_CONTROLLER'||
  trustedActor.actorID!==nativeEntityID||
  trustedActor.shipItemID!==originalShipItemID||
  trustedActor.pilotID!==pilotID||trustedActor.systemID!==systemID||
  trustedActor.generation!==generation||trustedActor.nativeExists!==true)
  return denied('PF_LOSS_ACTOR_UNVERIFIED');
 return {status:'ACTIVE',record:{version:1,...source,phase:'ACTIVE',revision:0,
  wreckID:null,recoveryReadyAt:null,proofs:[]}};
}
function advance(s,{to,expectedRevision,proof,now}={}){
 if(!valid(s))return denied('PF_LOSS_RECORD_CORRUPT');
 if(s.revision!==expectedRevision)return denied('PF_LOSS_REVISION_STALE');
 if(!Number.isSafeInteger(now)||now<0)return denied('PF_LOSS_CLOCK_INVALID');
 const required=TRANSITIONS[s.phase]?.[to];
 if(!required)return denied('PF_LOSS_ILLEGAL_TRANSITION');
 if(s.proofs.length>=12)return denied('PF_LOSS_PROOF_CAP_REACHED');
 if(proof?.type!==required||!str(proof.id)||proof.operationID!==s.operationID||
  proof.shipItemID!==s.originalShipItemID||proof.pilotID!==s.pilotID||
  proof.generation!==s.generation||s.proofs.some(x=>x.id===proof.id))
  return denied('PF_LOSS_NATIVE_EVIDENCE_REQUIRED');
 const next=structuredClone(s);
 if(to==='LOSS_PENDING'){
  if(!POS(proof.wreckID)||proof.systemID!==s.systemID||
   proof.originalNativeWreckObserved!==true)
   return denied('PF_LOSS_WRECK_UNVERIFIED');
  next.wreckID=proof.wreckID;
 }
 if(to==='LOSS_CONFIRMED'){
  if(proof.wreckID!==s.wreckID||proof.systemID!==s.systemID||
   proof.originalNativeShipAbsent!==true||
   proof.originalHangarShipAbsent!==true||
   proof.wreckItemIdentityVerified!==true||
   proof.nativeLossLedgerCommitted!==true)
   return denied('PF_LOSS_PHYSICAL_CONSERVATION_UNVERIFIED');
 }
 if(to==='CLONE_RECOVERING'){
  if(!POS(proof.readyAt)||proof.durablePilotStatus!=='RECOVERING'||
   proof.originalShipNotRestored!==true)
   return denied('PF_CLONE_RECOVERY_UNVERIFIED');
  next.recoveryReadyAt=proof.readyAt;
 }
 if(to==='PILOT_AVAILABLE'){
  if(now<s.recoveryReadyAt||proof.originalCloneReady!==true||
   proof.originalShipNotRestored!==true||
   proof.pilotStillUnassigned!==true||
   proof.wreckID!==s.wreckID)
   return denied('PF_CLONE_RECOVERY_UNVERIFIED');
 }
 next.phase=to;next.revision++;
 next.proofs.push({id:proof.id,type:required});
 return {status:'APPLIED',record:next};
}
// Pure snapshot analysis after restart. Never creates controller/ship or clears
// quarantine simply because the physical entity is missing from the scene.
function assessRestart(s,{nativeShip,hangarItem,wreck,lossLedger,pilotLife}={}){
 if(!valid(s))return denied('PF_LOSS_RECORD_CORRUPT');
 if([nativeShip,hangarItem,wreck,lossLedger,pilotLife].some(x=>x===undefined))
  return {status:'NEEDS_RECONCILIATION',reason:'PF_NATIVE_OBSERVATION_INCOMPLETE'};
 if(nativeShip!==null&&hangarItem!==null)
  return {status:'NEEDS_OPERATOR_REPAIR',reason:'PF_DUPLICATED_ORIGINAL_SHIP'};
 if(nativeShip!==null&&wreck!==null)
  return {status:'NEEDS_OPERATOR_REPAIR',reason:'PF_SHIP_AND_WRECK_BOTH_PRESENT'};
 if(hangarItem!==null&&wreck!==null)
  return {status:'NEEDS_OPERATOR_REPAIR',reason:'PF_HANGAR_AND_WRECK_BOTH_PRESENT'};
 if(nativeShip!==null){
  if(nativeShip.entityID!==s.nativeEntityID||
   nativeShip.originalShipItemID!==s.originalShipItemID||
   nativeShip.systemID!==s.systemID||
   nativeShip.pilotID!==s.pilotID||
   nativeShip.controllerVerified!==true)
   return {status:'NEEDS_OPERATOR_REPAIR',reason:'PF_NATIVE_ACTOR_IDENTITY_CHANGED'};
  if(s.phase!=='ACTIVE')
   return {status:'NEEDS_OPERATOR_REPAIR',reason:'PF_LOST_SHIP_REAPPEARED'};
  return {status:'ORIGINAL_NATIVE_ACTIVE',spawnAllowed:false};
 }
 if(wreck!==null){
  if(!POS(wreck.wreckID)||wreck.originalShipItemID!==s.originalShipItemID||
   wreck.systemID!==s.systemID||lossLedger?.wreckID!==wreck.wreckID||
   lossLedger?.shipItemID!==s.originalShipItemID||
   lossLedger?.status!=='COMMITTED')
   return {status:'NEEDS_OPERATOR_REPAIR',reason:'PF_WRECK_LEDGER_DISAGREES'};
  if(!['LOSS_CONFIRMED','CLONE_RECOVERING','PILOT_AVAILABLE'].includes(s.phase)||
   s.wreckID!==wreck.wreckID)
   return {status:'NEEDS_RECONCILIATION',reason:'PF_WRECK_NOT_YET_COMMITTED'};
  if(pilotLife?.pilotID!==s.pilotID||
   !['RECOVERING','AVAILABLE'].includes(pilotLife.status)||
   (s.phase==='PILOT_AVAILABLE'&&pilotLife.status!=='AVAILABLE'))
   return {status:'NEEDS_RECONCILIATION',reason:'PF_PILOT_LIFE_UNVERIFIED'};
  return {status:'ORIGINAL_SHIP_CONFIRMED_LOST',
   pilotStatus:pilotLife.status,originalShipRestored:false,spawnAllowed:false};
 }
 if(hangarItem!==null){
  if(hangarItem.itemID!==s.originalShipItemID||
   hangarItem.ownerCharacterID!==s.ownerCharacterID)
   return {status:'NEEDS_OPERATOR_REPAIR',reason:'PF_ORIGINAL_HANGAR_IDENTITY_CHANGED'};
  return {status:'NEEDS_RECONCILIATION',reason:'PF_UNEXPECTED_HANGAR_CUSTODY'};
 }
 return {status:'NEEDS_RECONCILIATION',reason:'PF_ORIGINAL_SHIP_UNLOCATED'};
}
function replay(s,{operationID,generation}={}){
 if(!valid(s))return denied('PF_LOSS_RECORD_CORRUPT');
 if(s.operationID!==operationID||s.generation!==generation)
  return denied('PF_LOSS_REPLAY_CONFLICT');
 return {status:'DUPLICATE',phase:s.phase,spawnAllowed:false,
  ledgerMutationAllowed:false};
}
module.exports={PHASES,valid,begin,advance,assessRestart,replay};
