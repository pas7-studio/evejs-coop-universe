import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {assertRoster,admitAssignment,transition,validateOperationReplay} =
  require('../scripts/lib/personal-fleet-contract.cjs');
const ship=(o={})=>({assignmentID:'pf-a1',pilotID:'coop-pilot-001',
  shipItemID:500,ownerCharacterID:90,state:'RESERVED',generation:1,revision:0,...o});
const admit=(overrides={})=>admitAssignment({roster:[],candidate:ship(),
  externalClaims:[],expectedFleetRevision:4,actualFleetRevision:4,...overrides});
const proof=(type,more={})=>({type,shipItemID:500,...more});

test('valid single assignment does not mutate source',()=>{
  const x=[ship()];assert.deepEqual(assertRoster(x),{ok:true});
  assert.equal(x[0].state,'RESERVED');
});
test('duplicate pilot across different ships denied',()=>assert.equal(
  assertRoster([ship(),ship({assignmentID:'pf-a2',shipItemID:501})]).reason,
  'PILOT_ALREADY_ASSIGNED'));
test('duplicate ship across different pilots denied',()=>assert.equal(
  assertRoster([ship(),ship({assignmentID:'pf-a2',pilotID:'coop-pilot-002'})]).reason,
  'SHIP_ALREADY_ASSIGNED'));
test('duplicate assignment key denied',()=>assert.equal(
  assertRoster([ship(),ship({pilotID:'coop-pilot-002',shipItemID:502})]).reason,
  'DUPLICATE_ASSIGNMENT_ID'));
test('historical losses do not occupy active slots',()=>assert.equal(
  assertRoster([ship({state:'LOST'}),ship({assignmentID:'pf-a2'})]).ok,true));
test('stale fleet revision fails closed',()=>assert.equal(
  admit({expectedFleetRevision:3}).reason,'STALE_FLEET_REVISION'));
test('missing global claim authority fails closed',()=>assert.equal(
  admit({externalClaims:null}).reason,'CLAIM_SOURCE_UNAVAILABLE'));
test('unknown external claim prevents assignment',()=>assert.equal(
  admit({externalClaims:[{status:'UNKNOWN'}]}).reason,'EXTERNAL_CLAIM_UNVERIFIED'));
test('malformed external claim fails closed',()=>assert.equal(
  admit({externalClaims:[{status:'OTHER',pilotID:'coop-pilot-002',shipItemID:600}]}).reason,
  'EXTERNAL_CLAIM_UNVERIFIED'));
test('WAR/mining claim for same pilot blocks assignment',()=>assert.equal(
  admit({externalClaims:[{status:'ACTIVE',pilotID:'coop-pilot-001',shipItemID:999,owner:'WAR'}]}).reason,
  'PILOT_ALREADY_ASSIGNED'));
test('external claim for ship with different pilot blocks assignment',()=>assert.equal(
  admit({externalClaims:[{status:'ACTIVE',pilotID:'coop-pilot-002',shipItemID:500,owner:'WAR'}]}).reason,
  'SHIP_ALREADY_ASSIGNED'));
test('candidate must be valid and RESERVED',()=>assert.equal(
  admit({candidate:ship({state:'ACTIVE'})}).reason,'INVALID_CANDIDATE'));
