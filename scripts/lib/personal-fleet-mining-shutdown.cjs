'use strict';
// PF-46 candidate: fail-closed Mining -> Personal Fleet handoff core.
// This module is NOT a replacement for PF-43..45 and is not a live GameStore adapter.
// All adapter operations MUST access the very same durable GameStore transaction.

const STATES = Object.freeze({ ACTIVE:'ACTIVE', DRAINING:'DRAINING', VERIFYING:'VERIFYING', RELEASED:'RELEASED' });
const positive = n => Number.isSafeInteger(n) && n > 0;
const tokenOK = s => typeof s === 'string' && /^[A-Za-z0-9._:-]{12,160}$/.test(s);
const idOK = s => typeof s === 'string' && /^[A-Za-z0-9._:-]{8,160}$/.test(s);
const fail = code => { const e = new Error(code); e.code = code; throw e; };
const requireBool = (cond, code) => { if (!cond) fail(code); };
const exactSet = (a,b) => Array.isArray(a) && a.length === b.length &&
  new Set(a).size === b.length && b.every(v => a.includes(v));

/**
 * tx interface (all functions sync, in ONE BEGIN IMMEDIATE-like transaction):
 *   readLease(systemID), readGate(systemID), writeGate(row),
 *   countPersonalClaims(systemID), readPermit(operationID), writePermit(row),
 *   listPermits(systemID), releaseLease(systemID, leaseToken, witness) -> true.
 *
 * An adapter whose `transact` only serializes in memory is NOT supported.
 * An adapter backed by a second SQLite DB (not the original GameStore) is NOT supported.
 */
