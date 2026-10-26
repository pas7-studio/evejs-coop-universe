import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const installer = require('../scripts/patch-evejs-coop.cjs');
const contractPatch = require('../scripts/coop-native-contract-mutation-fence-patch.cjs');
const wormholePatch = require('../scripts/coop-wormhole-jump-fence-patch.cjs');
const itemAudit = require('../scripts/coop-sde-supported-audit.cjs');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const contractFile = 'server/src/services/_other/contractProxyService.js';
const wormholeFile = 'server/src/services/exploration/wormholes/wormholeMgrService.js';

function contractFixture(eol) {
  return [
    'function create(rawInfo, session, kwargs) {',
    '  return contractRuntime.createContract(rawInfo, session, {',
    '    confirm: kwargs && kwargs.confirm,',
    '  });',
    '}',
    'function accept(contractID, session, forCorp) {',
    '  return contractRuntime.acceptContract(contractID, session, forCorp);',
    '}',
    'function complete(contractID, status, session) {',
    '  return contractRuntime.completeContract(contractID, status, session);',
    '}',
    'function remove(contractID, session) {',
    '  return contractRuntime.deleteContract(contractID, session);',
    '}',
    'function removeMany(contractIDs, session) {',
    '  return contractRuntime.deleteMultipleContracts(contractIDs, session);',
    '}',
    '',
  ].join(eol);
}

function wormholeFixture(eol) {
  return [
    'function completeWormholeJump({ session, sourceScene, sourceEndpointID, shipMass, prepareResult }) {',
    '  const pendingJump = session._wormholeJumpPending;',
    '  return pendingJump;',
    '}',
    'class WormholeMgrService {',
    '  Handle_WormholeJump(args, session) {',
    '    const endpointID = toInt(args && args[0], 0);',
    '    return endpointID;',
    '  }',
    '}',
    '',
  ].join(eol);
}

test('central installer is parseable; module and spec registries have no duplicate entries', () => {
  assert.equal(installer.PIN, 'c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f');
  assert.doesNotThrow(() => new vm.Script(read('scripts/patch-evejs-coop.cjs')));
  assert.equal(new Set(installer.names).size, installer.names.length, 'duplicate module copies can change a deployment plan');
  assert.equal(new Set(installer.specs.map(s => s.file)).size, installer.specs.length);
  for (const name of ['coopWormholeJumpFence', 'coopNativeContractMutationFence']) {
    assert.equal(installer.names.filter(n => n === name).length, 1);
    assert.ok(fs.existsSync(path.join(root, 'integration', name + '.cjs')));
  }
  assert.equal(installer.names.filter(n => n === 'coopCourierRuntime').length, 1);
});

test('Chat 23 + 30 hooks each have exactly one pinned native source owner', () => {
  for (const filename of [contractFile, wormholeFile]) {
    const matches = installer.specs.filter(spec => spec.file === filename);
    assert.equal(matches.length, 1, filename);
    assert.equal(matches[0].patches.length, 0);
  }
  assert.equal(contractPatch.FILE, contractFile);
  assert.equal(wormholePatch.fileName, wormholeFile);
});

for (const eol of ['\n', '\r\n']) {
  test(`Chat 30 proxy hooks are reversible/idempotent by central installer (${eol === '\n' ? 'LF' : 'CRLF'})`, () => {
    const source = contractFixture(eol);
    const spec = installer.specs.find(s => s.file === contractFile);
    const patched = installer.transform(source, spec, false);
    assert.equal(patched, contractPatch.patch(source, contractFile, false));
    assert.notEqual(patched, source);
    assert.equal(installer.transform(patched, spec, false), patched);
    assert.equal(installer.transform(patched, spec, true), source);
    assert.equal(installer.transform(source, spec, true), source);
    assert.equal(patched.match(/EVEJS_COOP_NATIVE_CONTRACT_MUTATION_FENCE/g)?.length, 5);
    assert.equal(patched.match(/coopNativeContractMutationFence/g)?.length, 5);
    assert.doesNotThrow(() => new vm.Script(patched));
  });

  test(`Chat 23 wormhole hooks remain reversible after Chat 30 integration (${eol === '\n' ? 'LF' : 'CRLF'})`, () => {
    const source = wormholeFixture(eol);
    const spec = installer.specs.find(s => s.file === wormholeFile);
    const patched = installer.transform(source, spec, false);
    assert.equal(patched, wormholePatch.patch(source, wormholeFile, false));
    assert.equal(installer.transform(patched, spec, false), patched);
    assert.equal(installer.transform(patched, spec, true), source);
    assert.equal(patched.includes('EVEJS_COOP_WORMHOLE_JUMP_FENCE === "1"'), true);
    assert.equal(patched.includes('jumpSessionViaStargate'), false);
    assert.doesNotThrow(() => new vm.Script(patched));
  });
}

test('Chat 37 keeps SDE auditing separate from installer, no balance or client-asset import', () => {
  assert.ok(itemAudit.REQUIRED.includes('marketGroups'));
  assert.ok(itemAudit.REQUIRED.includes('typeDogma'));
  const prices = read('scripts/balance-skill-market.cjs');
  assert.match(prices, /typeID:\s*45635, name: "Small Skill Injector"/);
  assert.doesNotMatch(prices, /typeID:\s*40521, name: "Small Skill Injector"/);
  assert.match(prices, /const APPLY = process\.argv\.includes\("--apply"\)/);
  assert.equal(installer.names.includes('coopSdeSupportedAudit'), false);
});

test('exact pinned upstream native contractProxy source patches without rewriting game client', t => {
  const codePath = process.env.EVEJS_COOP_CODE_PATH;
  if (!codePath) { t.skip('Needs an authorized pinned EveJS/Code checkout'); return; }
  const nativeGit = path.dirname(path.resolve(codePath));
  const actualPin = execFileSync('git', ['-C', nativeGit, 'rev-parse', 'HEAD'], {encoding:'utf8'}).trim();
  assert.equal(actualPin, installer.PIN);
  const spec = installer.specs.find(s => s.file === contractFile);
  const raw = fs.readFileSync(path.join(codePath, contractFile), 'utf8');
  const original = installer.transform(raw, spec, true);
  const patched = installer.transform(original, spec, false);
  assert.equal(installer.transform(patched, spec, false), patched);
  assert.equal(installer.transform(patched, spec, true), original);
  assert.ok(raw === original || raw === patched);
  assert.doesNotThrow(() => new vm.Script(patched));
});
