import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const hookRequires = require('../scripts/coop-hook-requires.cjs');
const {audit} = hookRequires;
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

// A relative require that resolves to nothing is a runtime only failure: the hook
// throws and the stock caller swallows it. Two live hooks had exactly that bug
// (miningNpcOperations -> ../gameStore, agentMgrService -> ../space/coopAgentDialogue),
// so the installer now refuses to write such a file.
test("the installer refuses a written file whose relative require resolves to nothing", ()=>{
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "coop-requires-"));
  try {
    fs.mkdirSync(path.join(dir, "server/src/services/mining"), {recursive: true});
    fs.mkdirSync(path.join(dir, "server/src/gameStore"), {recursive: true});
    fs.writeFileSync(path.join(dir, "server/src/gameStore/index.js"), "");
    const target = path.join(dir, "server/src/services/mining/miningNpcOperations.js");
    const sibling = path.join(dir, "server/src/services/mining/coopSibling.js");
    const plan = (text) => [{file: target, after: text}];
    const violations = (text) => hookRequires.installedFileViolations({plan: plan(text), checkout: dir});
    assert.equal(violations("const x = require(\"../../gameStore\");").length, 0,
      "the correct depth resolves to a real directory");
    assert.equal(hookRequires.installedFileViolations({
      plan: [{file: target, after: "const y = require(\"./coopSibling\");"},
        {file: sibling, after: "module.exports = {};"}], checkout: dir}).length, 0,
      "a sibling installed by the same plan is allowed");
    const bad = violations("const x = require(\"../gameStore\");");
    assert.equal(bad.length, 1);
    assert.equal(bad[0].code, "INSTALL_REQUIRE_UNRESOLVED");
    assert.equal(bad[0].from, "server/src/services/mining/miningNpcOperations.js");
    assert.equal(bad[0].specifier, "../gameStore");
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
});

test("a plan entry that is only removed is not scanned", ()=>{
  const violations = hookRequires.installedFileViolations({
    plan: [{file: "/nowhere/x.js", after: null}], checkout: null});
  assert.deepEqual(violations, []);
});
