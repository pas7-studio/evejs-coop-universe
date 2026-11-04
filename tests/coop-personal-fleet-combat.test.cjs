'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const c=require('../scripts/lib/personal-fleet-combat.cjs');
const command=(changes={})=>({operationID:'pf-combat-001',assignmentID:'pf-assignment-001',
 pilotID:'coop-pilot-001',nativeEntityID:500,systemID:30000144,targetID:700,
 issuerCharacterID:90,generation:7,fleetRevision:0,payloadHash:'a'.repeat(64),
 expiresAt:100000,...changes});
const actor=(changes={})=>({pilotID:'coop-pilot-001',nativeEntityID:500,
 systemID:30000144,ownerCharacterID:90,assignmentID:'pf-assignment-001',
 generation:7,fleetRevision:0,custodyActive:true,nativeControllerVerified:true,
 isWarping:false,...changes});
const legal=(changes={})=>({type:'ORIGINAL_NATIVE_TARGET_LEGALITY',
 systemID:30000144,targetID:700,shooterEntityID:500,allowed:true,
 friendlyFireAllowed:true,explicitNativeAuthority:true,...changes});
const weapon=(changes={})=>({type:'ORIGINAL_NATIVE_WEAPON_READINESS',
 entityID:500,systemID:30000144,moduleID:300,originalModuleItemID:300,
 installedOnOriginalShip:true,nativeWeaponActive:true,nativeCanActivate:true,
 capacitorSufficient:true,chargeRequired:true,chargeItemID:800,
 chargeQuantity:20,nativeChargeCompatible:true,...changes});
const trusted=(changes={})=>({now:1000,authenticatedIssuer:90,actor:actor(),
 legalTarget:legal(),weapon:weapon(),...changes});
const start=()=>{const x=c.createAttack(command(),trusted());assert.equal(x.status,'PROPOSED');return x.record};
const proof=(r,type,changes={})=>({type,id:'evidence-'+type,operationID:r.operationID,
 nativeEntityID:r.nativeEntityID,generation:r.generation,...changes});
const move=(r,to,type,changes={})=>c.transition(r,{to,expectedRevision:r.revision,
 now:2000+r.revision,proof:proof(r,type,changes)});
