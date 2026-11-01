import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);
if (!process.env.EVEJS_FORK_ROOT) throw new Error("EVEJS_FORK_ROOT is unset");
const fork = process.env.EVEJS_FORK_ROOT.trim();
const sp = (n) => join(fork, "Code/server/src/space", n);

const Rollout = require(sp("coopEconomyRolloutManifest.js"));
const Console = require(sp("coopEconomyRepairConsole.js"));
const Health = require(sp("coopEconomyHealthReport.js"));
const Calibration = require(sp("coopEconomyCalibration.js"));
const Compat = require(sp("coopEconomyCompatMatrix.js"));
const Release = require(sp("coopEconomyReleaseEvidence.js"));
const Scorecard = require(sp("coopEconomyAutonomyScorecard.js"));
const Perf = require(sp("coopEconomyPerformanceGuard.js"));
const Final = require(sp("coopEconomyFinalAcceptance.js"));

test("IE-065 rollout: OFF and SHADOW never write and an invalid combination cannot start writing", () => {
  assert.equal(Rollout.evaluate({ stage: "OFF", flags: {} }).writes, false);
  const shadow = Rollout.evaluate({ stage: "SHADOW", flags: {} });
  assert.equal(shadow.writes, false);
  assert.equal(shadow.observes, true, "shadow observes but never writes");
  const missing = Rollout.evaluate({ stage: "CORP1", flags: {} });
  assert.equal(missing.code, "INVALID_FLAG_COMBINATION");
  assert.equal(missing.writes, false);
  assert.deepEqual(missing.missing, ["EVEJS_COOP_ECONOMY"]);
  assert.equal(Rollout.evaluate({ stage: "CORP1", flags: { EVEJS_COOP_ECONOMY: "true" } }).writes, false, "only a strict boolean enables writes");
  assert.equal(Rollout.evaluate({ stage: "CORP1", flags: { EVEJS_COOP_ECONOMY: true } }).writes, true);
  const skip = Rollout.evaluate({ stage: "CORP2", flags: { EVEJS_COOP_SECOND_CORP: true } });
  assert.equal(skip.code, "INVALID_FLAG_COMBINATION", "CORP2 cannot be reached without CORP1");
  assert.deepEqual(skip.missing, ["EVEJS_COOP_ECONOMY", "CORP1"]);
  assert.equal(Rollout.evaluate({ stage: "CORP2", flags: { EVEJS_COOP_ECONOMY: true, EVEJS_COOP_SECOND_CORP: true } }).writes, true);
  for (const stage of ["CORP2", "CORP1", "SHADOW", "OFF"]) {
    const back = Rollout.rollback({ stage });
    assert.equal(back.deletesData, false, `${stage} rolls back without data deletion`);
  }
  assert.equal(Rollout.evaluate({ stage: "BETA", flags: {} }).code, "INVALID_STAGE");
});

test("IE-066 repair console: an unknown journal is not healthy and there is no force-success", () => {
  const operation = { operationID: "o1", state: "UNKNOWN", resourceKeys: ["item:1"] };
  const unknown = Console.view({ operation, journal: [] });
  assert.equal(unknown.code, "UNKNOWN_JOURNAL");
  assert.equal(unknown.healthy, false);
  const receiptless = Console.view({ operation, journal: [{ step: "DEBIT", status: "DONE" }] });
  assert.equal(receiptless.code, "UNKNOWN_JOURNAL", "a journal without a single receipt is not evidence");
  const view = Console.view({ operation, journal: [{ step: "DEBIT", receiptID: "r1" }] });
  assert.equal(view.blocked, true);
  assert.deepEqual(view.choices, ["RECONCILE", "QUARANTINE", "RETRY_AFTER_READBACK"]);
  assert.equal(Console.act({ operationID: "o1", choice: "FORCE_SUCCESS" }).code, "UNSAFE_CHOICE");
  assert.equal(Console.act({ operationID: "o1", choice: "RECONCILE" }).code, "EVIDENCE_REQUIRED");
  assert.equal(Console.act({ operationID: "o1", choice: "RECONCILE", evidence: "wallet readback clean" }).code, "ACCEPTED");
  assert.equal(Console.isHealthy({ journal: [] }), false);
});

