#!/usr/bin/env node
// Parity runner: the whole-suite baseline cannot gate a change right now (a large
// part of the suite still asserts against the pinned checkout, see
// docs/FORK_PATCH_AUDIT_20261028.md), so "no regression" has to be scoped to the
// files a change actually touches.
//
//   node scripts/coop-test-parity.cjs --files coop-npc-probe-wiring,loop-verdict --record
//   node scripts/coop-test-parity.cjs --files coop-npc-probe-wiring,loop-verdict
//   node scripts/coop-test-parity.cjs            # re-check every file in the snapshot
//
// It stores, per test file, the *names* of the failing cases, not just counts, so
// a fix and a new break cannot cancel out. Exit 1 means a case that passed in the
// snapshot fails now; a case that used to fail and passes is reported as an
// improvement and is allowed.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const project = path.resolve(__dirname, '..');
const snapshotPath = path.join(project, 'docs', 'evidence', 'test-parity.json');
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const record = args.includes('--record');
const explicit = opt('--files', '')
  .split(',')
  .map((x) => x.trim())
  .filter(Boolean);

const loadSnapshot = () => {
  if (!fs.existsSync(snapshotPath)) return { files: {} };
  return JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
};
const snapshot = loadSnapshot();
const names = explicit.length ? explicit : Object.keys(snapshot.files || {});
if (!names.length) {
  console.error('no files: pass --files a,b,c or record a snapshot first');
  process.exit(1);
}

function runOne(name) {
  const file = path.join(project, 'tests', name.endsWith('.test.mjs') ? name : `${name}.test.mjs`);
  if (!fs.existsSync(file)) return { missing: true };
  const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', file], { encoding: 'utf8', maxBuffer: 64 << 20 });
  const output = (result.stdout || '') + (result.stderr || '');
  const count = (key) => Number((output.match(new RegExp(`^# ${key} (\\d+)$`, 'm')) || [])[1] || 0);
  const failing = [...output.matchAll(/^not ok \d+ - (.+?)(?: # SKIP.*)?$/gm)]
    .map((m) => m[1].trim())
    .filter((line) => !/^tests[\\/]/.test(line) && line !== name);
  return { pass: count('pass'), fail: count('fail'), skipped: count('skipped'), failing: [...new Set(failing)].sort() };
}

const current = {};
for (const name of names) {
  process.stdout.write('.');
  current[name] = runOne(name);
}
process.stdout.write('\n');

if (record) {
  snapshot.recordedAt = new Date().toISOString();
  snapshot.projectRev = spawnSync('git', ['-C', project, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
  snapshot.files = snapshot.files || {};
  for (const [name, run] of Object.entries(current)) {
    if (run.missing) continue;
    snapshot.files[name] = { pass: run.pass, fail: run.fail, skipped: run.skipped, failing: run.failing };
  }
  fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
  fs.writeFileSync(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  const total = Object.values(snapshot.files).reduce((s, f) => ({ pass: s.pass + f.pass, fail: s.fail + f.fail }), { pass: 0, fail: 0 });
  console.log(`recorded ${Object.keys(snapshot.files).length} file(s) in ${path.relative(project, snapshotPath)}: ${total.pass} pass / ${total.fail} fail`);
  process.exit(0);
}

const regressions = [];
const improvements = [];
for (const [name, run] of Object.entries(current)) {
  if (run.missing) { regressions.push(`${name}: file not found`); continue; }
  const before = (snapshot.files || {})[name];
  if (!before) continue; // nothing recorded: nothing to compare, run --record first
  const known = new Set(before.failing);
  const now = new Set(run.failing);
  for (const title of now) if (!known.has(title)) regressions.push(`${name}: new failure "${title}"`);
  for (const title of known) if (!now.has(title)) improvements.push(`${name}: fixed "${title}"`);
}

const checked = names.filter((n) => (snapshot.files || {})[n]).length;
console.log(`parity: checked ${checked}/${names.length} recorded file(s), ${improvements.length} improvement(s)`);
if (improvements.length) for (const line of improvements) console.log(`  FIXED ${line}`);
if (regressions.length) {
  console.log('\nPARITY_REGRESSION');
  for (const line of regressions) console.log(`  ${line}`);
  process.exit(1);
}
console.log('PARITY_OK');