test('valid native attack is only PROPOSED',()=>assert.equal(start().phase,'PROPOSED'));
test('unauthenticated issuer blocked',()=>assert.equal(c.createAttack(command(),trusted({authenticatedIssuer:91})).reason,'PF_COMBAT_ISSUER_UNAUTHORIZED'));
test('stale pilot generation blocked',()=>assert.equal(c.createAttack(command(),trusted({actor:actor({generation:6})})).reason,'PF_COMBAT_ACTOR_UNVERIFIED'));
test('stale fleet revision blocked',()=>assert.equal(c.createAttack(command(),trusted({actor:actor({fleetRevision:4})})).reason,'PF_COMBAT_ACTOR_UNVERIFIED'));
test('unproven original native controller blocked',()=>assert.equal(c.createAttack(command(),trusted({actor:actor({nativeControllerVerified:false})})).reason,'PF_COMBAT_ACTOR_UNVERIFIED'));
test('warp-in-progress blocks native attack',()=>assert.equal(c.createAttack(command(),trusted({actor:actor({isWarping:true})})).reason,'PF_COMBAT_ACTOR_UNVERIFIED'));
test('invalid target and unknown legality block',()=>assert.equal(c.createAttack(command(),trusted({legalTarget:legal({allowed:false})})).reason,'PF_COMBAT_LEGALITY_UNVERIFIED'));
test('friendly fire authority is mandatory',()=>assert.equal(c.createAttack(command(),trusted({legalTarget:legal({friendlyFireAllowed:false})})).reason,'PF_COMBAT_LEGALITY_UNVERIFIED'));
test('native module must exist on original hull',()=>assert.equal(c.createAttack(command(),trusted({weapon:weapon({installedOnOriginalShip:false})})).reason,'PF_COMBAT_NATIVE_WEAPON_UNVERIFIED'));
test('zero native ammo blocks charged weapon',()=>assert.equal(c.createAttack(command(),trusted({weapon:weapon({chargeQuantity:0})})).reason,'PF_COMBAT_NATIVE_WEAPON_UNVERIFIED'));
test('native capacitor proof must exist',()=>assert.equal(c.createAttack(command(),trusted({weapon:weapon({capacitorSufficient:false})})).reason,'PF_COMBAT_NATIVE_WEAPON_UNVERIFIED'));
test('expired attack intent cannot dispatch',()=>assert.equal(c.createAttack(command(),trusted({now:100000})).reason,'PF_COMBAT_COMMAND_INVALID_OR_EXPIRED'));
test('durable ISSUING phase requires receipt',()=>{const r=start();assert.equal(move(r,'ISSUING','ORIGINAL_NATIVE_ATTACK_ACK').reason,'PF_COMBAT_NATIVE_PROOF_REQUIRED');assert.equal(move(r,'ISSUING','DURABLE_COMBAT_DISPATCH_FENCE').status,'APPLIED')});
test('ACK is not native damage',()=>{let r=move(start(),'ISSUING','DURABLE_COMBAT_DISPATCH_FENCE').record;r=move(r,'NATIVE_REQUESTED','ORIGINAL_NATIVE_ATTACK_ACK').record;assert.equal(r.phase,'NATIVE_REQUESTED')});
test('real native effect requires module and target proof',()=>{let r=move(start(),'ISSUING','DURABLE_COMBAT_DISPATCH_FENCE').record;r=move(r,'NATIVE_REQUESTED','ORIGINAL_NATIVE_ATTACK_ACK').record;assert.equal(move(r,'ENGAGED','ORIGINAL_NATIVE_DAMAGE_OR_ACTIVATION').reason,'PF_COMBAT_PHYSICAL_EFFECT_UNVERIFIED');assert.equal(move(r,'ENGAGED','ORIGINAL_NATIVE_DAMAGE_OR_ACTIVATION',{originalModuleID:300,targetID:700,nativeEffectVerified:true}).status,'APPLIED')});
test('combat completion requires native end evidence',()=>{let r=move(start(),'ISSUING','DURABLE_COMBAT_DISPATCH_FENCE').record;r=move(r,'NATIVE_REQUESTED','ORIGINAL_NATIVE_ATTACK_ACK').record;r=move(r,'ENGAGED','ORIGINAL_NATIVE_DAMAGE_OR_ACTIVATION',{originalModuleID:300,targetID:700,nativeEffectVerified:true}).record;assert.equal(move(r,'RESOLVED','ORIGINAL_NATIVE_COMBAT_RESOLVED').reason,'PF_COMBAT_COMPLETION_UNVERIFIED');assert.equal(move(r,'RESOLVED','ORIGINAL_NATIVE_COMBAT_RESOLVED',{targetID:700,nativeCombatFinished:true}).status,'APPLIED')});
test('unknown attack outcome never permits replay of native order',()=>{let r=move(start(),'ISSUING','DURABLE_COMBAT_DISPATCH_FENCE').record;r=move(r,'OUTCOME_UNKNOWN','NATIVE_COMBAT_OUTCOME_UNCERTAIN').record;assert.equal(c.replay(r,command()).dispatchAllowed,false);assert.equal(move(r,'ISSUING','DURABLE_COMBAT_DISPATCH_FENCE').reason,'PF_COMBAT_ILLEGAL_TRANSITION')});
test('reused operation ID with changed payload denied',()=>assert.equal(c.replay(start(),{operationID:'pf-combat-001',payloadHash:'b'.repeat(64)}).reason,'PF_COMBAT_REPLAY_CONFLICT'));
test('native damage events never authorize payout',()=>{const x=c.combatContribution({sourceEntityID:500,targetID:700,nativeDamageEvents:[{eventID:1,sourceEntityID:500,targetEntityID:700,damageUnits:12,authority:'NATIVE_EVEJS_DAMAGE'}],wreck:{wreckID:20,originalTargetID:700,authority:'NATIVE_EVEJS_WRECK'}});assert.equal(x.damageUnits,12);assert.equal(x.settlementAllowed,false)});
test('duplicate native damage event ID refuses attribution',()=>{const e={eventID:1,sourceEntityID:500,targetEntityID:700,damageUnits:20,authority:'NATIVE_EVEJS_DAMAGE'};assert.equal(c.combatContribution({sourceEntityID:500,targetID:700,nativeDamageEvents:[e,e]}).reason,'PF_COMBAT_ATTRIBUTION_DUPLICATED_EVENT')});
test('unknown damage authority refuses attribution',()=>assert.equal(c.combatContribution({sourceEntityID:500,targetID:700,nativeDamageEvents:[{eventID:1,sourceEntityID:500,targetEntityID:700,damageUnits:1,authority:'SYNTHETIC'}]}).reason,'PF_COMBAT_ATTRIBUTION_CORRUPT'));
test('wrong original wreck does not certify loss',()=>assert.equal(c.combatContribution({sourceEntityID:500,targetID:700,nativeDamageEvents:[],wreck:{wreckID:20,originalTargetID:701,authority:'NATIVE_EVEJS_WRECK'}}).reason,'PF_COMBAT_WRECK_UNVERIFIED'));

