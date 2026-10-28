#!/usr/bin/env node
// Verify a split produced by scripts/coop-split-module.cjs.
//
// Why this exists: the splitter moved declarations it believed were "state free"
// because it only saw the FIRST name on a multi-declarator `let` line
// (`let world=null,bridge=null,...`). Code that assigns such a name then lived in
// a module where the name does not exist, so the running server threw
// "warpPointDirector is not defined" the moment the phase ran. `node --check`,
// `require()` and every text-based test were all happy with it.
//
// Three findings, in order of severity:
//   UNDECLARED  a name the sibling assigns or reads but never declares. In strict
//               mode that is a ReferenceError at the moment the line runs, which
//               is a silently stopped phase, not a crash at load.
//   TWO_STATES  a name declared at module level in BOTH the parent and the
//               sibling. That is two copies of one piece of state and only a
//               binder keeps them equal; miss one bind and a phase reads a stale
//               copy (this is how the war reverted to an empty state).
//   COUPLING    a name the sibling uses that only the parent declares.
//
//   node scripts/coop-split-check.cjs                  # every split sibling it finds
//   node scripts/coop-split-check.cjs --parent space/x.js --sibling space/x.pure.js
//   node scripts/coop-split-check.cjs --explain name    # why is this name bound?
//
// Exit 1 = unsafe split. Exit 2 = nothing to check.

const fs = require("fs");
const path = require("path");
const {
  stripComments, bindingNames: bindingNamesPublic, declaredNames, moduleLevelNames, moduleLevelStatements, assignedNames, usedNames,
} = require("./lib/js-declarations.cjs");

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const CODE = opt("--code-path") || "C:\\Games\\EveCoop\\upstream-evejs\\Code";
const SERVER = path.join(CODE, "server", "src");

function checkPair(parentRel, siblingRel) {
  const parentSource = fs.readFileSync(path.join(SERVER, parentRel), "utf8");
  const parentText = stripComments(parentSource);
  const siblingText = stripComments(fs.readFileSync(path.join(SERVER, siblingRel), "utf8"));
  const parentTop = moduleLevelNames(parentText);
  // The parent re-requires the split sibling on purpose; that destructuring is
  // not a second copy of the state, it IS the sibling's own declaration. Matched
  // on the raw source: stripComments() drops string literals, i.e. the specifier.
  const base = path.basename(siblingRel, ".js");
  for (const m of parentSource.matchAll(new RegExp(`(?:const|let|var)\\s*(\\{[^}]*\\}|[A-Za-z_$][\\w$]*)\\s*=\\s*require\\(\\s*["']\\./${base}["']\\s*\\)`, "g"))) {
    const bound = m[1].startsWith("{") ? m[1].slice(1, -1) : m[1];
    for (const name of bindingNamesPublic(bound)) parentTop.delete(name);
  }
  const siblingTop = moduleLevelNames(siblingText);
  const declared = declaredNames(siblingText);
  const assigned = assignedNames(siblingText);
  const used = usedNames(siblingText);

  const undeclared = [...new Set([...assigned, ...used].filter((n) => !declared.has(n)))]
    .filter((n) => !parentTop.has(n))
    .sort();
  const coupling = [...new Set([...assigned, ...used].filter((n) => !declared.has(n) && parentTop.has(n)))].sort();
  const twoStates = [...siblingTop].filter((n) => parentTop.has(n)).sort();
  // Two copies of one state are only equal while something hands the live object
  // over. A name declared in both modules but never passed to a binder is a stale
  // copy by construction - this is how the war reverted to an empty state.
  const bound = new Set();
  const binderCalls = [...parentText.matchAll(/\bbind[A-Za-z0-9_$]*\s*\(\s*\{([^}]*)\}/g)];
  for (const m of binderCalls) {
    for (const name of bindingNamesPublic(m[1])) bound.add(name);
  }
  // A binder that nobody calls leaves every two-state name stale: the copies exist
  // but nothing ever refreshes them. Look at the enclosing module-level function.
  const binderNeverCalled = [];
  for (const call of binderCalls) {
    const before = parentText.slice(0, call.index);
    const owner = [...before.matchAll(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm)].pop();
    if (!owner) continue; // module scope: it runs when the file loads
    const uses = parentText.split(new RegExp(`\\b${owner[1]}\\b`)).length - 1;
    if (uses <= 1) binderNeverCalled.push(owner[1]);
  }
  // "the parent assigns it" must mean a real assignment outside the declaration
  // itself: `let warFleetRegistry=null` is an initialiser, not a live copy.
  const declarationLines = moduleLevelStatements(parentText);
  const parentLines = parentText.split("\n");
  const writtenOutsideDeclaration = (name) => {
    const re = new RegExp(`(?<![.\\w$])${name}\\s*(?:(?:\\+|-|\\*|/|%)?=|\\+\\+|--)`);
    return parentLines.some((line, i) =>
      !declarationLines.some((d) => i >= d.startLine && i <= d.endLine) && re.test(line));
  };
  const unbound = twoStates.filter((n) => !bound.has(n) && writtenOutsideDeclaration(n));
  // Declared in the parent, never assigned there: the copy is inert and only the
  // sibling's is live. Harmless, but it reads like shared state, so it is listed.
  const dead = twoStates.filter((n) => !bound.has(n) && !writtenOutsideDeclaration(n));

  const problems = [];
  for (const n of undeclared) problems.push(`UNDECLARED ${n}: used but declared nowhere -> ReferenceError (strict mode)`);
  for (const n of twoStates) problems.push(`TWO_STATES ${n}: declared in both ${path.basename(parentRel)} and ${path.basename(siblingRel)}`);
  for (const n of unbound) problems.push(`UNBOUND_STATE ${n}: two copies, the parent assigns its own and no binder hands it over`);
  for (const n of binderNeverCalled) problems.push(`BINDER_NEVER_CALLED ${n}(): the binder is defined but nothing invokes it, so every two-state name stays stale`);
  for (const n of coupling) problems.push(`COUPLING ${n}: owned by ${path.basename(parentRel)}, used by the sibling`);
  const notes = dead.map((n) => `DEAD_STATE ${n}: declared in the parent, never assigned there - only the sibling's copy is live`);
  return { parentRel, siblingRel, declared: declared.size, assigned: assigned.size, problems, notes };
}

