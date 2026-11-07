"use strict";
// PF-51. Durable admission barrier for ORIGINAL native ALIFE08 fleet startup.
// INERT unless explicitly wired by the authoritative EveJS process.
// It does not spawn, restore, move, mint, or destroy any native actor.
const {randomUUID}=require("node:crypto");
const TABLE="corporationRuntime", SEP="\u001f";
const CLAIMS="coop-personal-fleet"+SEP+"actor-claims-v1";
const WAR="coop-faction-war"+SEP+"fleet-registry-v1";
const SHUTDOWN="coop-personal-fleet"+SEP+"mining-shutdown-v1"+SEP;
const ADMISSION="coop-personal-fleet"+SEP+"mining-startup-admission-v1"+SEP;
const pos=x=>Number.isSafeInteger(x)&&x>0;
const obj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const token=x=>typeof x==="string"&&/^[a-zA-Z0-9._:-]{12,160}$/.test(x);
const operation=x=>typeof x==="string"&&/^[a-zA-Z0-9._:-]{8,160}$/.test(x);
const denied=x=>Object.freeze({status:"BLOCKED",reason:"PF51_"+x});
const read=(tx,key)=>{const v=tx.get(TABLE,key);if(v===undefined)throw Error("READ_UNCERTAIN");return v;};
const own=(x,k)=>Object.prototype.hasOwnProperty.call(x,k);
const asID=x=>pos(Number(x))&&String(Number(x))===x;
function assertClaims(v,systemID){
 if(!obj(v)||v.version!==1||!obj(v.claims)||!obj(v.generations)||!obj(v.processed)||
   Object.keys(v.claims).length>128||Object.keys(v.generations).length>1024||
   Object.keys(v.processed).length>1024)throw Error("PF_CLAIMS_UNVERIFIED");
 const pilots=new Set();
 for(const [id,g] of Object.entries(v.generations))if(!asID(id)||!pos(g))throw Error("PF_GENERATIONS_CORRUPT");
 for(const [id,c] of Object.entries(v.claims)){
  if(!asID(id)||!obj(c)||c.entityID!==Number(id)||!pos(c.systemID)||
    c.ownerType!=="PERSONAL_FLEET"||!pos(c.ownerCharacterID)||
    !pos(c.generation)||v.generations[id]<c.generation||
    typeof c.pilotID!=="string"||!/^coop-pilot-[0-9]{3,}$/.test(c.pilotID)||
    pilots.has(c.pilotID)||typeof c.assignmentID!=="string"||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(c.assignmentID))throw Error("PF_CLAIM_CORRUPT");
  pilots.add(c.pilotID);
  // No actor-list is yet available before a fresh ALIFE08 spawn. Conservatively
  // reject ANY PF owner in this system until per-actor unified writer coverage.
  if(c.systemID===systemID)throw Error("PF_ACTOR_IN_SYSTEM");
 }
 for(const [id,r] of Object.entries(v.processed))
  if(!operation(id)||!obj(r)||typeof r.signature!=="string"||!obj(r.receipt))
   throw Error("PF_RECEIPT_CORRUPT");
}
function assertWar(v,systemID){
 if(v===null)return; // only if WAR writer integration is independently proven
 if(!obj(v)||v.version!==1||!obj(v.ships)||
   (v.transfers!==undefined&&!obj(v.transfers))||
   Object.keys(v.ships).length>256||Object.keys(v.transfers||{}).length>128)
  throw Error("WAR_UNVERIFIED");
 for(const [kind,group] of [["SHIP",v.ships],["TRANSFER",v.transfers||{}]])
  for(const [id,c] of Object.entries(group)){
   if(!asID(id)||!obj(c)||c.entityID!==Number(id)||
     typeof c.pilotID!=="string"||!/^coop-pilot-[0-9]{3,}$/.test(c.pilotID))
    throw Error("WAR_CORRUPT");
   // Unknown location is NOT proof that a WAR ship cannot collide with a
   // freshly spawned mining ship (transfers may span two systems).
   if(kind==="SHIP"&&!pos(c.systemID))throw Error("WAR_LOCATION_UNPROVEN");
   if(kind==="TRANSFER"&&(!pos(c.sourceSystemID)||!pos(c.destinationSystemID)))
    throw Error("WAR_TRANSFER_LOCATION_UNPROVEN");
   if(c.systemID===systemID||c.sourceSystemID===systemID||
      c.destinationSystemID===systemID)throw Error("WAR_ACTOR_IN_SYSTEM");
  }
}
function assertGate(v,systemID,lease){
 // PF44 STARTING is acquired BEFORE the first original NPC spawn. PF46's
 // shutdown gate is only activated AFTER PF44 moves to ACTIVE. Thus requiring
 // a fictitious PF46 STARTING state would deadlock legitimate startup.
 if(lease.state==="STARTING"){
  if(v===null)return; // original GameStore confirms absence, not undefined
  if(!obj(v)||v.version!==1||v.systemID!==systemID||
     v.gate!==null||!obj(v.permits)||Object.keys(v.permits).length!==0)
   throw Error("STARTING_HAS_FOREIGN_SHUTDOWN_GATE");
  return;
 }
 if(!obj(v)||v.version!==1||v.systemID!==systemID||
    !obj(v.gate)||v.gate.systemID!==systemID||
    v.gate.state!=="ACTIVE"||v.gate.stopPhase!=="NONE"||
    !token(v.gate.leaseToken)||v.gate.leaseToken!==lease.token||
    !Array.isArray(v.gate.writerNames)||
    !v.gate.writerNames.includes("mining_startup")||
    new Set(v.gate.writerNames).size!==v.gate.writerNames.length||
    !obj(v.permits)||Object.keys(v.permits).length>8192)
  throw Error("STARTUP_GATE_UNVERIFIED");
 // An unacknowledged cargo/hauling receipt means boot must not touch actors.
 for(const [id,p] of Object.entries(v.permits)){
  if(!obj(p)||p.operationID!==id||p.systemID!==systemID||
     !["PENDING","ACKED"].includes(p.state)||!token(p.leaseToken)||
     p.leaseToken!==lease.token)throw Error("WRITE_PERMIT_CORRUPT");
  if(p.state==="PENDING")throw Error("INFLIGHT_NATIVE_WRITE");
 }
}
function validateEvidence(e,systemID,fleetCount){
 if(!obj(e)||e.version!==1||e.status!=="VERIFIED"||e.systemID!==systemID||
    !Array.isArray(e.slots)||e.slots.length!==fleetCount||e.slots.length>16)
  throw Error("NATIVE_EVIDENCE_UNVERIFIED");
 const all=new Set(),slotIDs=new Set();
 for(const x of e.slots){
  if(!obj(x)||!pos(x.slot)||x.slot>fleetCount||slotIDs.has(x.slot)||
     !Array.isArray(x.miners)||!Array.isArray(x.haulers)||
     !x.miners.length||!x.haulers.length||
     x.miners.length+x.haulers.length>32||
     !/^[a-f0-9]{64}$/.test(x.originalEntityHash)||
     !/^[a-f0-9]{64}$/.test(x.originalControllerHash)||
     !/^[a-f0-9]{64}$/.test(x.originalCargoHash))throw Error("NATIVE_EVIDENCE_INVALID");
  slotIDs.add(x.slot);
  for(const id of [...x.miners,...x.haulers]){
   if(!pos(id)||all.has(id))throw Error("DUPLICATE_NATIVE_SHIP");
   all.add(id);
  }
 }
 return structuredClone(e);
}
function createStartupFence({gameStore,readMiningLease,verifyOriginalPreflight,
 verifyNativeStartup,writersIntegrated=()=>false,enabled=()=>false,
 clock=()=>Date.now()}={}){
 const authority=gameStore?.coopAtomicNativeRows;
 if(typeof authority?.transact!=="function"||typeof authority.isPoisoned!=="function"||
    [readMiningLease,verifyOriginalPreflight,verifyNativeStartup,writersIntegrated,enabled,clock]
     .some(x=>typeof x!=="function"))throw Error("PF51_AUTHORITIES_REQUIRED");
 const execute=mutate=>{
  if(enabled()!==true)return {status:"DISABLED"};
  if(writersIntegrated()!==true)return denied("RECIPROCAL_WRITERS_UNPROVEN");
  if(authority.isPoisoned())return denied("GAMESTORE_POISONED");
  try{
   const out=authority.transact([TABLE],mutate);
   return out?.result&&out.status===undefined?out.result:out;
  }catch(e){return denied(e?.coopCommitOutcomeUnknown===true?
   "COMMIT_OUTCOME_UNKNOWN":String(e?.message||"NATIVE_TX_FAILED").slice(0,120));}
 };
 const leaseAndClaims=(tx,systemID)=>{
  assertClaims(read(tx,CLAIMS),systemID);
  assertWar(read(tx,WAR),systemID);
  const lease=readMiningLease(tx,systemID);
  if(!obj(lease)||lease.systemID!==systemID||
     !["STARTING","ACTIVE"].includes(lease.state)||!token(lease.token))
   throw Error("PF44_LEASE_UNPROVEN");
  assertGate(read(tx,SHUTDOWN+systemID),systemID,lease);
  return lease;
 };
 function admit({systemID,fleetCount,operationID=randomUUID()}={}){
  if(!pos(systemID)||!Number.isInteger(fleetCount)||fleetCount<0||fleetCount>16||
     !operation(operationID))return denied("COMMAND_INVALID");
  return execute(tx=>{
   const lease=leaseAndClaims(tx,systemID);
   const key=ADMISSION+systemID;
   const previous=read(tx,key);
   // No TTL reclaim. In-flight ambiguity needs an independent reconcile.
   if(previous!==null){
    if(!obj(previous)||previous.version!==1||previous.systemID!==systemID||
       !["IN_FLIGHT","VERIFIED"].includes(previous.state))
      return denied("STARTUP_RECORD_CORRUPT");
    return denied(previous.state==="IN_FLIGHT"?
      "STARTUP_OUTCOME_UNKNOWN":"PRIOR_STARTUP_REQUIRES_HANDOVER");
   }
   if(verifyOriginalPreflight({tx,systemID,fleetCount,lease})!==true)
    return denied("ORIGINAL_PREFLIGHT_NOT_PROVEN");
   const createdAt=clock();if(!pos(createdAt))return denied("CLOCK_INVALID");
   const record={version:1,state:"IN_FLIGHT",systemID,fleetCount,operationID,
    leaseToken:lease.token,createdAt,completedAt:null,evidence:null};
   tx.put(TABLE,key,record);
   return {status:"ADMITTED",operationID,systemID,leaseToken:lease.token};
  });
 }
 function finish({systemID,operationID}={}){
  if(!pos(systemID)||!operation(operationID))return denied("COMMAND_INVALID");
  return execute(tx=>{
   const lease=leaseAndClaims(tx,systemID);
   const key=ADMISSION+systemID,r=read(tx,key);
   if(!obj(r)||r.version!==1||r.systemID!==systemID||
     r.operationID!==operationID||r.leaseToken!==lease.token)
    return denied("STARTUP_RECEIPT_NOT_FOUND");
   if(r.state==="VERIFIED")return {status:"VERIFIED",operationID,replayed:true};
   if(r.state!=="IN_FLIGHT")return denied("STARTUP_STATE_INVALID");
   const evidence=validateEvidence(verifyNativeStartup({tx,systemID,
     fleetCount:r.fleetCount,operationID,lease}),systemID,r.fleetCount);
   const completedAt=clock();if(!pos(completedAt))return denied("CLOCK_INVALID");
   tx.put(TABLE,key,{...r,state:"VERIFIED",completedAt,evidence});
   return {status:"VERIFIED",operationID,evidence};
  });
 }
 // Crash recovery never spawns or attaches a ship; it ONLY observes persisted
 // original authorities and can turn a proven in-flight receipt into VERIFIED.
 function reconcile({systemID}={}){
  if(!pos(systemID))return denied("COMMAND_INVALID");
  return execute(tx=>{
   const lease=leaseAndClaims(tx,systemID);
   const key=ADMISSION+systemID,r=read(tx,key);
   if(!obj(r)||r.version!==1||r.systemID!==systemID||
      r.leaseToken!==lease.token||!operation(r.operationID))
    return denied("STARTUP_RECONCILE_UNVERIFIED");
   if(r.state==="VERIFIED")return {status:"VERIFIED",operationID:r.operationID,replayed:true};
   if(r.state!=="IN_FLIGHT")return denied("STARTUP_RECONCILE_STATE_INVALID");
   const evidence=validateEvidence(verifyNativeStartup({tx,systemID,
     fleetCount:r.fleetCount,operationID:r.operationID,lease}),systemID,r.fleetCount);
   const completedAt=clock();if(!pos(completedAt))return denied("CLOCK_INVALID");
   tx.put(TABLE,key,{...r,state:"VERIFIED",completedAt,evidence});
   return {status:"VERIFIED",operationID:r.operationID,evidence,reconciled:true};
  });
 }
 return Object.freeze({admit,finish,reconcile});
}
module.exports={createStartupFence,CLAIMS,WAR,SHUTDOWN,ADMISSION,validateEvidence};