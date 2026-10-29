import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import path from "node:path";

// eve_public.solarsystem.api.Get and eve_public.station.api.Get: the client's basic "what
// is this place" call, which had no handler at all. The data is the server's own static
// rows (space/worldData), so the answer is the real name and security, or NOT_FOUND.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const require = createRequire(import.meta.url);
const servicePath = path.join(forkRoot,
  "Code/server/src/_secondary/express/gatewayServices/entityLookupGatewayService.js");
const {
  ENTITY_PROTO_ROOT,
  createEntityLookupGatewayService,
  securityValue,
} = require(servicePath);

const worldData = {
  getSolarSystemByID: (id) => (Number(id) === 30000144
    ? {solarSystemID: 30000144, solarSystemName: "Perimeter", security: 0.949}
    : null),
  getStationByID: (id) => (Number(id) === 60003760
    ? {stationID: 60003760, stationName: "Jita IV - Moon 4 - Caldari Navy Assembly Plant"}
    : null),
};
const service = createEntityLookupGatewayService({worldData, structures: () => null});

function encode(name, value) {
  const type = ENTITY_PROTO_ROOT.lookupType(name);
  return Buffer.from(type.encode(type.create(value)).finish());
}
const envelope = (value) => ({payload: {value}});
const decode = (name, buffer) => ENTITY_PROTO_ROOT.lookupType(name).decode(buffer || Buffer.alloc(0));

test("security is encoded as the units+nanos value the client reads", () => {
  assert.deepEqual(securityValue(0.949), {units: 0, nanos: 949000000});
  assert.deepEqual(securityValue(-0.25), {units: 0, nanos: -250000000});
  assert.deepEqual(securityValue(0.5), {units: 0, nanos: 500000000});
  assert.deepEqual(securityValue(1.0), {units: 1, nanos: 0});
});

test("a solar system answers its real name and security", () => {
  const result = service.handleRequest("eve_public.solarsystem.api.GetRequest",
    envelope(encode("eve_public.solarsystem.api.GetRequest", {
      solar_system: {sequential: 30000144},
    })));
  assert.equal(result.statusCode, 200);
  const body = decode("eve_public.solarsystem.api.GetResponse", result.responsePayloadBuffer);
  assert.equal(body.solar_system.name, "Perimeter");
  assert.equal(Number(body.solar_system.security.nanos), 949000000);
});

test("an unknown system is NOT_FOUND, never an invented name", () => {
  const result = service.handleRequest("eve_public.solarsystem.api.GetRequest",
    envelope(encode("eve_public.solarsystem.api.GetRequest", {
      solar_system: {sequential: 39999999},
    })));
  assert.equal(result.statusCode, 5);
  assert.equal(result.responsePayloadBuffer.length, 0);
});

test("a station answers its real name", () => {
  const result = service.handleRequest("eve_public.station.api.GetRequest",
    envelope(encode("eve_public.station.api.GetRequest", {
      station: {sequential: 60003760},
    })));
  assert.equal(result.statusCode, 200);
  const body = decode("eve_public.station.api.GetResponse", result.responsePayloadBuffer);
  assert.equal(body.station.name, "Jita IV - Moon 4 - Caldari Navy Assembly Plant");
});

test("a station id with no record is NOT_FOUND and an empty id is INVALID", () => {
  const missing = service.handleRequest("eve_public.station.api.GetRequest",
    envelope(encode("eve_public.station.api.GetRequest", {station: {sequential: 12345}})));
  assert.equal(missing.statusCode, 5);
  const empty = service.handleRequest("eve_public.station.api.GetRequest", envelope());
  assert.equal(empty.statusCode, 3);
});
