#!/usr/bin/env node
// Engine patch-surface audit (read-only).
//
// Since 2026-10-28 the server code is our own fork (pas7-studio/EveJS,
// branch coop/pas7std), so "how much of the engine is a patch?" must be a
// measured number, not an impression. This tool answers three questions and
// never writes anything:
//
//   1. how much co-op code still sits inside stock EveJS files
//      (a hook line or a longer insertion = a future merge cost);
//   2. does the engine still contain runtime patching (monkey patches,
//      require-cache or source rewriting) that should be a module instead;
//   3. is every integration/*.cjs copy identical to the file the server runs.
//
// Usage: node scripts/coop-engine-audit.cjs [--code-path <.../Code>] [--json]
// Exit codes: 0 = AUDIT_OK, 1 = AUDIT_REGRESSION (a threshold was crossed).

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const asJson = args.includes('--json');
const CODE = flag('--code-path', 'C:\\Games\\EveCoop\\upstream-evejs\\Code');
const REPO = path.resolve(__dirname, '..');

// Budgets. Raising one is a deliberate decision, not a side effect of a commit:
// write down why in docs/FORK_PATCH_AUDIT_20261028.md.
const BUDGET = {
  stockFilesMax: 70, // stock files that mention the co-op layer at all
  stockLinesMax: 700, // total co-op lines inside stock files
  stockCharsMax: 67000, // characters of co-op code inside stock files: the real burden
  bigFileCharsMax: 15000, // one stock file before extraction is due
  monkeyPatches: 0, // prototype reassignment / defineProperty on stock classes
  sourceRewrites: 0, // writeFileSync(__filename) / require.cache juggling
  patchScriptsMax: 78, // frozen legacy transform library; may only shrink
  integrationDriftMax: 0, // integration/*.cjs must equal the deployed copy
};

const walk = (dir, acc = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', '_secondary', 'prof'].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else acc.push(p);
  }
  return acc;
};

const rel = (p) => path.relative(CODE, p).replace(/\\/g, '/');
const isCoopModule = (p) => /^coop[\w.-]*\.js$/.test(path.basename(p));

