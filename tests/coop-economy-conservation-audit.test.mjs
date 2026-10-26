import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { auditEconomyEvidence, SOURCES } = require("../integration/coopEconomyConservationAudit.cjs");
const K = "claim-10";
const valid = () => ({
  nativeItems: [
    { itemID: 501, ownerID: 900, locationID: 60001, typeID: 35, quantity: 12, stacksize: 12 },
    { itemID: 502, ownerID: 900, locationID: 9200000060, typeID: 36, quantity: 3, stacksize: 3 },
    { itemID: 503, ownerID: 901, locationID: 60001, typeID: 37, quantity: 2, stacksize: 2 },
  ],
  npcCargo: [{ cargoID: 14, nativeItemID: 501, ownerID: 900, typeID: 35, quantity: 12 }],
  rustClaims: [{ claimKey: K, fillID: 10, orderID: 60, state: "filled" }],
  gameStoreReceipts: [{ claimKey: K, fillID: 10, orderID: 60, itemID: 501, ownerID: 900, typeID: 35, quantity: 12, locationID: 60001 }],
  marketEscrows: [{ orderID: 60, itemID: 502, ownerID: 900, typeID: 36, quantity: 3, locationID: 9200000060 }],
  industryDeliveries: [{ jobID: 91, itemID: 503, ownerID: 901, typeID: 37, quantity: 2, locationID: 60001 }],
  contractReceipts: [],
  walletSettlements: [{ operationID: "pay-1", debitCents: 2000, creditCents: 1900, feeCents: 100 }],
  journals: [{ operationID: "pay-1", phase: "PREPARED" }, { operationID: "pay-1", phase: "SETTLED" }],
  conservationWindows: [{ operationID: "manufacture-91", typeID: 35, opening: 20, produced: 0, received: 0, consumed: 8, destroyed: 0, sent: 0, closing: 12 }],
});
function check(code, modify) {
  const data = valid(); modify(data);
  const result = auditEconomyEvidence(data);
  assert.equal(result.status, "HOLD_MANUAL");
  assert.ok(result.issues.some(i => i.code === code), JSON.stringify(result));
  assert.equal(result.changed, false);
}
test("fully evidenced cross-store, item and value snapshot is internally consistent", () => {
  const data = valid(), before = structuredClone(data), result = auditEconomyEvidence(data);
  assert.equal(result.status, "SNAPSHOT_CONSISTENT");
  assert.deepEqual(result.issues, []);
  assert.deepEqual(data, before);
  assert.equal(result.changed, false);
});
test("empty or unavailable sources never imply successful gameplay", () => {
  assert.equal(auditEconomyEvidence({}).status, "INCOMPLETE");
  assert.equal(auditEconomyEvidence(Object.fromEntries(SOURCES.map(s => [s, []]))).status, "NO_EVIDENCE");
});
test("lost native receipt after Rust order finalization flags missing settlement", () =>
  check("RUST_FILLED_WITHOUT_NATIVE_RECEIPT", d => d.gameStoreReceipts = []));
test("native receipt with missing Rust claim flags orphan deposit", () =>
  check("GAMESTORE_RECEIPT_WITHOUT_RUST_CLAIM", d => d.rustClaims = []));
test("partial Rust finalize is never represented as complete", () =>
  check("RUST_FINALIZATION_PENDING", d => d.rustClaims[0].state = "settling"));
test("cross-database claim identity mismatch blocks replay", () =>
  check("CROSS_DB_CLAIM_IDENTITY_MISMATCH", d => d.gameStoreReceipts[0].fillID += 1));
test("duplicate Rust fill IDs signal a double settlement", () =>
  check("DUPLICATE_RUST_FILL_ID", d => d.rustClaims.push({ claimKey: "claim-11", fillID: 10, orderID: 61, state: "settling" })));
test("duplicate GameStore claim keys are never silently deduped", () =>
  check("DUPLICATE_GAMESTORE_CLAIM_KEY", d => d.gameStoreReceipts.push({ ...d.gameStoreReceipts[0] })));
test("native inventory ghost behind market settlement is held", () =>
  check("MARKET_RECEIPT_NATIVE_ITEM_NOT_ATTESTED", d => d.nativeItems.shift()));
test("custody item location divergence is held", () =>
  check("GHOST_OR_MISMATCHED_MARKET_ESCROW", d => d.marketEscrows[0].locationID = 9200000061));
