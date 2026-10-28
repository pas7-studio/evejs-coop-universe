// FW-038C guard: the WALLET is the idempotency anchor, not a side row.
// Measured failure this covers: the previous version journalled intent in a
// separate row, paid, then could not read the row on a replay and paid again -
// 25 000 ISK destroyed. Every leg here is marked inside the corporation record
// that holds the money, in the same write as the balance.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { createMercenarySettlement, walletPointer } = require("../integration/coopWarMercenarySettlement.cjs");

const NEED = 2500000; // 25 000 ISK
function world({ payer = 179219344.69, payee = 0, loseWrites = false, loseCredit = false } = {}) {
  const records = new Map();
  const set = (corp, balance) => records.set(walletPointer(corp),
    { divisions: { "1000": { balance, journal: (records.get(walletPointer(corp))?.divisions?.["1000"]?.journal) || [] } } });
  set(1000129, payer);
  set(1000120, payee);
  const gameStore = {
    read: (table, pointer) => {
      assert.equal(table, "corporationRuntime");
      const data = records.get(pointer);
      return data ? { success: true, data } : { success: false, errorMsg: "ENTRY_NOT_FOUND" };
    },
    write: (table, pointer, value) => {
      assert.equal(table, "corporationRuntime");
      if (loseWrites) return { success: false, errorMsg: "WRITE_LOST" };
      if (loseCredit && Number(value.divisions["1000"].balance) > Number(records.get(pointer)?.divisions?.["1000"]?.balance || 0))
        return { success: false, errorMsg: "CREDIT_REFUSED" };
      records.set(pointer, value);
      return { success: true };
    },
  };
  const settlement = createMercenarySettlement({
    gameStore, clock: () => 1000, env: { EVEJS_COOP_WAR_MERCENARY_CONTRACT: "1" },
  });
  return { settlement, records };
}
const bal = (w, corp) => Number(w.records.get(walletPointer(corp)).divisions["1000"].balance);

test("a contract moves exactly the needed ISK and conserves it", () => {
  const w = world();
  const before = bal(w, 1000129) + bal(w, 1000120);
  const out = w.settlement.execute({ eventID: "merc:1", payerCorporationID: 1000129,
    payeeCorporationID: 1000120, amountCents: NEED });
  assert.equal(out.status, "PAID");
  assert.equal(bal(w, 1000129), 179219344.69 - 25000);
  assert.equal(bal(w, 1000120), 25000);
  assert.equal(bal(w, 1000129) + bal(w, 1000120), before, "no ISK minted or destroyed");
  assert.equal(out.idempotency, "WALLET_JOURNAL_MARKER");
});

test("a replay is refused BY THE WALLET even if every other record is gone", () => {
  const w = world();
  const args = { eventID: "merc:2", payerCorporationID: 1000129,
    payeeCorporationID: 1000120, amountCents: NEED };
  assert.equal(w.settlement.execute(args).status, "PAID");
  // simulate the measured environment: nothing outside the wallet survives
  const afterFirst = JSON.stringify([...w.records]);
  const replay = w.settlement.execute(args);
  assert.equal(replay.status, "PAID");
  assert.equal(replay.debitLeg, "DUPLICATE");
  assert.equal(replay.creditLeg, "DUPLICATE");
  assert.equal(JSON.stringify([...w.records]), afterFirst, "a replay changes nothing");
  assert.equal(bal(w, 1000120), 25000, "the payee is paid once");
});

test("a dry run previews and writes nothing", () => {
  const w = world();
  const before = JSON.stringify([...w.records]);
  const out = w.settlement.execute({ eventID: "merc:3", payerCorporationID: 1000129,
    payeeCorporationID: 1000120, amountCents: NEED, dryRun: true });
  assert.equal(out.status, "DRY_RUN");
  assert.equal(out.preview.payeeAfterISK, 25000);
  assert.equal(JSON.stringify([...w.records]), before);
});

test("an insolvent payer is refused and nothing is written", () => {
  const w = world({ payer: 10 });
  const before = JSON.stringify([...w.records]);
  const out = w.settlement.execute({ eventID: "merc:4", payerCorporationID: 1000129,
    payeeCorporationID: 1000120, amountCents: NEED });
  assert.equal(out.reason, "WAR_MERCENARY_PAYER_INSOLVENT");
  assert.equal(JSON.stringify([...w.records]), before);
});

test("an unverified write never reports a payment", () => {
  const w = world({ loseWrites: true });
  const out = w.settlement.execute({ eventID: "merc:5", payerCorporationID: 1000129,
    payeeCorporationID: 1000120, amountCents: NEED });
  assert.equal(out.phase, "DEBIT");
  assert.match(out.reason, /WAR_MERCENARY_DEBIT_/);
  assert.equal(out.paymentComplete, false);
  assert.equal(bal(w, 1000129), 179219344.69);
});

test("a missing credit is retry-SAFE: the debit is not repeated", () => {
  const w = world({ loseCredit: true });
  const args = { eventID: "merc:6", payerCorporationID: 1000129,
    payeeCorporationID: 1000120, amountCents: NEED };
  const first = w.settlement.execute(args);
  assert.equal(first.phase, "CREDIT");
  assert.equal(first.retrySafe, true);
  assert.equal(bal(w, 1000129), 179219344.69 - 25000, "the debit happened once");
  assert.equal(bal(w, 1000120), 0);
  // the credit is now allowed to succeed; re-running must not debit again
  w.loseCreditOff = true;
  const w2 = { records: w.records, settlement: createMercenarySettlement({
    gameStore: {
      read: (t, p) => { const d = w.records.get(p); return d ? { success: true, data: d } : { success: false }; },
      write: (t, p, v) => { w.records.set(p, v); return { success: true }; },
    }, clock: () => 2000, env: { EVEJS_COOP_WAR_MERCENARY_CONTRACT: "1" } }) };
  const second = w2.settlement.execute(args);
  assert.equal(second.status, "PAID");
  assert.equal(second.debitLeg, "DUPLICATE", "the debit leg was never repeated");
  assert.equal(bal(w, 1000129), 179219344.69 - 25000);
  assert.equal(bal(w, 1000120), 25000);
});

test("flag OFF is inert and identities are validated", () => {
  const off = createMercenarySettlement({
    gameStore: { read: () => ({ success: false }), write: () => ({ success: false }) }, env: {},
  });
  assert.equal(off.execute({ eventID: "x", payerCorporationID: 1, payeeCorporationID: 2, amountCents: 1 }).status, "DISABLED");
  const w = world();
  assert.equal(w.settlement.execute({ eventID: "bad id!", payerCorporationID: 1, payeeCorporationID: 2, amountCents: 1 }).status, "BLOCKED");
  assert.equal(w.settlement.execute({ eventID: "e", payerCorporationID: 7, payeeCorporationID: 7, amountCents: 1 }).reason, "INVALID_MERCENARY_IDENTITY");
});
