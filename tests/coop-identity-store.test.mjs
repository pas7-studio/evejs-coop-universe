import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

// Stage 4 of the JSON->gameStore migration: the NPC identity registry became one
// row per pilot in coopNpcLinks. The point is not speed - it is that several
// owners (world, market trader, co-op loop) used to read and REWRITE one file, so
// an owner with a stale copy silently dropped another owner's link (measured
// 2026-10-30). A shared row cannot go stale and cannot be clobbered.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const require = createRequire(import.meta.url);
const {createRegistry, TABLE} = require(
  path.join(forkRoot, "Code/server/src/space/coopIdentityRegistry.js"));

const NOW = 1_700_000_000_000;
const SID = 30000144;

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "coop-identity-store-"));
}

function fakeStore({failWrite = false} = {}) {
  const rows = new Map();
  return {
    rows,
    read(table, key) {
      if (key === "/") {
        const object = {};
        for (const [storedKey, value] of rows) {
          if (storedKey.startsWith("/")) object[storedKey.slice(1)] = structuredClone(value);
        }
        return Object.keys(object).length
          ? {success: true, errorMsg: null, data: object}
          : {success: false, errorMsg: "ENTRY_NOT_FOUND", data: null};
      }
      return rows.has(key)
        ? {success: true, errorMsg: null, data: structuredClone(rows.get(key))}
        : {success: false, errorMsg: "ENTRY_NOT_FOUND", data: null};
    },
    write(table, key, data) {
      if (failWrite) return {success: false, errorMsg: "WRITE_ERROR"};
      rows.set(key, structuredClone(data));
      return {success: true, errorMsg: null};
    },
    remove(table, key) {
      if (failWrite) return {success: false, errorMsg: "REMOVE_ERROR"};
      return rows.delete(key)
        ? {success: true, errorMsg: null}
        : {success: false, errorMsg: "ENTRY_NOT_FOUND"};
    },
    flushTableSync() {
      return {success: true, errorMsg: null, flushed: true};
    },
  };
}

function registryOf(store, dir, alive = new Set([502])) {
  return createRegistry({
    file: path.join(dir, "coop-npc-links.json"),
    exists: (systemID, entityID) => Number(systemID) === SID && alive.has(Number(entityID)),
    clock: () => NOW,
    gameStore: store,
  });
}

test("a link is one row, visible to every registry instance at once", () => {
  const store = fakeStore();
  const dir = tempDir();
  const file = path.join(dir, "coop-npc-links.json");
  const world = registryOf(store, dir);
  const trader = registryOf(store, dir);

  assert.deepEqual(world.link({id: "coop-pilot-001", name: "Hauler", role: "hauler"}, SID, 502),
    {pilotID: "coop-pilot-001", name: "Hauler", faction: "independent", role: "hauler",
      durable: false, systemID: SID, entityID: 502, linkedAt: NOW});
  assert.equal(TABLE, "coopNpcLinks");
  assert.equal(store.rows.get("/coop-pilot-001").entityID, 502);
  // the 2026-10-30 bug: the second owner used to hold a boot-time copy and answer null
  assert.equal(trader.get("coop-pilot-001").entityID, 502);
  assert.equal(world.refresh(), false);
});

test("the legacy readers still get a file projection of every link", () => {
  const store = fakeStore();
  const dir = tempDir();
  const registry = registryOf(store, dir);
  registry.link({id: "coop-pilot-002", role: "miner"}, SID, 502);

  const projected = JSON.parse(fs.readFileSync(path.join(dir, "coop-npc-links.json"), "utf8"));
  assert.equal(projected.version, 1);
  assert.equal(projected.links["coop-pilot-002"].entityID, 502);

  registry.release("coop-pilot-002");
  const after = JSON.parse(fs.readFileSync(path.join(dir, "coop-npc-links.json"), "utf8"));
  assert.deepEqual(after.links, {});
  assert.equal(store.rows.size, 0);
});

test("an existing links file is imported once, then the store is authoritative", () => {
  const store = fakeStore();
  const dir = tempDir();
  const file = path.join(dir, "coop-npc-links.json");
  fs.writeFileSync(file, JSON.stringify({version: 1, links: {
    "coop-pilot-003": {pilotID: "coop-pilot-003", systemID: SID, entityID: 502, linkedAt: NOW},
    "bad-id": {pilotID: "bad-id", systemID: SID, entityID: 502},
  }}));

  const registry = registryOf(store, dir);
  assert.deepEqual([...store.rows.keys()], ["/coop-pilot-003"]);
  assert.equal(registry.get("coop-pilot-003").entityID, 502);

  fs.rmSync(file);
  assert.equal(registryOf(store, dir).get("coop-pilot-003").entityID, 502);
});

test("release and relocate only touch the exact live link", () => {
  const store = fakeStore();
  const dir = tempDir();
  const alive = new Set([502]);
  const registry = createRegistry({
    file: path.join(dir, "coop-npc-links.json"),
    exists: (systemID, entityID) => Number(systemID) === SID && alive.has(Number(entityID)),
    clock: () => NOW,
    gameStore: store,
  });
  registry.link({id: "coop-pilot-004"}, SID, 502);

  assert.equal(registry.release("coop-pilot-004", {expectedEntityID: 999}).status, "ENTITY_MISMATCH");
  assert.equal(registry.get("coop-pilot-004").entityID, 502);

  alive.add(777);
  assert.equal(registry.relocate("coop-pilot-004", SID, 502, 30000145).status,
    "SOURCE_STILL_PHYSICAL");
  assert.equal(registry.relocate("coop-pilot-004", SID, 999, 30000145).status, "STALE_SOURCE");
  assert.equal(registry.release("coop-pilot-004", {expectedEntityID: 502}).status, "RELEASED");
  assert.equal(registry.get("coop-pilot-004"), null);
});

test("a refused identity write throws and leaves no half link", () => {
  const store = fakeStore({failWrite: true});
  const dir = tempDir();
  const registry = registryOf(store, dir);
  assert.throws(() => registry.link({id: "coop-pilot-005"}, SID, 502),
    /IDENTITY_LINK_WRITE_FAILED/);
  assert.equal(store.rows.size, 0);
  assert.equal(registry.get("coop-pilot-005"), null);
});

test("prune drops links whose physical ship is gone and keeps the rest", () => {
  const store = fakeStore();
  const dir = tempDir();
  const alive = new Set([502]);
  const registry = createRegistry({
    file: path.join(dir, "coop-npc-links.json"),
    exists: (systemID, entityID) => Number(systemID) === SID && alive.has(Number(entityID)),
    clock: () => NOW,
    gameStore: store,
  });
  registry.link({id: "coop-pilot-006"}, SID, 502);
  store.rows.set("/coop-pilot-007", {
    pilotID: "coop-pilot-007", systemID: SID, entityID: 909, linkedAt: NOW,
  });

  assert.equal(registry.prune(), 1);
  assert.deepEqual([...store.rows.keys()], ["/coop-pilot-006"]);
  assert.equal(registry.snapshot().links["coop-pilot-006"].entityID, 502);
});