// 1. co-op surface inside stock files ---------------------------------------
const serverRoot = path.join(CODE, 'server', 'src');
if (!fs.existsSync(serverRoot)) {
  console.error(`no server source at ${serverRoot}`);
  process.exit(1);
}
const jsFiles = walk(serverRoot).filter((p) => p.endsWith('.js'));
const COOP_RE = /EVEJS_COOP_|require\(["'][^"']*coop|\bcoop[A-Z]\w*/;
const stock = [];
for (const p of jsFiles) {
  if (isCoopModule(p)) continue;
  const lines = fs.readFileSync(p, 'utf8').split('\n');
  const hit = [];
  let chars = 0;
  lines.forEach((l, i) => {
    if (COOP_RE.test(l)) { hit.push(i + 1); chars += l.length; }
  });
  if (!hit.length) continue;
  const hookCalls = hit.filter((i) => /require\(["'][^"']*coop[^"']*["']\)\s*\./.test(lines[i - 1])).length;
  stock.push({ file: rel(p), lines: hit.length, chars, hookCalls, firstHit: hit[0] });
}
stock.sort((a, b) => b.chars - a.chars);

// 2. runtime patching smells ------------------------------------------------
const SMELLS = [
  ['prototype reassignment', /\.prototype\.[A-Za-z_$][\w$]*\s*=(?!=)/g],
  ['defineProperty on prototype', /Object\.defineProperty\([^)]*prototype/g],
  ['require.cache hijack', /require\.cache\s*\[/g],
  ['Module._load hook', /Module\._load|Module\._resolveFilename/g],
  ['new Function', /new Function\(/g],
  ['vm.run*', /vm\.runIn(New|This)Context/g],
  ['self source rewrite', /writeFileSync\(\s*__filename/g],
];
const smells = [];
let sourceRewrites = 0;
for (const p of jsFiles) {
  const src = fs.readFileSync(p, 'utf8');
  for (const [name, re] of SMELLS) {
    const n = (src.match(re) || []).length;
    if (!n) continue;
    if (/source rewrite|require\.cache|Module\._load|new Function|vm\.run/.test(name)) sourceRewrites += n;
    smells.push({ smell: name, file: rel(p), count: n, coop: isCoopModule(p) });
  }
}

// 3. integration copies vs deployed files ----------------------------------
const integDir = path.join(REPO, 'integration');
const drift = [];
if (fs.existsSync(integDir)) {
  for (const f of fs.readdirSync(integDir).filter((x) => x.endsWith('.cjs'))) {
    const target = path.join(serverRoot, 'space', f.replace(/\.cjs$/, '.js'));
    if (!fs.existsSync(target)) {
      drift.push({ file: f, state: 'MISSING_IN_ENGINE' });
      continue;
    }
    if (fs.readFileSync(path.join(integDir, f), 'utf8') !== fs.readFileSync(target, 'utf8')) {
      drift.push({ file: f, state: 'DIFFERS' });
    }
  }
}

// 4. legacy transform library (frozen, not growing) ------------------------
const scriptsDir = path.join(REPO, 'scripts');
const patchScripts = fs.existsSync(scriptsDir)
  ? fs.readdirSync(scriptsDir).filter((f) => f.endsWith('.cjs') && /patch/i.test(f))
  : [];

const totals = {
  stockFiles: stock.length,
  stockLines: stock.reduce((s, x) => s + x.lines, 0),
  stockChars: stock.reduce((s, x) => s + x.chars, 0),
  biggestFile: stock[0] ? { file: stock[0].file, lines: stock[0].lines, chars: stock[0].chars } : null,
  coopsModules: jsFiles.filter(isCoopModule).length,
  smells: smells.length,
  sourceRewrites,
  patchScripts: patchScripts.length,
  integrationDrift: drift.length,
};

const failures = [];
if (totals.stockFiles > BUDGET.stockFilesMax) failures.push(`stockFiles ${totals.stockFiles} > ${BUDGET.stockFilesMax}`);
if (totals.stockLines > BUDGET.stockLinesMax) failures.push(`stockLines ${totals.stockLines} > ${BUDGET.stockLinesMax}`);
if (totals.stockChars > BUDGET.stockCharsMax) failures.push(`stockChars ${totals.stockChars} > ${BUDGET.stockCharsMax}`);
if (totals.biggestFile && totals.biggestFile.chars > BUDGET.bigFileCharsMax)
  failures.push(`biggest stock file ${totals.biggestFile.file} ${totals.biggestFile.chars} chars > ${BUDGET.bigFileCharsMax}`);
if (totals.sourceRewrites > BUDGET.sourceRewrites) failures.push(`source-level patching ${totals.sourceRewrites} > 0`);
if (totals.patchScripts > BUDGET.patchScriptsMax) failures.push(`patch scripts ${totals.patchScripts} > ${BUDGET.patchScriptsMax}`);
if (totals.integrationDrift > BUDGET.integrationDriftMax)
  failures.push(`integration drift ${totals.integrationDrift} > ${BUDGET.integrationDriftMax}`);

if (asJson) {
  console.log(JSON.stringify({ code: CODE, totals, budget: BUDGET, failures, stock, smells, drift }, null, 2));
} else {
  console.log(`engine      ${CODE}`);
  console.log(`co-op modules ${totals.coopsModules}, stock files touched ${totals.stockFiles}, co-op lines in them ${totals.stockLines} (${totals.stockChars} chars)`);
  console.log(`biggest     ${totals.biggestFile ? `${totals.biggestFile.file} (${totals.biggestFile.lines} lines, ${totals.biggestFile.chars} chars)` : 'none'}`);
  console.log(`runtime patching: ${totals.sourceRewrites} (monkey-patch/require-cache/source-rewrite sites: ${totals.smells})`);
  console.log(`legacy patch scripts ${totals.patchScripts} (budget ${BUDGET.patchScriptsMax}), integration copies differing ${totals.integrationDrift}`);
  if (stock.length) {
    console.log('\nstock files by co-op surface (extraction candidates first):');
    for (const s of stock.slice(0, 8)) console.log(`  ${String(s.chars).padStart(5)}c ${String(s.lines).padStart(3)}L ${s.file} (${s.hookCalls} hook calls)`);
  }
  if (drift.length) {
    console.log('\nintegration drift:');
    for (const d of drift) console.log(`  ${d.state} ${d.file}`);
  }
  console.log(failures.length ? `\nAUDIT_REGRESSION\n  ${failures.join('\n  ')}` : '\nAUDIT_OK');
}
process.exit(failures.length ? 1 : 0);
