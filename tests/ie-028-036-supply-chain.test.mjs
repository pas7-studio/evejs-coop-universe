import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);
if (!process.env.EVEJS_FORK_ROOT) throw new Error("EVEJS_FORK_ROOT is unset");
const fork = process.env.EVEJS_FORK_ROOT.trim();
const sp = (n) => join(fork, "Code/server/src/space", n);

const Custody = require(sp("coopEconomyOreCustody.js"));
const Stock = require(sp("coopEconomyStationStockProof.js"));
const Refinery = require(sp("coopEconomyRefineryQuote.js"));
const Admission = require(sp("coopEconomyJobAdmission.js"));
const Delivery = require(sp("coopEconomyOutputDelivery.js"));
const Resupply = require(sp("coopEconomyFleetResupply.js"));
const Feedback = require(sp("coopEconomyConsumptionFeedback.js"));
const Loop = require(sp("coopEconomyClosedLoop.js"));

test("IE-028 ore custody: a repeated load cannot duplicate a cargo id, and custody keeps the title", () => {
  const c = Custody.createCustody();
  assert.equal(c.load({ cargoID: "c1", ownerID: "corp", holderID: "hull1", typeID: "34", quantity: 100 }).code, "LOADED");
  assert.equal(c.load({ cargoID: "c1", ownerID: "corp", holderID: "hull1", typeID: "34", quantity: 100 }).code, "DUPLICATE_CARGO_ID");
  assert.equal(c.totalQuantity(), 100, "the duplicate load added nothing");
  const moved = c.transfer({ cargoID: "c1", toHolderID: "hull2" });
  assert.equal(moved.holderID, "hull2");
  assert.equal(moved.ownerID, "corp", "the native title does not move with custody");
  assert.equal(c.ownerTotal("corp"), 100);
  assert.equal(c.totalQuantity(), 100, "physical quantity is conserved across reassignment");
  assert.equal(c.transfer({ cargoID: "ghost", toHolderID: "hull2" }).code, "UNKNOWN_CARGO");
  assert.equal(c.load({ cargoID: "c2", ownerID: "corp", holderID: "hull1", typeID: "34", quantity: 0 }).code, "INVALID_CARGO");
});

test("IE-029 station proof: a COMMITTED depot without a warehouse item is still blocked", () => {
  const arrival = { receiptID: "arr-1" };
  const blocked = Stock.proveStationStock({
    stationID: "s1",
    typeID: "34",
    quantity: 50,
    arrival,
    warehouseItems: [],
    depotStatus: "COMMITTED",
  });
  assert.deepEqual(blocked, { ok: false, code: "NO_PHYSICAL_STOCK", available: 0 });
  assert.equal(Stock.proveStationStock({ stationID: "s1", typeID: "34", quantity: 50, warehouseItems: [] }).code, "ARRIVAL_RECEIPT_REQUIRED");
  const proven = Stock.proveStationStock({
    stationID: "s1",
    typeID: "34",
    quantity: 50,
    arrival,
    warehouseItems: [
      { stationID: "s1", typeID: "34", itemID: "i2", quantity: 20 },
      { stationID: "s1", typeID: "34", itemID: "i1", quantity: 30 },
      { stationID: "s2", typeID: "34", itemID: "i3", quantity: 999 },
    ],
  });
  assert.equal(proven.code, "STOCK_PROVEN");
  assert.equal(proven.available, 50, "only the matching physical station items count");
  assert.deepEqual(proven.itemIDs, ["i1", "i2"]);
  assert.equal(proven.unlocksRefinery, true);
});

