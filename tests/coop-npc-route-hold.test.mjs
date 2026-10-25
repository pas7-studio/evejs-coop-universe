import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const { createCivilianOrders } = require("../integration/coopCivilianOrders.cjs");
const runtime = readFileSync(join(root, "integration", "coopVirtualWorldRuntime.cjs"), "utf8");

const FAR = { x: 1e9, y: 0, z: 0 };

function scene({ npcPosition, playerPosition = null }) {
  const ships = new Map();
  ships.set(42, { itemID: 42, kind: "ship", nativeNpc: true, position: npcPosition, mode: "" });
  if (playerPosition) ships.set(77, { itemID: 77, kind: "ship", position: playerPosition });
  const sessions = new Map();
  if (playerPosition) {
    sessions.set(1, { characterID: 140000005, socket: { destroyed: false }, _space: { shipID: 77 } });
  }
  return {
    sessions,
    getEntityByID(id) {
      return ships.get(Number(id));
    },
    // waypoints() reads scene.staticEntities, so the fake must expose that shape
    staticEntities: [{ itemID: 50000001, kind: "stargate", itemName: "Gate", position: FAR }],
  };
}

function harness({ holdMeters, player }) {
  const warps = [];
  const orbits = [];
  let now = 1_000_000;
  const orders = createCivilianOrders({
    sceneForSystem: () => scene({ npcPosition: { x: 0, y: 0, z: 0 }, playerPosition: player ? { x: 100, y: 0, z: 0 } : null }),
    warp: (id, point) => {
      warps.push({ id, point });
      return { success: true };
    },
    orbit: (id, targetID) => {
      orbits.push({ id, targetID });
      return { success: true };
    },
    clock: () => now,
    dwellMs: 1000,
    playerHoldMeters: holdMeters,
  });
  return { orders, warps, orbits, advance: (ms) => { now += ms; } };
}

const assignments = [{ pilotID: "p1", systemID: 30000145, entityID: 42 }];
const roles = { p1: { role: "patrol" } };

test("without a player on grid the scheduled route still warps the NPC", () => {
  const h = harness({ holdMeters: 200000, player: false });
  h.orders.tick(assignments, roles, {});
  assert.equal(h.warps.length, 1, "no hold flag needed when nobody watches");
});

test("a player on grid stops the scheduled warp that made NPCs vanish", () => {
  const h = harness({ holdMeters: 200000, player: true });
  const issued = h.orders.tick(assignments, roles, {});
  assert.deepEqual(issued, [], "no warp order while the player is close");
  assert.equal(h.warps.length, 0, "the NPC must not warp out from under the player");
  // It retries shortly instead of freezing forever.
  h.advance(14999);
  h.orders.tick(assignments, roles, {});
  assert.equal(h.warps.length, 0, "still held before the retry window");
  h.advance(2);
  h.orders.tick(assignments, roles, {});
  assert.equal(h.warps.length, 0, "still held: the player is still there");
});

test("the hold is OFF unless meters are configured", () => {
  const h = harness({ holdMeters: 0, player: true });
  h.orders.tick(assignments, roles, {});
  assert.equal(h.warps.length, 1, "0 meters means the old behaviour");
});

test("a disconnected ghost session cannot keep NPCs pinned in place", () => {
  const warps = [];
  const ghostScene = scene({ npcPosition: { x: 0, y: 0, z: 0 }, playerPosition: { x: 10, y: 0, z: 0 } });
  for (const session of ghostScene.sessions.values()) session.socket.destroyed = true;
  const orders = createCivilianOrders({
    sceneForSystem: () => ghostScene,
    warp: () => (warps.push(1), { success: true }),
    orbit: () => ({ success: true }),
    clock: () => 1,
    playerHoldMeters: 200000,
  });
  orders.tick(assignments, roles, {});
  assert.equal(warps.length, 1, "a dead session is not a player on grid");
});

test("the runtime wires the hold behind an OFF-by-default flag", () => {
  assert.match(runtime, /playerHoldMeters:process\.env\.EVEJS_COOP_NPC_ROUTE_HOLD==="1"\?200000:0/);
});
