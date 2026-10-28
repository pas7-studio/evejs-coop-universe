import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

// The cool-down is durable now, so the suite must never write into the real market root.
process.env.EVEJS_COOP_STATION_DRAIN_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "drain-"));

const require = createRequire(import.meta.url);
const modulePath = path.join("C:", "Games", "EveCoop", "upstream-evejs", "Code", "server", "src", "space",
  "coopStationDrain.js");
const present = fs.existsSync(modulePath);
const drain = present ? require(modulePath) : {};

// Measured on the work stack 2026-10-28: the corporation owned 705 484 units (442 350
// ore + 263 134 minerals) against a demand of 82 502 and a 200 000 allowance, so the
// governor held mining - and a sale only happens on a station arrival, so the surplus
// could never fall.
const CORP = 1000129;
const MINERALS = new Set([34, 35, 36, 37]);
const isMineral = (typeID) => MINERALS.has(Number(typeID));
const isOre = (typeID) => Number(typeID) === 1228;

test("the drain is OFF unless the flag says otherwise", { skip: !present }, () => {
  const before = process.env.EVEJS_COOP_STATION_DRAIN;
  delete process.env.EVEJS_COOP_STATION_DRAIN;
  assert.equal(drain.ENABLED(), false);
  process.env.EVEJS_COOP_STATION_DRAIN = "1";
  assert.equal(drain.ENABLED(), true);
  if (before === undefined) delete process.env.EVEJS_COOP_STATION_DRAIN;
  else process.env.EVEJS_COOP_STATION_DRAIN = before;
});

test("it flies to the station that really holds the most refined minerals", { skip: !present }, () => {
  const rows = [
    { ownerID: CORP, stationID: 60000682, typeID: 34, quantity: 1000 },
    { ownerID: CORP, stationID: 60000682, typeID: 35, quantity: 500 },
    { ownerID: CORP, stationID: 60014935, typeID: 34, quantity: 9000 },
    // Ore is not the drain's business: the refinery turns it into minerals first.
    { ownerID: CORP, stationID: 60003724, typeID: 1228, quantity: 50000 },
    // Another owner's stock can never be lifted by this corporation.
    { ownerID: 42, stationID: 60003724, typeID: 34, quantity: 99999 },
  ];
  const chosen = drain.chooseStation(rows, { corpID: CORP, isMineral, isOre });
  assert.equal(chosen.stationID, 60014935);
  assert.equal(chosen.units, 9000);
  assert.equal(chosen.ranked.length, 2, "only stations with real mineral stock are ranked");
});

test("no refined stock anywhere means no trip", { skip: !present }, () => {
  const rows = [{ ownerID: CORP, stationID: 60000682, typeID: 1228, quantity: 50000 }];
  assert.equal(drain.chooseStation(rows, { corpID: CORP, isMineral, isOre }), null);
});

test("a fleet is only drained while it is in the mining state", { skip: !present }, () => {
  const before = process.env.EVEJS_COOP_STATION_DRAIN;
  process.env.EVEJS_COOP_STATION_DRAIN = "1";
  const scene = { systemID: 30000145, getEntityByID: () => null };
  assert.equal(drain.start(scene, { state: "hauling", fleetID: 1 }, Date.now()), false);
  assert.equal(drain.start(scene, { state: "mining", fleetID: 1, haulerEntityIDs: [] }, Date.now()), false);
  if (before === undefined) delete process.env.EVEJS_COOP_STATION_DRAIN;
  else process.env.EVEJS_COOP_STATION_DRAIN = before;
});

test("the mining tick lets an active drain own the fleet", { skip: !present }, () => {
  const file = path.join(path.dirname(modulePath), "..", "services", "mining", "miningNpcOperations.js");
  const source = fs.readFileSync(file, "utf8");
  const activeAt = source.indexOf("if (drain.active(fleetRecord)) { drain.tick(scene, fleetRecord, now); return; }");
  const holdAt = source.indexOf("serverGovernor().hold(scene, fleetRecord)");
  assert.ok(activeAt > 0, "the tick must hand the fleet to an active drain");
  assert.ok(holdAt > activeAt, "the drain check comes before the governor hold");
  assert.ok(source.includes('if (drain.start(scene, fleetRecord, now)) return;'),
    "a due drain must start before the mining work picks the hauler");
});

