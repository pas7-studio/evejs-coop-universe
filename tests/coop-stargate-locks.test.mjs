import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import path from "node:path";

// eve_public.stargate.lock.api.admin.{Apply,Delete,GetAll} used to be an empty default,
// so no gate could ever be restricted. A lock is now a real persisted row with an expiry
// that space/runtime.startStargateJump refuses to jump through.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const require = createRequire(import.meta.url);
const lockPath = path.join(forkRoot, "Code/server/src/space/coopStargateLocks.js");
const {createStargateLocks, KEY} = require(lockPath);

const NOW = Date.UTC(2026, 9, 29, 12, 0, 0);
const HOUR = 60 * 60 * 1000;

function memoryStore() {
  const rows = new Map();
  return {
    read(table, pth) {
      const value = rows.get(`${table}${pth}`);
      return value ? {success: true, data: structuredClone(value)} : {success: false, data: null};
    },
    write(table, pth, data) {
      rows.set(`${table}${pth}`, structuredClone(data));
      return {success: true};
    },
    rows,
  };
}

const locks = (env = {EVEJS_COOP_STARGATE_LOCKS: "1"}, clock = () => NOW) =>
  createStargateLocks({gameStore: memoryStore(), clock, env});

test("a lock applies, lists and expires on its own timestamp", () => {
  const state = locks();
  assert.equal(state.apply({systemID: 30000144, gateID: 50001234, expiresAtMs: NOW + HOUR}).status,
    "APPLIED");
  assert.deepEqual(state.list(), [{systemID: 30000144, gateID: 50001234, expiresAtMs: NOW + HOUR}]);
  assert.equal(state.isLocked(50001234), true);
  assert.deepEqual(state.lockedSystemIDs(), [30000144]);
  // an hour later the same row is gone, without anyone deleting it
  assert.equal(state.isLocked(50001234, NOW + HOUR + 1), false);
  assert.deepEqual(state.list(NOW + HOUR + 1), []);
});

test("a lock refuses what it cannot honour instead of storing junk", () => {
  const state = locks();
  assert.equal(state.apply({gateID: 1, expiresAtMs: NOW + HOUR}).status, "SYSTEM_REQUIRED");
  assert.equal(state.apply({systemID: 1, expiresAtMs: NOW + HOUR}).status, "GATE_REQUIRED");
  assert.equal(state.apply({systemID: 1, gateID: 2}).status, "EXPIRY_REQUIRED");
  assert.equal(state.apply({systemID: 1, gateID: 2, expiresAtMs: NOW - 1}).status,
    "ALREADY_EXPIRED", "a lock in the past would be a lie");
});

test("delete removes exactly one solar system", () => {
  const state = locks();
  state.apply({systemID: 30000144, gateID: 11, expiresAtMs: NOW + HOUR});
  state.apply({systemID: 30000144, gateID: 12, expiresAtMs: NOW + HOUR});
  state.apply({systemID: 30000142, gateID: 21, expiresAtMs: NOW + HOUR});
  assert.deepEqual(state.deleteForSystem(30000144), {status: "DELETED", removed: 2});
  assert.deepEqual(state.list().map((lock) => lock.gateID), [21]);
  assert.equal(state.deleteForSystem(30000144).status, "NOT_FOUND");
});

test("a disabled feature locks nothing", () => {
  const state = locks({});
  assert.equal(state.apply({systemID: 1, gateID: 2, expiresAtMs: NOW + HOUR}).status, "DISABLED");
  assert.equal(state.isLocked(2), false);
});

test("gateway: Apply answers 200, refusals carry the reason, GetAll lists the rows", () => {
  const {createStargateLockGatewayService, LOCK_PROTO_ROOT} = require(path.join(forkRoot,
    "Code/server/src/_secondary/express/gatewayServices/stargateLockGatewayService.js"));
  const store = locks();
  const service = createStargateLockGatewayService({stargateLocks: store});
  const admin = "eve_public.stargate.lock.api.admin";
  const encode = (name, value) => {
    const type = LOCK_PROTO_ROOT.lookupType(name);
    return Buffer.from(type.encode(type.create(value)).finish());
  };
  const envelope = (value) => ({payload: {value}});

  const applied = service.handleRequest(`${admin}.ApplyRequest`, envelope(encode(
    `${admin}.ApplyRequest`, {
      character: {sequential: 140000001},
      solarsystem: {sequential: 30000144},
      gate: {sequential: 50001234},
      expiry: {seconds: Math.floor((NOW + HOUR) / 1000), nanos: 0},
    },
  )));
  assert.equal(applied.statusCode, 200);
  assert.equal(applied.responseTypeName, `${admin}.ApplyResponse`);

  const refused = service.handleRequest(`${admin}.ApplyRequest`, envelope(encode(
    `${admin}.ApplyRequest`, {solarsystem: {sequential: 30000144}},
  )));
  assert.equal(refused.statusCode, 9);
  assert.match(refused.statusMessage, /gate is required/);

  const all = service.handleRequest(`${admin}.GetAllRequest`, envelope());
  assert.equal(all.statusCode, 200);
  const body = LOCK_PROTO_ROOT.lookupType(`${admin}.GetAllResponse`)
    .decode(all.responsePayloadBuffer);
  assert.equal(body.locks.length, 1);
  assert.equal(Number(body.locks[0].solarsystem.sequential), 30000144);
  assert.equal(Number(body.locks[0].gate.sequential), 50001234);

  const deleted = service.handleRequest(`${admin}.DeleteRequest`, envelope(encode(
    `${admin}.DeleteRequest`, {solarsystem: {sequential: 30000144}},
  )));
  assert.equal(deleted.statusCode, 200);
});

test("the jump path consults the lock where the gate is actually known", () => {
  const runtime = require("node:fs").readFileSync(
    path.join(forkRoot, "Code/server/src/space/runtime.js"), "utf8");
  assert.match(runtime,
    /EVEJS_COOP_STARGATE_LOCKS === "1" && require\("\.\/coopStargateLocks"\)\.shared\(\)\.isLocked\(sourceGateEntity\.itemID\)/);
  assert.match(runtime, /errorMsg: "STARGATE_LOCKED"/);
  assert.equal(KEY.includes("\u001f"), true, "the row uses the durable key shape");
});
