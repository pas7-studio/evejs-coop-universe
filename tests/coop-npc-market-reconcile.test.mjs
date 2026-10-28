import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const modulePath = path.join("C:", "Games", "EveCoop", "upstream-evejs", "Code", "server", "src", "space",
  "coopNativeNpcMarketReconcile.js");
const present = fs.existsSync(modulePath);
const { proveFill, reconcileJournals } = present ? require(modulePath) : {};

// Measured on the work stack 2026-10-27: a sell of 5 000 Scordite III-Grade at
// 5 203.7 ISK left the journal at phase RPC_CALLING, so the native market was
// halted for good ("never repeat a possibly completed fill"). The market daemon
// itself held the answer: order 4257762183096583224, state filled, vol_entered
// 5000, vol_remaining 0, issued at the journal timestamp.
const JOURNAL = {
  version: 1,
  phase: "RPC_CALLING",
  at: 1793135288695,
  pilotID: "coop-pilot-012",
  entityID: 980000000035,
  systemID: 30000145,
  stationID: 60014935,
  typeID: 17464,
  marketOrderID: "4257762183096583224",
  side: "sell",
  quantity: 5000,
  price: 5203.7,
  cargoID: 980200000324,
  beforeQuantity: 5040,
  afterQuantity: 40,
  newCargo: null,
  beforeBalance: 0,
  lootSource: null,
  afterBalance: 26018500,
};

// The real GetOrder answer captured from the running market daemon.
const ORDER = {
  is_corp: false,
  order_id: "4257762183096583224",
  owner_id: 0,
  source: "seed",
  state: "filled",
  row: {
    bid: true,
    order_id: "4257762183096583224",
    price: 5203.7,
    station_id: 60014935,
    type_id: 17464,
    vol_entered: 5000,
    vol_remaining: 0,
    issued_at: "2026-10-27T21:08:08.710988524Z",
  },
};

test("the market's own filled row proves the exact fill", { skip: !present }, async () => {
  const proof = proveFill(JOURNAL, ORDER);
  assert.equal(proof.ok, true, proof.reason);
  assert.deepEqual(proof.ack, {
    order_id: "4257762183096583224",
    filled_quantity: 5000,
    bid: true,
    station_id: 60014935,
    type_id: 17464,
    price: 5203.7,
  });
});

test("a row that could belong to another trade never proves ours", { skip: !present }, async () => {
  const cases = [
    [{ ...ORDER, state: "open" }, "MARKET_ORDER_NOT_FILLED"],
    [{ ...ORDER, row: { ...ORDER.row, vol_remaining: 5000 } }, "MARKET_ROW_STILL_OPEN"],
    [{ ...ORDER, row: { ...ORDER.row, vol_entered: 1000 } }, "MARKET_ROW_VOLUME_MISMATCH"],
    [{ ...ORDER, row: { ...ORDER.row, price: 5100 } }, "MARKET_ROW_PRICE_MISMATCH"],
    [{ ...ORDER, row: { ...ORDER.row, station_id: 60003724 } }, "MARKET_ROW_STATION_MISMATCH"],
    [{ ...ORDER, row: { ...ORDER.row, type_id: 34 } }, "MARKET_ROW_TYPE_MISMATCH"],
    [{ ...ORDER, row: { ...ORDER.row, bid: false } }, "MARKET_ROW_NOT_BID"],
    [{ ...ORDER, row: { ...ORDER.row, issued_at: "2026-10-26T21:08:08.710Z" } },
      "MARKET_ROW_ISSUED_AT_NOT_THIS_TRADE"],
    [{ ...ORDER, order_id: "4257762183096583225" }, "MARKET_ORDER_ID_MISMATCH"],
    [null, "MARKET_ORDER_UNAVAILABLE"],
  ];
  for (const [order, reason] of cases) {
    const proof = proveFill(JOURNAL, order);
    assert.equal(proof.ok, false, reason + " must not be proven");
    assert.equal(proof.reason, reason);
  }
});