test('RESERVED -> DEPLOYING requires native intent receipt',()=>{
  const base={assignment:ship(),to:'DEPLOYING',expectedRevision:0,expectedGeneration:1};
  assert.equal(transition({...base,evidence:null}).reason,'NATIVE_EVIDENCE_REQUIRED');
  const yes=transition({...base,evidence:proof('NATIVE_DEPLOY_INTENT_DURABLE')});
  assert.equal(yes.ok,true);assert.equal(yes.value.revision,1);
  assert.equal(yes.value.state,'DEPLOYING');
});
test('DEPLOYING -> ACTIVE verifies exact original ship identity',()=>{
  const base={assignment:ship({state:'DEPLOYING'}),to:'ACTIVE',
    expectedRevision:0,expectedGeneration:1};
  assert.equal(transition({...base,evidence:proof('NATIVE_ENTITY_AND_CONTROLLER_VERIFIED',
    {shipItemID:600})}).reason,'NATIVE_EVIDENCE_REQUIRED');
  assert.equal(transition({...base,evidence:proof('NATIVE_ENTITY_AND_CONTROLLER_VERIFIED')}).ok,true);
});
test('stale revision and generation reject delayed callbacks',()=>{
  const base={assignment:ship({state:'ACTIVE',revision:8,generation:4}),
    to:'RETURNING',evidence:proof('NATIVE_RETURN_ORDER_ACCEPTED')};
  assert.equal(transition({...base,expectedRevision:7,expectedGeneration:4}).reason,
    'STALE_ASSIGNMENT_FENCE');
  assert.equal(transition({...base,expectedRevision:8,expectedGeneration:3}).reason,
    'STALE_ASSIGNMENT_FENCE');
});
test('cannot dock from active or bypass station arrival',()=>{
  assert.equal(transition({assignment:ship({state:'ACTIVE'}),to:'HANGAR',
    expectedRevision:0,expectedGeneration:1,
    evidence:proof('NATIVE_ITEM_CUSTODY_VERIFIED')}).reason,'ILLEGAL_TRANSITION');
  assert.equal(transition({assignment:ship({state:'RETURNING'}),to:'DOCKING',
    expectedRevision:0,expectedGeneration:1,
    evidence:proof('NATIVE_RETURN_ORDER_ACCEPTED')}).reason,'NATIVE_EVIDENCE_REQUIRED');
});
test('loss requires original wreck and system, and cannot be resurrected',()=>{
  const base={assignment:ship({state:'ACTIVE'}),to:'LOST',
    expectedRevision:0,expectedGeneration:1};
  assert.equal(transition({...base,evidence:proof('NATIVE_WRECK_AND_LOSS_VERIFIED')}).reason,
    'WRECK_IDENTITY_REQUIRED');
  assert.equal(transition({...base,evidence:proof('NATIVE_WRECK_AND_LOSS_VERIFIED',
    {wreckID:700,systemID:30000144})}).ok,true);
  assert.equal(transition({assignment:ship({state:'LOST'}),to:'ACTIVE',
    expectedRevision:0,expectedGeneration:1,
    evidence:proof('NATIVE_ENTITY_AND_CONTROLLER_VERIFIED')}).reason,'ILLEGAL_TRANSITION');
});
test('ambiguous outcome needs original matching reconciliation evidence',()=>{
  const base={assignment:ship({state:'OUTCOME_UNKNOWN'}),to:'ACTIVE',
    expectedRevision:0,expectedGeneration:1};
  assert.equal(transition({...base,evidence:proof('NATIVE_ENTITY_AND_CONTROLLER_VERIFIED')}).reason,
    'RECONCILIATION_PROOF_REQUIRED');
  assert.equal(transition({...base,evidence:proof('RECONCILED_NATIVE_ORIGINAL',
    {assignmentID:'pf-a1',resolvedState:'HANGAR'})}).reason,'RECONCILIATION_PROOF_REQUIRED');
  assert.equal(transition({...base,evidence:proof('RECONCILED_NATIVE_ORIGINAL',
    {assignmentID:'pf-a1',resolvedState:'ACTIVE'})}).ok,true);
});
test('operation dedupe exact and rejects ambiguous/changed payload',()=>{
  const operationID='pf-op-01',payloadHash='a'.repeat(64);
  const base={operationID,payloadHash,state:'COMMITTED'};
  assert.deepEqual(validateOperationReplay({existing:null,operationID,payloadHash}),
    {ok:true,action:'NEW'});
  assert.equal(validateOperationReplay({existing:base,operationID,payloadHash}).action,
    'REPLAY_COMMITTED');
  assert.equal(validateOperationReplay({existing:{...base,payloadHash:'b'.repeat(64)},
    operationID,payloadHash}).reason,'OPERATION_ID_REUSED');
  assert.equal(validateOperationReplay({existing:{...base,state:'OUTCOME_UNKNOWN'},
    operationID,payloadHash}).reason,'OPERATION_RECONCILIATION_REQUIRED');
});
