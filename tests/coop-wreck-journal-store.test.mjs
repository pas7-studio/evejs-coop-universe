import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

// Stage 2 of the JSON->gameStore migration: native wreck kill-proof claims and
// wreck->cargo custody journals moved from files into their own SQLite tables.
// The legacy files stay readable for one release (migration source), and a store
// failure must never lose a claim or let an unwritten custody journal pass.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const require = createRequire(import.meta.url);
const {createWreckClaims, TABLE: CLAIMS} = require(
  path.join(forkRoot, "Code/server/src/space/coopNpcWreckClaims.js"));
const {createWreckCustody, TABLE: CUSTODY} = require(
  path.join(forkRoot, "Code/server/src/space/coopNpcWreckCustody.js"));

const NOW = 1_700_000_000_000;
const SID = 30000144;

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "coop-wreck-store-"));
}

function fakeStore({failWrite = false} = {}) {
  const rows = new Map();
  const writes = [];
  return {
    rows,
    writes,
    read(table, key) {
      if (key === "/") {
        if (rows.has("/")) return {success: true, errorMsg: null, data: structuredClone(rows.get("/"))};
        const object = {};
        for (const [storedKey, value] of rows) {
          if (storedKey.startsWith("/") && storedKey.length > 1) object[storedKey.slice(1)] = structuredClone(value);
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
      writes.push([table, key]);
      if (failWrite) return {success: false, errorMsg: "WRITE_ERROR"};
      rows.set(key, structuredClone(data));
      return {success: true, errorMsg: null};
    },
    flushTableSync() {
      return {success: true, errorMsg: null, flushed: true};
    },
  };
}

function proofFor(wreckID) {
  return {
    status: "NATIVE_DESTRUCTION_ATTACKER_PROVIDED",
    systemID: SID,
    wreckID,
    victimEntityID: 900001,
    attackerEntityID: 98000001,
    attackerPilotID: "coop-pilot-001",
  };
}

function wreckFor(wreckID) {
  return {wreckID, systemID: SID, sourceEntityID: 900001, launcherID: 900001};
}

test("a killed-wreck claim lands in coopWreckClaims and survives a reload", () => {
  const store = fakeStore();
  const file = path.join(tempDir(), "claims.json");
  const first = createWreckClaims({file, gameStore: store, clock: () => NOW});

  assert.equal(first.record({proof: proofFor(424242), wreck: wreckFor(424242)}).status,
    "KILL_PROOF_RECORDED");
  assert.deepEqual([...new Set(store.writes.map(([table]) => table))], [CLAIMS]);
  assert.equal(CLAIMS, "coopWreckClaims");
  assert.equal(fs.existsSync(file), false);
  assert.deepEqual(first.active(SID).map((row) => row.wreckID), [424242]);

  const reloaded = createWreckClaims({file, gameStore: store, clock: () => NOW});
  assert.deepEqual(reloaded.active(SID).map((row) => row.wreckID), [424242]);
  assert.equal(reloaded.closed(SID).length, 0);
});

test("the legacy claims file is imported once, then ignored", () => {
  const store = fakeStore();
  const dir = tempDir();
  const file = path.join(dir, "claims.json");
  const legacy = {
    version: 1,
    claims: {
      777: {
        wreckID: 777, systemID: SID, sourceEntityID: 900001, attackerEntityID: 98000001,
        attackerPilotID: "coop-pilot-001", at: NOW - 1000, expiresAt: NOW + 60000,
      },
    },
    closed: {},
  };
  fs.writeFileSync(file, JSON.stringify(legacy));

  const claims = createWreckClaims({file, gameStore: store, clock: () => NOW});
  assert.deepEqual(claims.active(SID).map((row) => row.wreckID), [777]);
  assert.equal(store.rows.get("/").claims["777"].wreckID, 777);

  // removing the file changes nothing: the store is authoritative now
  fs.rmSync(file);
  const reloaded = createWreckClaims({file, gameStore: store, clock: () => NOW});
  assert.deepEqual(reloaded.active(SID).map((row) => row.wreckID), [777]);
});

test("a refused store write still records the claim in the legacy file", () => {
  const store = fakeStore({failWrite: true});
  const file = path.join(tempDir(), "claims.json");
  const claims = createWreckClaims({file, gameStore: store, clock: () => NOW});

  assert.equal(claims.record({proof: proofFor(31337), wreck: wreckFor(31337)}).status,
    "KILL_PROOF_RECORDED");
  assert.deepEqual(claims.active(SID).map((row) => row.wreckID), [31337]);
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).claims["31337"].wreckID, 31337);
});

test("a damaged stored claims journal fails closed instead of being overwritten", () => {
  const store = fakeStore();
  store.rows.set("/", {version: 2, claims: {}, closed: {}});
  const file = path.join(tempDir(), "claims.json");
  fs.writeFileSync(file, JSON.stringify({version: 1, claims: {}, closed: {}}));

  assert.throws(() => createWreckClaims({file, gameStore: store, clock: () => NOW}),
    /INVALID_NATIVE_WRECK_CLAIMS_JOURNAL/);
});

function custodyOf(store, root) {
  const noop = () => null;
  return createWreckCustody({
    store: {
      getNativeEntity: noop, getNativeWreck: noop, getNativeWreckItem: noop,
      listNativeCargoForEntity: noop, allocateCargoID: noop,
      removeNativeWreckItem: noop, upsertNativeWreckItem: noop,
      allocateWreckItemID: noop, upsertNativeCargo: noop, buildNativeCargoItems: noop,
    },
    sceneForSystem: () => ({}),
    resolveType: () => null,
    root,
    clock: () => NOW,
    gameStore: store,
  });
}

function custodyTx(itemID, phase) {
  return {
    version: 1, phase, itemID, wreckID: 5000, systemID: SID, entityID: 9001,
    pilotID: "coop-pilot-001", cargoID: 7000, ownerID: 1, typeID: 34, quantity: 10,
    groupID: 18, categoryID: 25, at: NOW,
    newCargo: {
      cargoID: 7000, entityID: 9001, typeID: 34, ownerID: 1, quantity: 10,
      sourceWreckItemID: itemID, sourceWreckID: 5000,
    },
  };
}

test("custody journals live in coopWreckCustody rows, not the tx directory", () => {
  const store = fakeStore();
  const root = tempDir();
  const legacy = path.join(root, "tx");
  fs.mkdirSync(legacy, {recursive: true});
  fs.writeFileSync(path.join(legacy, "4242.json"), JSON.stringify(custodyTx(4242, "SETTLED")));
  fs.writeFileSync(path.join(legacy, "4243.json"), JSON.stringify(custodyTx(4243, "PREPARED")));

  const custody = custodyOf(store, root);
  assert.equal(CUSTODY, "coopWreckCustody");
  assert.equal(store.rows.get("/4242").phase, "SETTLED");
  assert.equal(store.rows.get("/4243").phase, "PREPARED");
  const recovered = custody.recover();
  assert.equal(recovered.status, "NEEDS_OPERATOR_REPAIR");
  assert.deepEqual(recovered.pending.map((row) => row.reason), ["PREPARED_OUTCOME_UNCERTAIN"]);
});

test("an unexpected custody row is reported instead of treated as a journal", () => {
  const store = fakeStore();
  store.rows.set("/not-an-item-id", custodyTx(4242, "SETTLED"));
  const custody = custodyOf(store, tempDir());
  assert.equal(custody.recover().status, "REPAIR_UNEXPECTED_CUSTODY_FILES");
});
