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
// movable, 1 = error. `--apply` refuses to write unless `node --check` passes AND
// scripts/coop-split-check.cjs confirms the sibling touches no module state.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { bindingNames } = require('./lib/js-declarations.cjs');

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
// A moved body keeps its relative `require("./x")` calls, so the new module has
// to live in the same directory as the parent or those calls silently resolve
// elsewhere. Refuse instead of writing a file that breaks at runtime.
if (path.resolve(path.dirname(outRel)) !== path.resolve(path.dirname(relFile))) {
  console.error(`--out must stay in ${path.dirname(relFile)} (moved bodies keep relative require() calls)`);
  process.exit(1);
}
const absOut = path.join(SERVER, outRel);

const source = fs.readFileSync(absFile, 'utf8');
// Refuse to re-split a file that already has its sibling: the only thing left to
// "move" would be the parent's own destructuring require, i.e. an empty split.
const siblingBase = path.basename(outRel, '.js');
if (new RegExp(`require\\(\\s*["']\\./${siblingBase}["']\\s*\\)`).test(source)) {
  console.error(`${relFile} is already split into ${outRel}; re-splitting would only move its own require`);
  process.exit(1);
}
const lines = source.split('\n');
const depthOf = (l) => {
  let d = 0;
  for (const ch of l) { if ('{(['.includes(ch)) d++; else if ('})]'.includes(ch)) d--; }
  return d;
};

// --- top-level declarations --------------------------------------------------
// A statement may declare SEVERAL names (`let world=null,bridge=null,...`).
// Missing the second name is how a split moved code that assigns `bridge`: the
// name looked free, so it moved, and the running server threw ReferenceError at
// the first tick of that phase. Every declarator counts, on every line of the
// statement.
const decls = [];
let braceDepth = 0;
let current = null;
const namesOfStatement = (text, kind) => {
  if (kind !== 'const' && kind !== 'let' && kind !== 'var') return new Set();
  const afterKeyword = text.replace(/^\s*(?:const|let|var)\s+/, '');
  return bindingNames(afterKeyword);
};
for (let i = 0; i < lines.length; i++) {
  const l = lines[i];
  const fn = /^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/.exec(l);
  const cls = /^class\s+([A-Za-z_$][\w$]*)/.exec(l);
  const vars = /^(const|let|var)\s/.exec(l);
  if (braceDepth === 0 && (fn || cls || vars)) {
    if (current) decls.push(current);
    current = {
      name: fn ? fn[1] : cls ? cls[1] : null,
      kind: fn ? 'function' : cls ? 'class' : vars[1],
      start: i,
      end: i,
    };
  } else if (current) {
    // `module.exports` closes the file's last declaration; absorbing it would make
    // that declaration look coupled to every name in the export list.
    if (/^module\.exports\b/.test(l)) { decls.push(current); current = null; }
    else current.end = i;
  }
  braceDepth += depthOf(l);
}
if (current) decls.push(current);
// A statement's range ran to the next declaration, so trailing blank and comment
// lines came with it: the comments moved into the sibling and their words became
// bogus declarator names (`data, not a constant` -> "not"). Trim them back.
const isCommentOrBlank = (line) =>
  /^\s*$/.test(line) || /^\s*\/[/*]/.test(line) || /^\s*\*/.test(line);
for (const d of decls) {
  while (d.end > d.start && isCommentOrBlank(lines[d.end])) d.end--;
}
// Resolve the bound names once the statement's full range is known: a
// declaration list may continue on the following lines.
for (const d of decls) {
  if (d.kind === 'function' || d.kind === 'class') d.names = [d.name];
  else {
    const text = lines.slice(d.start, d.end + 1).join('\n')
      .replace(/\/\/[^\n]*/g, ' ')
      .replace(/\/\*[\s\S]*?\*\//g, ' ');
    d.names = [...namesOfStatement(text, d.kind)];
  }
  d.name = d.name || d.names[0];
  d.len = d.end - d.start + 1;
  if (!d.names.length) throw new Error(`cannot read the declarators at line ${d.start + 1}`);
}

// --- which names are mutable module state -----------------------------------
// EVERY name of a `let`/`var` statement is mutable state, not only the first one.
const mutable = new Set(decls.filter((d) => d.kind === 'let' || d.kind === 'var').flatMap((d) => d.names));
const byName = new Map(decls.map((d) => [d.name, d]));
const refsOf = (d) => {
  const body = lines.slice(d.start, d.end + 1).join('\n');
  const out = [];
  for (const other of decls) {
    if (other === d) continue;
    if (other.names.some((name) => new RegExp(`(?<![.\\w$])${name.replace(/\$/g, '\\$')}(?![\\w$])`).test(body))) out.push(other.name);
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
  names: slice.flatMap((d) => d.names),
  declarationsDetail: decls.map((d) => ({
    name: d.name, kind: d.kind, names: d.names, line: d.start + 1,
    refs: d.refs, movable: movable.has(d.name),
  })),
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
const moduleSource = `${banner}${header.join('\n')}\n${body}\n\nmodule.exports = {${slice.flatMap((d) => d.names).join(', ')}};\n`;
fs.writeFileSync(absOut, moduleSource);

const removeLines = new Set();
for (const d of slice) for (let i = d.start; i <= d.end; i++) removeLines.add(i);
const kept = [];
let insertAt = -1;
for (let i = 0; i < lines.length; i++) {
  if (removeLines.has(i)) {
    // collapse the blank line that preceded an extracted block
    if (kept.length && kept[kept.length - 1].trim() === '') kept.pop();
    // The require goes where the FIRST extracted declaration was, not at the top
    // of the file: a moved `const` (a config value, for instance) must still be
    // initialised before the parent's own statements read it, or the parent
    // throws "Cannot access X before initialization" at load.
    if (insertAt === -1) insertAt = kept.length;
    continue;
  }
  kept.push(lines[i]);
}
if (insertAt === -1) insertAt = kept.length;
const requireLine = `const { ${slice.flatMap((d) => d.names).join(', ')} } = require(${JSON.stringify('./' + path.basename(outRel, '.js'))});`;
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

// The static proof that the split is safe. `node --check` cannot see it: code that
// assigns a name which only exists in the parent parses fine and only throws when
// that line finally runs - which is how a live war phase stopped advancing.
const restore = (reason) => {
  console.error(reason);
  console.error('restoring the parent and removing the sibling');
  fs.writeFileSync(absFile, source);
  fs.unlinkSync(absOut);
  process.exit(1);
};
try {
  execFileSync(process.execPath, [path.join(__dirname, 'coop-split-check.cjs'),
    '--code-path', CODE, '--parent', relFile, '--sibling', outRel], { stdio: 'pipe' });
} catch (err) {
  restore(`split check failed:\n${String(err.stdout || '')}${String(err.stderr || '')}`);
}
console.log(`applied: ${slice.length} declarations (${sliceLines} lines) -> ${outRel}`);
console.log(`parent now ${lines.length - sliceLines} lines`);
