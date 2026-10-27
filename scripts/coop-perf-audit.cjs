#!/usr/bin/env node
// Performance-trap audit for the co-op engine (read-only).
//
// The engine already paid for this lesson twice: nativeNpcStore re-read and
// double-cloned its whole root on every call (86.7% of one core), and CONCORD
// rules went through JSON.parse(JSON.stringify()) on every cache hit. Both were
// invisible in tests and obvious under a profiler. This tool looks for the same
// shapes *statically*, ranked by how often they appear in a module, so a hot
// path is cheap to find without a live profile.
//
// Usage: node scripts/coop-perf-audit.cjs [--code-path <.../Code>] [--top <n>] [--json]
// Exit codes: 0 = clean or within budget, 1 = budget exceeded (a new trap class
// appeared in a hot module).

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const CODE = opt('--code-path', 'C:\\Games\\EveCoop\\upstream-evejs\\Code');
const TOP = Number(opt('--top', '12'));
const asJson = args.includes('--json');
const SERVER = path.join(CODE, 'server', 'src');

const walk = (dir, acc = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', '_secondary', 'prof'].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc); else if (p.endsWith('.js')) acc.push(p);
  }
  return acc;
};

// Each trap is a shape that is cheap once and catastrophic per tick.
const TRAPS = [
  ['deep-clone via JSON round-trip', /JSON\.parse\(\s*JSON\.stringify\(/g, 8],
  ['readFileSync inside a function', /^\s{2,}.*readFileSync\(/gm, 10],
  ['require() inside a function body', /^\s{2,}.*=\s*require\(/gm, 2],
  ['new RegExp inside a function body', /^\s{2,}.*new RegExp\(/gm, 6],
  ['path.join inside a function body', /^\s{2,}.*path\.join\(__dirname/gm, 4],
  ['sort() on a per-tick array', /^\s{2,}.*\.sort\(/gm, 5],
  ['O(n^2) nested find/filter', /\.filter\([^)]*\)\s*\.(find|filter|some|map)\(/g, 8],
  ['Array.find over a big array in a loop', /for\s*\(.*\)\s*\{[\s\S]{0,200}?\.find\(/g, 6],
  ['Date.now() inside a loop', /for\s*\([\s\S]{0,120}?Date\.now\(\)/g, 6],
  ['sync structuredClone of engine state', /structuredClone\(/g, 3],
  ['JSON.stringify for a cache key', /JSON\.stringify\([^)]*\)\s*(?:as|\]|,)/g, 4],
  ['unbounded array growth (push without cap)', /^\s{2,}.*\.push\([^)]*\);\s*$/gm, 1],
];

const files = walk(SERVER);
const findings = [];
for (const p of files) {
  const src = fs.readFileSync(p, 'utf8');
  if (src.length > 2_000_000) continue;
  const rows = [];
  let score = 0;
  for (const [name, re, weight] of TRAPS) {
    const hits = [...src.matchAll(re)];
    if (!hits.length) continue;
    const lineOf = (idx) => src.slice(0, idx).split('\n').length;
    rows.push({ trap: name, count: hits.length, weight, sample: hits.slice(0, 2).map((h) => lineOf(h.index)) });
    score += hits.length * weight;
  }
  if (!rows.length) continue;
  findings.push({ file: path.relative(SERVER, p).replace(/\\/g, '/'), lines: src.split('\n').length, score, rows });
}
findings.sort((a, b) => b.score - a.score);

const totals = {};
for (const f of findings) for (const r of f.rows) totals[r.trap] = (totals[r.trap] || 0) + r.count;

// Budget: the three known-fixed classes must stay at zero, and no single module
// may accumulate a score that says "this is a per-tick clone machine".
const BUDGET = { 'deep-clone via JSON round-trip': 180, 'require() inside a function body': 950 };
const failures = Object.entries(BUDGET)
  .filter(([trap, max]) => (totals[trap] || 0) > max)
  .map(([trap, max]) => `${trap}: ${totals[trap]} > ${max}`);

if (asJson) {
  console.log(JSON.stringify({ code: CODE, totals, findings, failures }, null, 2));
} else {
  console.log(`engine ${CODE}`);
  console.log('traps by count:');
  for (const [name, n] of Object.entries(totals).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(5)}  ${name}`);
  console.log(`\nhottest modules by weighted score (top ${TOP}):`);
  for (const f of findings.slice(0, TOP)) {
    console.log(`  ${String(f.score).padStart(5)}  ${String(f.lines).padStart(5)}L  ${f.file}`);
    console.log(`         ${f.rows.map((r) => `${r.trap} x${r.count}@${r.sample.join(',')}`).join(' | ')}`);
  }
  console.log(failures.length ? `\nPERF_REGRESSION\n  ${failures.join('\n  ')}` : '\nPERF_OK');
}
process.exit(failures.length ? 1 : 0);
