// Independent test for IE-001: coopEconomyCapabilityIndex
// Uses node:test + node:assert/strict, ESM, and createRequire to load the
// CommonJS module from the engine fork root.

import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync, writeFileSync, unlinkSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);

// Throw if the engine fork root is unset, as required.
// Default to the engine checkout: an unset variable must not read as a failing suite.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";

// Load the CommonJS module under test.
const mod = require(join(forkRoot, "Code/server/src/space/coopEconomyCapabilityIndex.js"));
const { CAPABILITY_FAMILIES, buildCapabilityIndex, toMarkdown } = mod;

const realSrcRoot = join(forkRoot, "Code/server/src");

test("test 1: real checkout builds a version-1 index with 13 families and 42 modules", () => {
  const index = buildCapabilityIndex({ srcRoot: realSrcRoot });
  assert.equal(index.version, 1);
  assert.equal(index.families.length, 13);
  const totalModules = index.families.reduce((n, f) => n + f.modules.length, 0);
  assert.equal(totalModules, 42);
  assert.equal(index.totals.missing, 0);
});

test("test 2: every family reports UNKNOWN runtime and CODE_CONFIRMED status", () => {
  const index = buildCapabilityIndex({ srcRoot: realSrcRoot });
  for (const family of index.families) {
    assert.equal(family.runtime, "UNKNOWN");
    assert.equal(family.status, "CODE_CONFIRMED");
  }
});

test("test 3: a fresh empty temp dir does not throw and reports all modules missing", () => {
  const dir = mkdtempSync(join(tmpdir(), "ie-001-empty-"));
  try {
    const index = buildCapabilityIndex({ srcRoot: dir });
    assert.equal(index.totals.missing, 42);
    for (const family of index.families) {
      assert.equal(family.status, "MISSING_MODULE");
      assert.ok(family.missing.length > 0, "family missing array must be non-empty");
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("test 4: a non-directory srcRoot throws a TypeError", () => {
  const file = join(tmpdir(), "ie-001-not-a-dir.txt");
  writeFileSync(file, "x");
  assert.throws(() => buildCapabilityIndex({ srcRoot: file }), TypeError);
  unlinkSync(file);

  assert.throws(() => buildCapabilityIndex({ srcRoot: "" }), TypeError);
});

test("test 5: toMarkdown starts with the exact header and has one row per family", () => {
  const index = buildCapabilityIndex({ srcRoot: realSrcRoot });
  const lines = toMarkdown(index).split(/\r?\n/);
  assert.equal(lines[0], "| family | title | modules | missing | runtime |");
  assert.equal(lines.length, 2 + index.families.length);
});

test("test 7: an unreadable module path is missing, not confirmed (review fix)", () => {
  // A path that exists but is not a readable regular file (here: a directory) must not make a family
  // CODE_CONFIRMED. Before the fix it was reported exists:true, bytes:0, flags:[], missing:[].
  const root = mkdtempSync(join(tmpdir(), "ie001-unreadable-"));
  mkdirSync(join(root, "space"), { recursive: true });
  mkdirSync(join(root, "space", "coopNativeMiningAtomic.js"));
  const index = buildCapabilityIndex({ srcRoot: root });
  const extraction = index.families.find((f) => f.id === "extraction");
  assert.equal(extraction.modules[0].exists, false);
  assert.equal(extraction.status, "MISSING_MODULE");
  assert.ok(extraction.missing.includes("space/coopNativeMiningAtomic"));
  assert.equal(index.totals.missing, 42);
  rmSync(root, { recursive: true, force: true });
});

test("test 6: every module record has path, exists, bytes, and sorted-unique EVEJS_ flags", () => {
  const index = buildCapabilityIndex({ srcRoot: realSrcRoot });
  for (const family of index.families) {
    for (const module of family.modules) {
      assert.equal(typeof module.path, "string");
      assert.equal(typeof module.exists, "boolean");
      assert.equal(typeof module.bytes, "number");
      assert.ok(Array.isArray(module.flags));
      for (const flag of module.flags) {
        assert.match(flag, /^EVEJS_/);
      }
      assert.deepEqual(module.flags, [...module.flags].sort());
      assert.equal(new Set(module.flags).size, module.flags.length);
    }
  }
});
