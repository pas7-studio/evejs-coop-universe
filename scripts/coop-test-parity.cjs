#!/usr/bin/env node
// Parity runner: the whole-suite baseline cannot gate a change right now (a large
// part of the suite still asserts against the pinned checkout, see
// docs/FORK_PATCH_AUDIT_20261028.md), so "no regression" has to be scoped to the
// files a change actually touches.
//
//   node scripts/coop-test-parity.cjs --files coop-npc-probe-wiring,loop-verdict --record
//   node scripts/coop-test-parity.cjs --files coop-npc-probe-wiring,loop-verdict
//   node scripts/coop-test-parity.cjs            # re-check every file in the snapshot
//   node scripts/coop-test-parity.cjs --jobs 1   # force serial runs (default: up to 8)
//
// It stores, per test file, the *names* of the failing cases, not just counts, so
// a fix and a new break cannot cancel out. Exit 1 means a case that passed in the
// snapshot fails now; a case that used to fail and passes is reported as an
// improvement and is allowed.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

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

// One process per test file, N at a time. Node's own runner already runs test
// files in parallel, and every case here is isolated in its own process, so the
// only thing that changes is wall-clock time. Kept well below the core count:
// this machine is shared with other sessions, and 31 suites at once is not
// kinder to anything.
const jobs = Math.max(1, Math.min(8, Number(opt('--jobs', 0)) ||
  Math.max(1, (os.availableParallelism ? os.availableParallelism() : os.cpus().length) - 2)));

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

function summarize(name, output) {
  const count = (key) => Number((output.match(new RegExp(`^# ${key} (\\d+)$`, 'm')) || [])[1] || 0);
  const failing = [...output.matchAll(/^not ok \d+ - (.+?)(?: # SKIP.*)?$/gm)]
    .map((m) => m[1].trim())
    .filter((line) => !/^tests[\\/]/.test(line) && line !== name);
  return { pass: count('pass'), fail: count('fail'), skipped: count('skipped'), failing: [...new Set(failing)].sort() };
}

function runOne(name) {
  const file = path.join(project, 'tests', name.endsWith('.test.mjs') ? name : `${name}.test.mjs`);
  if (!fs.existsSync(file)) return Promise.resolve({ missing: true });
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--test', '--test-reporter=tap', file]);
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.on('error', reject);
    child.on('close', () => resolve(summarize(name, output)));
  });
}

async function runAll(list) {
  const results = new Array(list.length);
  let next = 0;
  const worker = async () => {
    while (next < list.length) {
      const index = next++;
      process.stdout.write('.');
      results[index] = await runOne(list[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(jobs, list.length) }, worker));
  process.stdout.write('\n');
  return results;
}

async function main() {
  const outcomes = await runAll(names);
  const current = {};
  names.forEach((name, index) => { current[name] = outcomes[index]; });

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
}

main().catch((error) => {
  console.error(error && error.message ? error.message : error);
  process.exit(1);
});
