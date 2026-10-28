import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync, spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(import.meta.dirname, '..');
const {gitBlobSha, readPinned, assertReversible} = require('../scripts/lib/pinned-source.cjs');

// Why this exists: the five scripts/verify-*.cjs gates stop a build when the
// pinned original EveJS source moved. Their shared part used to be copied five
// times, so the only honest check is against an independent oracle (git itself)
// and against patches whose reversibility is known by construction. A verifier
// that silently accepts a drifted tree is worse than no verifier.

const reversible = [
  {name: 'rename', apply: (text) => text.replace('A', 'B'), revert: (text) => text.replace('B', 'A')},
];
const tail = (text, mode) => text + '\n// ' + mode;

test('gitBlobSha is the hash git itself stores, CRLF or LF on disk', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evejs-pin-'));
  try {
    const lf = 'const a = 1;\nconst b = 2;\n';
    fs.writeFileSync(path.join(root, 'lf.js'), lf);
    fs.writeFileSync(path.join(root, 'crlf.js'), lf.replace(/\n/g, '\r\n'));
    const gitSha = (file) => execFileSync('git', ['hash-object', file], {cwd: root, encoding: 'utf8'}).trim();
    assert.equal(gitBlobSha(lf), gitSha('lf.js'));
    // The same pinned commit checked out on Windows differs only by CRLF.
    assert.equal(gitBlobSha(lf.replace(/\n/g, '\r\n')), gitSha('lf.js'));
    assert.equal(gitBlobSha(fs.readFileSync(path.join(root, 'crlf.js'), 'utf8')), gitSha('lf.js'));
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
});

test('readPinned hashes the canonical text but hands back the disk bytes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evejs-pin-'));
  try {
    const file = path.join(root, 'server', 'space', 'x.js');
    fs.mkdirSync(path.dirname(file), {recursive: true});
    fs.writeFileSync(file, 'line1\r\nline2\r\n');
    const pinned = readPinned(root, path.join('server', 'space', 'x.js'));
    assert.equal(pinned.sha, gitBlobSha('line1\nline2\n'));
    assert.match(pinned.original, /\r\n/, 'a patch must be given the bytes that are on disk');
    assert.doesNotMatch(pinned.canonical, /\r/);
    assert.equal(pinned.file, file);
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
});

test('a reversible chain passes in both line endings and returns them', () => {
  const modes = assertReversible({
    variants: [{mode: 'LF', text: 'A\n'}, {mode: 'CRLF', text: 'A\r\n'}],
    stages: reversible,
    checkSyntax: (text) => new Function(text),
    failure: (mode) => 'FAILED:' + mode,
  });
  assert.deepEqual(modes, ['LF', 'CRLF']);
});

test('multi-stage chains cannot be reverted out of order', () => {
  // Stages must be idempotent and text-anchored, like the real patches.
  const chain = [
    {name: 'first', apply: (text) => text.replace('A', 'B'), revert: (text) => text.replace('B', 'A')},
    {name: 'second', apply: (text) => text.replace('B', 'C'), revert: (text) => text.replace('C', 'B')},
  ];
  assert.deepEqual(assertReversible({
    variants: [{mode: 'LF', text: 'A'}],
    stages: chain,
    failure: (mode) => 'FAILED:' + mode,
  }), ['LF']);
  // Reverting forward instead of in reverse leaves the text in the middle stage.
  const wrongOrder = [chain[0], {name: 'second', apply: chain[1].apply, revert: (text) => text}];
  assert.throws(() => assertReversible({
    variants: [{mode: 'LF', text: 'A'}],
    stages: wrongOrder,
    failure: (mode) => 'FAILED:' + mode,
  }), /FAILED:LF/);
});

test('a lost revert, a lost apply, a non-idempotent stage and a broken-CRLF stage are all refused', () => {
  const call = (stages, text = 'A') => assertReversible({
    variants: [{mode: 'LF', text}],
    stages,
    failure: (mode) => 'FAILED:' + mode,
  });
  assert.throws(() => call([{apply: (t) => t + '!', revert: (t) => t}]), /FAILED:LF/);
  assert.throws(() => call([{apply: (t) => t, revert: (t) => t}]), /FAILED:LF/);
  assert.throws(() => call([{apply: (t) => t + '!', revert: (t) => t.slice(0, -1)}]), /FAILED:LF/);
  // Applies to LF text, but its revert only knows LF, so the CRLF variant fails.
  assert.throws(() => assertReversible({
    variants: [{mode: 'LF', text: 'A\n'}, {mode: 'CRLF', text: 'A\r\n'}],
    stages: [{apply: (t) => t.replace(/\n/g, '\n// x'), revert: (t) => t.replace(/\n\/\/ x/g, '\n')}],
    failure: (mode) => 'FAILED:' + mode,
  }), /FAILED:LF/);
});

test('a patch that stops parsing is loud, not silently "fine"', () => {
  assert.throws(() => assertReversible({
    variants: [{mode: 'LF', text: 'A'}],
    stages: [{name: 'broken', apply: (text) => text + '(', revert: (text) => text.slice(0, -1)}],
    checkSyntax: (text) => new Function(text),
    failure: (mode) => 'FAILED:' + mode,
  }));
});

test('every verifier still exports what its siblings import', () => {
  // verify-alife09 takes the hash and the pin from verify-alife08;
  // verify-alife07 takes the pin table from the cycle verifier.
  const alife08 = require('../scripts/verify-alife08-durable-mining-source.cjs');
  const cycle = require('../scripts/verify-alife-native-mining-cycle-source.cjs');
  const alife07 = require('../scripts/verify-alife07-native-mining-source.cjs');
  const alife09 = require('../scripts/verify-alife09-mining-overlay.cjs');
  const cargo = require('../scripts/verify-alife-mining-cargo-source.cjs');
  assert.equal(typeof alife08.hashGitBlob, 'function');
  assert.match(alife08.EXPECTED, /^[0-9a-f]{40}$/);
  assert.equal(typeof alife09.verify, 'function');
  assert.equal(typeof alife07.verify, 'function');
  assert.equal(typeof cargo.inspectNativeMiningSource, 'function');
  assert.deepEqual(Object.keys(cycle.PINNED).sort(), ['miningRuntime.js', 'miningRuntimeState.js']);
});

test('the verifier CLI keeps exit 2 without an argument and 1 for a tree that does not match', () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'evejs-pin-empty-'));
  try {
    for (const name of ['verify-alife07-native-mining-source.cjs', 'verify-alife08-durable-mining-source.cjs']) {
      const noArg = spawnSync(process.execPath, [path.join(ROOT, 'scripts', name)], {encoding: 'utf8'});
      assert.equal(noArg.status, 2, name + ' must refuse to run without a root');
      assert.match(noArg.stderr, /root|Usage|usage/);
      const wrong = spawnSync(process.execPath, [path.join(ROOT, 'scripts', name), empty], {encoding: 'utf8'});
      assert.equal(wrong.status, 1, name + ' must fail on an empty tree');
    }
  } finally {
    fs.rmSync(empty, {recursive: true, force: true});
  }
});
