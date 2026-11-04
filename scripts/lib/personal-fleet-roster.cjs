'use strict';
// PF-02 pure reference roster state machine. NOT deployed. No native authority,
// wallet or custody mutation: authoritative adapters must verify receipts and
// call this ONLY inside their durable serializable transaction.
const PILOT=/^coop-pilot-[0-9]{3,}$/;
const KEY=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const pos=x=>Number.isSafeInteger(x)&&x>0;
const OWNERS=new Set(['PERSONAL_FLEET']);
const DOCTRINES=new Set(['DEFENSIVE','FOLLOW','HOLD_POSITION','RETREAT_ON_DAMAGE']);
const RECEIPT=/^[a-f0-9]{64}$/;
const isObj=x=>!!x&&typeof x==='object'&&!Array.isArray(x);
const validID=x=>typeof x==='string'&&KEY.test(x);
const own=(x,k)=>Object.prototype.hasOwnProperty.call(x,k);
const blocked=reason=>({status:'BLOCKED',reason});
const empty=(characterID,fleetID)=>({version:1,ownerCharacterID:characterID,
 fleetID,revision:0,doctrine:'DEFENSIVE',pilots:{},processed:{}});
function validate(state){
 if(!isObj(state)||state.version!==1||!pos(state.ownerCharacterID)||
   !validID(state.fleetID)||!Number.isSafeInteger(state.revision)||
   state.revision<0||!DOCTRINES.has(state.doctrine)||
   !isObj(state.pilots)||!isObj(state.processed)||
   Object.keys(state.pilots).length>24||Object.keys(state.processed).length>1024)
  throw Error('PF_ROSTER_CORRUPT');
 const ships=new Set();
 for(const [key,p] of Object.entries(state.pilots)){
  if(!PILOT.test(key)||!isObj(p)||p.pilotID!==key||
    !['CONTRACTED','ASSIGNED','RECOVERING','UNPAID','SUSPENDED'].includes(p.status)||
    !validID(p.contractID)||!pos(p.employerCharacterID)||
    p.employerCharacterID!==state.ownerCharacterID||
    !validID(p.hireReceipt)||!RECEIPT.test(p.hireReceipt)||
    !Number.isSafeInteger(p.revision)||p.revision<0||
    (p.shipItemID!==null&&!pos(p.shipItemID))||
    ((p.status==='ASSIGNED')!==(p.shipItemID!==null))||
    (p.shipItemID!==null&&ships.has(p.shipItemID)))
   throw Error('PF_PILOT_CORRUPT');
  if(p.shipItemID!==null)ships.add(p.shipItemID);
 }
 for(const [k,r] of Object.entries(state.processed)){
  if(!validID(k)||!isObj(r)||!RECEIPT.test(r.signature)||
    !isObj(r.receipt)||!['HIRED','ASSIGNED','UNASSIGNED','DOCTRINE_CHANGED','SUSPENDED','DISMISSED','LOSS_RECORDED','PILOT_RECOVERED'].includes(r.receipt.type))
   throw Error('PF_ROSTER_RECEIPT_CORRUPT');
 }
 return state;
}
function apply(state,cmd,{verifiedHire=false,verifiedCustody=false,verifiedRelease=false,
 verifiedTermination=false,verifiedLoss=false,verifiedRecovery=false,
 lossEvidence=null,recoveryEvidence=null,liabilityEvidence=null}={}){
 try{validate(state);}catch{return blocked('PF_ROSTER_CORRUPT');}
 if(!isObj(cmd)||!validID(cmd.operationID)||!RECEIPT.test(cmd.payloadHash)||
   !Number.isSafeInteger(cmd.expectedRevision)||cmd.expectedRevision<0||
   !['HIRE','ASSIGN','UNASSIGN','SET_DOCTRINE','SUSPEND','DISMISS','RECORD_LOSS','RECOVER_PILOT'].includes(cmd.type))
  return blocked('PF_COMMAND_INVALID');
 const prior=state.processed[cmd.operationID];
 if(prior)return prior.signature===cmd.payloadHash?
  {status:'DUPLICATE',receipt:structuredClone(prior.receipt),state}:
  blocked('PF_OPERATION_REPLAY_CONFLICT');
 if(cmd.expectedRevision!==state.revision)return blocked('PF_ROSTER_REVISION_STALE');
 if(state.revision===Number.MAX_SAFE_INTEGER||
   Object.keys(state.processed).length>=1024)return blocked('PF_ROSTER_CAP_REACHED');
 const next=structuredClone(state);
 let receipt;
 if(cmd.type==='HIRE'){
  if(!PILOT.test(cmd.pilotID)||!validID(cmd.contractID)||
    !RECEIPT.test(cmd.hireReceipt)||verifiedHire!==true||
    own(next.pilots,cmd.pilotID)||Object.keys(next.pilots).length>=24)
   return blocked('PF_HIRE_AUTHORITY_OR_CAP');
  if(Object.values(next.pilots).some(x=>x.contractID===cmd.contractID||
    x.hireReceipt===cmd.hireReceipt))return blocked('PF_HIRE_DUPLICATE_CONTRACT');
  next.pilots[cmd.pilotID]={pilotID:cmd.pilotID,
    contractID:cmd.contractID,hireReceipt:cmd.hireReceipt,
    employerCharacterID:state.ownerCharacterID,
    status:'CONTRACTED',shipItemID:null,revision:0};
  receipt={type:'HIRED',pilotID:cmd.pilotID,contractID:cmd.contractID};
 }else if(cmd.type==='SET_DOCTRINE'){
  if(!DOCTRINES.has(cmd.doctrine))return blocked('PF_DOCTRINE_INVALID');
  next.doctrine=cmd.doctrine;
  receipt={type:'DOCTRINE_CHANGED',doctrine:cmd.doctrine};
 }else{
  const p=next.pilots[cmd.pilotID];
  if(!PILOT.test(cmd.pilotID)||!p||p.employerCharacterID!==state.ownerCharacterID||
    !Number.isSafeInteger(cmd.expectedPilotRevision)||cmd.expectedPilotRevision!==p.revision)
   return blocked('PF_PILOT_NOT_OWNED_OR_STALE');
  if(p.revision===Number.MAX_SAFE_INTEGER)return blocked('PF_PILOT_REVISION_EXHAUSTED');
  if(cmd.type==='ASSIGN'){
   if(p.status!=='CONTRACTED'||p.shipItemID!==null||
     !pos(cmd.shipItemID)||verifiedCustody!==true||
     Object.values(next.pilots).some(x=>x.shipItemID===cmd.shipItemID))
    return blocked('PF_SHIP_CUSTODY_OR_PILOT_UNAVAILABLE');
   p.shipItemID=cmd.shipItemID;p.status='ASSIGNED';
   receipt={type:'ASSIGNED',pilotID:p.pilotID,shipItemID:cmd.shipItemID};
  }else if(cmd.type==='UNASSIGN'){
   if(p.status!=='ASSIGNED'||!pos(p.shipItemID)||verifiedRelease!==true)
    return blocked('PF_RELEASE_NOT_VERIFIED');
   const shipItemID=p.shipItemID;p.shipItemID=null;p.status='CONTRACTED';
   receipt={type:'UNASSIGNED',pilotID:p.pilotID,shipItemID};
  }else if(cmd.type==='RECORD_LOSS'){
   // Trusted adapter MUST have confirmed this exact original hull/wreck via
   // PF-07 and native ledger in one authorized committed reconciliation.
   if(p.status!=='ASSIGNED'||!pos(p.shipItemID)||!pos(cmd.wreckID)||
      cmd.shipItemID!==p.shipItemID||verifiedLoss!==true||
      !isObj(lossEvidence)||lossEvidence.phase!=='LOSS_CONFIRMED'||
      lossEvidence.pilotID!==p.pilotID||lossEvidence.originalShipItemID!==p.shipItemID||
      lossEvidence.assignmentID!==cmd.assignmentID||lossEvidence.wreckID!==cmd.wreckID||
      lossEvidence.ownerCharacterID!==state.ownerCharacterID||
      !pos(lossEvidence.generation)||lossEvidence.generation!==cmd.expectedGeneration)
    return blocked('PF_ORIGINAL_SHIP_LOSS_UNVERIFIED');
   const shipItemID=p.shipItemID;
   p.shipItemID=null;p.status='RECOVERING';
   receipt={type:'LOSS_RECORDED',pilotID:p.pilotID,shipItemID,wreckID:cmd.wreckID};
  }else if(cmd.type==='RECOVER_PILOT'){
   // Returning pilot has NO restored original ship; assigning a new hull
   // later requires a fresh PF actor claim and actual ItemStore custody.
   if(p.status!=='RECOVERING'||p.shipItemID!==null||verifiedRecovery!==true||
      !isObj(recoveryEvidence)||recoveryEvidence.phase!=='PILOT_AVAILABLE'||
      recoveryEvidence.pilotID!==p.pilotID||
      recoveryEvidence.ownerCharacterID!==state.ownerCharacterID||
      recoveryEvidence.originalShipItemID!==cmd.lostShipItemID||
      !pos(recoveryEvidence.wreckID)||
      recoveryEvidence.wreckID!==cmd.wreckID||
      !pos(recoveryEvidence.generation)||
      recoveryEvidence.generation!==cmd.expectedGeneration)
    return blocked('PF_CLONE_RECOVERY_UNVERIFIED');
   p.status='CONTRACTED';receipt={type:'PILOT_RECOVERED',pilotID:p.pilotID};
  }else if(cmd.type==='SUSPEND'){
   if(p.status!=='CONTRACTED'||p.shipItemID!==null)
    return blocked('PF_SUSPEND_REQUIRES_IDLE_PILOT');
   p.status='SUSPENDED';receipt={type:'SUSPENDED',pilotID:p.pilotID};
  }else if(cmd.type==='DISMISS'){
   if((p.status!=='CONTRACTED'&&p.status!=='SUSPENDED')||
     p.shipItemID!==null||verifiedTermination!==true)
    return blocked('PF_DISMISS_REQUIRES_RELEASED_CONTRACT');
   // Do not orphan DUE, SETTLING, OUTCOME_UNKNOWN or other unpaid payroll
   // when deleting a pilot. This assertion must come from the canonical
   // wallet/contract ledger in the same serialized native transaction.
   if(!isObj(liabilityEvidence)||
      liabilityEvidence.source!=='ORIGINAL_NATIVE_CONTRACT_AND_PAYROLL'||
      liabilityEvidence.pilotID!==p.pilotID||
      liabilityEvidence.contractID!==p.contractID||
      liabilityEvidence.employerCharacterID!==state.ownerCharacterID||
      !Number.isSafeInteger(liabilityEvidence.ledgerRevision)||
      liabilityEvidence.ledgerRevision<0||
      liabilityEvidence.outstandingISK!==0||
      liabilityEvidence.pendingInvoices!==0||
      liabilityEvidence.uncertainSettlements!==0||
      liabilityEvidence.nativeTerminationVerified!==true)
    return blocked('PF_DISMISS_LIABILITIES_UNVERIFIED');
   delete next.pilots[p.pilotID];
   receipt={type:'DISMISSED',pilotID:p.pilotID,contractID:p.contractID};
  }
  if(cmd.type!=='DISMISS')p.revision++;
 }
 next.revision++;
 next.processed[cmd.operationID]={signature:cmd.payloadHash,receipt};
 try{validate(next);}catch{return blocked('PF_NEXT_ROSTER_INVALID');}
 return {status:'APPLIED',receipt,state:next};
}

