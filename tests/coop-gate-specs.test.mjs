import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SPECS = path.join(ROOT, 'scripts/lib/gates.json');
const specs = JSON.parse(fs.readFileSync(SPECS, 'utf8'));
const gates = Object.entries(specs.gates);

// Why this exists: scripts/lib/gates.json is data that decides what nineteen
// manual gates run. Before, a renamed test file or a manifest whose schema or
// count moved on was only discovered by an operator running the gate and reading
// a throw. A spec is now cheap to check, and a typo in a key name used to fall
// back to a silent default, so the allowed keys are enumerated here.

const GATE_KEYS = new Set(['name', 'reportSlug', 'logName', 'tail', 'testMissing', 'tests',
  'optionalTests', 'syntax', 'syntaxFail', 'manifest', 'manifests', 'failureContext',
  'nodeFail', 'pinned', 'banner']);
const MANIFEST_KEYS = new Set(['path', 'missing', 'schema', 'count', 'op', 'status', 'invalid', 'notRun',
  'excludeFromCount']);
const PINNED_KEYS = new Set(['scripts', 'missing', 'missingKind']);

const exists = (rel) => fs.existsSync(path.join(ROOT, rel));

function scenarioManifest(rel) {
  const parsed = JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
  return { schema: parsed.schema, scenarios: parsed.scenarios || [] };
}

test('gate spec table is versioned and every gate is runnable in principle', () => {
  assert.equal(specs.schema, 'evejs-coop/gate-specs/v1');
  assert.ok(gates.length >= 19, 'the gate table may only grow by adding real gates');
  for (const [id, gate] of gates) {
    assert.match(id, /^[a-zA-Z][\w]*$/, 'gate id must be a plain key: ' + id);
    for (const key of Object.keys(gate)) {
      assert.ok(GATE_KEYS.has(key), `${id} has an unknown key "${key}" (a typo silently defaults)`);
    }
    assert.ok(gate.name && gate.reportSlug && gate.logName, `${id} needs name, reportSlug and logName`);
    assert.match(gate.logName, /\.(log|txt)$/, `${id} logName must be a log file`);
    assert.ok(Number.isInteger(gate.tail) && gate.tail > 0, `${id} needs a positive tail`);
    assert.ok(Array.isArray(gate.tests) && gate.tests.length, `${id} declares no test files`);
    assert.ok(String(gate.nodeFail || '').length, `${id} must name its failure log for the operator`);  }
});

test('every declared test, syntax and pin file still exists', () => {
  for (const [id, gate] of gates) {
    for (const file of gate.tests) assert.ok(exists(file), `${id} test missing: ${file}`);
    for (const file of gate.syntax || []) assert.ok(exists(file), `${id} syntax target missing: ${file}`);
    for (const optional of gate.optionalTests || []) {
      if (optional.switch) {
        assert.ok(Array.isArray(optional.tests) && optional.tests.length, `${id} switch group has no tests`);
        for (const file of optional.tests) assert.ok(exists(file), `${id} switch test missing: ${file}`);
        continue;
      }
      assert.ok(exists(optional.exists), `${id} optional test missing: ${optional.exists}`);
      assert.ok(exists(optional.test), `${id} optional test target missing: ${optional.test}`);
    }
    for (const verifier of (gate.pinned || {}).scripts || []) {
      assert.ok(exists(verifier.path), `${id} pinned verifier missing: ${verifier.path}`);
      assert.ok(verifier.fail, `${id} pinned verifier needs its own failure message`);
    }
  }
});

