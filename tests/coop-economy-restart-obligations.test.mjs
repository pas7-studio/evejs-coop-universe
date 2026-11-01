import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";

// The second half of the state scan: contracts, quarantines, reservations, hulls, boards and
// resupply. Each of these holds an obligation to the outside world, and each was process-local, so
// a restart either paid twice, handed the same units out twice or forgot a contract entirely.
const require = createRequire(import.meta.url);
if (!process.env.EVEJS_FORK_ROOT) throw new Error("EVEJS_FORK_ROOT is unset");
const SPACE = join(process.env.EVEJS_FORK_ROOT.trim(), "Code/server/src/space");

function reload(name) {
  const p = join(SPACE, name + ".js");
  delete require.cache[require.resolve(p)];
  return require(p);
}

function memoryJournal() {
  const rows = new Map();
  return {
    get: (k) => rows.get(k),
    set: (k, v) => { rows.set(k, v); },
    has: (k) => rows.has(k),
    delete: (k) => rows.delete(k),
    entries: () => [...rows.entries()],
  };
}

test("a contract settlement is not paid twice across a restart", () => {
  const journal = memoryJournal();
  let credits = 0;
  const walletPort = { credit: () => { credits += 1; return { receiptID: "w" + credits }; } };
  const args = { contractID: "ct-restart", playerID: "p1", deliveredQuantity: 10,
    contractQuantity: 10, unitPriceCents: 5, feeCents: 0, capCents: 100, walletPort };

  const before = reload("coopEconomyContractSettlement").createContractSettlement({ journal });
  const first = before.settle(args);
  assert.equal(first.ok, true, JSON.stringify(first).slice(0, 140));
  assert.equal(credits, 1);

  const after = reload("coopEconomyContractSettlement").createContractSettlement({ journal });
  const replay = after.settle(args);
  assert.equal(replay.code, "ALREADY_SETTLED", "a restart paid the contract again: " + replay.code);
  assert.equal(credits, 1);
});

test("a quarantine still blocks after a restart", () => {
  const journal = memoryJournal();
  const before = reload("coopEconomyQuarantine").createQuarantine({ journal });
  before.quarantine({ operationID: "op-1", resourceKeys: ["item-a"], reason: "ACK_LOST" });

  const after = reload("coopEconomyQuarantine").createQuarantine({ journal });
  assert.equal(after.isBlocked("item-a"), true, "a restart released quarantined goods");
  assert.equal(after.resolve("op-1", "").code, "EVIDENCE_REQUIRED");
});

test("a reservation is not handed out twice across a restart", () => {
  const journal = memoryJournal();
  const before = reload("coopEconomyReservations").createReservations({ journal });
  // reserve(key, operationID, quantity, onHand) is positional
  assert.equal(before.reserve("ore-1", "op-1", 10, 10).ok, true);

  const after = reload("coopEconomyReservations").createReservations({ journal });
  assert.equal(after.reservedFor("ore-1"), 10, "a restart forgot the reservation");
  const second = after.reserve("ore-1", "op-2", 10, 10);
  assert.notEqual(second.ok, true, "the same units were reserved twice after the restart");
});

test("a hull stays reserved across a restart", () => {
  const journal = memoryJournal();
  const before = reload("coopEconomyHaulerReservation").createHaulerPool({ journal });
  before.register({ hullID: "h1", capacityM3: 100 });
  assert.equal(before.reserve({ runID: "r1", hullID: "h1", volumeM3: 100, cargoIDs: ["c1"] }).ok, true);

  const after = reload("coopEconomyHaulerReservation").createHaulerPool({ journal });
  const second = after.reserve({ runID: "r2", hullID: "h1", volumeM3: 100, cargoIDs: ["c2"] });
  assert.notEqual(second.ok, true, "two runs got the same hull after the restart");
});

test("a published contract survives a restart and cannot be accepted twice", () => {
  const journal = memoryJournal();
  const args = { contractID: "cb-restart", typeID: "35", stationID: "s", quantity: 1,
    unitPriceCents: 1, expiryTick: 100, status: "FUNDED" };
  const before = reload("coopEconomyContractBoard").createBoard({ journal });
  assert.equal(before.publish(args).ok, true);
  assert.equal(before.accept({ contractID: "cb-restart", playerID: "p", channelID: "jobBoard",
    requestID: "r", tick: 10 }).code, "ACCEPTED");

  const after = reload("coopEconomyContractBoard").createBoard({ journal });
  const again = after.accept({ contractID: "cb-restart", playerID: "p", channelID: "jobBoard",
    requestID: "r2", tick: 11 });
  assert.notEqual(again.code, "ACCEPTED", "a restart let the same contract be accepted twice");
});

test("a resupply is issued once across a restart", () => {
  const journal = memoryJournal();
  let fits = 0;
  const equipmentPort = { fit: () => { fits += 1; return { ok: true, receiptID: "f" + fits }; } };
  const args = { deliveryID: "d-restart", item: { typeID: "35", quantity: 10, stationID: "s" },
    hull: { hullID: "h1", docked: true, stationID: "s" },
    warehouse: { stationID: "s", quantity: 10 }, equipmentPort };

  const before = reload("coopEconomyFleetResupply").createResupply({ journal });
  assert.equal(before.resupply(args).ok, true);
  assert.equal(fits, 1);

  const after = reload("coopEconomyFleetResupply").createResupply({ journal });
  const replay = after.resupply(args);
  assert.equal(replay.ok, true, "a replay should be a no-op success");
  assert.equal(fits, 1, "the hull was resupplied twice after the restart");
});

test("an open procurement contract survives a restart", () => {
  const journal = memoryJournal();
  const args = { contractID: "pc-restart", typeID: "35", stationID: "s", quantity: 10,
    unitPriceCents: 5, expiryTick: 100, buyerCorpID: "b", supplierID: "p",
    funding: { funded: true, reservedCents: 50, receiptID: "e" } };
  const before = reload("coopEconomyProcurementContract");
  assert.equal(before.useJournal(journal), true, "the journal was not accepted");
  assert.equal(before.openContract(args).ok, true);

  const after = reload("coopEconomyProcurementContract");
  after.useJournal(journal);
  assert.ok(after.open("pc-restart"), "a restart lost an open contract");
});

test("a refinery fee is not charged twice across a restart", () => {
  const journal = memoryJournal();
  let debits = 0;
  const paymentPort = { debit: () => { debits += 1; return { ok: true, receiptID: "p" + debits }; } };
  const args = { operationID: "ref-restart",
    quote: { inputTypeID: "34", outputTypeID: "35", facilityID: "f1", inputQuantity: 10,
      outputQuantity: 9, feeCents: 10 },
    inputs: [{ typeID: "34", quantity: 10 }], walletCents: 100,
    facility: { facilityID: "f1", supportsFeePayment: true }, paymentPort };

  const before = reload("coopEconomyRefineryQuote");
  before.useJournal(journal);
  assert.equal(before.runRefinery(args).code, "REFINED");
  assert.equal(debits, 1);

  const after = reload("coopEconomyRefineryQuote");
  after.useJournal(journal);
  assert.equal(after.runRefinery(args).code, "ALREADY_REFINED", "a restart charged the fee again");
  assert.equal(debits, 1);
});
