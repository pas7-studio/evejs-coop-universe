import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// The environment value may carry a trailing space (cmd `set` appends one);
// trim it so the resolved path is exact.
const EVEJS_FORK_ROOT = process.env.EVEJS_FORK_ROOT.trim();
assert.equal(typeof EVEJS_FORK_ROOT, 'string', 'EVEJS_FORK_ROOT must be set');

const modPath = join(EVEJS_FORK_ROOT, 'Code', 'server', 'src', 'space', 'coopEconomyDecisions.js');
const mod = require(modPath);

const { DECISIONS, blockingDecisions, isReadyToImplement } = mod;

test('DECISIONS has exactly 12 records with ids ADR-01..ADR-12 in order, each with title, decision, status, risk and evidence', () => {
  assert.ok(Array.isArray(DECISIONS), 'DECISIONS should be an array');
  assert.equal(DECISIONS.length, 12, 'DECISIONS should contain exactly 12 records');

  const expectedIds = [];
  for (let i = 1; i <= 12; i++) {
    expectedIds.push(`ADR-${String(i).padStart(2, "0")}`);
  }

  DECISIONS.forEach((rec, idx) => {
    assert.equal(rec.id, expectedIds[idx], `Record at index ${idx} should have id ${expectedIds[idx]}`);
    assert.equal(typeof rec.title, 'string');
    assert.ok(rec.title.length > 0, `Record ${rec.id} title should be non-empty`);
    assert.equal(typeof rec.decision, 'string');
    assert.ok(rec.decision.length > 0, `Record ${rec.id} decision should be non-empty`);
    assert.ok(['DECIDED', 'OPEN'].includes(rec.status), `Record ${rec.id} status should be DECIDED or OPEN`);
    assert.ok(['P0', 'P1', 'P2'].includes(rec.risk), `Record ${rec.id} risk should be P0/P1/P2`);
    assert.ok(Array.isArray(rec.evidence), `Record ${rec.id} evidence should be an array`);
  });
});

test('DECISIONS array is frozen and modifying an entry does not change DECISIONS', () => {
  assert.equal(Object.isFrozen(DECISIONS), true, 'DECISIONS should be frozen');

  const snapshot = DECISIONS.map((r) => ({ ...r }));
  // A frozen array alone still allows editing a record in place, so the registry must be deep-frozen:
  // a later phase that silently rewrites a P0 decision would otherwise need no commit at all.
  assert.throws(() => { DECISIONS[0].title = 'TAMPERED'; }, TypeError);
  assert.throws(() => { DECISIONS[0].evidence.push('invented'); }, TypeError);
  assert.throws(() => { DECISIONS.push({ id: 'ADR-13' }); }, TypeError);

  assert.deepEqual(DECISIONS.map((r) => ({ ...r })).map((r) => r.title),
    snapshot.map((r) => r.title), 'DECISIONS should not change after mutation attempts');
});

test('blockingDecisions() returns sorted ids of every non-DECIDED or empty-evidence record, consistent with the array', () => {
  const expected = DECISIONS
    .filter((r) => r.status !== 'DECIDED' || (Array.isArray(r.evidence) && r.evidence.length === 0))
    .map((r) => r.id)
    .sort();

  const actual = blockingDecisions();

  assert.deepEqual(actual, expected, 'blockingDecisions() should match recomputed expected ids');
  assert.deepEqual(actual, [...actual].sort(), 'blockingDecisions() should be sorted');
});

test('isReadyToImplement() is false while ADR-11 is not DECIDED and false whenever any P0 record has empty evidence', () => {
  const adr11 = DECISIONS.find((r) => r.id === 'ADR-11');
  assert.ok(adr11, 'ADR-11 should exist');

  const p0Records = DECISIONS.filter((r) => r.risk === 'P0');

  // Derive the expected readiness purely from the data, not from a hardcoded answer.
  const p0WithEmptyEvidence = p0Records.some((r) => Array.isArray(r.evidence) && r.evidence.length === 0);
  const adr11Decided = adr11 !== undefined && adr11.status === 'DECIDED';

  const expectedReady = adr11Decided && !p0WithEmptyEvidence;

  assert.equal(isReadyToImplement(), expectedReady,
    `isReadyToImplement() should equal ${expectedReady} given the current data`);

  // Sanity: when ADR-11 is not decided, readiness must be false.
  if (!adr11Decided) {
    assert.equal(isReadyToImplement(), false, 'isReadyToImplement() must be false while ADR-11 is not DECIDED');
  }

  // Sanity: when a P0 record has empty evidence, readiness must be false.
  if (p0WithEmptyEvidence) {
    assert.equal(isReadyToImplement(), false, 'isReadyToImplement() must be false when a P0 record has empty evidence');
  }
});

test('the module has no side effects on import: requiring it twice returns the same DECISIONS array', () => {
  const mod2 = require(modPath);
  assert.equal(mod2, mod, 'Requiring the module twice should return the same module object');
  assert.equal(mod2.DECISIONS, DECISIONS, 'DECISIONS should be the same array reference');
  assert.equal(mod2.blockingDecisions, blockingDecisions, 'blockingDecisions should be the same function');
  assert.equal(mod2.isReadyToImplement, isReadyToImplement, 'isReadyToImplement should be the same function');
});

