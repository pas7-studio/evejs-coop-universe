import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import path from "node:path";

// The corporation earns whenever its pilots trade, and that is independent of ore. The sweep
// used to live only inside the refinery path, so with the refinery off (its default) a pilot
// could earn millions and the corporation stayed at zero - measured live 2026-11-05:
// coop-pilot-101 held 1 387 521 ISK of real sale proceeds, corporation 1000129 held 2 624.02.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const require = createRequire(import.meta.url);
const tick = require(path.join(forkRoot, "Code/server/src/space/coopNpcRefineryTick.js"));

function events() {
  const seen = [];
  return {seen, see: (_probe, event, _space, fields) => seen.push({event, fields})};
}

test("the sweep switch moves pilot earnings with the refinery off", () => {
  tick.resetForTests();
  const log = events();
  const calls = [];
  const treasury = {run: (args) => { calls.push(args); return {status: "SWEPT", moved: 1_387_521,
    balanceISK: 1_390_145.02}; }};
  const r = tick.tick({env: {EVEJS_COOP_CORP_TREASURY_SWEEP: "1"}, systemID: 30000144,
    treasury, observe: log.see, probe: {}, now: 1_000});
  assert.equal(r.status, "SWEPT");
  assert.equal(r.swept, 1_387_521);
  assert.equal(r.refined, 0, "a sweep never refines an ore stack");
  assert.equal(calls.length, 1, "the treasury authority is asked exactly once");
  assert.equal(calls[0].corporationID, 1000129);
  const swept = log.seen.find((e) => e.event === "living-corp-treasury-swept");
  assert.ok(swept, log.seen.map((e) => e.event).join(","));
  assert.equal(swept.fields.movedISK, 1_387_521);
});

test("without either switch the phase stays disabled and moves nothing", () => {
  tick.resetForTests();
  let asked = 0;
  const r = tick.tick({env: {}, treasury: {run: () => { asked += 1; return {status: "SWEPT", moved: 5}; }},
    observe: () => {}, probe: {}, now: 2_000});
  assert.equal(r.status, "DISABLED");
  assert.equal(asked, 0);
});

test("the refinery switch alone still runs the full path", () => {
  tick.resetForTests();
  // A real station with an empty hangar: the sweep is still attempted with the same authority
  // (never silently skipped), and nothing is refined because there is no ore.
  let asked = 0;
  const items = {ITEM_FLAGS: {HANGAR: 4}, listOwnedItems: () => []};
  const refinery = {refine: () => ({status: "COMMITTED", outputs: []})};
  const r = tick.tick({env: {EVEJS_COOP_NPC_REFINERY: "1"}, systemID: 30000144, stationID: 60000358,
    items, refinery, treasury: {run: () => { asked += 1; return {status: "SWEPT", moved: 10}; }},
    observe: () => {}, probe: {}, now: 3_000});
  assert.equal(r.status, "NO_WAREHOUSE_ORE");
  assert.equal(asked, 1);
});

test("a sweep that has nothing to move reports the truth, not a fake success", () => {
  tick.resetForTests();
  const log = events();
  const r = tick.tick({env: {EVEJS_COOP_CORP_TREASURY_SWEEP: "1", EVEJS_COOP_TREASURY_TRACE: "1"},
    systemID: 30000144, treasury: {run: () => ({status: "NOTHING_TO_SWEEP", moved: 0})},
    observe: log.see, probe: {}, now: 4_000});
  assert.equal(r.status, "NOTHING_TO_SWEEP");
  assert.equal(r.swept, 0);
  assert.equal(log.seen.some((e) => e.event === "living-corp-treasury-swept"), false);
  assert.equal(log.seen.find((e) => e.event === "living-corp-treasury-skipped").fields.status,
    "NOTHING_TO_SWEEP");
});
