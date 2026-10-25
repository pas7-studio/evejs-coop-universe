import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { parse, summarize, report } = require("../scripts/alife-audit.cjs");

const rows = [
  { at: "2026-10-25T10:00:00Z", event: "living-native-industry", systemID: 30000145, status: "ACTIVE" },
  { at: "2026-10-25T10:00:30Z", event: "living-hauler-loaded", shipID: 980000000200, haulerID: 980000000200, cargoQuantity: 6720 },
  { at: "2026-10-25T10:01:00Z", event: "alife-blocker", module: "station-arrival", status: "WARP_COMMAND_FAILED", reason: "WARP_REJECTED_BY_NATIVE", haulerID: 980000000200 },
  { at: "2026-10-25T10:01:30Z", event: "alife-blocker", module: "station-arrival", status: "WARP_COMMAND_FAILED", reason: "WARP_REJECTED_BY_NATIVE" },
  { at: "2026-10-25T10:02:00Z", event: "alife-blocker", module: "station-arrival", status: "NO_NATIVE_NPC_STATION" },
  { at: "2026-10-25T10:02:30Z", event: "living-npc-station-delivered", haulerID: 980000000200, stacks: 1, oreQuantity: 6720 },
  { at: "2026-10-25T10:03:00Z", event: "living-native-market-trade", pilotID: "coop-pilot-002", side: "sell", typeID: 1228, price: 4605.77 },
  { at: "2026-10-25T10:03:30Z", event: "coop-party-proximity", pilotID: "coop-pilot-002" },
];

test("parse ignores BOM, blank lines and unparsable rows", () => {
  const raw = "\uFEFF" + JSON.stringify({ event: "a" }) + "\n\n{bad}\n" + JSON.stringify({ event: "b" }) + "\n";
  assert.deepEqual(parse(raw).map((row) => row.event), ["a", "b"]);
});

test("summarize groups blockers by module/status/reason with exact counts", () => {
  const summary = summarize(rows);
  assert.equal(summary.total, 8);
  assert.equal(summary.first, "2026-10-25T10:00:00Z");
  assert.equal(summary.last, "2026-10-25T10:03:30Z");
  const warp = summary.blockers.find((b) => b.key === "station-arrival / WARP_COMMAND_FAILED / WARP_REJECTED_BY_NATIVE");
  const station = summary.blockers.find((b) => b.key === "station-arrival / NO_NATIVE_NPC_STATION");
  assert.equal(warp.count, 2);
  assert.equal(station.count, 1);
  assert.equal(warp.first, "2026-10-25T10:01:00Z");
});

test("summarize separates life from player evidence and keeps real trades only", () => {
  const summary = summarize(rows);
  assert.equal(summary.trades.length, 1);
  assert.equal(summary.deliveries.length, 1);
  assert.equal(summary.playerEvents, 1);
  assert.ok(summary.lifeEvents >= 6);
  const actors = new Map(summary.actors);
  assert.equal(actors.get("hauler:980000000200"), 3);
  assert.equal(actors.get("coop-pilot-002"), 2);
});

test("--since keeps only the newer window and never invents rows", () => {
  const summary = summarize(rows, { since: "2026-10-25T10:02:00Z" });
  assert.equal(summary.total, 4);
  assert.equal(summary.trades.length, 1);
  const empty = summarize(rows, { since: "2030-01-01T00:00:00Z" });
  assert.equal(empty.total, 0);
  assert.deepEqual(empty.blockers, []);
});

test("report prints blockers and trades, and stays readable with no data", () => {
  const text = report(summarize(rows));
  assert.match(text, /ALIFE audit: 8 events/);
  assert.match(text, /station-arrival \/ WARP_COMMAND_FAILED \/ WARP_REJECTED_BY_NATIVE/);
  assert.match(text, /TRADE .*"typeID":1228/);
  assert.match(report(summarize([])), /blockers[\s\S]*none/);
});
test("--timeline renders the life chain per actor in order", () => {
  const text = require("../scripts/alife-audit.cjs").timeline(rows).map((entry) => entry.line).join("\n");
  assert.match(text, /cargo-loaded .*hauler:980000000200/);
  assert.match(text, /blocked .*WARP_REJECTED_BY_NATIVE/);
  assert.match(text, /station-delivered .*hauler:980000000200/);
  assert.match(text, /market-trade .*coop-pilot-002/);
  const order = require("../scripts/alife-audit.cjs").timeline(rows).map((entry) => entry.stage);
  assert.deepEqual(order, ["cargo-loaded", "blocked", "blocked", "blocked", "station-delivered", "market-trade"]);
});

test("unknown events never appear in the timeline", () => {
  const entries = require("../scripts/alife-audit.cjs").timeline([{ at: "t", event: "living-world-topology" }]);
  assert.deepEqual(entries, []);
  assert.equal(require("../scripts/alife-audit.cjs").stageOf("living-npc-station-warp-requested"), "warp-to-station");
});
