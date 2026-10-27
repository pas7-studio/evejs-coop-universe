// The JSON cache exists to remove a measured lag source: a tick phase that
// re-reads and re-parses the same file every tick. These tests pin the two
// properties that make that safe: a rewritten file is always seen, and the
// caller can ask for an isolated copy.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { readJsonFile, forget, size } = require("../integration/coopJsonFileCache.cjs");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "coop-json-cache-"));

test("a cached file is returned without a second parse", () => {
  const file = path.join(tmp, "a.json");
  fs.writeFileSync(file, JSON.stringify({ rows: [1, 2, 3] }));
  const first = readJsonFile(file);
  const second = readJsonFile(file);
  assert.equal(first, second, "same object while the file is untouched");
  assert.deepEqual(first.rows, [1, 2, 3]);
  forget();
  assert.equal(size(), 0);
});

test("a rewritten file is seen immediately (mtime or size change)", () => {
  const file = path.join(tmp, "b.json");
  fs.writeFileSync(file, JSON.stringify({ v: 1 }));
  assert.equal(readJsonFile(file).v, 1);
  fs.writeFileSync(file, JSON.stringify({ v: 22 }));
  assert.equal(readJsonFile(file).v, 22, "size changed");
  const later = new Date(Date.now() + 5000);
  fs.writeFileSync(file, JSON.stringify({ v: 3 }));
  fs.utimesSync(file, later, later);
  assert.equal(readJsonFile(file).v, 3, "mtime changed");
});

test("clone: true returns an isolated copy and maxBytes is enforced", () => {
  const file = path.join(tmp, "c.json");
  fs.writeFileSync(file, JSON.stringify({ rows: [] }));
  const shared = readJsonFile(file);
  shared.rows.push("mutated-by-caller");
  assert.deepEqual(readJsonFile(file).rows, ["mutated-by-caller"], "shared by design");
  const copy = readJsonFile(file, { clone: true });
  copy.rows.push("x");
  assert.equal(readJsonFile(file).rows.length, 1, "clone is isolated");
  assert.throws(() => readJsonFile(file, { maxBytes: 4 }), /JSON_FILE_TOO_LARGE/);
});

test("a missing file throws like a plain read", () => {
  assert.throws(() => readJsonFile(path.join(tmp, "nope.json")), /ENOENT/);
});
