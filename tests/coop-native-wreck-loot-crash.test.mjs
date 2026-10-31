import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const fork = process.env.EVEJS_FORK_ROOT;
if (!fork) throw new Error("EVEJS_FORK_ROOT must point at the EveJS checkout under test");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "m002-crash-"));
fs.cpSync(path.join(fork, "Code/server/src/gameStore/data"), path.join(root, "data"), { recursive: true });
fs.writeFileSync(path.join(root, ".evejs-test-store-attestation.json"), JSON.stringify({
  schemaVersion: 1, kind: "evejs-test-store",
  createdBy: "server/tests/helpers/isolatedGameStore.js",
  storeRoot: fs.realpathSync(root), dataDir: fs.realpathSync(path.join(root, "data")),
}));
process.env.EVEJS_TEST_STORE_ISOLATED = "1";
process.env.EVEJS_TEST_STORE_ROOT = root;
process.env.EVEJS_GAMESTORE_DATA_DIR = path.join(root, "data");
process.env.EVEJS_COOP_WRECK_TRANSFER_GUARD_FILE = path.join(root, "coop-wreck-transfer-guard.json");
for (const key of ["EVEJS_COOP_NPC_EXPEDITION_WRECK", "EVEJS_COOP_SALVAGE_ATOMIC_TRANSFER",
  "EVEJS_COOP_NATIVE_LOOT_QUARANTINE", "EVEJS_COOP_PVE_BOSS_LOOT_FENCE",
  "EVEJS_COOP_NATIVE_LOOT_EVIDENCE"]) delete process.env[key];

const STATION = 60003760;
const SYSTEM = 30000142;
const gameStore = require(path.join(fork, "Code/server/src/gameStore"));
const itemStore = require(path.join(fork, "Code/server/src/services/inventory/itemStore"));
const nativeNpcStore = require(path.join(fork, "Code/server/src/space/npc/nativeNpcStore"));

// Every step runs in its own process: a pickup that is killed cannot leave this process's cache
// looking healthy, and "restart" means exactly what it means on a server.
const CHILD = path.join(root, "crash-child.cjs");
fs.writeFileSync(CHILD, `
const fork = process.env.EVEJS_FORK_ROOT;
const mode = process.argv[2];
const arg = JSON.parse(process.argv[3] || "{}");
const gameStore = require(fork + "/Code/server/src/gameStore");
const itemStore = require(fork + "/Code/server/src/services/inventory/itemStore");
const nativeNpcStore = require(fork + "/Code/server/src/space/npc/nativeNpcStore");
const guard = require(fork + "/Code/server/src/space/coopNativeWreckTransferGuard");
const svc = require(fork + "/Code/server/src/space/npc/nativeNpcWreckService");
function state() {
  const row = nativeNpcStore.getNativeWreckItem(arg.wreckItemID);
  const dest = Object.values(itemStore.getAllItems()).filter((i) =>
    Number(i.ownerID) === Number(arg.characterID) && Number(i.locationID) === Number(arg.stationID) &&
    Number(i.typeID) === Number(arg.typeID));
  return {
    wreckRemaining: row ? Number(row.quantity) : 0,
    wreckRowPresent: row !== null,
    destination: dest.map((i) => ({ itemID: i.itemID, quantity: Number(i.quantity) })),
    destinationTotal: dest.reduce((n, i) => n + (Number(i.quantity) > 0 ? Number(i.quantity) : 1), 0),
    pending: guard.pending().length,
  };
}
const kill = () => process.kill(process.pid, "SIGKILL");
if (mode === "state") { console.log(JSON.stringify(state())); process.exit(0); }
if (mode === "recover") {
  if (arg.crashDuringRecovery) {
    const remove = itemStore.removeInventoryItem;
    itemStore.removeInventoryItem = (...a) => { remove.apply(itemStore, a); kill(); };
  }
  const result = svc.recoverNativeWreckTransfers();
  console.log(JSON.stringify({ recovery: result, state: state() }));
  process.exit(0);
}
if (mode === "pickup") {
  if (arg.crashAt === "after-intent") {
    const begin = guard.begin;
    guard.begin = (...a) => { const r = begin(...a); kill(); return r; };
  }
  if (arg.crashAt === "after-grant-full") {
    nativeNpcStore.removeNativeWreckItem = () => kill();
  }
  if (arg.crashAt === "after-grant-partial") {
    nativeNpcStore.upsertNativeWreckItem = () => kill();
  }
  if (arg.crashAt === "after-debit") {
    guard.finish = () => kill();
  }
  const result = svc.transferNativeWreckItemToCharacterLocation({
    characterID: arg.characterID, wreckID: arg.wreckID, wreckItemID: arg.wreckItemID,
    destinationLocationID: arg.stationID, ...(arg.quantity ? { quantity: arg.quantity } : {}) });
  console.log(JSON.stringify({ result: { success: result.success, errorMsg: result.errorMsg }, state: state() }));
  process.exit(0);
}
console.log(JSON.stringify({ error: "unknown mode" }));
process.exit(2);
`);