function createMiningShutdownProtocol({ transact, nativeStop, verifyNativeStop, nativeAudit, verifyCoverage,
  verifyReceipt, writerNames, now = () => Date.now() } = {}) {
  requireBool(typeof transact === 'function', 'TRANSACTION_ADAPTER_MISSING');
  requireBool(typeof nativeStop === 'function', 'NATIVE_STOP_MISSING');
  requireBool(typeof verifyNativeStop === 'function', 'NATIVE_STOP_VERIFIER_MISSING');
  requireBool(typeof nativeAudit === 'function', 'NATIVE_AUDIT_MISSING');
  requireBool(typeof verifyCoverage === 'function', 'COVERAGE_VERIFIER_MISSING');
  requireBool(typeof verifyReceipt === 'function', 'RECEIPT_VERIFIER_MISSING');
  requireBool(Array.isArray(writerNames) && writerNames.length > 0 &&
    writerNames.every(n => typeof n === 'string' && /^[a-z][a-z0-9_-]{2,48}$/.test(n)) &&
    new Set(writerNames).size === writerNames.length && writerNames.includes('shutdown_cleanup'),
    'WRITER_MANIFEST_INVALID');
  const expected = Object.freeze([...writerNames].sort());
  const time = () => { const t = now(); requireBool(positive(t), 'CLOCK_INVALID'); return t; };
  const validate = (systemID, leaseToken) => {
    requireBool(positive(systemID), 'SYSTEM_ID_INVALID');
    requireBool(tokenOK(leaseToken), 'LEASE_TOKEN_INVALID');
  };
  const readActiveLease = (tx, systemID, leaseToken) => {
    const lease = tx.readLease(systemID);
    requireBool(lease && lease.state === 'ACTIVE' && lease.token === leaseToken, 'LEASE_NOT_OWNED');
    return lease;
  };
  const readGate = (tx, systemID, leaseToken, allowed) => {
    const gate = tx.readGate(systemID);
    requireBool(gate && gate.leaseToken === leaseToken && allowed.includes(gate.state), 'GATE_NOT_OWNED_OR_STATE');
    requireBool(exactSet(gate.writerNames, expected), 'WRITER_MANIFEST_CHANGED');
    requireBool(['NONE','IN_PROGRESS','CONFIRMED'].includes(gate.stopPhase) &&
      (gate.state === STATES.ACTIVE ? gate.stopPhase === 'NONE' : true),
      'STOP_PHASE_CORRUPT');
    return gate;
  };
  const pending = (tx, systemID) => {
    const permits = tx.listPermits(systemID);
    requireBool(Array.isArray(permits), 'PERMIT_SCAN_INCOMPLETE');
    requireBool(permits.every(p => p && (p.state === 'PENDING' || p.state === 'ACKED') &&
      positive(p.systemID) && p.systemID === systemID && idOK(p.operationID) &&
      typeof p.writer === 'string' && expected.includes(p.writer)), 'PERMIT_LEDGER_CORRUPT');
    return permits.filter(p => p.state === 'PENDING');
  };
  const hasClaims = tx => typeof tx.countPersonalClaims === 'function';
  function activate({systemID, leaseToken}) {
    validate(systemID, leaseToken);
    return transact(tx => {
      readActiveLease(tx, systemID, leaseToken);
      requireBool(hasClaims(tx) && tx.countPersonalClaims(systemID) === 0, 'PF_CLAIMS_UNKNOWN_OR_PRESENT');
      const old = tx.readGate(systemID);
      if (old) {
        requireBool(old.state === STATES.ACTIVE && old.leaseToken === leaseToken, 'GATE_ALREADY_EXISTS');
        requireBool(exactSet(old.writerNames, expected), 'WRITER_MANIFEST_CHANGED');
        return {status:'ALREADY_ACTIVE'};
      }
      tx.writeGate({systemID, leaseToken, state:STATES.ACTIVE, attemptID:null, createdAt:time(), witness:null, stopPhase:'NONE', writerNames:[...expected]});
      return {status:'ACTIVE'};
    });
  }
  function beginWrite({systemID, leaseToken, writer, operationID, shutdownAttemptID=null}) {
    validate(systemID, leaseToken);
    requireBool(expected.includes(writer), 'WRITER_NOT_REGISTERED');
    requireBool(idOK(operationID), 'OPERATION_ID_INVALID');
    return transact(tx => {
      readActiveLease(tx, systemID, leaseToken);
      const gate = readGate(tx, systemID, leaseToken, [STATES.ACTIVE, STATES.DRAINING]);
      // Only the shutdown coordinator may perform tracked cleanup while draining.
      if (gate.state === STATES.DRAINING) requireBool(writer === 'shutdown_cleanup' &&
        idOK(shutdownAttemptID) && gate.attemptID === shutdownAttemptID, 'WRITER_FENCED_BY_SHUTDOWN');
      if (gate.state === STATES.ACTIVE) requireBool(writer !== 'shutdown_cleanup' &&
        shutdownAttemptID === null, 'CLEANUP_OUTSIDE_SHUTDOWN');
      const existing = tx.readPermit(operationID);
      requireBool(!existing, 'OPERATION_ID_REUSED');
      tx.writePermit({systemID, leaseToken, writer, operationID, state:'PENDING',
        attemptID: gate.state === STATES.DRAINING ? shutdownAttemptID : null, createdAt:time()});
      return {status:'PENDING', operationID};
    });
  }
  function finishWrite({systemID, leaseToken, operationID, receipt}) {
    validate(systemID, leaseToken);
    requireBool(idOK(operationID), 'OPERATION_ID_INVALID');
    return transact(tx => {
      readActiveLease(tx, systemID, leaseToken);
      readGate(tx, systemID, leaseToken, [STATES.ACTIVE, STATES.DRAINING]);
      const p = tx.readPermit(operationID);
      requireBool(p && p.systemID === systemID && p.leaseToken === leaseToken &&
        p.state === 'PENDING', 'WRITE_PERMIT_NOT_PENDING');
      // Read the trusted native receipt while holding the same serialized lease gate.
      requireBool(verifyReceipt({systemID, operationID, receipt, permit:p, tx}) === true,
        'WRITE_RECEIPT_NOT_PROVEN');
      tx.writePermit({...p, state:'ACKED', completedAt:time()});
      return {status:'ACKED', operationID};
    });
  }
  function beginShutdown({systemID, leaseToken, attemptID}) {
    validate(systemID, leaseToken); requireBool(idOK(attemptID), 'ATTEMPT_ID_INVALID');
    return transact(tx => {
      readActiveLease(tx, systemID, leaseToken);
      const gate = readGate(tx, systemID, leaseToken, [STATES.ACTIVE, STATES.DRAINING, STATES.VERIFYING]);
      if (gate.state !== STATES.ACTIVE) {
        requireBool(gate.attemptID === attemptID, 'SHUTDOWN_ATTEMPT_FENCED');
        return {status:gate.state === STATES.VERIFYING ? 'ALREADY_VERIFYING' : 'ALREADY_DRAINING', attemptID};
      }
      tx.writeGate({...gate, state:STATES.DRAINING, attemptID, stopPhase:'NONE', startedAt:time()});
      return {status:'DRAINING', attemptID};
    });
  }
  // STOP is a physical side effect and must not be called by two concurrent
  // coordinators. Acquiring IN_PROGRESS is a durable single-winner CAS in the
  // original lease transaction. A crash after this claim is OUTCOME_UNKNOWN:
  // only explicit independent native reconciliation may advance it.
  function sealStop(systemID, leaseToken, attemptID) {
    return transact(tx => {
      readActiveLease(tx, systemID, leaseToken);
      const gate = readGate(tx, systemID, leaseToken, [STATES.DRAINING, STATES.VERIFYING]);
      requireBool(gate.attemptID === attemptID, 'SHUTDOWN_ATTEMPT_FENCED');
      if (gate.state === STATES.VERIFYING) return {status:'ALREADY_VERIFYING'};
      requireBool(gate.stopPhase === 'IN_PROGRESS', 'STOP_NOT_CLAIMED');
      requireBool(pending(tx, systemID).length === 0, 'PENDING_WRITERS_BEFORE_VERIFYING');
      tx.writeGate({...gate, state:STATES.VERIFYING, stopPhase:'CONFIRMED', stoppedAt:time()});
      return {status:'VERIFYING'};
    });
  }
  async function independentlyProveStop(systemID, attemptID) {
    // A STOP_CONFIRMED callback from the mutator is not independent proof.
    // The verifier must inspect actual native controllers and durability.
    const verified = await verifyNativeStop({systemID, attemptID});
    requireBool(verified === true, 'NATIVE_STOP_INDEPENDENT_PROOF_MISSING');
  }
  async function reconcileStopped({systemID, leaseToken, attemptID}) {
    validate(systemID, leaseToken); requireBool(idOK(attemptID), 'ATTEMPT_ID_INVALID');
    const phase = transact(tx => {
      readActiveLease(tx, systemID, leaseToken);
      const gate = readGate(tx, systemID, leaseToken, [STATES.DRAINING, STATES.VERIFYING]);
      requireBool(gate.attemptID === attemptID, 'SHUTDOWN_ATTEMPT_FENCED');
      requireBool(gate.stopPhase === 'IN_PROGRESS' || (gate.state === STATES.VERIFYING &&
        gate.stopPhase === 'CONFIRMED'), 'STOP_NOT_CLAIMED');
      return gate.state;
    });
    if (phase === STATES.VERIFYING) return {status:'ALREADY_VERIFYING'};
    await independentlyProveStop(systemID, attemptID);
    return sealStop(systemID, leaseToken, attemptID);
  }
  async function completeShutdown({systemID, leaseToken, attemptID}) {
    validate(systemID, leaseToken); requireBool(idOK(attemptID), 'ATTEMPT_ID_INVALID');
    const preflight = transact(tx => {
      readActiveLease(tx, systemID, leaseToken);
      const gate = readGate(tx, systemID, leaseToken, [STATES.DRAINING, STATES.VERIFYING]);
      requireBool(gate.attemptID === attemptID, 'SHUTDOWN_ATTEMPT_FENCED');
      const outstanding = pending(tx, systemID).map(p=>p.operationID);
      if (outstanding.length) return {state:gate.state,pending:outstanding};
      if (gate.state === STATES.DRAINING && gate.stopPhase === 'IN_PROGRESS')
        return {state:gate.state,claimedByAnother:true,pending:[]};
      if (gate.state === STATES.DRAINING) {
        requireBool(gate.stopPhase === 'NONE', 'STOP_PHASE_CORRUPT');
        // No side effects before this durable CAS.
        tx.writeGate({...gate,stopPhase:'IN_PROGRESS',stopClaimedAt:time()});
      }
      return {state:gate.state,pending:[]};
    });
    if (preflight.pending.length) return {status:'BLOCKED_PENDING_WRITERS',pending:preflight.pending};
    if (preflight.claimedByAnother) return {status:'BLOCKED_STOP_OUTCOME_UNKNOWN'};
    if (preflight.state === STATES.DRAINING) {
      const stopped = await nativeStop({systemID, attemptID,
        beginCleanup: (writerOperationID) => beginWrite({systemID, leaseToken,
          writer:'shutdown_cleanup', operationID:writerOperationID, shutdownAttemptID:attemptID}),
        finishCleanup: (operationID,receipt) => finishWrite({systemID, leaseToken, operationID,receipt})});
      requireBool(stopped && stopped.status === 'STOP_CONFIRMED' &&
        stopped.systemID === systemID && stopped.attemptID === attemptID, 'NATIVE_STOP_UNPROVEN');
      await independentlyProveStop(systemID, attemptID);
      sealStop(systemID, leaseToken, attemptID);
    }
    // A validated native observation alone is not custody proof; the writer
    // coverage must be verified from the currently deployed source + runtime.
    const observed = await nativeAudit({systemID, attemptID});
    requireBool(observed && observed.status === 'OBSERVED_EMPTY_UNPROVEN' &&
      Array.isArray(observed.blockers) && observed.blockers.length === 0 &&
      observed.systemID === systemID, 'NATIVE_NOT_OBSERVED_EMPTY');
    const coverage = await verifyCoverage({systemID, attemptID, writerNames:[...expected]});
    requireBool(coverage && coverage.status === 'ALL_WRITERS_FENCED' &&
      exactSet(coverage.writerNames, expected) &&
      typeof coverage.sourceFingerprint === 'string' && /^[a-f0-9]{64}$/.test(coverage.sourceFingerprint),
      'MINING_WRITER_COVERAGE_UNPROVEN');
    return transact(tx => {
      readActiveLease(tx, systemID, leaseToken);
      const gate = readGate(tx, systemID, leaseToken, [STATES.VERIFYING]);
      requireBool(gate.attemptID === attemptID && gate.stopPhase === 'CONFIRMED',
        'SHUTDOWN_ATTEMPT_FENCED');
      requireBool(pending(tx, systemID).length === 0, 'PENDING_WRITERS_AFTER_AUDIT');
      requireBool(hasClaims(tx) && tx.countPersonalClaims(systemID) === 0,
        'PF_CLAIMS_UNKNOWN_OR_PRESENT');
      const witness = {version:1, systemID, attemptID, leaseToken,
        sourceFingerprint:coverage.sourceFingerprint, writers:[...expected],
        auditedAt:time(), observation:'OBSERVED_EMPTY_UNPROVEN', stopped:'INDEPENDENTLY_CONFIRMED'};
      requireBool(tx.releaseLease(systemID, leaseToken, witness) === true,
        'ATOMIC_LEASE_RELEASE_FAILED');
      tx.writeGate({...gate, state:STATES.RELEASED, releasedAt:time(), witness});
      return {status:'RELEASED', witness};
    });
  }
  function inspect({systemID}) {
    requireBool(positive(systemID), 'SYSTEM_ID_INVALID');
    return transact(tx => ({lease:tx.readLease(systemID), gate:tx.readGate(systemID),
      pending:pending(tx, systemID).map(p=>p.operationID)}));
  }
  return Object.freeze({activate, beginWrite, finishWrite, beginShutdown,
    completeShutdown, reconcileStopped, inspect, writerNames:expected});
}
module.exports = {createMiningShutdownProtocol, STATES};