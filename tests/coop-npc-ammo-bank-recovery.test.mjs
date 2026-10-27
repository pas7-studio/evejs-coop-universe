import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const bank = require("../integration/coopNpcAmmoBankAtomic.cjs");

// Live finding: a PREPARED ammo-bank journal whose SQLite transaction failed
// quarantined a real warship forever (NATIVE_AMMO_BANK_SHIP_QUARANTINED), so it
// could never fire again. The replay fence is written in the SAME transaction as
// the cargo delta, so a missing fence is proof the debit never landed: such a
// journal is recovered as ABORTED. A fence at/past the boundary proves the
// opposite and stays untouched.
const entityID = 980000016639, moduleID = 980100051793;

function fixture(t, { fence = null, phase = "PREPARED", lockNonce = "n1" } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "coop-ammo-recover-"));
  const dir = path.join(root, "bank-ships");
  fs.mkdirSync(dir, { mode: 0o700 });
  const file = path.join(dir, entityID + ".json");
  const receipt = { version: 1, phase, entityID, boundaryMs: 1793063985624,
    modules: [moduleID], nonce: "n1", outcomeRequired: true };
  fs.writeFileSync(file, JSON.stringify(receipt));
  if (lockNonce) fs.writeFileSync(file + ".lock", JSON.stringify({ version: 1, entityID, nonce: lockNonce }));
  const atomicRows = { transact: (tables, fn) => fn({ get: () => fence }) };
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, file, receipt, atomicRows };
}

const read = file => JSON.parse(fs.readFileSync(file, "utf8"));

test("a PREPARED journal without a committed fence is aborted", t => {
  const f = fixture(t, { fence: null });
  const result = bank.recoverUncommitted({ root: f.root, entityID, atomicRows: f.atomicRows });
  assert.equal(result.status, "ABORTED");
  const after = read(f.file);
  assert.equal(after.phase, "ABORTED");
  assert.equal(after.abortReason, "NO_COMMITTED_SQLITE_FENCE");
  assert.equal(fs.existsSync(f.file + ".lock"), false, "the quarantine lock is released");
  // The recovered ship is usable again instead of permanently quarantined.
  assert.equal(bank.inspectShip({ root: f.root, entityID }).status, "ABORTED");
});

test("a fence at the boundary proves the debit landed and is never touched", t => {
  const f = fixture(t, { fence: { version: 1, entityID, modules: { [moduleID]: 1793063985624 } } });
  const before = fs.readFileSync(f.file, "utf8");
  const result = bank.recoverUncommitted({ root: f.root, entityID, atomicRows: f.atomicRows });
  assert.equal(result.status, "NEEDS_OPERATOR_REPAIR");
  assert.equal(result.reason, "SQLITE_FENCE_PROVES_COMMITTED_DEBIT");
  assert.equal(fs.readFileSync(f.file, "utf8"), before);
  assert.equal(fs.existsSync(f.file + ".lock"), true, "the lock stays as the durable fence");
});

test("an older fence for another module does not authorize an abort", t => {
  const f = fixture(t, { fence: { version: 1, entityID, modules: { [moduleID]: 1793063985623 } } });
  assert.equal(bank.recoverUncommitted({ root: f.root, entityID, atomicRows: f.atomicRows }).status,
    "ABORTED");
  const g = fixture(t, { fence: { version: 1, entityID, modules: { "980100099999": 1793063985624 } } });
  assert.equal(bank.recoverUncommitted({ root: g.root, entityID, atomicRows: g.atomicRows }).status,
    "ABORTED");
});

test("a foreign lock owner is operator repair, never an automatic abort", t => {
  const f = fixture(t, { lockNonce: "other" });
  const result = bank.recoverUncommitted({ root: f.root, entityID, atomicRows: f.atomicRows });
  assert.equal(result.status, "NEEDS_OPERATOR_REPAIR");
  assert.equal(result.reason, "BANK_LOCK_OWNER_MISMATCH");
  assert.equal(read(f.file).phase, "PREPARED");
});

test("a committed or absent journal has nothing to recover", t => {
  const committed = fixture(t, { phase: "COMMITTED" });
  assert.equal(bank.recoverUncommitted({ root: committed.root, entityID,
    atomicRows: committed.atomicRows }).status, "NOTHING_TO_RECOVER");
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "coop-ammo-empty-"));
  t.after(() => fs.rmSync(empty, { recursive: true, force: true }));
  assert.equal(bank.recoverUncommitted({ root: empty, entityID,
    atomicRows: { transact: () => null } }).status, "NOTHING_TO_RECOVER");
});

test("journal discovery is bounded to real journal files", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "coop-ammo-list-"));
  const dir = path.join(root, "bank-ships");
  fs.mkdirSync(dir, { mode: 0o700 });
  for (const name of ["980000016639.json", "980000016987.json", "980000016987.json.lock",
    "980000016987.json.tmp-1-1", "notes.txt", "0.json"])
    fs.writeFileSync(path.join(dir, name), "{}");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const listed = bank.listJournals({ root });
  assert.equal(listed.status, "OBSERVED");
  assert.deepEqual(listed.entityIDs, [980000016639, 980000016987]);
  assert.deepEqual(bank.listJournals({ root: path.join(root, "absent") }), { status: "EMPTY", entityIDs: [] });
});

test("an unreadable SQLite view never guesses an abort", t => {  const f = fixture(t);
  const result = bank.recoverUncommitted({ root: f.root, entityID,
    atomicRows: { transact: () => { throw Error("SQL_DOWN"); } } });
  assert.equal(result.status, "RECOVERY_SQLITE_UNAVAILABLE");
  assert.equal(read(f.file).phase, "PREPARED");
});