test("manufacturing cannot claim an absent physical delivery", () =>
  check("GHOST_OR_MISMATCHED_INDUSTRY_DELIVERY", d => d.nativeItems.pop()));
test("contract custody mismatch is not accepted", () =>
  check("GHOST_OR_MISMATCHED_CONTRACT_CUSTODY", d => d.contractReceipts.push({ contractID: 99, itemID: 503, ownerID: 901, typeID: 37, quantity: 2, locationID: 99999 })));
test("NPC cargo cannot duplicate a mismatched physical item", () =>
  check("NPC_CARGO_ITEM_CUSTODY_DIVERGED", d => d.npcCargo[0].quantity = 42));
test("two receipts cannot represent the same unique NPC cargo stack", () =>
  check("DUPLICATE_NPC_CARGO_ID", d => d.npcCargo.push({ ...d.npcCargo[0] })));
test("wallet cents must conserve with explicit fees", () =>
  check("WALLET_VALUE_NOT_CONSERVED", d => d.walletSettlements[0].creditCents = 2200));
test("same wallet operation cannot settle twice", () =>
  check("DUPLICATE_WALLET_SETTLEMENT", d => d.walletSettlements.push({ ...d.walletSettlements[0] })));
test("ambiguous journal after restart is held", () =>
  check("AMBIGUOUS_JOURNAL_REQUIRES_MANUAL_RECONCILIATION", d => d.journals = [{ operationID: "pay-1", phase: "PREPARED" }]));
test("duplicate terminal journal receipts are held", () =>
  check("DUPLICATE_TERMINAL_JOURNAL", d => d.journals.push({ operationID: "pay-1", phase: "AWARDED" })));
test("manufacturing commodity deficit is flagged", () =>
  check("COMMODITY_NOT_CONSERVED", d => d.conservationWindows[0].closing += 2));
test("invalid negative, fractional or overflowing economic quantities are rejected", () => {
  for (const value of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1])
    check("MALFORMED_EVIDENCE", d => d.nativeItems[0].quantity = value);
});
test("input snapshot size limit fails closed", () =>
  check("SOURCE_TOO_LARGE", d => d.journals = Array.from({ length: 50001 }, () => null)));

test("distinct claims must never share one native fill ID", () =>
  check("DUPLICATE_NATIVE_FILL_ID", d => d.gameStoreReceipts.push({ ...d.gameStoreReceipts[0], claimKey: "other-claim" })));
test("two simultaneously active Rust orders cannot reserve one native item ID", () =>
  check("ITEM_CLAIMED_BY_MULTIPLE_MARKET_ORDERS", d => d.marketEscrows.push({ ...d.marketEscrows[0], orderID: 61 })));
test("NPC cargo and market escrow cannot claim the same live native item", () =>
  check("NPC_CARGO_AND_MARKET_ESCROW_DOUBLE_CLAIM", d => d.marketEscrows.push({ orderID: 99, itemID: 501, ownerID: 900, typeID: 35, quantity: 12, locationID: 60001 })));

test('market escrow and courier contract cannot both reserve the same native item', () =>
  check('NATIVE_ITEM_MULTIPLE_ACTIVE_CUSTODIANS', d => {
    d.contractReceipts.push({contractID:77,itemID:502,ownerID:900,typeID:36,quantity:3,locationID:9200000060});
  }));
test('finished manufacturing output cannot remain a simultaneously active contract escrow', () =>
  check('NATIVE_ITEM_MULTIPLE_ACTIVE_CUSTODIANS', d => {
    d.contractReceipts.push({contractID:78,itemID:503,ownerID:901,typeID:37,quantity:2,locationID:60001});
  }));
test('NPC cargo and any active native contract must not claim one original item', () =>
  check('NATIVE_ITEM_MULTIPLE_ACTIVE_CUSTODIANS', d => {
    d.contractReceipts.push({contractID:79,itemID:501,ownerID:900,typeID:35,quantity:12,locationID:60001});
  }));
test('inactive historical custody receipt is not a live double-claim', () => {
  const d=valid();d.contractReceipts.push({contractID:77,itemID:502,ownerID:900,typeID:36,quantity:3,locationID:9200000060,active:false});
  assert.equal(auditEconomyEvidence(d).status,'SNAPSHOT_CONSISTENT');
});
