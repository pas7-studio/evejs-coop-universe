'use strict';
// PF-06 NON-DEPLOYED pure combat policy. Never mutates HP, ammo, wallet,
// standings, loot or native NPC controllers. All authority witnesses must be
// issued by trusted server-side native adapters, never by the EVE client.
const PILOT=/^coop-pilot-[0-9]{3,}$/;
const HASH=/^[a-f0-9]{64}$/;
const TOKEN=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const positive=x=>Number.isSafeInteger(x)&&x>0;
const token=x=>typeof x==='string'&&TOKEN.test(x);
const object=x=>!!x&&typeof x==='object'&&!Array.isArray(x);
const block=reason=>({status:'BLOCKED',reason});
const PHASES=new Set(['PROPOSED','ISSUING','NATIVE_REQUESTED','ENGAGED','RESOLVED','REJECTED','OUTCOME_UNKNOWN']);
function createAttack(command,{authenticatedIssuer,actor,legalTarget,weapon,now}={}){
 if(!object(command)||!token(command.operationID)||!token(command.assignmentID)||
  !PILOT.test(command.pilotID)||!positive(command.nativeEntityID)||
  !positive(command.systemID)||!positive(command.targetID)||
  !positive(command.issuerCharacterID)||!positive(command.generation)||
  !Number.isSafeInteger(command.fleetRevision)||command.fleetRevision<0||
  !HASH.test(command.payloadHash)||!positive(command.expiresAt)||
  !Number.isSafeInteger(now)||now>=command.expiresAt)
  return block('PF_COMBAT_COMMAND_INVALID_OR_EXPIRED');
 if(authenticatedIssuer!==command.issuerCharacterID)
  return block('PF_COMBAT_ISSUER_UNAUTHORIZED');
 if(!object(actor)||actor.nativeEntityID!==command.nativeEntityID||
  actor.pilotID!==command.pilotID||actor.systemID!==command.systemID||
  actor.ownerCharacterID!==command.issuerCharacterID||
  actor.assignmentID!==command.assignmentID||
  actor.generation!==command.generation||
  actor.fleetRevision!==command.fleetRevision||actor.custodyActive!==true||
  actor.nativeControllerVerified!==true||actor.isWarping!==false)
  return block('PF_COMBAT_ACTOR_UNVERIFIED');
 // Native PVP legality / faction war / Crimewatch and exact target identity
 // are all separate from the user's desire to attack.
 if(legalTarget?.type!=='ORIGINAL_NATIVE_TARGET_LEGALITY'||
  legalTarget.systemID!==command.systemID||
  legalTarget.targetID!==command.targetID||
  legalTarget.shooterEntityID!==command.nativeEntityID||
  legalTarget.allowed!==true||legalTarget.friendlyFireAllowed!==true||
  legalTarget.explicitNativeAuthority!==true)
  return block('PF_COMBAT_LEGALITY_UNVERIFIED');
 // Weapon proof is obtained from original installed module/charge snapshots,
 // using real dogma/capacitor checks. Synthetic NPC weapons cannot be
 // mistaken for a player's physically fitted module.
 if(weapon?.type!=='ORIGINAL_NATIVE_WEAPON_READINESS'||
  weapon.entityID!==command.nativeEntityID||
  weapon.systemID!==command.systemID||
  !positive(weapon.moduleID)||!positive(weapon.originalModuleItemID)||
  weapon.moduleID!==weapon.originalModuleItemID||
  weapon.installedOnOriginalShip!==true||
  weapon.nativeWeaponActive!==true||
  weapon.nativeCanActivate!==true||weapon.capacitorSufficient!==true||
  weapon.chargeRequired!==true&&weapon.chargeRequired!==false||
  (weapon.chargeRequired===true&&
   (!positive(weapon.chargeItemID)||!positive(weapon.chargeQuantity)||
    weapon.nativeChargeCompatible!==true)))
  return block('PF_COMBAT_NATIVE_WEAPON_UNVERIFIED');
 const row={version:1,operationID:command.operationID,assignmentID:command.assignmentID,
  pilotID:command.pilotID,nativeEntityID:command.nativeEntityID,
  systemID:command.systemID,targetID:command.targetID,
  issuerCharacterID:command.issuerCharacterID,generation:command.generation,
  fleetRevision:command.fleetRevision,payloadHash:command.payloadHash,
  moduleID:weapon.moduleID,chargeItemID:weapon.chargeRequired?weapon.chargeItemID:null,
  expiresAt:command.expiresAt,phase:'PROPOSED',revision:0,receipts:[]};
 return {status:'PROPOSED',record:row};
}
function valid(r){
 return object(r)&&r.version===1&&token(r.operationID)&&token(r.assignmentID)&&
  PILOT.test(r.pilotID)&&positive(r.nativeEntityID)&&positive(r.systemID)&&
  positive(r.targetID)&&positive(r.issuerCharacterID)&&positive(r.generation)&&
  Number.isSafeInteger(r.fleetRevision)&&r.fleetRevision>=0&&
  positive(r.moduleID)&&(r.chargeItemID===null||positive(r.chargeItemID))&&
  positive(r.expiresAt)&&HASH.test(r.payloadHash)&&PHASES.has(r.phase)&&
  Number.isSafeInteger(r.revision)&&r.revision>=0&&
  Array.isArray(r.receipts)&&r.receipts.length<=16&&
  r.receipts.every(x=>object(x)&&token(x.id)&&token(x.type))&&
  new Set(r.receipts.map(x=>x.id)).size===r.receipts.length;
}
const MOVES={PROPOSED:{ISSUING:'DURABLE_COMBAT_DISPATCH_FENCE',
 REJECTED:'PRE_DISPATCH_NATIVE_REJECTION'},
 ISSUING:{NATIVE_REQUESTED:'ORIGINAL_NATIVE_ATTACK_ACK',
 REJECTED:'DEFINITE_NATIVE_NO_EFFECT',OUTCOME_UNKNOWN:'NATIVE_COMBAT_OUTCOME_UNCERTAIN'},
 NATIVE_REQUESTED:{ENGAGED:'ORIGINAL_NATIVE_DAMAGE_OR_ACTIVATION',
 REJECTED:'DEFINITE_NATIVE_NO_EFFECT',OUTCOME_UNKNOWN:'NATIVE_COMBAT_OUTCOME_UNCERTAIN'},
 ENGAGED:{RESOLVED:'ORIGINAL_NATIVE_COMBAT_RESOLVED',
 OUTCOME_UNKNOWN:'NATIVE_COMBAT_OUTCOME_UNCERTAIN'},
 REJECTED:{},RESOLVED:{},OUTCOME_UNKNOWN:{}};