test('every manifest gate still matches its schema, count and all-NOT_RUN state', () => {
  for (const [id, gate] of gates) {
    const manifests = [...(gate.manifest ? [gate.manifest] : []), ...(gate.manifests || [])];
    assert.ok(manifests.length, `${id} declares no manifest: a source gate always refuses unproven E2E`);
    for (const manifest of manifests) {
      for (const key of Object.keys(manifest)) {
        assert.ok(MANIFEST_KEYS.has(key), `${id} manifest has an unknown key "${key}"`);
      }
      assert.ok(exists(manifest.path), `${id} scenario manifest missing: ${manifest.path}`);
      const loaded = scenarioManifest(manifest.path);
      assert.equal(loaded.schema, manifest.schema, `${id} scenario schema drifted`);
      assert.ok(['eq', 'ge'].includes(manifest.op), `${id} manifest op must be eq or ge`);
      if (manifest.op === 'eq') assert.equal(loaded.scenarios.length, manifest.count, `${id} scenario count drifted`);
      else assert.ok(loaded.scenarios.length >= manifest.count, `${id} lost scenarios`);
      const claimed = loaded.scenarios.filter((scenario) => scenario.status !== 'NOT_RUN');
      assert.equal(claimed.length, 0, `${id} manifest claims unexecuted gameplay: ` +
        claimed.map((scenario) => scenario.id || scenario.name).join(', '));
      if (manifest.status) {
        assert.equal(JSON.parse(fs.readFileSync(path.join(ROOT, manifest.path), 'utf8')).status, manifest.status,
          `${id} ${manifest.path} is no longer ${manifest.status}`);
      }
    }
  }
});

test('the pinned block is well formed', () => {
  for (const [id, gate] of gates) {
    if (!gate.pinned) continue;
    for (const key of Object.keys(gate.pinned)) {
      assert.ok(PINNED_KEYS.has(key), `${id} pinned has an unknown key "${key}"`);
    }
    assert.ok(gate.pinned.missing, `${id} pinned block must say what is not checked`);
    assert.ok(['Host', 'Warning', undefined].includes(gate.pinned.missingKind),
      `${id} pinned missingKind must be Host or Warning`);
  }
});

test('the A-Life economy gate keeps its historic banner total and guard matrix', () => {
  // The old runner printed the sum of the nine acceptance manifests it counted
  // and deliberately left the COOP-060 two-client matrix out of that number.
  // Both facts are operator-visible output, so they are pinned here.
  const gate = specs.gates.alifeEconomy;
  assert.ok(gate, 'alifeEconomy gate is missing');
  assert.equal(gate.name, 'NATIVE ECONOMY', 'the failure header text is documented');
  assert.equal(gate.tests.length, 38);
  assert.equal(gate.manifests.length, 10);
  const excluded = gate.manifests.filter((manifest) => manifest.excludeFromCount);
  assert.equal(excluded.length, 1, 'exactly one manifest is a guard-only matrix');
  assert.equal(excluded[0].path, 'tests/scenarios/coop-060-native-player-seller-live-e2e.json');
  const counted = gate.manifests.filter((manifest) => !manifest.excludeFromCount)
    .reduce((total, manifest) => total + scenarioManifest(manifest.path).scenarios.length, 0);
  assert.equal(counted, 95, 'PASS banner must still report 95 scenarios remaining NOT_RUN');
  assert.deepEqual(gate.optionalTests.map((optional) => optional.switch), ['IncludeExistingEconomyTests']);
});

test('every wrapper resolves an existing gate and the table has no orphan gate', () => {
  const used = new Map();
  for (const file of fs.readdirSync(path.join(ROOT, 'scripts'))) {
    if (!/^Run-.*\.ps1$/.test(file)) continue;
    const text = fs.readFileSync(path.join(ROOT, 'scripts', file), 'utf8');
    for (const match of text.matchAll(/Invoke-CoopGateById -Id "(\w+)"/g)) {
      assert.ok(specs.gates[match[1]], `${file} asks for unknown gate "${match[1]}"`);
      used.set(match[1], file);
    }
  }
  for (const [id] of gates) {
    assert.ok(used.has(id), `gate "${id}" has no Run-*.ps1 wrapper, so nobody can run it`);
  }
});
