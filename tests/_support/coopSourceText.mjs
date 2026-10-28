// Wiring tests in this repo assert on the *text* of a co-op module ("is this
// call site wired, in this order, with this guard"). A module may legitimately
// be split by `scripts/coop-split-module.cjs`, which moves pure declarations
// into a `*.pure.js` sibling and requires them back, so reading one file would
// fail for a reason that has nothing to do with the wiring.
//
// `readModuleText` therefore inlines exactly those split siblings in place of
// their `require()` call: the result reads like the file did before the split,
// so an assertion or an `indexOf` slice keeps working after code moves - and a
// split can never silently hide an assertion. Nothing else is inlined: a test
// that reads `scripts/overlay-spec.cjs` must still see that file only, or a
// `doesNotMatch` would trip over an imported copy of the same string.
//
// Deliberately small: no AST, no virtual fs, no caching.

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const SUFFIXES = ["", ".js", ".cjs", ".mjs", "/index.js"];
const SHIM = /^module\.exports\s*=\s*require\(\s*["']([^"']+)["']\s*\)\s*;?\s*$/;
// The splitter stamps every module it writes with this banner. Inlining keys on
// the banner, not on a filename, so a sibling may be called whatever its role is
// (`*.pure.js`, `*-actions.js`, ...) and still be read by the wiring tests.
const SPLIT_MARK = "Extracted from";

function resolveRelative(fromFile, spec) {
  const base = path.resolve(path.dirname(fromFile), spec);
  for (const suffix of SUFFIXES) {
    const candidate = base + suffix;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

// Follow the one-line re-export shims the archived `.cjs` copies need, so a
// split sibling is found whether it is read from the engine or from
// `integration/`.
function throughShims(target) {
  for (let hops = 0; hops < 3; hops++) {
    const raw = fs.readFileSync(target, "utf8");
    const shim = raw.length < 200 ? SHIM.exec(raw.trim()) : null;
    if (!shim) return target;
    const inner = resolveRelative(target, shim[1]);
    if (!inner) return target;
    target = inner;
  }
  return target;
}

function isSplitSibling(file) {
  const head = fs.readFileSync(file, "utf8").slice(0, 400);
  return head.includes(SPLIT_MARK) && head.includes("coop-split-module");
}

function expand(file, depth, seen, order) {
  const text = fs.readFileSync(file, "utf8");
  order.push(file);
  if (depth <= 0) return text;
  return text.replace(/require\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g, (whole, spec) => {
    const direct = resolveRelative(file, spec);
    if (!direct) return whole;
    const target = throughShims(direct);
    if (seen.has(target) || !isSplitSibling(target)) return whole;
    seen.add(target);
    const child = expand(target, depth - 1, seen, order);
    const label = path.relative(ROOT, target).replace(/\\/g, "/");
    return `require(/* ---- ${label} ---- */\n${child}\n/* ---- end ${label} ---- */)`;
  });
}

/** Text of `relPath` (relative to the repo root) with split siblings inlined. */
export function readModuleText(relPath, options = {}) {
  const file = path.resolve(ROOT, relPath);
  const order = [];
  const text = expand(file, options.depth ?? 2, new Set([file]), order);
  if (options.withFiles) return { text, files: order.map((f) => path.relative(ROOT, f).replace(/\\/g, "/")) };
  return text;
}

/**
 * The co-op modules the overlay installs, as the real list.
 *
 * Tests used to assert on the *text* of the registry, e.g.
 * `/"coopA","coopB"/` - which silently means "registered in one splice call,
 * adjacent, in that order". That is the layout of a list, not the fact anyone
 * cares about, and it breaks every time a module is added between them. Ask the
 * list instead.
 */
export function overlayModules() {
  const spec = createRequire(import.meta.url)("../../scripts/overlay-spec.cjs");
  return spec.names;
}

/** How many times the overlay registers `name` (1 = correct, 2 = merge accident). */
export function overlayRegistrations(name) {
  return overlayModules().filter((entry) => entry === name).length;
}

/** Files that `readModuleText` inlined, in read order (useful when debugging). */
export function moduleFiles(relPath, options = {}) {
  return readModuleText(relPath, { ...options, withFiles: true }).files;
}

// Text of one top-level function, from its signature to its closing brace.
// Wiring tests used to do `indexOf(nextFunction)` by hand; that breaks as soon
// as the *next* function moves into a split module, which says nothing about the
// function under test. This engine keeps top-level closing braces at column 0 and
// nested ones indented, so `\n}` at line start ends the function - true both for
// a single file and for text with split siblings inlined.
export function functionText(text, signature) {
  const start = text.indexOf(signature);
  if (start < 0) return "";
  const close = /\r?\n\}[ \t]*(?=\r?\n|$)/g;
  close.lastIndex = start + signature.length;
  const hit = close.exec(text);
  if (!hit) return text.slice(start);
  return text.slice(start, hit.index + hit[0].indexOf("}") + 1);
}