function transition(row,{to,expectedRevision,proof,now}={}){
 if(!valid(row))return block('PF_COMBAT_RECORD_CORRUPT');
 if(row.revision!==expectedRevision)return block('PF_COMBAT_REVISION_STALE');
 if(!Number.isSafeInteger(now)||now<0)return block('PF_COMBAT_CLOCK_INVALID');
 if(row.phase==='PROPOSED'&&now>=row.expiresAt)return block('PF_COMBAT_INTENT_EXPIRED');
 const kind=MOVES[row.phase]?.[to];
 if(!kind)return block('PF_COMBAT_ILLEGAL_TRANSITION');
 if(proof?.type!==kind||!token(proof.id)||
  proof.operationID!==row.operationID||
  proof.nativeEntityID!==row.nativeEntityID||
  proof.generation!==row.generation||
  row.receipts.some(x=>x.id===proof.id))
  return block('PF_COMBAT_NATIVE_PROOF_REQUIRED');
 if(to==='ENGAGED'&&(proof.originalModuleID!==row.moduleID||
  proof.targetID!==row.targetID||proof.nativeEffectVerified!==true))
  return block('PF_COMBAT_PHYSICAL_EFFECT_UNVERIFIED');
 if(to==='RESOLVED'&&(proof.targetID!==row.targetID||
  proof.nativeCombatFinished!==true))return block('PF_COMBAT_COMPLETION_UNVERIFIED');
 const next={...row,phase:to,revision:row.revision+1,
  receipts:[...row.receipts,{id:proof.id,type:kind}]};
 return {status:'APPLIED',record:next};
}
function replay(row,{operationID,payloadHash}={}){
 if(!valid(row))return block('PF_COMBAT_RECORD_CORRUPT');
 if(row.operationID!==operationID||row.payloadHash!==payloadHash)
  return block('PF_COMBAT_REPLAY_CONFLICT');
 return {status:'DUPLICATE',phase:row.phase,dispatchAllowed:false};
}
// Pure read-only attribution is NEVER reward/payment authority.
function combatContribution({nativeDamageEvents,wreck,sourceEntityID,targetID}={}){
 if(!positive(sourceEntityID)||!positive(targetID)||!Array.isArray(nativeDamageEvents)||
  nativeDamageEvents.length>10000)return block('PF_COMBAT_ATTRIBUTION_UNVERIFIED');
 let amount=0;
 for(const e of nativeDamageEvents){
  if(!object(e)||!positive(e.eventID)||!positive(e.sourceEntityID)||
   !positive(e.targetEntityID)||!Number.isSafeInteger(e.damageUnits)||e.damageUnits<0||
   e.authority!=='NATIVE_EVEJS_DAMAGE')
   return block('PF_COMBAT_ATTRIBUTION_CORRUPT');
 }
 const ids=new Set();
 for(const e of nativeDamageEvents){
  if(ids.has(e.eventID))return block('PF_COMBAT_ATTRIBUTION_DUPLICATED_EVENT');
  ids.add(e.eventID);
  if(e.sourceEntityID===sourceEntityID&&e.targetEntityID===targetID)
   amount+=e.damageUnits;
  if(!Number.isSafeInteger(amount))return block('PF_COMBAT_ATTRIBUTION_OVERFLOW');
 }
 if(wreck!==null&&wreck!==undefined&&
  (!positive(wreck.wreckID)||wreck.originalTargetID!==targetID||
   wreck.authority!=='NATIVE_EVEJS_WRECK'))
  return block('PF_COMBAT_WRECK_UNVERIFIED');
 return {status:'OBSERVED',sourceEntityID,targetID,damageUnits:amount,
  wreckID:wreck?.wreckID??null,settlementAllowed:false};
}

