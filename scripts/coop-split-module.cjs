#!/usr/bin/env node
// Split a "giga" engine module by extracting a self-contained slice.
//
// A file with thousands of lines in one scope is a maintenance hazard: nothing
// can be tested in isolation and every edit risks a hidden coupling. This tool
// finds top-level declarations that do NOT touch the module's mutable state
// (`let`/`var`), so they are pure w.r.t. the rest of the file, and can move into
// their own module with no behaviour change. The original file keeps a
// destructuring require, so its public exports and call sites stay identical.
//
// Usage:
//   node scripts/coop-split-module.cjs --file space/coopVirtualWorldRuntime.js
//   node scripts/coop-split-module.cjs --file <rel> --out space/virtualWorld/<name>.js --apply
//
// Options: --code-path <.../Code>  --file <rel to server/src>  --out <rel to server/src>
//          --apply (default is a dry run)  --json
//
// Exit codes: 0 = slice found (dry run) or applied and verified, 2 = nothing
// movable, 1 = error. `--apply` refuses to write unless `node --check` passes.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const CODE = opt('--code-path', 'C:\\Games\\EveCoop\\upstream-evejs\\Code');
const SERVER = path.join(CODE, 'server', 'src');
const relFile = opt('--file', '');
const apply = args.includes('--apply');
const asJson = args.includes('--json');
if (!relFile) {
  console.error('usage: --file <path relative to server/src> [--out <path>] [--apply]');
  process.exit(1);
}
const absFile = path.join(SERVER, relFile);
if (!fs.existsSync(absFile)) {
  console.error(`no such file: ${absFile}`);
  process.exit(1);
}
const outRel = opt('--out', path.join(path.dirname(relFile), `${path.basename(relFile, '.js')}.pure.js`));
const absOut = path.join(SERVER, outRel);

const source = fs.readFileSync(absFile, 'utf8');
const lines = source.split('\n');
const depthOf = (l) => {
  let d = 0;
  for (const ch of l) { if ('{(['.includes(ch)) d++; else if ('})]'.includes(ch)) d--; }
  return d;
};

// --- top-level declarations --------------------------------------------------
const decls = [];
let braceDepth = 0;
let current = null;
for (let i = 0; i < lines.length; i++) {
  const l = lines[i];
  const m = /^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)|^(const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/.exec(l);
  if (braceDepth === 0 && m) {
    if (current) decls.push(current);
    current = { name: m[1] || m[3], kind: m[1] ? 'function' : m[2], start: i, end: i };
  } else if (current) {
    current.end = i;
  }
  braceDepth += depthOf(l);
}
if (current) decls.push(current);
for (const d of decls) d.len = d.end - d.start + 1;

// --- which names are mutable module state -----------------------------------
const mutable = new Set(decls.filter((d) => d.kind === 'let' || d.kind === 'var').map((d) => d.name));
const byName = new Map(decls.map((d) => [d.name, d]));
const refsOf = (d) => {
  const body = lines.slice(d.start, d.end + 1).join('\n');
  const out = [];
  for (const other of decls) {
    if (other.name === d.name) continue;
    if (new RegExp(`(?<![.\\w$])${other.name.replace(/\$/g, '\\$')}(?![\\w$])`).test(body)) out.push(other.name);
  }
  return out;
};
for (const d of decls) d.refs = refsOf(d);

// fixpoint: movable = touches no mutable state and no non-movable declaration
const movable = new Set();
for (const d of decls) if (!mutable.has(d.name) && !d.refs.some((r) => mutable.has(r))) movable.add(d.name);
let changed = true;
while (changed) {
  changed = false;
  for (const name of [...movable]) {
    const d = byName.get(name);
    if (d.refs.some((r) => !movable.has(r) && byName.has(r))) { movable.delete(name); changed = true; }
  }
}
for (const name of mutable) movable.delete(name);
// the file's own header (requires, constants above the first declaration) is copied
const headerEnd = decls.length ? decls[0].start : lines.length;
const header = lines.slice(0, headerEnd);

const slice = decls.filter((d) => movable.has(d.name) && byName.get(d.name));
const sliceLines = slice.reduce((s, d) => s + d.len, 0);
const report = {
  file: relFile,
  lines: lines.length,
  declarations: decls.length,
  mutableState: [...mutable],
  movableDeclarations: slice.length,
  movableLines: sliceLines,
  out: outRel,
  names: slice.map((d) => d.name),
};

if (asJson) console.log(JSON.stringify(report, null, 2));
else {
  console.log(`${relFile}: ${lines.length} lines, ${decls.length} top-level declarations`);
  console.log(`mutable state: ${report.mutableState.join(', ') || 'none'}`);
  console.log(`movable (touch no mutable state, no non-movable sibling): ${slice.length} declarations, ${sliceLines} lines`);
  console.log(`  ${report.names.join(', ')}`);
  console.log(apply ? `writing ${outRel}` : `dry run: would write ${outRel} (use --apply)`);
}

if (!slice.length) process.exit(2);
if (!apply) process.exit(0);

// --- apply ------------------------------------------------------------------
const body = slice
  .slice()
  .sort((a, b) => a.start - b.start)
  .map((d) => lines.slice(d.start, d.end + 1).join('\n'))
  .join('\n\n');
const banner = `// Extracted from ${relFile} by scripts/coop-split-module.cjs.\n// These declarations touch no module state, so they are pure helpers: they can be\n// read, tested and changed without loading the runtime. The parent file requires\n// them back, so its exports and call sites are unchanged.\n\n`;
const moduleSource = `${banner}${header.join('\n')}\n${body}\n\nmodule.exports = {${slice.map((d) => d.name).join(', ')}};\n`;
fs.writeFileSync(absOut, moduleSource);

const removeLines = new Set();
for (const d of slice) for (let i = d.start; i <= d.end; i++) removeLines.add(i);
const kept = [];
let insertAt = -1;
for (let i = 0; i < lines.length; i++) {
  if (removeLines.has(i)) {
    // collapse the blank line that preceded an extracted block
    if (kept.length && kept[kept.length - 1].trim() === '') kept.pop();
    continue;
  }
  if (i === headerEnd && insertAt === -1) insertAt = kept.length;
  kept.push(lines[i]);
}
if (insertAt === -1) insertAt = kept.length;
const requireLine = `const { ${slice.map((d) => d.name).join(', ')} } = require(${JSON.stringify('./' + path.basename(outRel, '.js'))});`;
kept.splice(
  insertAt,
  0,
  '',
  `// Pure helpers live in ${outRel} (split by scripts/coop-split-module.cjs).`,
  requireLine,
);
fs.writeFileSync(absFile, kept.join('\n'));

try {
  execFileSync(process.execPath, ['--check', absFile], { stdio: 'pipe' });
  execFileSync(process.execPath, ['--check', absOut], { stdio: 'pipe' });
} catch (err) {
  console.error('node --check failed, restoring');
  fs.writeFileSync(absFile, source);
  fs.unlinkSync(absOut);
  console.error(String(err.stderr || err));
  process.exit(1);
}
console.log(`applied: ${slice.length} declarations (${sliceLines} lines) -> ${outRel}`);
console.log(`parent now ${lines.length - sliceLines} lines`);
