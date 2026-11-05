import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";

// Measured 2026-11-01: a fillID settled before a process restart was settled AGAIN after it and the
// wallet port was called twice - the money doubled. The module's ledger was process-local, so its
// "one settlement per fill" promise only held inside one process. A restart is simulated the only
// honest way: drop the module from the require cache and require it again.
const require = createRequire(import.meta.url);
if (!process.env.EVEJS_FORK_ROOT) process.env.EVEJS_FORK_ROOT = "C:/Games/EveCoop/upstream-evejs";
const MODULE = join((process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs").trim(), "Code/server/src/space/coopEconomySaleSettlement.js");

function reload() {
  delete require.cache[require.resolve(MODULE)];
  return require(MODULE);
}

function memoryJournal() {
  const rows = new Map();
  return { get: (key) => rows.get(key), set: (key, value) => { rows.set(key, value); } };
}

test("a durable journal survives a restart and the wallet is credited once", () => {
  const journal = memoryJournal();
  let credits = 0;
  const walletPort = { credit: () => { credits += 1; return { receiptID: "c" + credits }; } };
  const args = { fillID: "fill-restart", ownerCorpID: "corp-1", grossCents: 1000, taxCents: 100,
    feeCents: 50, walletPort };

  const before = reload().createSettlement({ journal });
  assert.equal(before.settle(args).code, "SETTLED");
  assert.equal(credits, 1);

  const after = reload().createSettlement({ journal });
  const replay = after.settle({ ...args, walletPort });
  assert.equal(replay.code, "ALREADY_SETTLED", "a restart forgot the settlement: " + replay.code);
  assert.equal(credits, 1, "the wallet was credited again after the restart");
});

test("the money port receives the fill identity, so a native ledger can dedupe too", () => {
  const seen = [];
  const walletPort = { credit: (args) => { seen.push(args); return { receiptID: "c1" }; } };
  const settlement = reload().createSettlement();
  settlement.settle({ fillID: "fill-id-42", ownerCorpID: "corp-1", grossCents: 200,
    taxCents: 0, feeCents: 0, walletPort });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].fillID, "fill-id-42", "the wallet cannot dedupe without the fill id");
  assert.equal(seen[0].cents, 200);
});