const explicitParent = opt("--parent");
const explicitSibling = opt("--sibling");
const explain = opt("--explain");
if (explain) {
  const siblingRel = explicitSibling || "space/coopVirtualWorldRuntime.pure.js";
  const text = stripComments(fs.readFileSync(path.join(SERVER, siblingRel), "utf8"));
  const siblingTop = moduleLevelNames(text);
  const declared = declaredNames(text);
  console.log(`${explain}: declared=${declared.has(explain)} moduleLevel=${siblingTop.has(explain)} assigned=${assignedNames(text).has(explain)} used=${usedNames(text).has(explain)}`);
  process.exit(0);
}

let pairs = [];
if (explicitParent && explicitSibling) {
  pairs = [[explicitParent, explicitSibling]];
} else {
  const walk = (dir, acc = []) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (["node_modules", ".git", "_secondary"].includes(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, acc);
      else if (/\.js$/.test(entry.name)) acc.push(full);
    }
    return acc;
  };
  for (const file of walk(SERVER)) {
    const head = fs.readFileSync(file, "utf8").slice(0, 300);
    const origin = /Extracted from (?:server\/src\/)?(\S+\.js)/.exec(head);
    if (!origin) continue;
    pairs.push([origin[1], path.relative(SERVER, file).replace(/\\/g, "/")]);
  }
}

if (!pairs.length) {
  console.log("no split siblings found");
  process.exit(2);
}

let failed = false;
for (const [parentRel, siblingRel] of pairs) {
  if (!fs.existsSync(path.join(SERVER, parentRel))) {
    console.log(`MISSING parent for ${siblingRel}`);
    failed = true;
    continue;
  }
  const result = checkPair(parentRel, siblingRel);
  for (const problem of result.problems || []) console.log(`  ${problem}`);
  if (result.problems.length) {
    failed = true;
    console.log(`SPLIT_UNSAFE ${siblingRel} <- ${parentRel}`);
    for (const note of result.notes || []) console.log(`  ${note}`);
  } else if (!(result.notes || []).length) {
    console.log(`SPLIT_OK ${siblingRel} <- ${parentRel} (${result.declared} declared names)`);
  } else {
    console.log(`SPLIT_OK ${siblingRel} <- ${parentRel} (${result.declared} declared names, ${result.notes.length} note(s))`);
    for (const note of result.notes || []) console.log(`  ${note}`);
  }
}
if (failed) {
  console.log("\nA split may only move declarations that touch no module state,");
  console.log("and state must live in exactly one of the two modules.");
  process.exit(1);
}
console.log("SPLIT_CHECK_OK");
