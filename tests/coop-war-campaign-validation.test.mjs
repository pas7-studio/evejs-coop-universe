// FW-063 guard: the campaign invariants themselves, without a server.
//
// The live validator found two classes of defect that no single module test could see:
// a campaign running in ASSAULT with no escrow on either side (the treasury row had been
// reverted) and a territory whose revision said "changed hands" with no campaign behind
// it. Each record was individually valid. These checks are the relations between them.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { validateCampaignRecord, summarise } = require("../scripts/war-campaign-checks.cjs");

const WAR = "war:500004-500011";
const CAMPAIGN = "war:500004-500011:campaign:30045344";
const statusOf = (checks, name) => (checks.find((row) => row.name === name) || {}).status;

function record({ campaignState = "ASSAULT", reservations = [], territories = {},
  campaignsExtra = {}, warState = "ACTIVE" } = {}) {
  return {
    state: {
      version: 1,
      wars: { [WAR]: { warID: WAR, attackerFactionID: 500004, defenderFactionID: 500011, state: warState } },
      campaigns: { [CAMPAIGN]: { campaignID: CAMPAIGN, warID: WAR, sourceSystemID: 30003837,
        targetSystemID: 30045344, state: campaignState, objectiveEvidence: [], revision: 2 }, ...campaignsExtra },
      territories,
      enlistments: {}, processed: {}, history: [],
    },
    treasury: { version: 1, nextJournalID: 1, processed: {}, reservations: Object.fromEntries(
      reservations.map((row, index) => [`r${index}`, { reservationID: `r${index}`, ...row }])) },
    fleet: { ships: { 1: { entityID: 980000000001, systemID: 30045344 } } },
  };
}

const funded = (factionID, status = "HELD") => ({ campaignID: CAMPAIGN, factionID,
  warID: WAR, status, cents: 2500000 });

test("a war with escrow on both sides passes every check", () => {
  const input = record({ reservations: [funded(500004), funded(500011)] });
  const checks = validateCampaignRecord({ ...input, creditedEventIDs: new Set() });
  const summary = summarise(checks);
  assert.equal(summary.fail, 0, JSON.stringify(checks.filter((c) => c.status === "FAIL")));
  assert.equal(statusOf(checks, "campaign-sides-funded"), "PASS");
});

test("an assault with no escrow at all is a FAIL, and one side is only a WARN", () => {
  const broken = validateCampaignRecord(record({ reservations: [] }));
  assert.equal(statusOf(broken, "campaign-payable"), "FAIL");
  const oneSided = validateCampaignRecord(record({ reservations: [funded(500004)] }));
  assert.equal(statusOf(oneSided, "campaign-payable"), "PASS");
  assert.equal(statusOf(oneSided, "campaign-sides-funded"), "WARN");
  assert.match(oneSided.find((c) => c.name === "campaign-sides-funded").detail, /500011/);
});

test("escrow held for an expired campaign is a FAIL until it is released", () => {
  const stuck = validateCampaignRecord(record({ campaignState: "EXPIRED",
    reservations: [funded(500011)] }));
  assert.equal(statusOf(stuck, "terminal-escrow-released"), "FAIL");
  const released = validateCampaignRecord(record({ campaignState: "EXPIRED",
    reservations: [{ ...funded(500011), status: "REFUNDED" }] }));
  assert.equal(statusOf(released, "terminal-escrow-released"), "PASS");
});

test("a released escrow without its second leg is a FAIL", () => {
  const paid = { ...funded(500004, "PAID"), paidToPilotID: "coop-pilot-027",
    payoutProofID: "wreck:980300000014" };
  const missing = validateCampaignRecord({ ...record({ reservations: [paid] }),
    creditedEventIDs: new Set() });
  assert.equal(statusOf(missing, "paid-pilot-credited"), "FAIL");
  const credited = validateCampaignRecord({ ...record({ reservations: [paid] }),
    creditedEventIDs: new Set([`war-bounty:${CAMPAIGN}:wreck:980300000014`]) });
  assert.equal(statusOf(credited, "paid-pilot-credited"), "PASS");
});

test("a settlement without its own proof is a FAIL", () => {
  const half = validateCampaignRecord(record({ reservations: [{ ...funded(500004, "PAID"),
    paidToPilotID: "coop-pilot-027" }] }));
  assert.equal(statusOf(half, "paid-row-proven"), "FAIL");
});

test("a territory that changed hands with no campaign behind it is a FAIL", () => {
  const orphan = validateCampaignRecord(record({ territories: { "30000142": {
    systemID: 30000142, originalOwnerFactionID: 500014, militaryControllerFactionID: 500014,
    state: "SECURE", revision: 3, changedAt: 1 } }, reservations: [funded(500004)] }));
  assert.equal(statusOf(orphan, "territory-provenance"), "FAIL");
  const contested = validateCampaignRecord(record({ reservations: [funded(500004)],
    territories: { "30045344": { systemID: 30045344, originalOwnerFactionID: 500011,
      militaryControllerFactionID: 500011, state: "CONTESTED", revision: 2, changedAt: 1 } } }));
  assert.equal(statusOf(contested, "territory-provenance"), "PASS");
});

test("two live campaigns on one target, a dead war and a ghost hull are all caught", () => {
  const doubled = validateCampaignRecord(record({
    reservations: [funded(500004)],
    campaignsExtra: { "war:500004-500011:campaign:30045344:b": {
      campaignID: "war:500004-500011:campaign:30045344:b", warID: WAR,
      sourceSystemID: 30003836, targetSystemID: 30045344, state: "PREPARING",
      objectiveEvidence: [], revision: 1 } } }));
  assert.equal(statusOf(doubled, "one-campaign-per-target"), "FAIL");
  const orphanWar = validateCampaignRecord({ ...record({ reservations: [funded(500004)] }),
    state: { ...record({ reservations: [] }).state,
      campaigns: { x: { campaignID: "x", warID: "war:missing", sourceSystemID: 1,
        targetSystemID: 2, state: "ASSAULT", objectiveEvidence: [], revision: 1 } } } });
  assert.equal(statusOf(orphanWar, "campaign-war-state"), "FAIL");
  const ghost = validateCampaignRecord({ ...record({ reservations: [funded(500004)] }),
    fleet: { ships: { 1: { entityID: 0, systemID: 0 } } } });
  assert.equal(statusOf(ghost, "fleet-hulls-present"), "FAIL");
});

test("unreadable input is a SKIP, never a silent pass", () => {
  const noChest = validateCampaignRecord(record({ reservations: [] }));
  assert.equal(statusOf(noChest, "paid-pilot-credited"), "SKIP");
  assert.equal(noChest.find((c) => c.name === "paid-pilot-credited").detail,
    "the chest journal is not readable here");
  const nothing = validateCampaignRecord({});
  assert.equal(statusOf(nothing, "war-record-readable"), "FAIL");
});
