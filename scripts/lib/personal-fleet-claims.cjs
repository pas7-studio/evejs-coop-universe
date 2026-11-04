'use strict';
// PF-01 reference durable claim registry (NON-DEPLOYED).
// A future engine fork adapter must wire all competing writers before writes
// are enabled. This module never issues native orders, moves items or spawns.
const TABLE='corporationRuntime',SEP='\u001f';
const KEY='coop-personal-fleet'+SEP+'actor-claims-v1';
const WAR_KEY='coop-faction-war'+SEP+'fleet-registry-v1';
const PILOT=/^coop-pilot-[0-9]{3,}$/;
const goodID=x=>Number.isSafeInteger(x)&&x>0;
const goodKey=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(x);
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const empty=()=>({version:1,claims:{},generations:{},processed:{}});
function validate(v){
 if(!v||v.version!==1||!v.claims||!v.generations||!v.processed||
   [v.claims,v.generations,v.processed].some(x=>typeof x!=='object'||Array.isArray(x))||
   Object.keys(v.claims).length>128||Object.keys(v.generations).length>1024||
   Object.keys(v.processed).length>1024)throw Error('PF_CLAIM_STATE_INVALID');
 const seen=new Set();
 for(const [key,c] of Object.entries(v.claims)){
  if(!goodID(Number(key))||String(Number(key))!==key||!c||
   c.entityID!==Number(key)||!PILOT.test(c.pilotID)||
   !goodID(c.ownerCharacterID)||!goodID(c.systemID)||
   !goodKey(c.assignmentID)||!goodID(c.generation)||
   c.ownerType!=='PERSONAL_FLEET'||seen.has(c.pilotID)||
   !goodID(v.generations[key])||v.generations[key]<c.generation)
    throw Error('PF_CLAIM_CORRUPT');
  seen.add(c.pilotID);
 }
 for(const [k,g] of Object.entries(v.generations))
  if(!goodID(Number(k))||String(Number(k))!==k||!goodID(g))throw Error('PF_GENERATION_CORRUPT');
 for(const [k,r] of Object.entries(v.processed))
  if(!goodKey(k)||!r||typeof r.signature!=='string'||!r.receipt)
   throw Error('PF_RECEIPT_CORRUPT');
 return v;
}
const denied=reason=>({status:'BLOCKED',reason});
function createPersonalFleetClaims({gameStore,verifyNativeActor,verifyMiningFree,
 verifyOtherClaimsFree,verifyRelease,enabled=()=>false,
 writersIntegrated=()=>false}={}){
 if(typeof gameStore?.coopAtomicNativeRows?.transact!=='function'||
    typeof gameStore.coopAtomicNativeRows.isPoisoned!=='function'||
    [verifyNativeActor,verifyMiningFree,verifyOtherClaimsFree,verifyRelease,enabled,writersIntegrated]
     .some(x=>typeof x!=='function'))
  throw Error('PF_NATIVE_AUTHORITIES_REQUIRED');
 function execute(cmd){
  // Until WAR/mining/exploration writers also consult the SAME claim row
  // transactionally, this API must remain strictly read-only/blocked.
  if(enabled()!==true)return {status:'DISABLED'};
  if(writersIntegrated()!==true)return denied('GLOBAL_WRITER_FENCE_NOT_INTEGRATED');
  if(gameStore.coopAtomicNativeRows.isPoisoned())return denied('ATOMIC_STORE_POISONED');
  if(!cmd||!['CLAIM','RELEASE'].includes(cmd.type)||!goodKey(cmd.operationID)||
     !goodID(cmd.entityID)||!PILOT.test(cmd.pilotID)||
     !goodID(cmd.ownerCharacterID)||!goodKey(cmd.assignmentID))
   return denied('INVALID_COMMAND');
  // Immutable, canonical operation fingerprint. Never rely on user-supplied
  // signatures or object-key ordering.
  const signature=JSON.stringify([cmd.type,cmd.operationID,cmd.entityID,cmd.pilotID,
    cmd.ownerCharacterID,cmd.assignmentID,cmd.systemID??null,cmd.expectedGeneration??null]);
  try{
   const wrapped=gameStore.coopAtomicNativeRows.transact([TABLE],tx=>{
    const s=validate(tx.get(TABLE,KEY)||empty());
    if(own(s.processed,cmd.operationID)){
     const p=s.processed[cmd.operationID];
     return p.signature===signature?{status:'DUPLICATE',receipt:structuredClone(p.receipt)}:
      denied('OPERATION_REPLAY_CONFLICT');
    }
    if(Object.keys(s.processed).length>=1024)return denied('RECEIPT_CAP_REACHED');
    const war=tx.get(TABLE,WAR_KEY);
    // Missing WAR registry is safe only when its writer is explicitly
    // integrated; corrupt or in-flight WAR reservations are not safe.
    if(war!==null&&(!war||war.version!==1||!war.ships||
       typeof war.ships!=='object'||Array.isArray(war.ships)||
       (war.transfers!==undefined&&(!war.transfers||typeof war.transfers!=='object'||Array.isArray(war.transfers)))))
      return denied('WAR_REGISTRY_UNVERIFIED');
    if(war&&(
      Object.values(war.ships).some(x=>x?.entityID===cmd.entityID||x?.pilotID===cmd.pilotID)||
      Object.values(war.transfers||{}).some(x=>x?.entityID===cmd.entityID||x?.pilotID===cmd.pilotID)))
      return denied('WAR_ACTOR_RESERVED');
    const existing=s.claims[String(cmd.entityID)];
    let receipt;
    if(cmd.type==='CLAIM'){
     if(!goodID(cmd.systemID)||existing||
        Object.values(s.claims).some(x=>x.pilotID===cmd.pilotID)||
        Object.keys(s.claims).length>=128)return denied('PF_ACTOR_RESERVED_OR_INVALID');
     // These predicates MUST inspect their original native claim authorities.
     // Their return is a hard gate; unknown status fails closed.
     if(verifyMiningFree(cmd,tx)!==true||
       verifyOtherClaimsFree(cmd,tx)!==true||
       verifyNativeActor(cmd,tx)!==true)return denied('NATIVE_OR_CLAIM_UNVERIFIED');
     const prev=s.generations[String(cmd.entityID)]||0;
     if(prev>=Number.MAX_SAFE_INTEGER-1)return denied('GENERATION_EXHAUSTED');
     const generation=prev+1;
     s.generations[String(cmd.entityID)]=generation;
     s.claims[String(cmd.entityID)]={entityID:cmd.entityID,pilotID:cmd.pilotID,
       ownerCharacterID:cmd.ownerCharacterID,assignmentID:cmd.assignmentID,
       systemID:cmd.systemID,generation,ownerType:'PERSONAL_FLEET'};
     receipt={type:'CLAIM',entityID:cmd.entityID,pilotID:cmd.pilotID,generation};
    }else{
     if(!existing||existing.pilotID!==cmd.pilotID||
       existing.ownerCharacterID!==cmd.ownerCharacterID||
       existing.assignmentID!==cmd.assignmentID||
       existing.generation!==cmd.expectedGeneration)
       return denied('STALE_OR_FOREIGN_CLAIM');
     if(verifyRelease({...cmd,claim:structuredClone(existing)},tx)!==true)
       return denied('NATIVE_RELEASE_UNVERIFIED');
     delete s.claims[String(cmd.entityID)];
     receipt={type:'RELEASE',entityID:cmd.entityID,pilotID:cmd.pilotID,
       generation:existing.generation};
    }
    s.processed[cmd.operationID]={signature,receipt};
    validate(s);
    tx.put(TABLE,KEY,s);
    return {status:'APPLIED',receipt};
   });
   // The real GameStore wrapper returns its mutation's result directly;
   // isolated/mocked bridges may wrap it as {result}. Do not mistake
   // success of a transaction wrapper for successful claim admission.
   return wrapped?.result&&wrapped.status===undefined?wrapped.result:wrapped;
  }catch(error){
   return denied(error?.coopCommitOutcomeUnknown===true?
     'ATOMIC_COMMIT_OUTCOME_UNKNOWN':'ATOMIC_CLAIM_UNAVAILABLE');
  }
 }
 return Object.freeze({execute});
}
module.exports={TABLE,KEY,WAR_KEY,empty,validate,createPersonalFleetClaims};