let nextID = 100;
function fixture(quantity, extra = {}) {
  const n = nextID++;
  const characterID = 150000000 + n;
  const wreckID = 950000 + n;
  const wreckItemID = 960000 + n;
  const typeID = 34;
  gameStore.write("characters", String(characterID), { characterID, name: "Crash Pilot " + n,
    shipID: 0, corporationID: 1000001, stationID: STATION, solarSystemID: SYSTEM });
  nativeNpcStore.upsertNativeWreck({ wreckID, systemID: SYSTEM, itemName: "Crash Wreck",
    ownerID: 500001, typeID: 25, transient: false });
  nativeNpcStore.upsertNativeWreckItem({ wreckItemID, wreckID, typeID, quantity,
    singleton: false, itemName: "Tritanium", ownerID: 500001, volume: 0.01 });
  if (extra.destinationStack) {
    const granted = itemStore.grantItemToCharacterLocation(characterID, STATION, 4,
      { typeID, name: "Tritanium" }, extra.destinationStack, {});
    if (granted.success !== true) throw new Error("fixture stack failed");
  }
  gameStore.flushAllSync();
  return { characterID, wreckID, wreckItemID, typeID, stationID: STATION, quantity };
}
function run(mode, arg) {
  const r = spawnSync(process.execPath, [CHILD, mode, JSON.stringify(arg)],
    { env: process.env, encoding: "utf8", timeout: 120000 });
  const line = (r.stdout || "").trim().split("\n").filter((x) => x.startsWith("{")).pop();
  return { status: r.status, signal: r.signal, out: line ? JSON.parse(line) : null,
           stderr: (r.stderr || "").slice(-400) };
}
const state = (f) => run("state", f).out;
const conserved = (s) => s.wreckRemaining + s.destinationTotal;

test("crash after the durable intent and before the grant leaves nothing behind", () => {
  const f = fixture(3);
  const killed = run("pickup", { ...f, crashAt: "after-intent" });
  assert.notEqual(killed.status, 0, "the child must die, not return");
  const before = state(f);
  assert.equal(before.wreckRemaining, 3);
  assert.equal(before.destinationTotal, 0);
  assert.equal(before.pending, 1);
  const recovered = run("recover", { ...f }).out;
  assert.equal(recovered.recovery.ok, true);
  const after = state(f);
  assert.equal(after.pending, 0);
  assert.equal(conserved(after), 3);
});

test("crash after the grant and before the source debit does not duplicate loot", () => {
  const f = fixture(4);
  const killed = run("pickup", { ...f, crashAt: "after-grant-full" });
  assert.notEqual(killed.status, 0);
  const before = state(f);
  assert.equal(before.destinationTotal, 4);
  assert.equal(before.wreckRemaining, 4);
  assert.equal(conserved(before), 8, "the crash window is real: both copies exist before recovery");
  const recovered = run("recover", { ...f }).out;
  assert.equal(recovered.recovery.ok, true);
  const after = state(f);
  assert.equal(after.destinationTotal, 0);
  assert.equal(after.wreckRemaining, 4);
  assert.equal(conserved(after), 4);
  assert.equal(after.pending, 0);
});

