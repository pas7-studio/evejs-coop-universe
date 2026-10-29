import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import path from "node:path";

// The record of one third-party skin (thirdparty.api.Get). Without it the designer can list a
// licence it owns but cannot show the design. The design bytes are spliced back exactly as
// stored, because the server never decoded them in the first place.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const require = createRequire(import.meta.url);
const {createThirdPartySkins} = require(
  path.join(forkRoot, "Code/server/src/space/coopThirdPartySkins.js"));
const {
  SKIN_RECORD_PROTO_ROOT,
  createThirdPartySkinRecordGatewayService,
} = require(path.join(forkRoot,
  "Code/server/src/_secondary/express/gatewayServices/thirdPartySkinRecordGatewayService.js"));

const API = "eve_public.cosmetic.ship.skin.thirdparty.api";
const NOW = Date.UTC(2026, 9, 29, 20, 30, 0);
const HEX = "0123456789abcdef";
const LAYOUT = Buffer.from("0a06080112020802120408d18901", "hex");

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

function makeSkins(state) {
  return createThirdPartySkins({
    characterState: state,
    clock: () => NOW,
    env: {EVEJS_COOP_THIRD_PARTY_SKINS: "1"},
  });
}

const encode = (value) =>
  Buffer.from(SKIN_RECORD_PROTO_ROOT.lookupType(`${API}.GetRequest`).encode(value).finish());
const decode = (buffer) =>
  SKIN_RECORD_PROTO_ROOT.lookupType(`${API}.GetResponse`).decode(buffer || Buffer.alloc(0));

const envelope = (value, characterID = 7) => ({
  payload: {value: value || Buffer.alloc(0)},
  authoritative_context: {identity: {character: {sequential: characterID}}},
});

test("a skin minted by a job reads back with its name, creator and design bytes", () => {
  const state = fakeCharacterState({"7": {characterID: 7}});
  const skins = makeSkins(state);
  skins.grant(7, {
    skin: HEX,
    unactivated: 2,
    name: "Nova",
    lineName: "Line A",
    creatorID: 7,
    layout: LAYOUT.toString("base64"),
  });
  const service = createThirdPartySkinRecordGatewayService({thirdPartySkins: skins});

  const result = service.handleRequest(`${API}.GetRequest`, envelope(encode({skin: {hex: HEX}})));
  assert.equal(result.statusCode, 200, result.statusMessage);

  const body = decode(result.responsePayloadBuffer);
  assert.equal(body.skin.name, "Nova");
  assert.equal(body.skin.line_name, "Line A");
  assert.equal(body.skin.creator.sequential, 7);
  assert.equal(body.skin.not_sequenced, false, "a sequenced skin is not unsequenced");
  assert.equal(Math.round(body.skin.first_sequenced.seconds), Math.round(NOW / 1000));
  assert.equal(body.skin.tier.level, 1);

  // field 4 carries the design bytes verbatim, which is how the client gets them back
  const hex = result.responsePayloadBuffer.toString("hex");
  assert.ok(hex.includes(`22${LAYOUT.length.toString(16).padStart(2, "0")}${LAYOUT.toString("hex")}`),
    "the stored layout is spliced back unchanged");
});

test("a skin the character does not hold is NOT_FOUND, never an empty skin", () => {
  const state = fakeCharacterState({"7": {characterID: 7}, "8": {characterID: 8}});
  const skins = makeSkins(state);
  skins.grant(7, {skin: HEX, unactivated: 1, name: "Mine", creatorID: 7});
  const service = createThirdPartySkinRecordGatewayService({thirdPartySkins: skins});

  assert.equal(service.handleRequest(`${API}.GetRequest`,
    envelope(encode({skin: {hex: HEX}}), 8)).statusCode, 5,
  "another character's skin is not answered through this call");
  assert.equal(service.handleRequest(`${API}.GetRequest`,
    envelope(encode({skin: {hex: "ffffffff"}}))).statusCode, 5);
  assert.equal(service.handleRequest(`${API}.GetRequest`, envelope()).statusCode, 5,
    "a request without a skin id is not a wildcard");

  const own = decode(service.handleRequest(`${API}.GetRequest`,
    envelope(encode({skin: {hex: HEX}}))).responsePayloadBuffer);
  assert.equal(own.skin.name, "Mine");
});

test("a licence granted without a design is honestly unsequenced", () => {
  const state = fakeCharacterState({"7": {characterID: 7}});
  const skins = makeSkins(state);
  // an admin grant predates any job: no design, no sequence date
  skins.grant(7, {skin: "aaaabbbb", unactivated: 1});
  const service = createThirdPartySkinRecordGatewayService({thirdPartySkins: skins});
  const body = decode(service.handleRequest(`${API}.GetRequest`,
    envelope(encode({skin: {hex: "aaaabbbb"}}))).responsePayloadBuffer);
  assert.equal(body.skin.not_sequenced, true);
  assert.equal(body.skin.creator.sequential, 0, "nobody is claimed as the creator");
  assert.equal(body.skin.first_sequenced, null);
});
