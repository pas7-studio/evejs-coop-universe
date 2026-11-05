import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

// Finding 1 (independent review of 15c374a): a journal that cannot read or cannot write must not
// look like a journal that worked. Measured behaviour on 15c374a: DurableMap catches every store
// error, keeps the value in memory only, and createFileJournal renames a corrupt file away and
// continues with an empty map. A money module then returns "SETTLED" with nothing on disk.
const require = createRequire(import.meta.url);
const root = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const SP = path.join(root, "Code/server/src/space");
const load = (name) => {
  const file = path.join(SP, name);
  delete require.cache[file];
  return require(file);
};

const tmpdir = () => fs.mkdtempSync(path.join(os.tmpdir(), "coop-journal-review-"));

test("a corrupt journal file is refused, not silently treated as empty", () => {
  const Journal = load("coopEconomyJournalFile.js");
  const dir = tmpdir();
  const file = path.join(dir, "journal.json");
  fs.writeFileSync(file, "{ this is not json", "utf8");

  const journal = Journal.createFileJournal(file);
  assert.throws(
    () => journal.get("anything"),
    (error) => error.code === "JOURNAL_UNREADABLE" || error.code === "JOURNAL_CORRUPT",
    "an unreadable journal was silently accepted as an empty one",
  );
});

test("a failed file write is reported and never kept as memory-only durable state", () => {
  const Journal = load("coopEconomyJournalFile.js");
  const failing = {
    readFileSync() { const e = new Error("ENOENT"); e.code = "ENOENT"; throw e; },
    mkdirSync() {},
    writeFileSync() { const e = new Error("EACCES: permission denied"); e.code = "EACCES"; throw e; },
    renameSync() { throw new Error("should not be reached"); },
  };
  const journal = Journal.createFileJournal(path.join(tmpdir(), "journal.json"), { fs: failing });
  assert.throws(
    () => journal.set("settle:1", { state: "SETTLED" }),
    (error) => error.code === "JOURNAL_WRITE_FAILED",
    "the journal swallowed a write failure",
  );
  assert.equal(journal.has("settle:1"), false,
    "a write that never reached the store stayed in memory and would be replayed as durable");
});

test("a durable store that cannot be read is refused at construction", () => {
  const { createJournal } = load("coopEconomyJournal.js");
  const unreadable = {
    entries() { throw new Error("EIO: cannot read journal"); },
    get() { throw new Error("EIO"); },
    set() { throw new Error("EIO"); },
  };
  assert.throws(
    () => createJournal(unreadable),
    (error) => error.code === "JOURNAL_UNREADABLE",
    "a journal that cannot be read was started as if it were empty (replay after restart is lost)",
  );
});

test("a durable store that cannot be written makes set() fail and leaves no memory record", () => {
  const { createJournal } = load("coopEconomyJournal.js");
  const journal = createJournal({
    get() { return undefined; },
    has() { return false; },
    set() { const e = new Error("ENOSPC: no space left"); e.code = "ENOSPC"; throw e; },
  });
  assert.throws(
    () => journal.set("fill:1", { state: "SETTLED" }),
    (error) => error.code === "JOURNAL_WRITE_FAILED",
    "DurableMap swallowed the store failure",
  );
  assert.equal(journal.has("fill:1"), false,
    "the in-memory map kept a settlement the store never accepted");
});

test("a settlement cannot acknowledge success when its intent is not durable", () => {
  const Settlement = load("coopEconomySaleSettlement.js");
  let credits = 0;
  const journal = {
    get() { return undefined; },
    set() { const e = new Error("ENOSPC"); e.code = "ENOSPC"; throw e; },
  };
  const settlement = Settlement.createSettlement({ journal });
  const result = settlement.settle({
    fillID: "fill-review-1",
    ownerCorpID: "corp-1",
    grossCents: 1000,
    taxCents: 0,
    feeCents: 0,
    walletPort: { credit() { credits += 1; return { receiptID: "wallet-1" }; } },
  });
  assert.notEqual(result.ok, true, "the settlement acknowledged success with no durable evidence");
  assert.equal(credits, 0, "money moved before the intent was durable");
});

test("a journal that fails only on the outcome write still refuses to claim SETTLED", () => {
  const Settlement = load("coopEconomySaleSettlement.js");
  const rows = new Map();
  const journal = {
    get(key) { return rows.get(key); },
    set(key, value) {
      if (value && value.state === "SETTLED") { const e = new Error("ENOSPC"); e.code = "ENOSPC"; throw e; }
      rows.set(key, value);
    },
  };
  const settlement = Settlement.createSettlement({ journal });
  const result = settlement.settle({
    fillID: "fill-review-2",
    ownerCorpID: "corp-1",
    grossCents: 500,
    taxCents: 0,
    feeCents: 0,
    walletPort: { credit() { return { receiptID: "wallet-2" }; } },
  });
  assert.notEqual(result.ok, true, "SETTLED was acknowledged while the outcome row could not be written");
});
