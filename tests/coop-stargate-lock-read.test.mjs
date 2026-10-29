import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import path from "node:path";

// eve_public.stargate.lock.api.{Get,GetRestrictedSystems} are the two public reads the client's
// own gateLockMessenger.pyj makes. The request messages carry no fields at all: the client pairs
// the Get answer with its own session.solarsystemid2, so the server has to take the system from
// the live session. The response carries exactly one gate, so a system with several locked gates
// cannot be described and is refused instead of reporting an arbitrary one.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const require = createRequire(import.meta.url);
const gatewayPath = path.join(
  forkRoot,
  "Code/server/src/_secondary/express/gatewayServices/stargateLockGatewayService.js",
);
const locksPath = path.join(forkRoot, "Code/server/src/space/coopStargateLocks.js");
const {createStargateLockGatewayService} = require(gatewayPath);
const {createStargateLocks} = require(locksPath);

const NOW = Date.UTC(2026, 9, 29, 12, 0, 0);
const HOUR = 60 * 60 * 1000;
const CHARACTER = 140000004;

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
  };
}

function service({systemID = 0} = {}) {
  const locks = createStargateLocks({
    gameStore: memoryStore(),
    clock: () => NOW,
    env: {EVEJS_COOP_STARGATE_LOCKS: "1"},
  });
  return {
    locks,
    gateway: createStargateLockGatewayService({stargateLocks: locks, sessionSystemID: () => systemID}),
  };
}

function request(typeName) {
  return {
    payload: {value: Buffer.alloc(0)},
    authoritative_context: {identity: {character: {sequential: CHARACTER}}},
  };
}

test("GetRestrictedSystems lists exactly the systems with a live lock", () => {
  const {locks, gateway} = service();
  locks.apply({systemID: 30000144, gateID: 50001234, expiresAtMs: NOW + HOUR});
  locks.apply({systemID: 30000142, gateID: 50005678, expiresAtMs: NOW + HOUR});
  const result = gateway.handleRequest(
    "eve_public.stargate.lock.api.GetRestrictedSystemsRequest",
    request(),
  );
  assert.equal(result.statusCode, 200);
  assert.equal(result.responseTypeName, "eve_public.stargate.lock.api.GetRestrictedSystemsResponse");
  // Decode with the same root the service uses, so the bytes are read back as the client would.
  const {LOCK_PROTO_ROOT} = require(gatewayPath);
  const response = LOCK_PROTO_ROOT
    .lookupType("eve_public.stargate.lock.api.GetRestrictedSystemsResponse")
    .decode(result.responsePayloadBuffer);
  assert.deepEqual(response.solarsystems.map((row) => Number(row.sequential)), [30000142, 30000144]);
});

test("Get answers the single lock of the character's own system", () => {
  const {locks, gateway} = service({systemID: 30000144});
  locks.apply({systemID: 30000144, gateID: 50001234, expiresAtMs: NOW + HOUR});
  const result = gateway.handleRequest("eve_public.stargate.lock.api.GetRequest", request());
  assert.equal(result.statusCode, 200);
  assert.equal(result.responseTypeName, "eve_public.stargate.lock.api.GetResponse");
  const {LOCK_PROTO_ROOT} = require(gatewayPath);
  const response = LOCK_PROTO_ROOT
    .lookupType("eve_public.stargate.lock.api.GetResponse")
    .decode(result.responsePayloadBuffer);
  assert.equal(Number(response.gate.sequential), 50001234);
  assert.equal(Number(response.expiry.seconds), Math.floor((NOW + HOUR) / 1000));
});

test("Get refuses - never invents - an unknown system, no lock, or several gates", () => {
  const unknown = service({systemID: 0});
  unknown.locks.apply({systemID: 30000144, gateID: 50001234, expiresAtMs: NOW + HOUR});
  const unknownResult = unknown.gateway.handleRequest(
    "eve_public.stargate.lock.api.GetRequest",
    request(),
  );
  // 404 is what the client's messenger checks: it then reports "no lock" rather than a gate.
  assert.equal(unknownResult.statusCode, 404);
  assert.match(unknownResult.statusMessage, /unknown to the gateway/);

  const elsewhere = service({systemID: 30000145});
  elsewhere.locks.apply({systemID: 30000144, gateID: 50001234, expiresAtMs: NOW + HOUR});
  const elsewhereResult = elsewhere.gateway.handleRequest(
    "eve_public.stargate.lock.api.GetRequest",
    request(),
  );
  assert.equal(elsewhereResult.statusCode, 404);
  assert.match(elsewhereResult.statusMessage, /no stargate lock/);

  const several = service({systemID: 30000144});
  several.locks.apply({systemID: 30000144, gateID: 50001234, expiresAtMs: NOW + HOUR});
  several.locks.apply({systemID: 30000144, gateID: 50005678, expiresAtMs: NOW + HOUR});
  const severalResult = several.gateway.handleRequest(
    "eve_public.stargate.lock.api.GetRequest",
    request(),
  );
  assert.equal(severalResult.statusCode, 404);
  assert.match(severalResult.statusMessage, /several locked gates/);
});

test("an expired lock is not answered as a restriction", () => {
  const locks = createStargateLocks({
    gameStore: memoryStore(),
    clock: () => NOW + 2 * HOUR,
    env: {EVEJS_COOP_STARGATE_LOCKS: "1"},
  });
  locks.apply({systemID: 30000144, gateID: 50001234, expiresAtMs: NOW + HOUR});
  const gateway = createStargateLockGatewayService({
    stargateLocks: locks,
    sessionSystemID: () => 30000144,
  });
  assert.equal(
    gateway.handleRequest("eve_public.stargate.lock.api.GetRequest", request()).statusCode,
    404,
  );
  const list = gateway.handleRequest(
    "eve_public.stargate.lock.api.GetRestrictedSystemsRequest",
    request(),
  );
  const {LOCK_PROTO_ROOT} = require(gatewayPath);
  const response = LOCK_PROTO_ROOT
    .lookupType("eve_public.stargate.lock.api.GetRestrictedSystemsResponse")
    .decode(list.responsePayloadBuffer);
  assert.deepEqual(response.solarsystems.map((row) => Number(row.sequential)), []);
});