test("IE-030 refinery: an unpayable fee blocks the run and debits nothing", () => {
  const quote = {
    inputTypeID: "34",
    inputQuantity: 100,
    outputTypeID: "35",
    outputQuantity: 90,
    feeCents: 10,
    facilityID: "f1",
  };
  let debits = 0;
  const debit = () => {
    debits += 1;
    return { receiptID: "pay-1" };
  };
  const unsupported = Refinery.runRefinery({
    quote,
    inputs: [{ typeID: "34", quantity: 100 }],
    walletCents: 1000,
    facility: { facilityID: "f1", supportsFeePayment: false },
    paymentPort: { debit },
  });
  assert.equal(unsupported.code, "FEE_PAYMENT_UNSUPPORTED");
  assert.equal(debits, 0, "an unsupported fee path never touches the wallet");
  assert.equal(
    Refinery.runRefinery({ quote, inputs: [{ typeID: "34", quantity: 100 }], walletCents: 1000, facility: { facilityID: "f1", supportsFeePayment: true } }).code,
    "FEE_PAYMENT_UNSUPPORTED",
    "a missing payment port is the same blocker",
  );
  assert.equal(debits, 0);
  assert.equal(Refinery.runRefinery({ quote, inputs: [], walletCents: 1000, facility: { facilityID: "f1", supportsFeePayment: true }, paymentPort: { debit } }).code, "INPUT_SHORT");
  assert.equal(debits, 0);
  assert.equal(Refinery.runRefinery({ quote, inputs: [{ typeID: "34", quantity: 100 }], walletCents: 5, facility: { facilityID: "f1", supportsFeePayment: true }, paymentPort: { debit } }).code, "INSUFFICIENT_FUNDS");
  assert.equal(debits, 0);
  assert.equal(Refinery.runRefinery({ quote: { ...quote, facilityID: "f9" }, inputs: [{ typeID: "34", quantity: 100 }], walletCents: 1000, facility: { facilityID: "f1", supportsFeePayment: true }, paymentPort: { debit } }).code, "FACILITY_MISMATCH");

  const paid = Refinery.runRefinery({ quote, inputs: [{ typeID: "34", quantity: 100 }], walletCents: 1000, facility: { facilityID: "f1", supportsFeePayment: true }, paymentPort: { debit } });
  assert.equal(paid.code, "REFINED");
  assert.deepEqual(paid.output, { typeID: "35", quantity: 90 });
  assert.equal(paid.feeCents, 10);
  assert.equal(paid.debitReceiptID, "pay-1");
  assert.equal(debits, 1, "the fee is debited exactly once");
});

test("IE-030 refinery: a zero fee skips the wallet entirely", () => {
  const free = Refinery.runRefinery({
    quote: { inputTypeID: "34", inputQuantity: 10, outputTypeID: "35", outputQuantity: 9, feeCents: 0, facilityID: "f1" },
    inputs: [{ typeID: "34", quantity: 10 }],
    walletCents: 0,
    facility: { facilityID: "f1" },
  });
  assert.equal(free.code, "REFINED");
  assert.equal(free.debitReceiptID, null);
});

test("IE-032 job admission: duplicate invocation makes one job, an unknown install makes none", () => {
  const quote = {
    blueprintID: "bp1",
    productTypeID: "35",
    runs: 1,
    materialCostCents: 50,
    needs: [{ typeID: "34", quantity: 100 }],
  };
  let installs = 0;
  const installPort = {
    installOnce: () => {
      installs += 1;
      return { receiptID: "job-" + installs };
    },
  };
  const a = Admission.createJobAdmission();
  const first = a.admit({ operationID: "o1", quote, materials: [{ typeID: "34", quantity: 100 }], walletCents: 100, installPort });
  const second = a.admit({ operationID: "o1", quote, materials: [{ typeID: "34", quantity: 100 }], walletCents: 100, installPort });
  assert.equal(first.code, "ADMITTED");
  assert.equal(second.code, "ALREADY_ADMITTED");
  assert.equal(second.jobID, first.jobID);
  assert.equal(installs, 1, "exactly one paid native job under duplicate invocation");
  assert.equal(a.admit({ operationID: "o2", quote, materials: [], walletCents: 100, installPort }).code, "MATERIALS_SHORT");
  assert.equal(a.admit({ operationID: "o3", quote, materials: [{ typeID: "34", quantity: 100 }], walletCents: 10, installPort }).code, "INSUFFICIENT_FUNDS");
  assert.equal(
    a.admit({ operationID: "o4", quote, materials: [{ typeID: "34", quantity: 100 }], walletCents: 100, installPort: {} }).code,
    "NATIVE_AUTHORITY_UNAVAILABLE",
  );

  const b = Admission.createJobAdmission();
  const unknown = b.admit({
    operationID: "u1",
    quote,
    materials: [{ typeID: "34", quantity: 100 }],
    walletCents: 100,
    installPort: { installOnce: () => { throw new Error("timeout"); } },
  });
  assert.equal(unknown.code, "INSTALL_UNKNOWN");
  const retry = b.admit({ operationID: "u1", quote, materials: [{ typeID: "34", quantity: 100 }], walletCents: 100, installPort });
  assert.equal(retry.code, "INSTALL_UNKNOWN", "an unknown install can never create a second job");
  assert.equal(installs, 1);
});

