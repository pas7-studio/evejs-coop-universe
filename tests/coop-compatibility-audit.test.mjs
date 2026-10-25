import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const audit = require('../scripts/coop-compatibility-audit.cjs');

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'evejs-compat-'));
  const code = path.join(directory, 'Code');
  fs.mkdirSync(path.join(code, 'server/src/services/contracts'), { recursive: true });
  fs.mkdirSync(path.join(code, 'server/src/services/other'), { recursive: true });
  fs.writeFileSync(path.join(code, 'server/src/services/contracts/contractService.js'), `
class Contracts {
 constructor() { super("contractMgr"); }
 Handle_CreateContract() { return null; }
 Handle_SearchContracts() { return []; }
 async Handle_Fetch() { return 1; }
}
`);
  fs.writeFileSync(path.join(code, 'server/src/services/other/dummyService.js'),
    'class Dummy { constructor() { super("foo"); } Handle_X() { return 42; } }');
  return { directory, code, cleanup: () => fs.rmSync(directory, { recursive: true, force: true }) };
}

const matchingManifest = () => ({
  build: audit.CLIENT_BUILD,
  sdeMeta: { buildNumber: audit.CLIENT_BUILD },
  sdeUrl: `https://developers.eveonline.com/static-data/tranquility/eve-online-static-data-${audit.CLIENT_BUILD}-jsonl.zip`,
  placeholderTables: ['example'],
});

test('source-only RPC discovery never claims it is registered or functional', () => {
  assert.deepEqual(audit.extractDeclaredRpc(`
 Handle_Start(args) { return null; }
 async Handle_Stop() {}
 const Handle_NotAFunction = true;
 // Handle_Comment() {
`), ['Start', 'Stop']);
  assert.equal(audit.extractServiceName('super("contractProxy");'), 'contractProxy');
  const f = fixture();
  try {
    const files = audit.collectServiceFiles(f.code);
    assert.equal(files.length, 2);
    const report = audit.inspectCodePath(f.code);
    assert.equal(report.inventory.sourceServiceFileCount, 2);
    assert.ok(report.inventory.services.some(row => row.name === 'contractMgr'));
    assert.ok(report.checks.some(row => row.status === 'SOURCE_MISSING'));
  } finally { f.cleanup(); }
});

test('read-only audit ignores symlink escape and does not mutate fixture', () => {
  const f = fixture();
  try {
    const outside = path.join(f.directory, 'outsideService.js');
    fs.writeFileSync(outside, 'SECRET');
    const link = path.join(f.code, 'server/src/services/other/leakService.js');
    fs.symlinkSync(outside, link);
    assert.equal(audit.readSource(f.code, 'server/src/services/other/leakService.js'), null);
    assert.equal(audit.collectServiceFiles(f.code).length, 2);
    const before = fs.readFileSync(path.join(f.code, 'server/src/services/contracts/contractService.js'), 'utf8');
    audit.inspectCodePath(f.code);
    audit.inspectCodePath(f.code);
    assert.equal(fs.readFileSync(path.join(f.code, 'server/src/services/contracts/contractService.js'), 'utf8'), before);
  } finally { f.cleanup(); }
});

test('SDE guard rejects mismatched manifest.build, metadata, or URL independently', () => {
  assert.equal(audit.analyzeSdeManifest(matchingManifest()).status, 'BUILD_MATCH');
  for (const change of [
    m => { m.build++; },
    m => { m.sdeMeta.buildNumber++; },
    m => { m.sdeUrl = m.sdeUrl.replace('3396210', '3632936'); },
    m => { m.sdeMeta.buildNumber = null; },
    m => { m.sdeUrl = 'https://example.test/latest.zip'; },
  ]) {
    const manifest = matchingManifest();
    change(manifest);
    assert.equal(audit.analyzeSdeManifest(manifest).status, 'BUILD_MISMATCH');
  }
  assert.equal(audit.analyzeSdeManifest(null).status, 'NOT_INSPECTED');
  assert.equal(audit.analyzeSdeManifest([]).status, 'INVALID_MANIFEST');
});

test('manifest path handles malformed and absent JSON without altering files', () => {
  const f = fixture();
  try {
    const manifest = path.join(f.directory, 'manifest.json');
    fs.writeFileSync(manifest, '{invalid');
    assert.equal(audit.inspectManifest(manifest).status, 'INVALID_MANIFEST');
    fs.writeFileSync(manifest, JSON.stringify(matchingManifest()));
    assert.equal(audit.inspectManifest(manifest).status, 'BUILD_MATCH');
    assert.equal(audit.inspectManifest(path.join(f.directory, 'missing')).status, 'INVALID_MANIFEST');
  } finally { f.cleanup(); }
});

test('pin check rejects foreign checkout before performing any audit', () => {
  const f = fixture();
  try {
    execFileSync('git', ['init', '-q', f.directory]);
    execFileSync('git', ['-C', f.directory, 'config', 'user.email', 'fixture@example.invalid']);
    execFileSync('git', ['-C', f.directory, 'config', 'user.name', 'Fixture']);
    execFileSync('git', ['-C', f.directory, 'add', '.']);
    execFileSync('git', ['-C', f.directory, 'commit', '-qm', 'fixture']);
    assert.throws(() => audit.resolveCodePath({ codePath: f.code }), /UPSTREAM_PIN_MISMATCH/);
    const res = spawnSync(process.execPath, [path.resolve('scripts/coop-compatibility-audit.cjs'),
      '--code-path', f.code, '--json'], { encoding: 'utf8' });
    assert.equal(res.status, 2);
    assert.match(res.stderr, /UPSTREAM_PIN_MISMATCH/);
  } finally { f.cleanup(); }
});

test('unknown options or missing values are rejected without fallback', () => {
  assert.deepEqual(audit.parseArguments(['--code-path', '/x', '--json']), { codePath: '/x', json: true });
  assert.throws(() => audit.parseArguments(['--code-path']), /MISSING_VALUE/);
  assert.throws(() => audit.parseArguments(['--allow-unpinned']), /UNKNOWN_ARGUMENT/);
});
