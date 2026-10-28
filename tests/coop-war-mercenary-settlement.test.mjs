// FW-038B guard: a mercenary contract is paid with a journaled two-leg transfer.
// Value is conserved, a debit is never replayed, and an unverified leg halts.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { createMercenarySettlement } = require("../integration/coopWarMercenarySettlement.cjs");

const NEED = 2500000; // 25 000 ISK in cents
function world({ payer = 136554292.96, payee = 0, creditFails = false, debitUnverified = false, volatileJournal = false } = {}) {
  const balances = new Map([[1000129, payer], [1000120, payee]]);
  const rows = new Map();
  const gameStore = { coopAtomicNativeRows: { transact: (tables, fn) => {
    assert.deepEqual(tables, ["corporationRuntime"]);
    // `volatileJournal` models the measured defect: a write that cannot be read back.
    const tx = { get: (t, k) => (volatileJournal ? undefined : rows.get(k)),
      put: (t, k, v) => rows.set(k, v) };
    return fn(tx);
  } } };
  const apply = [];
  const settlement = createMercenarySettlement({
    gameStore,
    readBalance: (corp) => (balances.has(corp) ? balances.get(corp) : NaN),
    applyDelta: ({ corporationID, delta }) => {
      apply.push({ corporationID, delta });
      if (Number(delta) > 0 && creditFails) return { status: "CORP_CREDIT_FAILED", moved: 0 };
      if (Number(delta) < 0 && debitUnverified) return { status: "OK", moved: Math.abs(delta) };
      const before = balances.get(corporationID);
      const after = Math.round((before + Number(delta)) * 100) / 100;
      if (after < 0) return { status: "CORP_WALLET_INSUFFICIENT", moved: 0 };
      balances.set(corporationID, after);
      return { status: "OK", moved: Math.abs(Number(delta)), balance: after };
    },
    clock: () => 1000,
    env: { EVEJS_COOP_WAR_MERCENARY_CONTRACT: "1" },
  });
  return { settlement, balances, apply, rows };
}

test("a contract moves exactly the needed ISK between real wallets and conserves it", () => {
  const w = world();
  const before = w.balances.get(1000129) + w.balances.get(1000120);
  const out = w.settlement.execute({ eventID: "merc:1", payerCorporationID: 1000129,
    payeeCorporationID: 1000120, amountCents: NEED });
  assert.equal(out.status, "PAID");
  assert.equal(w.balances.get(1000129), 136554292.96 - 25000);
  assert.equal(w.balances.get(1000120), 25000);
  assert.equal(w.balances.get(1000129) + w.balances.get(1000120), before, "no ISK minted");
  assert.equal(w.apply.length, 2, "exactly one debit and one credit");
});

test("a replayed event never pays twice", () => {
  const w = world();
  const args = { eventID: "merc:2", payerCorporationID: 1000129,
    payeeCorporationID: 1000120, amountCents: NEED };
  assert.equal(w.settlement.execute(args).status, "PAID");
  assert.equal(w.settlement.execute(args).status, "DUPLICATE");
  assert.equal(w.balances.get(1000120), 25000);
  assert.equal(w.apply.length, 2);
});

test("a dry run previews the transfer and touches no wallet", () => {
  const w = world();
  const out = w.settlement.execute({ eventID: "merc:3", payerCorporationID: 1000129,
    payeeCorporationID: 1000120, amountCents: NEED, dryRun: true });
  assert.equal(out.status, "DRY_RUN");
  assert.equal(out.preview.payeeAfterISK, 25000);
  assert.equal(w.apply.length, 0);
  assert.equal(w.rows.size, 0);
});

test("an insolvent payer is refused and nothing is journalled", () => {
  const w = world({ payer: 10 });
  const out = w.settlement.execute({ eventID: "merc:4", payerCorporationID: 1000129,
    payeeCorporationID: 1000120, amountCents: NEED });
  assert.equal(out.reason, "WAR_MERCENARY_PAYER_INSOLVENT");
  assert.equal(w.apply.length, 0);
  assert.equal(w.rows.size, 0);
});

test("an unverified debit halts and is never replayed", () => {
  const w = world({ debitUnverified: true });
  const args = { eventID: "merc:5", payerCorporationID: 1000129,
    payeeCorporationID: 1000120, amountCents: NEED };
  const out = w.settlement.execute(args);
  assert.equal(out.phase, "AMBIGUOUS_DEBIT");
  const again = w.settlement.execute(args);
  assert.equal(again.reason, "WAR_MERCENARY_PRIOR_LEG_UNRESOLVED");
  assert.equal(w.apply.length, 1, "the debit is attempted exactly once");
});

test("a failed credit is recorded as owed, not retried silently", () => {
  const w = world({ creditFails: true });
  const args = { eventID: "merc:6", payerCorporationID: 1000129,
    payeeCorporationID: 1000120, amountCents: NEED };
  const out = w.settlement.execute(args);
  assert.equal(out.phase, "PARTIAL_CREDIT_MISSING");
  assert.equal(out.owedISK, 25000);
  assert.equal(w.settlement.execute(args).reason, "WAR_MERCENARY_PRIOR_LEG_UNRESOLVED");
  // the money left the payer and did not arrive: the journal says so exactly
  assert.equal(w.balances.get(1000129), 136554292.96 - 25000);
  assert.equal(w.balances.get(1000120), 0);
});

test("a journal that does not read back blocks the debit instead of double paying", () => {
  const w = world({ volatileJournal: true });
  const out = w.settlement.execute({ eventID: "merc:7", payerCorporationID: 1000129,
    payeeCorporationID: 1000120, amountCents: NEED });
  assert.equal(out.reason, "WAR_MERCENARY_JOURNAL_NOT_DURABLE");
  assert.equal(out.debitAttempted, false);
  assert.equal(w.apply.length, 0, "no money may move on an unreadable journal");
  assert.equal(w.balances.get(1000129), 136554292.96);
  assert.equal(w.balances.get(1000120), 0);
});

test("flag OFF is inert and identities are validated", () => {
  const w = world();
  const off = createMercenarySettlement({ gameStore: { coopAtomicNativeRows: { transact: (t, fn) => fn({ get: () => null, put: () => {} }) } },
    readBalance: () => 0, applyDelta: () => ({ status: "OK" }), env: {} });
  assert.equal(off.execute({ eventID: "x", payerCorporationID: 1, payeeCorporationID: 2, amountCents: 1 }).status, "DISABLED");
  assert.equal(w.settlement.execute({ eventID: "bad id!", payerCorporationID: 1, payeeCorporationID: 2, amountCents: 1 }).status, "BLOCKED");
  assert.equal(w.settlement.execute({ eventID: "e", payerCorporationID: 7, payeeCorporationID: 7, amountCents: 1 }).reason, "INVALID_MERCENARY_IDENTITY");
});