test("IE-033 output delivery: a READY flag alone cannot mint an item", () => {
  let issues = 0;
  const itemStore = {
    issue: () => {
      issues += 1;
      return { itemID: "item-1" };
    },
  };
  const job = { jobID: "job1", productTypeID: "35", quantity: 2, readyFlag: true };
  const d = Delivery.createOutputDelivery();
  assert.equal(d.deliver({ job, readback: { jobID: "job1" }, itemStore }).code, "NOT_READY");
  assert.equal(issues, 0, "the flag is not readiness evidence");
  assert.equal(d.deliver({ job, readback: { jobID: "job1", readyAt: 5 }, itemStore }).code, "NOT_READY");
  assert.equal(issues, 0);
  const delivered = d.deliver({ job, readback: { jobID: "job1", completed: true, readyAt: 5 }, itemStore });
  assert.equal(delivered.code, "DELIVERED");
  assert.deepEqual({ itemID: delivered.itemID, typeID: delivered.typeID, quantity: delivered.quantity }, { itemID: "item-1", typeID: "35", quantity: 2 });
  const again = d.deliver({ job, readback: { jobID: "job1", completed: true, readyAt: 5 }, itemStore });
  assert.equal(again.code, "ALREADY_DELIVERED");
  assert.equal(issues, 1, "exactly one product item");
  assert.equal(d.deliver({ job: { ...job, jobID: "job2" }, readback: { jobID: "job2", completed: true, readyAt: 5 }, itemStore: {} }).code, "NATIVE_AUTHORITY_UNAVAILABLE");
});

test("IE-034 fleet resupply: an unavailable hull gets nothing and the warehouse issues once", () => {
  let fits = 0;
  const equipmentPort = {
    fit: () => {
      fits += 1;
      return { receiptID: "fit-1" };
    },
  };
  const base = {
    deliveryID: "d1",
    item: { typeID: "35", quantity: 10, stationID: "s1" },
    hull: { hullID: "h1", stationID: "s1", docked: true },
    warehouse: { stationID: "s1", quantity: 50 },
    equipmentPort,
  };
  const r = Resupply.createResupply();
  assert.equal(r.resupply({ ...base, hull: { hullID: "h1", stationID: "s2", docked: true } }).code, "HULL_UNAVAILABLE");
  assert.equal(r.resupply({ ...base, hull: { hullID: "h1", stationID: "s1", docked: false } }).code, "HULL_UNAVAILABLE");
  assert.equal(fits, 0, "no remote gifting to an absent hull");
  assert.equal(r.resupply({ ...base, warehouse: { stationID: "s1", quantity: 5 } }).code, "STOCK_SHORT");
  assert.equal(r.resupply({ ...base, equipmentPort: {} }).code, "NATIVE_AUTHORITY_UNAVAILABLE");
  const issued = r.resupply(base);
  assert.equal(issued.code, "RESUPPLIED");
  assert.equal(issued.warehouseRemaining, 40);
  assert.equal(issued.receiptID, "fit-1");
  const again = r.resupply(base);
  assert.equal(again.code, "ALREADY_ISSUED");
  assert.equal(fits, 1, "the warehouse is not issued twice for one delivery");
});

test("IE-035 consumption: one fire debit is one signal, a replay cannot inflate demand", () => {
  const ledger = Feedback.createDemandLedger();
  assert.equal(ledger.record({ evidenceID: "e1", hullID: "h1", typeID: "35", quantity: 10 }).code, "RECORDED");
  const replay = ledger.record({ evidenceID: "e1", hullID: "h1", typeID: "35", quantity: 10 });
  assert.equal(replay.code, "DUPLICATE_IGNORED");
  assert.equal(replay.demand, 10);
  assert.equal(ledger.record({ evidenceID: "e2", hullID: "h1", typeID: "35", quantity: 5 }).demand, 15);
  assert.equal(ledger.record({ evidenceID: "e3", hullID: "h2", typeID: "36", quantity: 2 }).code, "RECORDED");
  assert.equal(ledger.total(), 17);
  assert.deepEqual(ledger.signals(), [
    { typeID: "35", quantity: 15, evidenceIDs: ["e1", "e2"] },
    { typeID: "36", quantity: 2, evidenceIDs: ["e3"] },
  ]);
  assert.equal(ledger.record({ evidenceID: "", hullID: "h1", typeID: "35", quantity: 1 }).code, "INVALID_EVIDENCE");
});