test("IE-067 health report: an intent is never presented as production", () => {
  const report = Health.buildReport({
    pnl: { realizedCents: 100, stockValueCents: 50, committedCents: 20 },
    demand: { intents: 999, fulfilled: [{ receiptID: "r1", quantity: 5 }] },
    shortages: [{ typeID: "35", quantity: 2 }],
    cargoLosses: [{ cargoID: "c1", quantity: 1, receiptID: "loss-1" }],
    players: [{ playerID: "p1", deliveredQuantity: 5, paidCents: 50 }],
  });
  assert.equal(report.code, "REPORT");
  assert.equal(report.producedQuantity, 5, "only the receipted quantity counts");
  assert.equal(report.intents, 999, "the intent count is reported separately");
  assert.equal(report.shortageQuantity, 2);
  assert.equal(report.cargoLostQuantity, 1);
  assert.equal(
    Health.buildReport({ pnl: { realizedCents: 0, stockValueCents: 0, committedCents: 0 }, demand: { intents: 1, fulfilled: [] }, shortages: [], cargoLosses: [{ cargoID: "c1", quantity: 1 }], players: [] }).code,
    "UNVERIFIED_METRIC",
  );
  assert.equal(
    Health.buildReport({ pnl: { realizedCents: 0, stockValueCents: 0, committedCents: 0 }, demand: { intents: 1, fulfilled: [{ receiptID: "r1", quantity: 1 }] }, shortages: [], cargoLosses: [], players: [{ playerID: "p1", deliveredQuantity: 5, paidCents: 50 }] }).metric,
    "players.p1",
    "a player cannot be paid for more than the receipts show",
  );
});

test("IE-068 calibration: values are clamped to their bounds and there is no demand pump", () => {
  const bounds = { safetyStockTicks: [10, 100], productionCadenceTicks: [5, 60], offerRefreshTicks: [5, 120], riskStep: [1, 5] };
  const steady = Calibration.calibrate({ measured: { safetyStockTicks: 50, productionCadenceTicks: 20, offerRefreshTicks: 30, riskStep: 2, demandMultiplier: 1 }, bounds });
  assert.equal(steady.code, "CALIBRATED");
  assert.deepEqual(steady.clamped, []);
  const extreme = Calibration.calibrate({ measured: { safetyStockTicks: 1000, productionCadenceTicks: 1, offerRefreshTicks: 1, riskStep: 9, demandMultiplier: 1 }, bounds });
  assert.equal(extreme.code, "CALIBRATED");
  assert.deepEqual(extreme.config, { safetyStockTicks: 100, productionCadenceTicks: 5, offerRefreshTicks: 5, riskStep: 5, demandMultiplier: 1 });
  assert.deepEqual(extreme.clamped.sort(), ["offerRefreshTicks", "productionCadenceTicks", "riskStep", "safetyStockTicks"]);
  assert.equal(Calibration.calibrate({ measured: { safetyStockTicks: 50, productionCadenceTicks: 20, offerRefreshTicks: 30, riskStep: 2, demandMultiplier: 3 }, bounds }).code, "DEMAND_PUMP_REFUSED");
});

test("IE-069 compatibility: OFF is unchanged, ON only moves the economy, and no policy self-enables", () => {
  const baseline = { combat: { k: 1 }, salvage: { k: 1 }, factionWarfare: { k: 1 }, market: { k: 1 }, clientRpc: { k: 1 }, economy: { k: 1 }, securityPolicy: { autoEnabled: false } };
  assert.equal(Compat.run({ baseline, candidate: baseline, flags: { economy: false } }).code, "OFF_PARITY");
  assert.equal(Compat.run({ baseline, candidate: { ...baseline, economy: { k: 2 } }, flags: { economy: false } }).code, "OFF_PARITY", "OFF ignores the economy object entirely");
  const offDiff = Compat.run({ baseline, candidate: { ...baseline, combat: { k: 2 } }, flags: { economy: false } });
  assert.equal(offDiff.code, "OFF_DIFF");
  assert.deepEqual(offDiff.areas, ["combat"]);
  const onDiff = Compat.run({ baseline, candidate: { ...baseline, salvage: { k: 2 } }, flags: { economy: true } });
  assert.equal(onDiff.code, "ON_DISRUPTION");
  assert.equal(Compat.run({ baseline, candidate: { ...baseline, economy: { k: 9 } }, flags: { economy: true } }).code, "ON_PARITY");
  assert.equal(Compat.run({ baseline, candidate: { ...baseline, securityPolicy: { autoEnabled: true } }, flags: { economy: true } }).code, "AUTO_ENABLED_POLICY");
});