test("the overstock decision comes from the governor's own measurement", { skip: !present }, () => {
  // Measured 2026-10-28: the governor reported DEMAND_UNKNOWN with 739 492 units held,
  // so a HOLD-driven trigger never fired. The drain asks for the measurement instead.
  const source = fs.readFileSync(modulePath, "utf8");
  assert.ok(source.includes("governor.measure(now)"));
  assert.ok(source.includes('if (!decision || decision.action === "ALLOW")'));
  assert.ok(source.includes("EVEJS_COOP_MINING_DEMAND_FLOOR"), "the same floor the governor uses");
});

test("the sale is the proven arrival path, never a new market call", { skip: !present }, () => {
  const source = fs.readFileSync(modulePath, "utf8");
  assert.ok(source.includes('require("./coopVirtualWorldRuntime").sellOnArrival'));
  assert.ok(!/FillOrder|PlaceOrder/.test(source), "the drain never places or fills an order itself");
  assert.ok(source.includes("living-station-drain"), "every step is observable");
});

test("a manufactured good outranks refinery minerals", { skip: !present }, () => {
  // The economy's own product is what nobody else makes, so it must move first:
  // measured 2026-10-28 a station held 5 Mining Survey Chipset I while another held
  // 300k of minerals, and the drain must not keep choosing the minerals.
  const rows = [
    { ownerID: CORP, stationID: 60000682, typeID: 34, quantity: 300000 },
    { ownerID: CORP, stationID: 60014935, typeID: 444, quantity: 5 },
  ];
  const chosen = drain.chooseStation(rows, { corpID: CORP, isMineral, isOre });
  assert.equal(chosen.stationID, 60014935);
  assert.equal(chosen.kind, "product");
});

test("a product sale is not throttled by the mineral governor", { skip: !present }, () => {
  // Measured 2026-10-28: 5 chipsets sat in a hangar that really bids 53 700 while the
  // corporation held 61 000 units of Tritanium, legitimately within its 200 000 floor.
  // The governor answered ALLOW and the drain never left, so the only path that could
  // sell the goods that manufacturing had just produced was silenced by a rule about ore.
  assert.equal(drain.shouldStart("product", { action: "ALLOW" }).start, true);
  assert.equal(drain.shouldStart("product", null).start, true);
  // Minerals keep the gate: overstock drains, demand does not.
  assert.equal(drain.shouldStart("mineral", { action: "TRICKLE" }).start, true);
  assert.equal(drain.shouldStart("mineral", { action: "HOLD" }).start, true);
  assert.equal(drain.shouldStart("mineral", { action: "ALLOW" }).start, false);
  assert.equal(drain.shouldStart("mineral", null).start, false);
});

test("a station that sold nothing is not flown to again while it cools down", { skip: !present }, () => {
  // Measured 2026-10-28: the drain returned to the same hangar three times because a
  // fallback ignored the cooldown it had just set, and each trip burned the fleet's only
  // hauler. The biggest stock is not the best station when that station buys nothing.
  const rows = [
    { ownerID: CORP, stationID: 60000682, typeID: 34, quantity: 400000 },
    { ownerID: CORP, stationID: 60014935, typeID: 34, quantity: 60000 },
  ];
  const now = Date.now();
  drain.coolDown(60000682, now);
  const chosen = drain.chooseStation(rows, { corpID: CORP, isMineral, isOre, now });
  assert.equal(chosen.stationID, 60014935);
  // With every mineral station cooling, the drain stays in the belt instead of flying.
  drain.coolDown(60014935, now);
  assert.equal(drain.chooseStation(rows, { corpID: CORP, isMineral, isOre, now }), null);
});

test("the cool-down survives a restart", { skip: !present }, () => {
  // The map was in memory and the work stack restarted between drain trips, so the same
  // unprofitable station was visited three times. The cool-down is now durable.
  const source = fs.readFileSync(modulePath, "utf8");
  assert.ok(source.includes('"drain-cooldowns.json"'));
  assert.ok(source.includes("function loadCooldowns("));
  assert.ok(source.includes("function saveCooldowns("));
  assert.ok(source.includes("if (id) { stationCooldown.set(id, now + COOLDOWN_MS); saveCooldowns(); }"));
});