test("only a sell journal is reconciled", { skip: !present }, async () => {
  assert.equal(proveFill({ ...JOURNAL, side: "buy" }, ORDER).reason, "JOURNAL_SIDE_NOT_SELL");
});

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "coop-market-"));
  fs.mkdirSync(path.join(root, "tx"));
  fs.writeFileSync(path.join(root, "tx", "coop-pilot-012.json"), JSON.stringify(JOURNAL));
  fs.writeFileSync(path.join(root, "ledger.json"), JSON.stringify({ version: 1, pilots: {} }));
  return root;
}

test("a proven fill is settled once and the journal removed", { skip: !present }, async () => {
  const root = fixture();
  const first = await reconcileJournals({ root, inspectOrder: () => ORDER, store: null });
  assert.deepEqual(first.pending, []);
  assert.equal(first.settled.length, 1);
  assert.equal(first.settled[0].isk, 26018500);
  assert.equal(fs.existsSync(path.join(root, "tx", "coop-pilot-012.json")), false);
  const ledger = JSON.parse(fs.readFileSync(path.join(root, "ledger.json"), "utf8"));
  assert.deepEqual(ledger.pilots["coop-pilot-012"], {
    balance: 26018500, lastTradeAt: JOURNAL.at, tradeCount: 1,
  });
  const receipt = JSON.parse(fs.readFileSync(path.join(root, "reconciled", "coop-pilot-012.json"), "utf8"));
  assert.equal(receipt.status, "SETTLED_BY_MARKET_PROOF");
  assert.equal(receipt.replayed, false);
  assert.equal(receipt.volRemaining, 0);
  // A second run cannot double-credit: the journal is gone.
  const second = await reconcileJournals({ root, inspectOrder: () => ORDER, store: null });
  assert.equal(second.settled.length, 0);
  const again = JSON.parse(fs.readFileSync(path.join(root, "ledger.json"), "utf8"));
  assert.equal(again.pilots["coop-pilot-012"].balance, 26018500);
});

test("an unproven journal stays pending and the ledger is untouched", { skip: !present }, async () => {
  const root = fixture();
  const result = await reconcileJournals({ root, inspectOrder: () => ({ ...ORDER, state: "open" }), store: null });
  assert.equal(result.settled.length, 0);
  assert.equal(result.pending.length, 1);
  assert.equal(result.pending[0].reason, "MARKET_ORDER_NOT_FILLED");
  assert.equal(fs.existsSync(path.join(root, "tx", "coop-pilot-012.json")), true);
  const ledger = JSON.parse(fs.readFileSync(path.join(root, "ledger.json"), "utf8"));
  assert.deepEqual(ledger.pilots, {});
});

test("an unreachable market is never guessed into a settlement", { skip: !present }, async () => {
  const root = fixture();
  const result = await reconcileJournals({ root, inspectOrder: () => { throw Error("ECONNREFUSED"); }, store: null });
  assert.equal(result.settled.length, 0);
  assert.equal(result.pending[0].reason, "RPC_OUTCOME_UNKNOWN");
  assert.equal(fs.existsSync(path.join(root, "tx", "coop-pilot-012.json")), true);
});

test("a pilot whose balance already moved is not credited twice", { skip: !present }, async () => {
  const root = fixture();
  fs.writeFileSync(path.join(root, "ledger.json"), JSON.stringify({
    version: 1, pilots: { "coop-pilot-012": { balance: 1, lastTradeAt: 1, tradeCount: 1 } },
  }));
  const result = await reconcileJournals({ root, inspectOrder: () => ORDER, store: null });
  assert.equal(result.settled.length, 0);
  assert.equal(result.pending[0].reason, "NPC_MARKET_BALANCE_CONFLICT");
});

test("dry run proves without writing anything", { skip: !present }, async () => {
  const root = fixture();
  const before = fs.readFileSync(path.join(root, "ledger.json"), "utf8");
  const result = await reconcileJournals({ root, inspectOrder: () => ORDER, store: null, dryRun: true });
  assert.equal(result.settled.length, 1);
  assert.equal(result.settled[0].dryRun, true);
  assert.equal(fs.existsSync(path.join(root, "tx", "coop-pilot-012.json")), true);
  assert.equal(fs.readFileSync(path.join(root, "ledger.json"), "utf8"), before);
});
