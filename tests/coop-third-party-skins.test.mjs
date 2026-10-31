import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import path from "node:path";

// Third-party SKIN licences: a player-designed skin is identified by a hex string, which is a
// different key from the catalogue skins shipCosmeticsState models, so it owns its own store.
// A licence exists because a row exists; nothing is invented, and an unactivated copy is the
// only thing that can become a usable licence.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const require = createRequire(import.meta.url);
const skinsPath = path.join(forkRoot, "Code/server/src/space/coopThirdPartySkins.js");
const {createThirdPartySkins} = require(skinsPath);

const NOW = Date.UTC(2026, 9, 29, 12, 0, 0);
const HEX = "a1b2c3d4e5f60718";

function fakeCharacterState(initial = {}) {
  const records = structuredClone(initial);
  return {
    records,
    getCharacterRecord(id) {
      const row = records[String(id)];
      return row ? structuredClone(row) : null;
    },
    updateCharacterRecord(id, mutate) {
      const next = mutate(structuredClone(records[String(id)] || {characterID: id}));
      records[String(id)] = next;
      return {success: true, data: structuredClone(next)};
    },
  };
}

const make = (state, env = {EVEJS_COOP_THIRD_PARTY_SKINS: "1"}, shipLookup = null) =>
  createThirdPartySkins({characterState: state, clock: () => NOW, env, shipLookup});

// 5001 belongs to character 7, 5002 to character 8; 5003 is not a ship.
const ships = (characterID, shipID) => {
  const owner = {5001: 7, 5002: 8, 5003: 7}[shipID];
  if (!owner) return {status: "SHIP_NOT_FOUND"};
  if (owner !== characterID) return {status: "SHIP_NOT_OWNED"};
  if (shipID === 5003) return {status: "NOT_A_SHIP"};
  return {status: "OK"};
};

test("a character with no grant owns nothing", () => {
  const skins = make(fakeCharacterState({"7": {characterID: 7}}));
  assert.deepEqual(skins.list(7), []);
  assert.equal(skins.get(7, HEX), null);
  assert.equal(skins.activate(7, HEX).status, "NOT_FOUND");
});

test("an admin grant creates the row and GetOwned lists it", () => {
  const state = fakeCharacterState({"7": {characterID: 7}});
  const skins = make(state);
  const granted = skins.grant(7, {skin: HEX, unactivated: 3});
  assert.equal(granted.status, "GRANTED");
  const owned = skins.list(7);
  assert.equal(owned.length, 1);
  assert.equal(owned[0].skin, HEX);
  assert.equal(owned[0].unactivated, 3);
  assert.equal(owned[0].activated, false);
  assert.equal(owned[0].firstAcquiredMs, NOW);
  // granting more copies keeps the row and its first-acquired date
  skins.grant(7, {skin: HEX, unactivated: 2});
  assert.equal(skins.get(7, HEX).unactivated, 5);
  assert.equal(skins.get(7, HEX).firstAcquiredMs, NOW);
});

test("activation turns exactly one copy into a usable licence", () => {
  const state = fakeCharacterState({"7": {characterID: 7}});
  const skins = make(state);
  skins.grant(7, {skin: HEX, unactivated: 1});
  const activated = skins.activate(7, HEX);
  assert.equal(activated.status, "ACTIVATED");
  assert.equal(skins.get(7, HEX).activated, true);
  assert.equal(skins.get(7, HEX).unactivated, 0);
  assert.equal(skins.activate(7, HEX).status, "ALREADY_ACTIVATED");
});

test("there is nothing to activate without an unactivated copy", () => {
  const state = fakeCharacterState({
    "7": {
      characterID: 7,
      thirdPartySkins: {
        version: 1,
        licences: {[HEX]: {skin: HEX, activated: false, unactivated: 0, escrowed: 0,
          firstAcquiredMs: NOW}},
      },
    },
  });
  const skins = make(state);
  assert.equal(skins.activate(7, HEX).status, "NOTHING_TO_ACTIVATE");
});

test("revoke removes the row, and a bad hex is refused on both sides", () => {
  const state = fakeCharacterState({"7": {characterID: 7}});
  const skins = make(state);
  skins.grant(7, {skin: HEX, unactivated: 1});
  assert.equal(skins.revoke(7, HEX).status, "REVOKED");
  assert.equal(skins.get(7, HEX), null);
  assert.equal(skins.revoke(7, HEX).status, "NOT_FOUND");
  assert.equal(skins.grant(7, {skin: "not-a-hex", unactivated: 1}).status, "SKIN_REQUIRED");
  assert.equal(skins.grant(7, {skin: HEX, unactivated: 0}).status, "COUNT_REQUIRED");
});