test("crash after the source debit and before acknowledgement completes the pickup", () => {
  const f = fixture(5);
  const killed = run("pickup", { ...f, crashAt: "after-debit" });
  assert.notEqual(killed.status, 0);
  const before = state(f);
  assert.equal(before.wreckRemaining, 0);
  assert.equal(before.destinationTotal, 5);
  const recovered = run("recover", { ...f }).out;
  assert.equal(recovered.recovery.ok, true);
  const after = state(f);
  assert.equal(after.wreckRemaining, 0);
  assert.equal(after.destinationTotal, 5);
  assert.equal(conserved(after), 5);
  assert.equal(after.pending, 0);
});

test("partial decrement path: crash after the grant restores the source and the total", () => {
  const f = fixture(6);
  const killed = run("pickup", { ...f, crashAt: "after-grant-partial", quantity: 2 });
  assert.notEqual(killed.status, 0);
  const before = state(f);
  assert.equal(before.destinationTotal, 2);
  assert.equal(before.wreckRemaining, 6);
  assert.equal(conserved(before), 8);
  const recovered = run("recover", { ...f }).out;
  assert.equal(recovered.recovery.ok, true);
  const after = state(f);
  assert.equal(after.destinationTotal, 0);
  assert.equal(after.wreckRemaining, 6);
  assert.equal(conserved(after), 6);
  assert.equal(after.pending, 0);
});

test("a merged destination stack is restored exactly, not just emptied", () => {
  const f = fixture(4, { destinationStack: 7 });
  const killed = run("pickup", { ...f, crashAt: "after-grant-full" });
  assert.notEqual(killed.status, 0);
  const before = state(f);
  assert.equal(before.destinationTotal, 11);
  const recovered = run("recover", { ...f }).out;
  assert.equal(recovered.recovery.ok, true);
  const after = state(f);
  assert.equal(after.destinationTotal, 7, "the pre-existing stack must come back untouched");
  assert.equal(after.wreckRemaining, 4);
  assert.equal(after.pending, 0);
});

test("a crash during recovery is finished by the next restart, once", () => {
  const f = fixture(3);
  run("pickup", { ...f, crashAt: "after-grant-full" });
  const crashed = run("recover", { ...f, crashDuringRecovery: true });
  assert.notEqual(crashed.status, 0, "recovery must be killed mid-way");
  const midway = state(f);
  assert.ok(midway.pending === 1, "the intent survives a crash inside recovery");
  const recovered = run("recover", { ...f }).out;
  assert.equal(recovered.recovery.ok, true);
  const after = state(f);
  assert.equal(after.pending, 0);
  assert.equal(after.destinationTotal, 0);
  assert.equal(after.wreckRemaining, 3);
  const again = run("recover", { ...f }).out;
  assert.equal(again.recovery.ok, true);
  assert.equal(state(f).pending, 0, "recovery is idempotent");
});

test("a settled pickup cannot be granted twice by a repeated pickup", () => {
  const f = fixture(5);
  const first = run("pickup", { ...f });
  assert.equal(first.out.result.success, true);
  const second = run("pickup", { ...f });
  assert.equal(second.out.result.success, false);
  assert.equal(second.out.result.errorMsg, "ITEM_NOT_FOUND");
  const after = state(f);
  assert.equal(after.destinationTotal, 5);
  assert.equal(after.wreckRemaining, 0);
  assert.equal(after.pending, 0);
});

test("two independent processes claiming one wreck item grant it once", () => {
  const f = fixture(5);
  const child = path.join(root, "race-child.cjs");
  fs.writeFileSync(child, fs.readFileSync(CHILD));
  const spawn = () => import("node:child_process").then(({ spawn }) => new Promise((resolve) => {
    const p = spawn(process.execPath, [child, "pickup", JSON.stringify(f)], { env: process.env });
    let out = "";
    p.stdout.on("data", (d) => { out += d; });
    p.on("exit", (status) => resolve({ status, out }));
  }));
  return Promise.all([spawn(), spawn()]).then((results) => {
    const granted = results.filter((r) => {
      const line = (r.out || "").trim().split("\n").filter((x) => x.startsWith("{")).pop();
      return line && JSON.parse(line).result.success === true;
    });
    assert.equal(granted.length, 1, "exactly one process may win");
    const after = state(f);
    assert.equal(after.destinationTotal, 5);
    assert.equal(after.wreckRemaining, 0);
    assert.equal(conserved(after), 5);
    assert.equal(after.pending, 0);
  });
});

