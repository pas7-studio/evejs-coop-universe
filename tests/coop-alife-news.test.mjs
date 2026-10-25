import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { createNews, systemLabel, describe } = require("../integration/coopAlifeNews.cjs");

function news(options = {}) {
  let now = 1_000_000;
  const instance = createNews({ clock: () => now, ...options });
  return { instance, advance: (ms) => (now += ms), now: () => now };
}

test("only real observed events can reach the digest", () => {
  const { instance } = news();
  assert.equal(instance.record("living-world-topology", { systemID: 30000145 }), false);
  assert.equal(instance.record("living-native-market-trade", {}), false, "no system, no news");
  assert.equal(instance.record("living-native-market-trade",
    { systemID: 30000145, side: "sell", typeID: 1228, quantity: 1, price: 4605.77 }), true);
  assert.equal(instance.pendingFor(30000145), 1);
});

test("a no-op event never becomes news", () => {
  const { instance } = news();
  assert.equal(instance.record("living-pirate-raid", { systemID: 30000145, pirates: 0 }), false);
  assert.equal(instance.record("living-native-combat-damage", { systemID: 30000145, damage: 0 }), false);
  assert.equal(instance.record("living-hauler-loaded", { systemID: 30000145, haulerID: 7, cargoQuantity: 0 }), false);
  assert.equal(instance.record("living-npc-station-delivered", { systemID: 30000145, stacks: 0, oreQuantity: 0 }), false);
  assert.equal(instance.pendingFor(30000145), 0);
  assert.equal(instance.digest(30000145), null, "no digest may be built from nothing");
  // A real quantity still passes.
  assert.equal(instance.record("living-pirate-raid", { systemID: 30000145, pirates: 2 }), true);
});

test("a digest summarises the window and names the system", () => {
  const { instance } = news();
  instance.record("living-native-market-trade",
    { systemID: 30000145, side: "sell", typeID: 1228, quantity: 1, price: 4605.77 });
  instance.record("living-pirate-raid", { systemID: 30000145, pirates: 3 });
  const digest = instance.digest(30000145);
  assert.ok(digest);
  assert.equal(digest.systemID, 30000145);
  assert.match(digest.text, /^\[ALIFE\] New Caldari \(30000145\): /);
  assert.match(digest.text, /продаж 1228 x1 @4605\.77/);
  assert.match(digest.text, /3 пірат/);
  assert.equal(digest.items, 2);
});

test("one digest per window per system, and nothing is repeated", () => {
  const { instance, advance } = news({ windowMs: 300000 });
  instance.record("living-hauler-loaded", { systemID: 30000144, haulerID: 1, cargoQuantity: 100 });
  assert.ok(instance.digest(30000144));
  instance.markSent(30000144);
  assert.equal(instance.digest(30000144), null, "same window stays silent");
  advance(299000);
  instance.record("living-hauler-loaded", { systemID: 30000144, haulerID: 1, cargoQuantity: 100 });
  assert.equal(instance.digest(30000144), null);
  advance(2000);
  const next = instance.digest(30000144);
  assert.ok(next, "a new window reports again");
  assert.equal(next.items, 1);
});

test("stale items expire instead of being reported as news", () => {
  const { instance, advance } = news({ maxAgeMs: 60000 });
  instance.record("living-native-combat-damage", { systemID: 30000142, damage: 120 });
  advance(61000);
  assert.equal(instance.digest(30000142), null);
});

test("duplicate identical lines are collapsed, and the text is bounded", () => {
  const { instance } = news({ maxItems: 3 });
  for (let i = 0; i < 10; i += 1) {
    instance.record("living-native-mining-startup-slot",
      { systemID: 30000144, fleetSlot: 1, miners: 2 });
  }
  const digest = instance.digest(30000144);
  assert.equal(digest.items, 1);
  assert.ok(digest.text.length <= 240);
  assert.equal(systemLabel(30000144), "Perimeter (30000144)");
  assert.equal(systemLabel(9999), "9999");
  assert.equal(describe({ kind: "blocker", module: "station-arrival", status: "WARP_COMMAND_FAILED" }),
    "station-arrival: WARP_COMMAND_FAILED");
});