test("a corrupt row is dropped instead of trusted", () => {
  const state = fakeCharacterState({
    "7": {characterID: 7, thirdPartySkins: {version: 1, licences: {[HEX]: {unactivated: "x"}}}},
  });
  const skins = make(state);
  const owned = skins.list(7);
  assert.equal(owned.length, 1);
  assert.equal(owned[0].unactivated, 0);
  assert.equal(owned[0].activated, false);
});

test("disabled means no licences at all", () => {
  const skins = make(fakeCharacterState({"7": {characterID: 7}}), {});
  assert.deepEqual(skins.list(7), []);
  assert.equal(skins.grant(7, {skin: HEX, unactivated: 1}).status, "DISABLED");
});

test("gateway: grant answers with the licence, Get reads it, a foreign id is refused", () => {
  const {createThirdPartySkinGatewayService, SKIN_LICENSE_PROTO_ROOT} = require(path.join(
    forkRoot,
    "Code/server/src/_secondary/express/gatewayServices/thirdPartySkinGatewayService.js",
  ));
  const state = fakeCharacterState({"7": {characterID: 7}});
  const service = createThirdPartySkinGatewayService({
    thirdPartySkins: make(state),
  });
  const API = "eve_public.cosmetic.ship.skin.thirdparty.license.api";
  const encode = (name, value) => {
    const type = SKIN_LICENSE_PROTO_ROOT.lookupType(name);
    return Buffer.from(type.encode(type.create(value)).finish());
  };
  const envelope = (value) => ({
    payload: {value},
    authoritative_context: {identity: {character: {sequential: 7}}},
  });

  const granted = service.handleRequest(`${API}.admin.GrantRequest`,
    envelope(encode(`${API}.admin.GrantRequest`, {skin: {hex: HEX}, unactivated: 2})));
  assert.equal(granted.statusCode, 200);
  const grantBody = SKIN_LICENSE_PROTO_ROOT.lookupType(`${API}.admin.GrantResponse`)
    .decode(granted.responsePayloadBuffer);
  assert.equal(grantBody.license.skin.hex, HEX);
  assert.equal(Number(grantBody.license.character.sequential), 7);

  const owned = service.handleRequest(`${API}.GetOwnedRequest`,
    envelope(Buffer.alloc(0)));
  const ownedBody = SKIN_LICENSE_PROTO_ROOT.lookupType(`${API}.GetOwnedResponse`)
    .decode(owned.responsePayloadBuffer);
  assert.equal(ownedBody.licenses.length, 1);

  const one = service.handleRequest(`${API}.GetRequest`,
    envelope(encode(`${API}.GetRequest`,
      {license: {character: {sequential: 7}, skin: {hex: HEX}}})));
  assert.equal(one.statusCode, 200);
  const attr = SKIN_LICENSE_PROTO_ROOT.lookupType(`${API}.GetResponse`)
    .decode(one.responsePayloadBuffer).license;
  assert.equal(attr.activated, false);
  assert.equal(Number(attr.unactivated), 2);

  const foreign = service.handleRequest(`${API}.GetRequest`,
    envelope(encode(`${API}.GetRequest`,
      {license: {character: {sequential: 140000002}, skin: {hex: HEX}}})));
  assert.equal(foreign.statusCode, 5, "another character's licence is never answered");

  const activated = service.handleRequest(`${API}.ActivateRequest`,
    envelope(encode(`${API}.ActivateRequest`, {license: {skin: {hex: HEX}}})));
  assert.equal(activated.statusCode, 200);
  const again = service.handleRequest(`${API}.ActivateRequest`,
    envelope(encode(`${API}.ActivateRequest`, {license: {skin: {hex: HEX}}})));
  assert.equal(again.statusCode, 9, "a licence is not activated twice");
});

