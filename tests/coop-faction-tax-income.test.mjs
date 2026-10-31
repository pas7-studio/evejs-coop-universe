// FW-122: the faction that HOLDS a system takes a share of the tax its market already charges.
//
// MEASURED 2026-10-31: the market charges a sales tax (TRANSACTION_TAX) and debits it from the
// seller, but never credits a corporation - the ISK disappears. So owning ground paid nothing,
// which is exactly the owner's complaint. The recipient is now the faction whose military
// controller holds the station's system, through the same journaled war treasury.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { createFactionTaxIncome } = require("../integration/coopFactionTaxIncome.cjs");

function fixture({ controller = 500004, corporation = 1000120, treasuryStatus = "APPLIED" } = {}) {
  const calls = [];
  const api = createFactionTaxIncome({
    readWarState: () => ({ version: 1,
      territories: controller
        ? { "30045344": { systemID: 30045344, militaryControllerFactionID: controller } }
        : {} }),
    getStation: (id) => (Number(id) === 60003760 ? { stationID: 60003760, solarSystemID: 30045344 } : null),
    corporationFor: () => corporation,
    treasury: { execute: (command) => { calls.push(command);
      return { status: treasuryStatus, reason: treasuryStatus === "APPLIED" ? "" : "WAR_TREASURY_FUNDS_UNAVAILABLE",
        receipt: { amountCents: command.amountCents } }; } },
  });
  return { api, calls };
}

test("the tax of a sale goes to the faction that controls the system", () => {
  const f = fixture();
  const answer = f.api.collect({ stationID: 60003760, amountCents: 2500,
    proofID: "sale:980300000001", eventID: "tax:sale:980300000001" });
  assert.equal(answer.status, "APPLIED", JSON.stringify(answer));
  assert.equal(f.calls.length, 1);
  const command = f.calls[0];
  assert.equal(command.type, "TAX_INCOME");
  assert.equal(command.factionID, 500004);
  assert.equal(command.corporationID, 1000120);
  assert.equal(command.amountCents, 2500);
  assert.equal(command.systemID, 30045344);
  assert.equal(command.proofID, "sale:980300000001");
});

test("a system nobody controls pays nobody", () => {
  const f = fixture({ controller: 0 });
  const answer = f.api.collect({ stationID: 60003760, amountCents: 2500,
    proofID: "sale:1", eventID: "tax:1" });
  assert.equal(answer.status, "REFUSED");
  assert.equal(answer.reason, "NO_SYSTEM_CONTROLLER");
  assert.equal(f.calls.length, 0, "no journal entry is written for an unowned system");
});

test("no tax means no income, and a missing proof is a refusal", () => {
  const f = fixture();
  assert.equal(f.api.collect({ stationID: 60003760, amountCents: 0, proofID: "sale:1",
    eventID: "tax:1" }).reason, "NO_TAX_TO_COLLECT");
  assert.equal(f.api.collect({ stationID: 60003760, amountCents: 100, proofID: "",
    eventID: "tax:1" }).reason, "TAX_PROOF_REQUIRED");
  assert.equal(f.api.collect({ stationID: 1, amountCents: 100, proofID: "sale:1",
    eventID: "tax:1" }).reason, "STATION_UNKNOWN");
  assert.equal(f.calls.length, 0);
});

test("a faction without a corporation cannot be paid", () => {
  const f = fixture({ corporation: 0 });
  const answer = f.api.collect({ stationID: 60003760, amountCents: 900,
    proofID: "sale:2", eventID: "tax:2" });
  assert.equal(answer.reason, "NO_FACTION_CORPORATION");
  assert.equal(f.calls.length, 0);
});

test("a refused treasury is reported with its own reason, never hidden", () => {
  const f = fixture({ treasuryStatus: "BLOCKED" });
  const answer = f.api.collect({ stationID: 60003760, amountCents: 900,
    proofID: "sale:3", eventID: "tax:3" });
  assert.equal(answer.status, "BLOCKED");
  assert.equal(answer.reason, "WAR_TREASURY_FUNDS_UNAVAILABLE");
});

test("the owner of a station is the controller of its system", () => {
  const f = fixture();
  assert.deepEqual(f.api.ownerOf(60003760), { status: "OWNED", systemID: 30045344,
    factionID: 500004 });
  assert.equal(f.api.ownerOf(0).status, "INVALID_STATION");
  assert.equal(f.api.ownerOf(999).status, "STATION_UNKNOWN");
});