const goodRelease = () => ({
  integratedSHA: "abc1234",
  testedSHA: "abc1234",
  deployedSHA: "abc1234",
  audits: {
    conservation: { ok: true, evidence: "test log" },
    crash: { ok: true, evidence: "test log" },
    race: { ok: true, evidence: "test log" },
    soak: { ok: true, evidence: "test log" },
    compat: { ok: true, evidence: "test log" },
  },
  client: { ok: true, code: "E2E_VERIFIED", buildID: "build-1" },
  rollback: { tested: true, deletesData: false },
  migrations: [],
  reviewer: { reviewerID: "reviewer-1", role: "REVIEWER", sha: "abc1234" },
});

test("IE-070 release evidence: no PASS for a missing client, a failed audit or a SHA mismatch", () => {
  const ready = Release.build(goodRelease());
  assert.equal(ready.code, "RELEASE_READY");
  assert.equal(ready.integratedSHA, "abc1234");
  assert.deepEqual(ready.audits.sort(), ["compat", "conservation", "crash", "race", "soak"]);
  assert.equal(Release.build({ ...goodRelease(), deployedSHA: "def5678" }).code, "SHA_MISMATCH");
  assert.equal(Release.build({ ...goodRelease(), client: undefined }).code, "CLIENT_NOT_VERIFIED");
  const incomplete = Release.build({ ...goodRelease(), audits: { ...goodRelease().audits, soak: { ok: false } } });
  assert.equal(incomplete.code, "AUDIT_INCOMPLETE");
  assert.deepEqual(incomplete.missing, ["soak"]);
  assert.equal(Release.build({ ...goodRelease(), migrations: undefined }).code, "MIGRATIONS_MISSING");
  assert.equal(Release.build({ ...goodRelease(), rollback: { tested: false, deletesData: false } }).code, "ROLLBACK_UNVERIFIED");
  assert.equal(Release.build({ ...goodRelease(), reviewer: { reviewerID: "reviewer-1", role: "REVIEWER", sha: "zzz" } }).code, "SIGN_OFF_REQUIRED");
});

test("IE-071 scorecard: a DeepSeek rescue is never counted as Ornith work", () => {
  const events = [
    { taskID: "t1", actor: "ornith-a", kind: "PRODUCTION", loc: 100, accepted: true, toolFailures: 1, reviewRounds: 1 },
    { taskID: "t2", actor: "ornith-b", kind: "PRODUCTION", loc: 0, accepted: false, toolFailures: 2 },
    { taskID: "t2", actor: "deepseek", kind: "RESCUE", loc: 80, accepted: true },
    { taskID: "t3", actor: "ornith-a", kind: "PRODUCTION", loc: 40, accepted: true },
    { taskID: "t4", actor: "ornith-a", kind: "TEST", loc: 20, accepted: true },
  ];
  const score = Scorecard.buildScorecard({ events });
  assert.equal(score.ornithAuthoredProductionLOC, 140, "only Ornith production lines");
  assert.equal(score.ornithAuthoredTestLOC, 20);
  assert.equal(score.deepseekRescueLOC, 80);
  assert.equal(score.rescuedTasks, 1);
  assert.equal(score.autonomousVerifiedTasks, 2, "t2 was rescued, so it is not autonomous success");
  assert.equal(score.noCandidateAttempts, 1);
  assert.equal(score.toolFailures, 3);
  assert.equal(Scorecard.buildScorecard({ events: [{ taskID: "t9", actor: "nobody", kind: "PRODUCTION", loc: 5, accepted: true }] }).code, "UNATTRIBUTED");
});