function inspectNativeSettlement({nativeReceipt,existingReceipt,targetID,wreckID}={}){
 // A PF-owned NPC never mints bounties/rewards. This is a projection of an
 // existing authoritative settlement, not a permission to create one.
 if(!positive(targetID)||!positive(wreckID))return block('PF_REWARD_CONTEXT_INVALID');
 if(!object(nativeReceipt)||nativeReceipt.authority!=='NATIVE_EVEJS_SETTLEMENT'||
  !token(nativeReceipt.settlementID)||nativeReceipt.originalTargetID!==targetID||
  nativeReceipt.wreckID!==wreckID||
  nativeReceipt.finalized!==true||
  !Number.isSafeInteger(nativeReceipt.iskAmount)||nativeReceipt.iskAmount<0||
  !Array.isArray(nativeReceipt.itemIDs)||nativeReceipt.itemIDs.length>256||
  nativeReceipt.itemIDs.some(x=>!positive(x))||
  new Set(nativeReceipt.itemIDs).size!==nativeReceipt.itemIDs.length)
  return block('PF_NATIVE_REWARD_RECEIPT_UNVERIFIED');
 if(existingReceipt!==null&&existingReceipt!==undefined){
  if(!object(existingReceipt)||existingReceipt.settlementID!==nativeReceipt.settlementID||
    existingReceipt.wreckID!==wreckID||
    existingReceipt.originalTargetID!==targetID)
   return block('PF_REWARD_SETTLEMENT_CONFLICT');
  return {status:'ALREADY_SETTLED',settlementID:nativeReceipt.settlementID,
   payoutAllowed:false};
 }
 return {status:'NATIVE_SETTLEMENT_OBSERVED',
  settlementID:nativeReceipt.settlementID,iskAmount:nativeReceipt.iskAmount,
  originalItemIDs:[...nativeReceipt.itemIDs],payoutAllowed:false};
}
module.exports={PHASES,valid,createAttack,transition,replay,combatContribution,inspectNativeSettlement};