const demand = {
  oreTypeID: "34",
  materialTypeID: "35",
  productTypeID: "36",
  stationID: "s1",
  hullID: "h1",
  blueprintID: "bp1",
  oreQuantity: 100,
  materialQuantity: 90,
  productQuantity: 2,
  runs: 1,
  feeCents: 10,
  walletCents: 1000,
  materialCostCents: 50,
  corpID: "corp-a",
};

const livePorts = () => ({
  mining: { dispatch: () => ({ receiptID: "mine-1" }) },
  warehouse: { receive: () => ({ receiptID: "arr-1", itemID: "item-ore-1" }) },
  payment: { debit: () => ({ receiptID: "pay-1" }) },
  install: { installOnce: () => ({ receiptID: "job-1" }) },
  itemStore: { issue: () => ({ itemID: "item-prod-1" }) },
  equipment: { fit: () => ({ receiptID: "fit-1" }) },
  consumption: { read: () => ({ receiptID: "fire-1", quantity: 1 }) },
});

test("IE-036 closed loop: mine..consume closes with a real receipt chain and a new shortage", () => {
  const result = Loop.runClosedLoop({ demand, ports: livePorts() });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.code, "LOOP_CLOSED");
  assert.deepEqual(
    result.receipts.map((r) => r.step),
    ["mine", "warehouse", "refine", "admit", "deliver", "resupply", "consume"],
    "every step carries a native receipt",
  );
  for (const receipt of result.receipts) assert.ok(receipt.receiptID, "receipt id present for " + receipt.step);
  assert.deepEqual(result.ledger, { "34": 0, "35": 0, "36": 1 });
  assert.equal(result.conserved.oreMined, 100);
  assert.equal(result.conserved.productConsumed, 1);
  assert.equal(result.conserved.remainingProduct, 1);
  assert.equal(result.shortage.signalled, true);
  assert.equal(result.shortage.quantity, 1);
});

test("IE-036 closed loop: a manual or mock port is not live proof", () => {
  const manual = Loop.runClosedLoop({ demand, ports: { ...livePorts(), mining: { manual: true } } });
  assert.equal(manual.ok, false);
  assert.equal(manual.code, "NOT_LIVE_PROOF");
  const mock = Loop.runClosedLoop({ demand, ports: { ...livePorts(), itemStore: { mock: true } } });
  assert.equal(mock.code, "NOT_LIVE_PROOF");
  const simulated = Loop.runClosedLoop({ demand, ports: { ...livePorts(), equipment: { simulated: true } } });
  assert.equal(simulated.code, "NOT_LIVE_PROOF");
});

test("IE-036 closed loop: a receiptless step and over-consumption both stop the loop", () => {
  const noReceipt = Loop.runClosedLoop({ demand, ports: { ...livePorts(), payment: { debit: () => ({}) } } });
  assert.equal(noReceipt.ok, false);
  assert.equal(noReceipt.step, "refine");
  assert.equal(noReceipt.detail.code, "FEE_OUTCOME_UNKNOWN");
  const overConsume = Loop.runClosedLoop({ demand, ports: { ...livePorts(), consumption: { read: () => ({ receiptID: "fire-1", quantity: 9 }) } } });
  assert.equal(overConsume.ok, false);
  assert.equal(overConsume.code, "CONSERVATION_VIOLATION");
  const noEvidence = Loop.runClosedLoop({ demand, ports: { ...livePorts(), consumption: { read: () => ({ quantity: 1 }) } } });
  assert.equal(noEvidence.code, "NOT_LIVE_PROOF");
  assert.equal(noEvidence.step, "consume");
});

// WAVE4-REGRESSION
test("IE-033 delivery: a completed readback for another job is not this job's readiness", () => {
  const d = Delivery.createOutputDelivery();
  const job = { jobID: "job-a", productTypeID: "35", quantity: 1, readyFlag: true };
  const foreign = d.deliver({ job, readback: { jobID: "job-b", completed: true, readyAt: 5 }, itemStore: { issue: () => ({ itemID: "it" }) } });
  assert.equal(foreign.ok, false, "another job's readback minted an item");
  assert.equal(foreign.code, "NOT_READY");
  const own = d.deliver({ job, readback: { jobID: "job-a", completed: true, readyAt: 5 }, itemStore: { issue: () => ({ itemID: "it" }) } });
  assert.equal(own.ok, true);
  assert.equal(d.deliver({ job, readback: { completed: true, readyAt: 5 }, itemStore: { issue: () => ({ itemID: "it2" }) } }).code, "ALREADY_DELIVERED");
});
