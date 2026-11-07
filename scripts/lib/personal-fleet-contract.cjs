'use strict';
// PF-00 portable pure policy/reference kernel. This module does not read/write
// GameStore or authorize native actions. Port to the engine fork after
// authoritative native contracts are verified.
const PILOT = /^coop-pilot-[0-9]{3,}$/;
const ID = x => Number.isSafeInteger(x) && x > 0;
const TOKEN = x => typeof x === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(x);
const STATES = new Set(['HANGAR','RESERVED','DEPLOYING','ACTIVE','RETURNING','DOCKING','LOST','OUTCOME_UNKNOWN']);
const TRANSITIONS = Object.freeze({
  HANGAR: ['RESERVED'], RESERVED: ['DEPLOYING','HANGAR'],
  DEPLOYING: ['ACTIVE','OUTCOME_UNKNOWN'],
  ACTIVE: ['RETURNING','LOST','OUTCOME_UNKNOWN'],
  RETURNING: ['DOCKING','LOST','OUTCOME_UNKNOWN'],
  DOCKING: ['HANGAR','LOST','OUTCOME_UNKNOWN'],
  OUTCOME_UNKNOWN: ['RESERVED','DEPLOYING','ACTIVE','RETURNING','DOCKING','HANGAR','LOST'],
  LOST: [],
});
const REQUIRED = Object.freeze({
  RESERVED: 'ATOMIC_CUSTODY_RESERVED', DEPLOYING: 'NATIVE_DEPLOY_INTENT_DURABLE',
  ACTIVE: 'NATIVE_ENTITY_AND_CONTROLLER_VERIFIED',
  RETURNING: 'NATIVE_RETURN_ORDER_ACCEPTED',
  DOCKING: 'NATIVE_STATION_ARRIVAL_VERIFIED',
  HANGAR: 'NATIVE_ITEM_CUSTODY_VERIFIED',
  LOST: 'NATIVE_WRECK_AND_LOSS_VERIFIED',
});
const deny = reason => ({ok:false,reason});
function validAssignment(a) {
  return !!a && TOKEN(a.assignmentID) && PILOT.test(a.pilotID) &&
    ID(a.shipItemID) && ID(a.ownerCharacterID) &&
    STATES.has(a.state) && ID(a.generation) &&
    Number.isSafeInteger(a.revision) && a.revision >= 0;
}
function assertRoster(rows) {
  if (!Array.isArray(rows) || rows.length > 256) return deny('INVALID_ROSTER');
  const pilots = new Set(), ships = new Set(), assignments = new Set();
  for (const row of rows) {
    if (!validAssignment(row)) return deny('INVALID_ASSIGNMENT');
    if (assignments.has(row.assignmentID)) return deny('DUPLICATE_ASSIGNMENT_ID');
    assignments.add(row.assignmentID);
    if (row.state === 'LOST') continue; // historical loss is not an active claim
    if (pilots.has(row.pilotID)) return deny('PILOT_ALREADY_ASSIGNED');
    if (ships.has(row.shipItemID)) return deny('SHIP_ALREADY_ASSIGNED');
    pilots.add(row.pilotID); ships.add(row.shipItemID);
  }
  return {ok:true};
}
function admitAssignment({roster,candidate,externalClaims,expectedFleetRevision,actualFleetRevision}) {
  if (!Number.isSafeInteger(expectedFleetRevision) || expectedFleetRevision < 0 ||
    expectedFleetRevision !== actualFleetRevision) return deny('STALE_FLEET_REVISION');
  const local = assertRoster(roster);
  if (!local.ok) return local;
  if (!validAssignment(candidate) || candidate.state !== 'RESERVED') return deny('INVALID_CANDIDATE');
  if (!Array.isArray(externalClaims)) return deny('CLAIM_SOURCE_UNAVAILABLE');
  if (externalClaims.some(c => !c || !['ACTIVE','RELEASED'].includes(c.status) ||
    (c.status === 'ACTIVE' && (!PILOT.test(c.pilotID) || !ID(c.shipItemID)))))
    return deny('EXTERNAL_CLAIM_UNVERIFIED');
  for (const row of [...roster,...externalClaims.filter(c => c.status === 'ACTIVE')]) {
    if (row.state === 'LOST') continue;
    if (row.pilotID === candidate.pilotID) return deny('PILOT_ALREADY_ASSIGNED');
    if (row.shipItemID === candidate.shipItemID) return deny('SHIP_ALREADY_ASSIGNED');
  }
  return {ok:true}; // advisory only: revalidate in the authoritative atomic transaction
}
function transition({assignment,to,expectedRevision,expectedGeneration,evidence}) {
  if (!validAssignment(assignment)) return deny('INVALID_ASSIGNMENT');
  if (assignment.revision !== expectedRevision || assignment.generation !== expectedGeneration)
    return deny('STALE_ASSIGNMENT_FENCE');
  if (!STATES.has(to) || !TRANSITIONS[assignment.state].includes(to))
    return deny('ILLEGAL_TRANSITION');
  if (assignment.state === 'OUTCOME_UNKNOWN') {
    if (evidence?.type !== 'RECONCILED_NATIVE_ORIGINAL' ||
      evidence?.resolvedState !== to ||
      evidence?.shipItemID !== assignment.shipItemID ||
      evidence?.assignmentID !== assignment.assignmentID)
      return deny('RECONCILIATION_PROOF_REQUIRED');
  } else if (REQUIRED[to] && (evidence?.type !== REQUIRED[to] ||
    evidence?.shipItemID !== assignment.shipItemID)) {
    return deny('NATIVE_EVIDENCE_REQUIRED');
  }
  if (to === 'LOST' && !(ID(evidence.wreckID) && ID(evidence.systemID)))
    return deny('WRECK_IDENTITY_REQUIRED');
  return {ok:true,value:Object.freeze({...assignment,state:to,revision:assignment.revision+1})};
}
function validateOperationReplay({existing,operationID,payloadHash}) {
  if (!TOKEN(operationID) || typeof payloadHash !== 'string' || !/^[a-f0-9]{64}$/.test(payloadHash))
    return deny('INVALID_OPERATION_KEY');
  if (existing == null) return {ok:true,action:'NEW'};
  if (existing.operationID !== operationID || existing.payloadHash !== payloadHash)
    return deny('OPERATION_ID_REUSED');
  if (existing.state === 'OUTCOME_UNKNOWN' || existing.state === 'ISSUING')
    return deny('OPERATION_RECONCILIATION_REQUIRED');
  if (existing.state !== 'COMMITTED') return deny('OPERATION_NOT_FINAL');
  return {ok:true,action:'REPLAY_COMMITTED'};
}
module.exports = {STATES,TRANSITIONS,REQUIRED,validAssignment,assertRoster,admitAssignment,transition,validateOperationReplay};
