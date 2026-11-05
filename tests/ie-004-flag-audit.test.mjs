import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);

// Default to the engine checkout: an unset variable must not read as a failing suite.
const forkRoot = (process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs").trim();

const enginePath = join(forkRoot, "Code", "server", "src", "space", "coopEconomyFlagAudit.js");
const mod = require(enginePath);

const { collectFlags, classifyFlagUsage, auditFlags, FLAG_NOT_FOUND } = mod;

test("collectFlags returns sorted unique flags and rejects non-strings", () => {
  assert.deepEqual(collectFlags("EVEJS_A EVEJS_A EVEJS_B"), ["EVEJS_A", "EVEJS_B"]);
  assert.deepEqual(collectFlags(42), []);
});

test("classifyFlagUsage detects strict one, other, strict one negated and missing", () => {
  assert.equal(classifyFlagUsage(`if (String(env.EVEJS_X || "") === "1")`, "EVEJS_X").mode, "STRICT_ONE");
  assert.equal(classifyFlagUsage(`if (env.EVEJS_X)`, "EVEJS_X").mode, "OTHER");
  assert.equal(classifyFlagUsage(`if (env.EVEJS_X !== "1") return`, "EVEJS_X").mode, "STRICT_ONE_NEGATED");
  assert.equal(classifyFlagUsage(`const on = env.EVEJS_X === "true";`, "EVEJS_X").mode, "STRICT_TRUE");
  const missing = classifyFlagUsage("nothing to see here", "EVEJS_X");
  assert.equal(missing.mode, FLAG_NOT_FOUND);
  assert.equal(missing.sample, "");
  // a digit 1 elsewhere on the line must never be mistaken for a strict check
  assert.equal(classifyFlagUsage(`const n = 1; if (env.EVEJS_X) {}`, "EVEJS_X").mode, "OTHER");
});

test("auditFlags scans a temp directory and reports flags", () => {
  const dir = mkdtempSync(join(tmpdir(), "flag-audit-"));
  writeFileSync(join(dir, "a.js"), `const on = String(env.EVEJS_STRICT || "") === "1";`);
  writeFileSync(join(dir, "b.js"), `const on = !!env.EVEJS_TRUTHY;`);
  writeFileSync(join(dir, "c.js"), `const on = env.EVEJS_TRUTHY === true;`);

  const report = auditFlags({ srcRoot: dir });

  assert.equal(report.flags.length, 2);
  assert.equal(report.totals.flags, 2);
  assert.equal(report.totals.unsafe, 1);
  assert.deepEqual(report.blocking, ["EVEJS_TRUTHY"]);

  const strict = report.flags.find((r) => r.flag === "EVEJS_STRICT");
  const truthy = report.flags.find((r) => r.flag === "EVEJS_TRUTHY");
  assert.ok(strict && truthy, "both flags must be reported");
  assert.deepEqual(strict.files, ["a.js"]);
  assert.equal(strict.parsedStrictly, true);
  assert.equal(strict.unsafe, false);
  assert.deepEqual(truthy.files.slice().sort(), ["b.js", "c.js"]);
  assert.equal(truthy.unsafe, true);
  assert.ok(truthy.modes.includes("OTHER"));

  rmSync(dir, { recursive: true, force: true });
});

test("auditFlags throws TypeError on a non-directory srcRoot", () => {
  const dir = mkdtempSync(join(tmpdir(), "flag-audit-"));
  const file = join(dir, "a.js");
  writeFileSync(file, `const on = String(env.EVEJS_STRICT || "") === "1";`);
  assert.throws(() => auditFlags({ srcRoot: file }), TypeError);
  rmSync(dir, { recursive: true, force: true });
});

test("auditFlags on the real checkout finds many flags with consistent blocking", () => {
  const realRoot = join(forkRoot, "Code", "server", "src");
  const report = auditFlags({ srcRoot: realRoot });

  assert.ok(report.totals.flags > 600);
  assert.equal(report.totals.unsafe, report.blocking.length);

  const byName = new Map(report.flags.map((r) => [r.flag, r]));
  for (const flag of report.blocking) {
    const entry = byName.get(flag);
    assert.ok(entry, `blocking flag ${flag} missing from flags`);
    assert.equal(entry.unsafe, true);
    assert.ok(entry.modes.includes("OTHER"));
  }
  for (const entry of report.flags) {
    if (entry.parsedStrictly) assert.equal(entry.unsafe, false);
  }
});