test('inactive native weapon cannot issue a physical attack',()=>assert.equal(
 c.createAttack(command(),trusted({weapon:weapon({nativeWeaponActive:false})})).reason,
 'PF_COMBAT_NATIVE_WEAPON_UNVERIFIED'));
const nativeSettlement=(changes={})=>({authority:'NATIVE_EVEJS_SETTLEMENT',
 settlementID:'native-settlement-01',originalTargetID:700,wreckID:20,
 finalized:true,iskAmount:5000,itemIDs:[1001,1002],...changes});
test('native settlement is observed, never an authorization to mint ISK',()=>{
 const result=c.inspectNativeSettlement({nativeReceipt:nativeSettlement(),
  existingReceipt:null,targetID:700,wreckID:20});
 assert.equal(result.status,'NATIVE_SETTLEMENT_OBSERVED');
 assert.equal(result.payoutAllowed,false);
 assert.deepEqual(result.originalItemIDs,[1001,1002]);
});
test('existing native payout cannot be settled again by PF',()=>{
 const result=c.inspectNativeSettlement({nativeReceipt:nativeSettlement(),
  existingReceipt:{settlementID:'native-settlement-01',originalTargetID:700,wreckID:20},
  targetID:700,wreckID:20});
 assert.equal(result.status,'ALREADY_SETTLED');assert.equal(result.payoutAllowed,false);
});
test('conflicting settlement or duplicated physical item IDs are rejected',()=>{
 assert.equal(c.inspectNativeSettlement({nativeReceipt:nativeSettlement(),
  existingReceipt:{settlementID:'foreign',originalTargetID:700,wreckID:20},
  targetID:700,wreckID:20}).reason,'PF_REWARD_SETTLEMENT_CONFLICT');
 assert.equal(c.inspectNativeSettlement({nativeReceipt:nativeSettlement({itemIDs:[1001,1001]}),
  targetID:700,wreckID:20}).reason,'PF_NATIVE_REWARD_RECEIPT_UNVERIFIED');
});


test('PF-13: same combat operation/hash cannot swap native target',()=>{
 const row=start();
 assert.equal(c.replay(row,command({targetID:701})).reason,
 'PF_COMBAT_REPLAY_CONFLICT');
});
test('PF-13: same combat operation/hash cannot swap pilot assignment',()=>{
 const row=start();
 assert.equal(c.replay(row,command({assignmentID:'pf-assignment-999'})).reason,
 'PF_COMBAT_REPLAY_CONFLICT');
});
test('PF-13: same combat operation/hash cannot extend native action expiry',()=>{
 const row=start();
 assert.equal(c.replay(row,command({expiresAt:200000})).reason,
 'PF_COMBAT_REPLAY_CONFLICT');
});


test('PF-14: duplicated saved combat receipts are corrupt',()=>{
 const r=start(),receipt={id:'proof-x',type:'DURABLE_COMBAT_DISPATCH_FENCE'};
 assert.equal(c.replay({...r,phase:'ISSUING',revision:2,
 receipts:[receipt,receipt]},command()).reason,'PF_COMBAT_RECORD_CORRUPT');
});
test('PF-14: combat revision mismatch fails closed',()=>{
 const r=start();
 assert.equal(c.replay({...r,revision:3},command()).reason,
 'PF_COMBAT_RECORD_CORRUPT');
});
test('PF-14: fabricated combat proof type never validates',()=>{
 const r=start();
 assert.equal(c.replay({...r,phase:'ISSUING',revision:1,
 receipts:[{id:'fake-01',type:'FAKE_DAMAGE'}]},command()).reason,
 'PF_COMBAT_RECORD_CORRUPT');
});
