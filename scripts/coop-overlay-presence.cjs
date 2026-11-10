#!/usr/bin/env node
'use strict';
// Co-op overlay presence gate.
//
// For every stock file our branch modified, take each line we added that names
// co-op code and check that the same line exists in the engine tree we are
// delivering. A missing line means the overlay is not fully re-anchored; a
// missing file means upstream deleted a file we patched.
//
// Usage:
//   node scripts/coop-overlay-presence.cjs --engine <path to Code/>
//        [--repo <fork checkout>] [--base c3ea396] [--ours coop/pas7std]
//        [--json] [--strict]
//
// Exit code 1 with --strict when anything is missing, 0 otherwise.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const args = process.argv.slice(2);
const opt = (name, fallback = '') => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const engine = opt('--engine');
const repo = opt('--repo', 'C:\\Games\\EveCoop\\upstream-evejs');
const baseRev = opt('--base', 'c3ea396');
const oursRev = opt('--ours', 'coop/pas7std');
const asJson = args.includes('--json');
const strict = args.includes('--strict');

// Once the port is committed, the engine checkout IS the branch: comparing that
// branch with the same checkout would report 100% and mean nothing. Say so.
try {
  const headRev = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const oursFull = execFileSync('git', ['-C', repo, 'rev-parse', oursRev], { encoding: 'utf8' }).trim();
  if (headRev === oursFull) {
    console.error(
      'coop-overlay-presence: --engine points at a checkout of the same revision as --ours (' +
        oursRev +
        '), so this is a self-comparison and will always be 100%. ' +
        'For overlay completeness pass --ours coop/legacy-20261028 (the pre-port line).',
    );
  }
} catch { /* not a git checkout: keep going, the comparison is still meaningful */ }

if (!engine || !fs.existsSync(engine)) {
  console.error('coop-overlay-presence: --engine <path to the engine Code folder> is required and must exist');
  process.exit(2);
}

const git = (cmdArgs) => execFileSync('git', ['-C', repo, ...cmdArgs], { encoding: 'utf8', maxBuffer: 1 << 30 });

function treeOf(rev) {
  const map = new Map();
  for (const rec of git(['ls-tree', '-r', '-z', '--full-tree', rev]).split('\0')) {
    if (!rec) continue;
    const tab = rec.indexOf('\t');
    const meta = rec.slice(0, tab).split(' ');
    map.set(rec.slice(tab + 1), meta[2]);
  }
  return map;
}

const base = treeOf(baseRev);
const ours = treeOf(oursRev);

// Stock files we touched: present in both trees, different blob.
const stockFiles = [];
for (const [p, hash] of ours) {
  if (!p.startsWith('Code/')) continue;
  if (!base.has(p)) continue; // our own new file, nothing to re-anchor
  if (base.get(p) !== hash) stockFiles.push(p);
}
// Stock files we deleted on purpose are not an overlay problem.
const deletedByUs = [...base.keys()].filter((p) => p.startsWith('Code/') && !ours.has(p));

function coopLinesAdded(file) {
  const diff = git(['diff', '-U0', '--no-color', baseRev, oursRev, '--', file]);
  return diff
    .split('\n')
    .filter((l) => l.startsWith('+') && !l.startsWith('+++'))
    .map((l) => l.slice(1))
    .filter((l) => /\bcoop|EVEJS_COOP/.test(l) && l.trim().length > 0);
}

const results = [];
// A re-home can also change the require depth (`./coopX` -> `../coopX`), so the
// comparison normalises require specifiers down to the module basename: the
// question is whether the hook exists, not how many `../` it walks.
const normalize = (line) => line
  .trim()
  .replace(/(["'])\.\.?\/[^"']*?\/(coop[A-Za-z0-9_.-]+)/g, '$1$2')
  .replace(/\s+/g, ' ');
let engineIndex = null;
function relocatedIn(line, sameFile) {
  if (!engineIndex) {
    engineIndex = new Map();
    const stack = [engine];
    while (stack.length) {
      const dir = stack.pop();
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) { stack.push(p); continue; }
        if (!entry.name.endsWith('.js')) continue;
        const rel = path.relative(engine, p).split(path.sep).join('/');
        const text = fs.readFileSync(p, 'utf8');
        for (const l of text.split(/\r?\n/)) {
          const key = normalize(l);
          if (!key) continue;
          if (!engineIndex.has(key)) engineIndex.set(key, rel);
        }
      }
    }
  }
  const hit = engineIndex.get(normalize(line));
  return hit && hit !== sameFile ? hit : null;
}

for (const file of stockFiles) {
  const rel = file.slice(5);
  const target = path.join(engine, rel);
  const lines = coopLinesAdded(file);
  if (lines.length === 0) continue;
  if (!fs.existsSync(target)) {
    results.push({ file: rel, status: 'engine-file-missing', total: lines.length, missing: lines });
    continue;
  }
  const targetLines = new Set(fs.readFileSync(target, 'utf8').split(/\r?\n/).map(normalize));
  const missing = [];
  const relocated = [];
  for (const l of lines) {
    if (targetLines.has(normalize(l))) continue;
    const other = relocatedIn(l, rel);
    if (other) { relocated.push({ line: l.trim().slice(0, 120), in: other }); continue; }
    missing.push(l);
  }
  const status = missing.length === 0 ? (relocated.length ? 'complete-relocated' : 'complete') : 'incomplete';
  results.push({ file: rel, status, total: lines.length, missing, relocated });
}

const summary = {
  engine: path.resolve(engine),
  baseRev,
  oursRev,
  stockFilesTouched: stockFiles.length,
  stockFilesDeletedByUs: deletedByUs.length,
  filesWithCoopLines: results.length,
  complete: results.filter((r) => r.status === 'complete' || r.status === 'complete-relocated').length,
  relocated: results.filter((r) => r.status === 'complete-relocated').length,
  incomplete: results.filter((r) => r.status === 'incomplete').length,
  engineFileMissing: results.filter((r) => r.status === 'engine-file-missing').length,
  missingLines: results.reduce((n, r) => n + r.missing.length, 0),
  worst: results
    .filter((r) => r.missing.length)
    .sort((a, b) => b.missing.length - a.missing.length)
    .slice(0, 15)
    .map((r) => ({ file: r.file, status: r.status, missing: r.missing.length, total: r.total })),
};

if (asJson) {
  console.log(JSON.stringify({ summary, results }, null, 2));
} else {
  console.log(`overlay presence: ${summary.complete}/${summary.filesWithCoopLines} files complete, ${summary.missingLines} co-op line(s) missing, ${summary.engineFileMissing} file(s) gone from the engine`);
  for (const w of summary.worst) console.log(`  ${String(w.missing).padStart(3)}/${String(w.total).padStart(3)} missing  [${w.status}]  ${w.file}`);
}

if (strict && (summary.incomplete || summary.engineFileMissing)) process.exit(1);
