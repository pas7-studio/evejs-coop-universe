"use strict";
// PF-49 source candidate; fail closed. Only invoked from original ALIFE-07
// miningRuntimeState + npcCargo + corporationRuntime SQLite transaction.
// This module never spawns, mines, transfers items or releases a ship.
const TABLE = "corporationRuntime", SEP = "\u001f";
const CLAIMS = "coop-personal-fleet" + SEP + "actor-claims-v1";
const SHUTDOWN = "coop-personal-fleet" + SEP + "mining-shutdown-v1" + SEP;
const PERMIT = "coop-personal-fleet" + SEP + "mining-write-v1" + SEP;
const WAR = "coop-faction-war" + SEP + "fleet-registry-v1";
const pos = n => Number.isSafeInteger(n) && n > 0;
const record = v => v && typeof v === "object" && !Array.isArray(v);
const own = (v, k) => Object.prototype.hasOwnProperty.call(v, k);
const token = v => typeof v === "string" && /^[A-Za-z0-9._:-]{12,160}$/.test(v);
const pilot = v => typeof v === "string" && /^coop-pilot-[0-9]{3,}$/.test(v);
function reject(reason) { throw Error("PF49_" + reason); }
function requireThat(v, reason) { if(!v) reject(reason); }
function canonicalKeys(v, limit) {
  requireThat(record(v) && Object.keys(v).length <= limit, "STATE_CAP_OR_SHAPE_INVALID");
  return Object.keys(v);
}
function validateClaims(claims, systemID, shipID) {
  requireThat(record(claims) && claims.version===1 && record(claims.claims) &&
    record(claims.generations) && record(claims.processed), "CLAIMS_UNPROVEN");
  const generations=canonicalKeys(claims.generations,1024);
  canonicalKeys(claims.processed,1024);
  for(const id of generations)
    requireThat(pos(Number(id)) && String(Number(id))===id && pos(claims.generations[id]),
      "CLAIM_GENERATION_CORRUPT");
  const seenPilots=new Set();
  for(const id of canonicalKeys(claims.claims,128)){
    const c=claims.claims[id];
    requireThat(pos(Number(id)) && String(Number(id))===id && record(c) &&
      c.entityID===Number(id) && pilot(c.pilotID) && !seenPilots.has(c.pilotID) &&
      pos(c.systemID) && pos(c.ownerCharacterID) && pos(c.generation) &&
      c.generation<=claims.generations[id] && c.ownerType==="PERSONAL_FLEET" &&
      typeof c.assignmentID==="string" && c.assignmentID.length>0,
      "CLAIM_CORRUPT");
    seenPilots.add(c.pilotID);
    requireThat(c.systemID!==systemID && c.entityID!==shipID, "PERSONAL_FLEET_ACTOR_RESERVED");
  }
  for(const id of Object.keys(claims.processed)){
    const p=claims.processed[id];
    requireThat(/^[A-Za-z0-9._:-]{1,128}$/.test(id) && record(p) &&
      typeof p.signature==="string" && record(p.receipt), "CLAIM_RECEIPT_CORRUPT");
  }
}
function validateWar(war, shipID) {
  // No WAR row is permitted only because the shared WAR writer must have been
  // independently integrated. This is not a claim that absence proves coverage.
  if(war===null)return;
  requireThat(record(war) && war.version===1 && record(war.ships) &&
    (war.transfers===undefined || record(war.transfers)), "WAR_ROW_CORRUPT");
  for(const entries of [war.ships,war.transfers||{}]){
    for(const id of canonicalKeys(entries,256)){
      const v=entries[id];
      requireThat(pos(Number(id)) && String(Number(id))===id && record(v) &&
        v.entityID===Number(id) && pilot(v.pilotID), "WAR_SHIP_CORRUPT");
      requireThat(v.entityID!==shipID,"WAR_SHIP_RESERVED");
    }
  }
}
/**
 * readLease MUST be an ORIGINAL PF-44 reader bound to `tx` and validate its
 * own canonical row. Without that callback there is no path to allow a write.
 * Running this function inside a separate read transaction is INVALID.
 */
function assertMiningWriteAuthorized(tx, {systemID,shipID,opKey}={}, readLease=null){
  requireThat(record(tx) && typeof tx.get==="function", "ATOMIC_TX_MISSING");
  requireThat(pos(systemID) && pos(shipID) && typeof opKey==="string" &&
    /^coopMiningCycle:[a-f0-9]{64}$/.test(opKey), "SCOPE_INVALID");
  requireThat(typeof readLease==="function", "PF44_LEASE_READER_UNBOUND");
  const get = key => {
    let v;
    try{v=tx.get(TABLE,key);}catch(_e){reject("ATOMIC_ROW_UNAVAILABLE");}
    requireThat(v!==undefined,"ATOMIC_ROW_UNCERTAIN");
    return v;
  };
  const claims=get(CLAIMS);
  validateClaims(claims,systemID,shipID);
  validateWar(get(WAR),shipID);
  const state=get(SHUTDOWN+systemID);
  requireThat(record(state) && state.version===1 && state.systemID===systemID &&
    record(state.gate) && state.gate.systemID===systemID &&
    record(state.permits) && Object.keys(state.permits).length<=8192,
    "GATE_UNPROVEN");
  const gate=state.gate;
  requireThat(gate.state==="ACTIVE" && gate.stopPhase==="NONE" &&
    token(gate.leaseToken) && Array.isArray(gate.writerNames) &&
    gate.writerNames.includes("mining_cycle") &&
    new Set(gate.writerNames).size===gate.writerNames.length,
    "MINING_GATE_NOT_ACTIVE");
  let lease;
  try{lease=readLease(tx,systemID);}catch(_e){reject("PF44_LEASE_READ_FAILED");}
  requireThat(record(lease) && lease.systemID===systemID && lease.state==="ACTIVE" &&
    lease.token===gate.leaseToken,"PF44_ACTIVE_LEASE_UNPROVEN");
  const permit=get(PERMIT+opKey);
  requireThat(record(permit) && permit.operationID===opKey &&
    permit.systemID===systemID && permit.leaseToken===lease.token &&
    permit.writer==="mining_cycle" && permit.state==="PENDING" &&
    permit.attemptID===null && record(state.permits[opKey]) &&
    JSON.stringify(state.permits[opKey])===JSON.stringify(permit),
    "MINING_WRITE_PERMIT_UNPROVEN");
  // Pure read-only validation; exactly the same serialized transaction must
  // commit the original miningRuntimeState + npcCargo side effects afterwards.
  return true;
}
module.exports={assertMiningWriteAuthorized, CLAIMS, SHUTDOWN, PERMIT, WAR};