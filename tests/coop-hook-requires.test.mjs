import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const {audit} = require('../scripts/coop-hook-requires.cjs');
const spec = require('../scripts/overlay-spec.cjs');
const integrations = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', 'integration');

// A hook is one call into a module. If that module is not installed the require
// throws inside stock code and aborts the whole native tick - measured as
// "NPC tick failed ... Cannot find module ../coopMiningTargetGuard" while the
// mining fleet looked merely idle. The install must refuse that, not ship it.
test('every module a hook or an installed module requires is installed by the overlay', () => {
  const result = audit({names: spec.names, specs: spec.specs, integrationsDir: integrations});
  assert.deepEqual(result.violations, []);
  assert.ok(result.targets > 100, 'the audit must actually see the requires');
});

test('the mining lock guard is registered and required by its hook', () => {
  assert.ok(spec.names.includes('coopMiningTargetGuard'));
  const hooks = spec.specs.flatMap((entry) => (entry.patches || []).map((patch) => String(patch.line || '')));
  assert.ok(hooks.some((line) => line.includes('coopMiningTargetGuard')),
    'the hook must still call the guard');
});

test('a hook that requires a module the overlay does not install is a violation', () => {
  const result = audit({
    names: ['coopMiningTrace'],
    specs: [{file: 'server/src/space/npc/npcBehaviorLoop.js', patches: [
      {line: 'if (require("../coopNotInstalled").check()) return;'},
    ]}],
    integrationsDir: integrations,
  });
  const hooks = result.violations.filter((violation) => violation.origin === 'hook');
  assert.equal(hooks.length, 1);
  assert.equal(hooks[0].code, 'HOOK_REQUIRE_NOT_INSTALLED');
  assert.equal(hooks[0].resolved, 'server/src/space/coopNotInstalled');
});

test('a hook that requires a .cjs sibling is a violation even when installed', () => {
  const result = audit({
    names: ['coopMiningCapacitorGate'],
    specs: [{file: 'server/src/space/coopMiningActivate.js', patches: [
      {line: 'const gate = require("./coopMiningCapacitorGate.cjs");'},
    ]}],
    integrationsDir: integrations,
  });
  const hooks = result.violations.filter((violation) => violation.origin === 'hook');
  assert.equal(hooks.length, 1);
  assert.equal(hooks[0].code, 'HOOK_REQUIRE_EXTENSION');
});

test('builtins and packages are out of scope', () => {
  const result = audit({
    names: [],
    specs: [{file: 'server/src/space/x.js', patches: [{line: 'require("node:fs"); require("better-sqlite3");'}]}],
    integrationsDir: integrations,
  });
  assert.deepEqual(result.violations, []);
});