test("IE-072 performance: a p95 regression, tick starvation and a 45-minute checker all fail", () => {
  const baseline = { paths: [{ name: "economyTick", p95Ms: 3 }], ticks: { slowestMs: 5 } };
  const budgets = { p95TolerancePct: 20, tickBudgetMs: 10, maxCheckMinutes: 5 };
  assert.equal(Perf.check({ baseline, candidate: baseline, budgets }).code, "PASS");
  assert.equal(Perf.check({ baseline, candidate: { paths: [{ name: "economyTick", p95Ms: 4 }], ticks: { slowestMs: 5 } }, budgets }).code, "P95_REGRESSION");
  assert.equal(Perf.check({ baseline, candidate: { ...baseline, ticks: { slowestMs: 50 } }, budgets }).code, "TICK_STARVATION");
  assert.equal(Perf.check({ baseline, candidate: baseline, budgets: { ...budgets, checkMinutes: 45 } }).code, "SLOW_CHECKER");
  const extra = Perf.check({ baseline, candidate: { paths: [...baseline.paths, { name: "newProbe", p95Ms: 2 }], ticks: { slowestMs: 5 } }, budgets });
  assert.deepEqual(extra.newPaths, ["newProbe"]);
});

test("IE-073 final acceptance: a reviewer PASS alone never promotes to PLAY", () => {
  const gates = {};
  for (const gate of Final.REQUIRED_GATES) gates[gate] = { ok: true, evidence: "evidence-" + gate };
  assert.equal(Final.evaluate({ gates }).code, "NOT_PROMOTED");
  assert.equal(Final.evaluate({ gates, reviewerApproval: { reviewerID: "rev-1", approved: true } }).code, "NOT_PROMOTED");
  const reviewerOnly = Final.evaluate({ gates, ownerApproval: { approved: true, role: "REVIEWER", approverID: "rev-1", sha: "abc" } });
  assert.equal(reviewerOnly.code, "OWNER_APPROVAL_REQUIRED");
  assert.equal(reviewerOnly.readyForPlay, false);
  const incomplete = Final.evaluate({ gates: { ...gates, G5: { ok: false } }, ownerApproval: { approved: true, role: "OWNER", approverID: "owner", sha: "abc" } });
  assert.equal(incomplete.code, "GATE_INCOMPLETE");
  assert.deepEqual(incomplete.missing, ["G5"]);
  assert.deepEqual(Final.evaluate({ gates: { ...gates, G9: { ok: true } }, ownerApproval: { approved: true, role: "OWNER", approverID: "owner", sha: "abc" } }).missing, ["G9"], "a gate without evidence is incomplete");
  const approved = Final.evaluate({ gates, ownerApproval: { approved: true, role: "OWNER", approverID: "owner-1", sha: "abc1234" }, reviewerApproval: { reviewerID: "rev-1" } });
  assert.equal(approved.code, "PLAY_APPROVED");
  assert.equal(approved.readyForPlay, true);
  assert.equal(approved.approverID, "owner-1");
  assert.equal(approved.reviewerID, "rev-1");
});

// WAVE2-REGRESSION
test("IE-072 performance: a zero baseline cannot hide a nonzero candidate", () => {
  const baseline = { paths: [{ name: "coldPath", p95Ms: 0 }], ticks: { slowestMs: 1 } };
  const candidate = { paths: [{ name: "coldPath", p95Ms: 500 }], ticks: { slowestMs: 1 } };
  const budgets = { p95TolerancePct: 20, tickBudgetMs: 10, maxCheckMinutes: 5 };
  const r = Perf.check({ baseline, candidate, budgets });
  assert.equal(r.code, "P95_REGRESSION", "0ms to 500ms passed as no change");
  assert.equal(Perf.check({ baseline, candidate: { paths: [{ name: "coldPath", p95Ms: 0 }], ticks: { slowestMs: 1 } }, budgets }).code, "PASS");
});