test("gateway: a licence that really changed is announced, a refusal is not", () => {
  const {createThirdPartySkinGatewayService, SKIN_LICENSE_PROTO_ROOT} = require(path.join(
    forkRoot,
    "Code/server/src/_secondary/express/gatewayServices/thirdPartySkinGatewayService.js",
  ));
  const state = fakeCharacterState({"7": {characterID: 7}});
  const published = [];
  const service = createThirdPartySkinGatewayService({
    thirdPartySkins: make(state),
    publishGatewayNotice(typeName, payload, target) {
      published.push({typeName, payload, target});
    },
  });
  const API = "eve_public.cosmetic.ship.skin.thirdparty.license.api";
  const encode = (name, value) => {
    const type = SKIN_LICENSE_PROTO_ROOT.lookupType(name);
    return Buffer.from(type.encode(type.create(value)).finish());
  };
  const decode = (name, buffer) =>
    SKIN_LICENSE_PROTO_ROOT.lookupType(name).decode(buffer || Buffer.alloc(0));
  const envelope = (value) => ({
    payload: {value},
    authoritative_context: {identity: {character: {sequential: 7}}},
  });

  service.handleRequest(`${API}.admin.GrantRequest`,
    envelope(encode(`${API}.admin.GrantRequest`, {skin: {hex: HEX}, unactivated: 2})));
  assert.equal(published.length, 1);
  assert.equal(published[0].typeName, `${API}.AddedNotice`);
  assert.deepEqual(published[0].target, {character: 7});
  const added = decode(`${API}.AddedNotice`, published[0].payload);
  assert.equal(added.id.skin.hex, HEX);
  assert.equal(Number(added.attributes.unactivated), 2);
  assert.equal(added.attributes.activated, false);

  // a refusal changes nothing, so nothing is announced
  const refused = service.handleRequest(`${API}.ActivateRequest`,
    envelope(encode(`${API}.ActivateRequest`, {license: {skin: {hex: "ff".repeat(8)}}})));
  assert.notEqual(refused.statusCode, 200);
  assert.equal(published.length, 1, "a refused activation announces nothing");

  service.handleRequest(`${API}.ActivateRequest`,
    envelope(encode(`${API}.ActivateRequest`, {license: {skin: {hex: HEX}}})));
  assert.equal(published.length, 2);
  assert.equal(published[1].typeName, `${API}.UpdatedNotice`);
  const updated = decode(`${API}.UpdatedNotice`, published[1].payload);
  assert.equal(updated.attributes.activated, true, "the licence is activated now");
  assert.equal(updated.previous_attributes.activated, false, "and it was not before");

  service.handleRequest(`${API}.admin.RevokeRequest`,
    envelope(encode(`${API}.admin.RevokeRequest`, {license: {skin: {hex: HEX}}})));
  assert.equal(published.length, 3);
  assert.equal(published[2].typeName, `${API}.DeletedNotice`);
  assert.equal(decode(`${API}.DeletedNotice`, published[2].payload).id.skin.hex, HEX);
});

test("apply records a real ship of this character, and only for an activated licence", () => {
  const state = fakeCharacterState({"7": {characterID: 7}});
  const skins = make(state, {EVEJS_COOP_THIRD_PARTY_SKINS: "1"}, ships);
  skins.grant(7, {skin: HEX, unactivated: 1});
  // ship checks are injected through the same module boundary the server uses
  const result = skins.apply(7, {skin: HEX, shipID: 5001});
  assert.equal(result.status, "LICENCE_NOT_ACTIVATED", "an unactivated licence cannot be worn");
  skins.activate(7, HEX);
  assert.equal(skins.apply(7, {skin: HEX, shipID: 5009}).status, "SHIP_NOT_FOUND",
    "an unknown ship is refused");
  assert.equal(skins.apply(7, {skin: HEX, shipID: 5002}).status, "SHIP_NOT_OWNED",
    "somebody else's ship is refused");
  assert.equal(skins.apply(7, {skin: HEX, shipID: 5003}).status, "NOT_A_SHIP");
  assert.equal(skins.apply(7, {skin: HEX, shipID: 0}).status, "SHIP_REQUIRED");
  assert.equal(skins.apply(7, {skin: "zzz", shipID: 5001}).status, "SKIN_REQUIRED");
  assert.deepEqual(skins.appliedFor(7), {}, "nothing was recorded by the refusals");
  assert.equal(skins.apply(7, {skin: HEX, shipID: 5001}).status, "APPLIED");
  assert.deepEqual(skins.appliedFor(7), {"5001": HEX});
});

test("unapply removes exactly the applied record it names", () => {
  const state = fakeCharacterState({
    "7": {
      characterID: 7,
      thirdPartySkins: {
        version: 1,
        licences: {[HEX]: {skin: HEX, activated: true, unactivated: 0, firstAcquiredMs: NOW}},
        applied: {"6001": HEX},
      },
    },
  });
  const skins = make(state, {EVEJS_COOP_THIRD_PARTY_SKINS: "1"}, ships);
  assert.deepEqual(skins.appliedFor(7), {"6001": HEX});
  assert.equal(skins.unapply(7, {shipID: 6002}).status, "NOT_APPLIED");
  assert.equal(skins.unapply(7, {shipID: 6001, skin: "ffffffff"}).status, "SKIN_MISMATCH");
  assert.equal(skins.unapply(7, {shipID: 6001}).status, "UNAPPLIED");
  assert.deepEqual(skins.appliedFor(7), {});
});

test("an applied record for a licence that no longer exists is dropped on read", () => {
  const state = fakeCharacterState({
    "7": {
      characterID: 7,
      thirdPartySkins: {
        version: 1,
        licences: {},
        applied: {"6001": HEX},
      },
    },
  });
  const skins = make(state);
  assert.deepEqual(skins.appliedFor(7), {},
    "no licence, no applied skin: the appearance claim must not survive a revoke");
});
