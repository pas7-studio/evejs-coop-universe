"use strict";
// A single optional synchronously arbitrated owner for named native NPC orders.
// Native EveJS remains authoritative; this does not spawn, attack or move ships.
const named = value => typeof value === "string" && /^coop-pilot-[0-9]{3,}$/.test(value);
const id = value => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;
const OWNERS = new Set(["RAID","TACTICS","GATE","PATROL","CIVILIAN"]);
function createOrderArbiter({clock = () => Date.now(), leaseMs = 120000, maxEntries = 512} = {}) {
 if(typeof clock !== "function" || !Number.isSafeInteger(leaseMs) || leaseMs < 10000 ||
   leaseMs > 600000 || !Number.isSafeInteger(maxEntries) || maxEntries < 1 ||
   maxEntries > 10000) throw Error("INVALID_ORDER_ARBITER_CONFIG");
 const leases = new Map();
 let denied = 0, ambiguous = 0, completed = 0;
 const keyFor = (systemID,entityID) => systemID + ":" + entityID;
 function active(key) {
  const lease = leases.get(key);
  if(!lease) return null;
  if(lease.phase === "OUTCOME_UNKNOWN") return lease;
  if(clock() >= lease.expiresAt) {leases.delete(key);return null;}
  return lease;
 }
 function eligible(existing,pilotID,owner) {
  if(!existing) return true;
  if(existing.phase === "OUTCOME_UNKNOWN") return false;
  if(existing.pilotID !== pilotID) return false;
  if(existing.owner === owner) return true;
  // Only the genuinely emergency-capable native tactics director can preempt.
  return owner === "TACTICS";
 }
 function blocked({systemID,entityID,pilotID,owner}={}) {
  if(!id(systemID)||!id(entityID)||!named(pilotID)||!OWNERS.has(owner)) return true;
  return !eligible(active(keyFor(Number(systemID),Number(entityID))),pilotID,owner);
 }
 function blocksForSystem(systemID,owner) {
  const result = new Set();
  if(!id(systemID)||!OWNERS.has(owner)) return result;
  for(const key of [...leases.keys()]) {
   const record = active(key);
   if(record && record.systemID === Number(systemID) && !eligible(record,record.pilotID,owner))
    result.add(record.entityID);
  }
  return result;
 }
 function issue({systemID,entityID,pilotID,owner,action,execute,verify,
   holdMs=leaseMs} = {}) {
  if(!id(systemID)||!id(entityID)||!named(pilotID)||!OWNERS.has(owner) ||
    typeof execute !== "function" || typeof verify !== "function" ||
    typeof action !== "string" || !/^[a-z][a-z-]{1,35}$/.test(action) ||
    !Number.isSafeInteger(holdMs) || holdMs < 10000 || holdMs > 600000)
    return {success:false,errorMsg:"COOP_NPC_ORDER_INVALID"};
  const system=Number(systemID),ship=Number(entityID),key=keyFor(system,ship);
  const before = active(key),now=clock();
  if(!Number.isSafeInteger(now) || now < 0)
   return {success:false,errorMsg:"COOP_NPC_ORDER_CLOCK_INVALID"};
  if(!eligible(before,pilotID,owner)){
   denied++;
   return {success:false,errorMsg:before?.phase==="OUTCOME_UNKNOWN"
    ?"COOP_NPC_ORDER_REPAIR_REQUIRED":"COOP_NPC_ORDER_LEASED"};
  }
  if(!before && leases.size >= maxEntries){
   // Expired leases are safe to prune; never erase an unknown-outcome fence.
   for(const other of [...leases.keys()]) active(other);
   if(leases.size >= maxEntries)return {success:false,errorMsg:"COOP_NPC_ORDER_CAP_REACHED"};
  }
  // The actual physical ship/controller must still match immediately before
  // executing. verify is mandatory and supplied by native runtime, not a flag.
  let confirmed = false;
  try { confirmed = verify() === true; } catch (_error) {confirmed=false;}
  if(!confirmed)return {success:false,errorMsg:"COOP_NPC_ORDER_NATIVE_PROOF_MISSING"};
  let result;
  try { result=execute(); }
  catch (error) {
   leases.set(key,{systemID:system,entityID:ship,pilotID,owner,action,
    phase:"OUTCOME_UNKNOWN",since:now,expiresAt:null});
   ambiguous++;
   return {success:false,errorMsg:"COOP_NPC_ORDER_REPAIR_REQUIRED"};
  }
  if(!result || typeof result !== "object" || typeof result.then === "function"){
   leases.set(key,{systemID:system,entityID:ship,pilotID,owner,action,
    phase:"OUTCOME_UNKNOWN",since:now,expiresAt:null});
   ambiguous++;
   return {success:false,errorMsg:"COOP_NPC_ORDER_REPAIR_REQUIRED"};
  }
  if(result.success!==true)return result;
  leases.set(key,{systemID:system,entityID:ship,pilotID,owner,action,
   phase:"ACTIVE",since:now,expiresAt:now+holdMs});
  completed++;
  return result;
 }
 function clearWithNativeProof({systemID,entityID,pilotID,owner,
   controllerIdle=false,shipAbsent=false}={}) {
  if(!id(systemID)||!id(entityID)||!named(pilotID)||!OWNERS.has(owner))
   return {status:"INVALID"};
  const key=keyFor(Number(systemID),Number(entityID)),entry=active(key);
  if(!entry)return {status:"NO_LEASE"};
  if(entry.pilotID!==pilotID||entry.owner!==owner)
   return {status:"WRONG_OWNER"};
  if(entry.phase==="OUTCOME_UNKNOWN")
   return {status:"NEEDS_OPERATOR_REPAIR"};
  if(controllerIdle!==true&&shipAbsent!==true)
   return {status:"PROOF_REQUIRED"};
  leases.delete(key);return {status:"RELEASED"};
 }
 function snapshot(){
  return {leases:[...leases.values()].map(x=>({...x})),
   counters:{denied,ambiguous,completed}};
 }
 return {issue,blocked,blocksForSystem,clearWithNativeProof,snapshot};
}
module.exports={createOrderArbiter};
