import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { ensureJournalRoot } = require("../integration/coopNpcAmmoBankAtomic.cjs");

// Live finding: the atomic ammo bank journal root
// (/var/lib/evejs/coop-npc-ammo-debits) did not exist in the running container,
// so every strict-ammo turret cycle failed as BANK_ATOMIC_JOURNAL_UNSAFE and no
// NPC weapon ever applied damage. The root is a private journal directory, not
// game state, so it is created on first use; anything that is not a real
// directory still fails closed.
function tmpBase() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "coop-ammo-bank-"));
}

test("a missing journal root is created instead of failing the fire cycle", () => {
  const root = path.join(tmpBase(), "coop-npc-ammo-debits");
  assert.equal(fs.existsSync(root), false);
  assert.equal(ensureJournalRoot({ root }), root);
  assert.equal(fs.statSync(root).isDirectory(), true);
});

test("an existing journal root is accepted unchanged", () => {
  const root = path.join(tmpBase(), "root");
  fs.mkdirSync(root, { mode: 0o700 });
  assert.equal(ensureJournalRoot({ root }), root);
  assert.equal(fs.statSync(root).isDirectory(), true);
});

test("a non-directory root fails closed", () => {
  const file = path.join(tmpBase(), "not-a-dir");
  fs.writeFileSync(file, "x");
  assert.throws(() => ensureJournalRoot({ root: file }), /BANK_ROOT_UNSAFE/);
});

test("a symlinked root fails closed", () => {
  const base = tmpBase();
  const real = path.join(base, "real");
  fs.mkdirSync(real);
  const link = path.join(base, "link");
  try {
    fs.symlinkSync(real, link, "dir");
  } catch {
    return; // symlinks unavailable on this filesystem
  }
  assert.throws(() => ensureJournalRoot({ root: link }), /BANK_ROOT_UNSAFE/);
});

test("a relative root is refused before any filesystem write", () => {
  assert.throws(() => ensureJournalRoot({ root: "relative/path" }), /BANK_ROOT_UNSAFE/);
});

test("the fire cycle calls the root guard before touching SQLite", () => {
  const source = fs.readFileSync(
    path.join(import.meta.dirname, "..", "integration", "coopNpcAmmoBankAtomic.cjs"),
    "utf8");
  const prepare = source.slice(source.indexOf("function prepare("), source.indexOf("function settle("));
  assert.match(prepare, /ensureJournalRoot\(\{root,io\}\)/);
  assert.ok(prepare.indexOf("ensureJournalRoot") < prepare.indexOf("openSync(lock"),
    "the root guard must run before the writer lock");
});
