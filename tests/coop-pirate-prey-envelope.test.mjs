import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";

// Measured live 2026-11-02 in Jita: a pirate anchored 4.4e11 m away at a stargate was ordered to warp onto the
// player the second he undocked, so every undock produced an immediate fight on top of the station. A pirate is a
// site rat: it fights what comes to it, inside its own engagement envelope.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const require = createRequire(import.meta.url);
const { createRaids } = require(
  path.join(forkRoot, "Code/server/src/space/coopNativeRaids.js"),
);

const SYSTEM = 30000142;
const PIRATE = 501;
const PLAYER_SHIP = 90001;
const ENV = { EVEJS_COOP_PIRATE_PREY_PLAYERS: "1", EVEJS_COOP_PIRATE_PREY_HIGHSEC: "1" };

function build(playerAt) {
  const ships = new Map();
  ships.set(PIRATE, {
    id: PIRATE,
    kind: "ship",
    nativeNpc: true,
    position: { x: 0, y: 0, z: 0 },
    mode: "STOP",
    itemID: PIRATE,
  });
  ships.set(PLAYER_SHIP, {
    id: PLAYER_SHIP,
    kind: "ship",
    itemID: PLAYER_SHIP,
    position: playerAt,
    mode: "STOP",
    session: { characterID: 140000005 },
  });
  const sessions = new Map();
  sessions.set(1, { characterID: 140000005, _space: { systemID: SYSTEM, shipID: PLAYER_SHIP } });
  const calls = [];
  const raids = createRaids({
    env: ENV,
    clock: () => Date.UTC(2026, 10, 2, 23, 30, 0),
    warp: (pirateID, targetID) => {
      calls.push({ kind: "warp", pirateID, targetID });
      return { success: true };
    },
    attack: (pirateID, targetID) => {
      calls.push({ kind: "attack", pirateID, targetID });
      return { success: true };
    },
    release: () => ({ success: true }),
    gunRange: () => ({ meters: 9000, family: "laserTurret" }),
  });
  const scene = {
    systemID: SYSTEM,
    sessions,
    getEntityByID: (id) => ships.get(Number(id)) || null,
  };
  return { raids, scene, calls };
}

test("a pirate does not warp across the system onto a player who just undocked", () => {
  const { raids, scene, calls } = build({ x: 4.4e11, y: 0, z: 0 });
  const result = raids.tick({ systemID: SYSTEM, scene, pirates: [PIRATE], fleetShips: [] });
  assert.equal(calls.length, 0, "no warp and no attack order for prey outside the envelope");
  assert.equal(result.actions.length, 0);
});

test("a player inside the engagement envelope is still fought", () => {
  const { raids, scene, calls } = build({ x: 40000, y: 0, z: 0 });
  raids.tick({ systemID: SYSTEM, scene, pirates: [PIRATE], fleetShips: [] });
  assert.equal(calls.length, 1, "one order is issued for prey at 40 km");
  assert.equal(calls[0].targetID, PLAYER_SHIP);
});

test("the envelope is configurable for the owner's own testing", () => {
  const { raids, scene, calls } = build({ x: 4.4e11, y: 0, z: 0 });
  const wide = createRaids({
    env: { ...ENV, EVEJS_COOP_PIRATE_PREY_RANGE_METERS: "5e11" },
    clock: () => Date.UTC(2026, 10, 2, 23, 30, 0),
    warp: (pirateID, targetID) => {
      calls.push({ kind: "warp", pirateID, targetID });
      return { success: true };
    },
    attack: (pirateID, targetID) => {
      calls.push({ kind: "attack", pirateID, targetID });
      return { success: true };
    },
    gunRange: () => ({ meters: 9000 }),
  });
  wide.tick({ systemID: SYSTEM, scene, pirates: [PIRATE], fleetShips: [] });
  assert.equal(calls.length, 1, "an operator can widen the envelope explicitly");
  assert.equal(raids.tick({ systemID: SYSTEM, scene, pirates: [PIRATE], fleetShips: [] }).actions.length, 0);
});