/**
 * PF-10 read-only cross-authority readiness check.
 * Trusted native adapter must pass atomic snapshots and an original ItemStore
 * binding for EACH assigned physical hull. Missing, stale or unreadable
 * authorities are NOT evidence of an empty universe.
 * This does not create/release a claim or authorize item mutation.
 */
function auditClaims(state,claimState,{bindings}={}){
 try{validate(state);
  require('./personal-fleet-claims.cjs').validate(claimState);
 }catch{return blocked('PF_CROSS_AUTHORITY_STATE_CORRUPT');}
 if(!Array.isArray(bindings))return blocked('PF_NATIVE_BINDINGS_UNAVAILABLE');
 const byPilot=new Map(),byShip=new Map(),byEntity=new Map();
 for(const b of bindings){
  if(!isObj(b)||!PILOT.test(b.pilotID)||!pos(b.shipItemID)||
    !pos(b.nativeEntityID)||!validID(b.assignmentID)||
    !pos(b.generation)||b.nativeItemVerified!==true||
    byPilot.has(b.pilotID)||byShip.has(b.shipItemID)||
    byEntity.has(b.nativeEntityID))
   return blocked('PF_NATIVE_BINDING_INVALID_OR_DUPLICATE');
  byPilot.set(b.pilotID,b);byShip.set(b.shipItemID,b);
  byEntity.set(b.nativeEntityID,b);
 }
 for(const p of Object.values(state.pilots)){
  const b=byPilot.get(p.pilotID);
  const matching=Object.values(claimState.claims).filter(x=>x.pilotID===p.pilotID);
  if(p.status==='ASSIGNED'){
   if(!b||p.shipItemID!==b.shipItemID||matching.length!==1||
      matching[0].entityID!==b.nativeEntityID||
      matching[0].assignmentID!==b.assignmentID||
      matching[0].generation!==b.generation||
      matching[0].ownerCharacterID!==state.ownerCharacterID)
    return blocked('PF_ASSIGNED_NATIVE_CLAIM_MISMATCH');
  }else if(b||matching.length){
   // Following a confirmed loss, old claims must be safely released in native
   // SQLite before the recovered pilot can accept an entirely new ship.
   return blocked('PF_ORPHANED_CLAIM_RECONCILIATION_REQUIRED');
  }
 }
 for(const entry of Object.values(claimState.claims))
  if(!state.pilots[entry.pilotID])
   return blocked('PF_CLAIM_WITHOUT_CONTRACTED_PILOT');
 for(const b of bindings)
  if(!state.pilots[b.pilotID])
   return blocked('PF_BINDING_WITHOUT_CONTRACTED_PILOT');
 return {status:'READY',assignmentCount:bindings.length};
}
module.exports={DOCTRINES,empty,validate,apply,auditClaims};
