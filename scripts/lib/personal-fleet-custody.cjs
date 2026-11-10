'use strict';
// PF-03 reference contract: NO native ship materialization, item writes or session spoofing.
// Caller must commit each returned immutable row in the original GameStore transaction.
const ID=x=>Number.isSafeInteger(x)&&x>0;
const TOKEN=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(x);
const PILOT=/^coop-pilot-[0-9]{3,}$/;
const HASH=/^[a-f0-9]{64}$/;
const STATES=new Set(['PREPARED','NATIVE_REQUESTED','ACTIVE','RETURN_REQUESTED','DOCKING','COMMITTED_DOCKED','CONFIRMED_LOST','OUTCOME_UNKNOWN']);
const STEP=Object.freeze({
 PREPARED:{NATIVE_REQUESTED:'NATIVE_DISPATCH_INTENT_DURABLE'},
 NATIVE_REQUESTED:{ACTIVE:'ORIGINAL_NATIVE_ACTOR_VERIFIED'},
 ACTIVE:{RETURN_REQUESTED:'RETURN_INTENT_DURABLE',CONFIRMED_LOST:'NATIVE_WRECK_VERIFIED'},
 RETURN_REQUESTED:{DOCKING:'NATIVE_STATION_APPROACH_VERIFIED',CONFIRMED_LOST:'NATIVE_WRECK_VERIFIED'},
 DOCKING:{COMMITTED_DOCKED:'ORIGINAL_HANGAR_CUSTODY_VERIFIED',CONFIRMED_LOST:'NATIVE_WRECK_VERIFIED'},
 COMMITTED_DOCKED:{},CONFIRMED_LOST:{},OUTCOME_UNKNOWN:{}
});
const blocked=reason=>({status:'BLOCKED',reason});
function valid(r){
 return !!r&&r.version===1&&TOKEN(r.operationID)&&TOKEN(r.assignmentID)&&
 PILOT.test(r.pilotID)&&ID(r.ownerCharacterID)&&ID(r.shipItemID)&&
 ID(r.systemID)&&ID(r.generation)&&HASH.test(r.fittingHash)&&
 HASH.test(r.cargoHash)&&STATES.has(r.phase)&&
 Number.isSafeInteger(r.revision)&&r.revision>=0&&
 Array.isArray(r.receipts)&&r.receipts.length<=16&&
 r.receipts.every(x=>x&&TOKEN(x.proofID)&&TOKEN(x.type));
}
function prepare({operationID,assignmentID,pilotID,ownerCharacterID,shipItemID,
 systemID,generation,fittingHash,cargoHash,proof}={}){
 if(!TOKEN(operationID)||!TOKEN(assignmentID)||!PILOT.test(pilotID)||
 !ID(ownerCharacterID)||!ID(shipItemID)||!ID(systemID)||!ID(generation)||
 !HASH.test(fittingHash)||!HASH.test(cargoHash))return blocked('INVALID_ORIGINAL_SHIP_IDENTITY');
 // This is an assertion from a trusted native Inventory/ItemStore adapter, NEVER a client input.
 if(proof?.type!=='ORIGINAL_HANGAR_ITEM_VERIFIED'||
 proof.shipItemID!==shipItemID||proof.ownerCharacterID!==ownerCharacterID||
 proof.systemID!==systemID||proof.fittingHash!==fittingHash||
 proof.cargoHash!==cargoHash||proof.assignmentID!==assignmentID||
 proof.generation!==generation||proof.exclusiveUnavailable!==true||
 !TOKEN(proof.proofID))return blocked('ORIGINAL_HANGAR_CUSTODY_UNVERIFIED');
 return {status:'PREPARED',record:Object.freeze({version:1,operationID,assignmentID,
 pilotID,ownerCharacterID,shipItemID,systemID,generation,fittingHash,cargoHash,
 phase:'PREPARED',revision:0,receipts:[{type:proof.type,proofID:proof.proofID}]})};
}
function advance(record,{to,expectedRevision,expectedGeneration,proof}={}){
 if(!valid(record))return blocked('CUSTODY_RECORD_CORRUPT');
 if(record.revision!==expectedRevision||record.generation!==expectedGeneration)
 return blocked('STALE_CUSTODY_FENCE');
 const required=STEP[record.phase]?.[to];
 if(!required)return blocked('ILLEGAL_CUSTODY_TRANSITION');
 if(proof?.type!==required||proof.shipItemID!==record.shipItemID||
 proof.assignmentID!==record.assignmentID||proof.generation!==record.generation||
 !TOKEN(proof.proofID))return blocked('ORIGINAL_NATIVE_EVIDENCE_REQUIRED');
 if(['ORIGINAL_NATIVE_ACTOR_VERIFIED','ORIGINAL_HANGAR_CUSTODY_VERIFIED'].includes(required)){
  if(proof.originalItemID!==record.shipItemID||
  proof.fittingHash!==record.fittingHash||proof.cargoHash!==record.cargoHash||
  proof.singleLocation!==true)return blocked('NATIVE_ITEM_CONSERVATION_UNVERIFIED');
 }
 if(required==='NATIVE_WRECK_VERIFIED'&&(!ID(proof.wreckID)||
 proof.systemID!==record.systemID))return blocked('WRECK_EVIDENCE_UNVERIFIED');
 if(required==='ORIGINAL_HANGAR_CUSTODY_VERIFIED'&&proof.nativeActorAbsent!==true)
 return blocked('NATIVE_SHIP_STILL_PRESENT');
 if(record.receipts.some(x=>x.proofID===proof.proofID))
 return blocked('EVIDENCE_REPLAY_CONFLICT');
 const next={...record,phase:to,revision:record.revision+1,
 receipts:[...record.receipts,{type:required,proofID:proof.proofID}]};
 return {status:'APPLIED',record:Object.freeze(next)};
}
function observe(record,{nativeEntity,hangarItem,wreck}={}){
 if(!valid(record))return blocked('CUSTODY_RECORD_CORRUPT');
 // Absent observations are UNKNOWN, not evidence of destruction or docking.
 const n=nativeEntity,h=hangarItem,w=wreck;
 if(n===undefined||h===undefined||w===undefined)
  return {status:'OUTCOME_UNKNOWN',reason:'INCOMPLETE_NATIVE_OBSERVATION'};
 if(n!==null&&h!==null)return {status:'OUTCOME_UNKNOWN',reason:'DUPLICATE_PHYSICAL_CUSTODY'};
 if(w!==null){
  if(!ID(w.wreckID)||w.originalItemID!==record.shipItemID||n!==null||h!==null)
   return {status:'OUTCOME_UNKNOWN',reason:'WRECK_IDENTITY_CONFLICT'};
  return {status:'OBSERVED_LOST',wreckID:w.wreckID};
 }
 if(n!==null){
  if(n.originalItemID!==record.shipItemID||n.pilotID!==record.pilotID||
    n.systemID!==record.systemID||n.fittingHash!==record.fittingHash||
    n.cargoHash!==record.cargoHash||n.controllerVerified!==true)
   return {status:'OUTCOME_UNKNOWN',reason:'NATIVE_ACTOR_IDENTITY_CONFLICT'};
  return {status:'OBSERVED_ACTIVE'};
 }
 if(h!==null){
  if(h.itemID!==record.shipItemID||h.ownerCharacterID!==record.ownerCharacterID||
   h.fittingHash!==record.fittingHash||h.cargoHash!==record.cargoHash)
   return {status:'OUTCOME_UNKNOWN',reason:'HANGAR_ITEM_IDENTITY_CONFLICT'};
  return {status:'OBSERVED_HANGAR'};
 }
 return {status:'OUTCOME_UNKNOWN',reason:'ORIGINAL_SHIP_LOCATION_UNKNOWN'};
}
module.exports={STATES,STEP,valid,prepare,advance,observe};
