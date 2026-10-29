import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import path from "node:path";

// Third-party SKIN design drafts (eve_public...thirdparty.draft.api). A draft is what the
// editor saves while a player is still designing: it is not a licence and it is not a skin.
// Two things are proven here, and they are the two that would silently corrupt a design:
//   - the layout bytes reach the store exactly as the client sent them (the server never
//     re-encodes a tree it only partly understands), and
//   - the capacity the client is told is the capacity save actually enforces.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const require = createRequire(import.meta.url);
const {createSkinDrafts} = require(
  path.join(forkRoot, "Code/server/src/space/coopSkinDrafts.js"));
const {
  SKIN_DRAFT_PROTO_ROOT,
  createThirdPartySkinDraftGatewayService,
} = require(path.join(forkRoot,
  "Code/server/src/_secondary/express/gatewayServices/thirdPartySkinDraftGatewayService.js"));

const NOW = Date.UTC(2026, 9, 29, 12, 0, 0);
const API = "eve_public.cosmetic.ship.skin.thirdparty.draft.api";

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

let uuidSeed = 0;
const nextUuid = () => {
  uuidSeed += 1;
  return Buffer.alloc(16, uuidSeed);
};

const makeStore = (state, env = {}) => createSkinDrafts({
  characterState: state,
  clock: () => NOW + uuidSeed,
  randomUuid: nextUuid,
  env: {EVEJS_COOP_THIRD_PARTY_SKINS: "1", ...env},
});

const encode = (typeName, value) =>
  Buffer.from(SKIN_DRAFT_PROTO_ROOT.lookupType(typeName).encode(value).finish());

const decode = (typeName, buffer) =>
  SKIN_DRAFT_PROTO_ROOT.lookupType(typeName).decode(buffer || Buffer.alloc(0));

function envelope(value, characterID = 7) {
  return {
    payload: {value: value || Buffer.alloc(0)},
    authoritative_context: {identity: {character: {sequential: characterID}}},
  };
}

// A layout the client would send: field 1 (slots) repeated, field 2 (ship_type), including a
// nested blob this server does not model. The exact bytes must survive.
const LAYOUT = Buffer.concat([
  Buffer.from([0x0a, 0x06, 0x08, 0x01, 0x12, 0x02, 0x08, 0x02]),
  Buffer.from([0x12, 0x04, 0x08, 0xd1, 0x89, 0x01]),
]);

const CONFIG = [{
  id: {sequential: 3},
  config: {offset_u_ratio: 0.25, offset_v_ratio: -0.5, yaw: 90, pitch: 0, roll: 12.5, scaling: 0.75},
}];

test("the store keeps the layout bytes exactly and enforces the capacity it reports", () => {
  const state = fakeCharacterState({"7": {characterID: 7}});
  const store = makeStore(state, {EVEJS_COOP_SKIN_DRAFT_CAPACITY: "2"});
  assert.equal(store.capacity(), 2);

  const first = store.create(7, {name: "Black Nova", lineName: "Line A", layout: LAYOUT, configurations: CONFIG});
  assert.equal(first.status, "SAVED");
  assert.match(first.draft.uuid, /^[0-9a-f]{32}$/);
  assert.equal(store.get(7, first.draft.uuid).layout, LAYOUT.toString("base64"),
    "the design bytes are stored verbatim");
  assert.equal(store.get(7, first.draft.uuid).name, "Black Nova");

  assert.equal(store.create(7, {name: "Second", layout: LAYOUT}).status, "SAVED");
  assert.equal(store.create(7, {name: "Third", layout: LAYOUT}).status, "CAPACITY_REACHED",
    "the limit is real, not a number the client is told");

  assert.equal(store.count(7), 2);
  assert.equal(store.list(7)[0].name, "Second", "newest first");
});

test("update overwrites the design but keeps its creation time", () => {
  const state = fakeCharacterState({"7": {characterID: 7}});
  const store = makeStore(state);
  const saved = store.create(7, {name: "Draft", layout: LAYOUT, configurations: CONFIG}).draft;
  uuidSeed += 5;
  const updated = store.update(7, {
    uuid: saved.uuid,
    name: "Renamed",
    layout: Buffer.from([0x0a, 0x00]),
    configurations: [],
  });
  assert.equal(updated.status, "UPDATED");
  assert.equal(updated.draft.createdAtMs, saved.createdAtMs);
  assert.ok(updated.draft.updatedAtMs > saved.createdAtMs);
  assert.equal(updated.draft.name, "Renamed");
  assert.equal(store.update(7, {uuid: "00ff", name: "x"}).status, "NOT_FOUND");
  assert.equal(store.update(7, {}).status, "UUID_REQUIRED");
});

test("delete removes exactly one draft, and another character cannot reach it", () => {
  const state = fakeCharacterState({"7": {characterID: 7}, "8": {characterID: 8}});
  const store = makeStore(state);
  const saved = store.create(7, {name: "Mine", layout: LAYOUT}).draft;
  assert.equal(store.get(8, saved.uuid), null, "a draft id is not a shared secret");
  assert.deepEqual(store.list(8), []);
  assert.equal(store.remove(8, saved.uuid).status, "NOT_FOUND");
  assert.equal(store.remove(7, saved.uuid).status, "DELETED");
  assert.deepEqual(store.list(7), []);
  assert.equal(store.remove(7, saved.uuid).status, "NOT_FOUND");
});

test("save answers a real id and attributes the client can render", () => {
  const state = fakeCharacterState({"7": {characterID: 7}});
  const service = createThirdPartySkinDraftGatewayService({skinDrafts: makeStore(state)});

  // Proto literal: name + layout(field 3) + editor_configurations(field 4), layout untouched.
  const payload = Buffer.concat([
    encode(`${API}.SaveRequest`, {name: "Nova", line_name: "L1"}),
    Buffer.from([0x1a, LAYOUT.length]), LAYOUT,
    encode(`${API}.SaveRequest`, {editor_configurations: CONFIG}),
  ]);
  const saved = service.handleRequest(`${API}.SaveRequest`, envelope(payload));
  assert.equal(saved.statusCode, 200);
  const body = decode(`${API}.SaveResponse`, saved.responsePayloadBuffer);
  assert.equal(body.id.uuid.length, 16);
  assert.equal(body.attributes.editor_configurations.length, 1);
  assert.equal(Number(body.attributes.editor_configurations[0].id.sequential), 3,
    "uint64 decodes as a Long");
  assert.equal(body.attributes.editor_configurations[0].config.yaw, 90,
    "a float survives the round trip");
  assert.equal(body.attributes.editor_configurations[0].config.offset_v_ratio, -0.5);

  const stored = state.records["7"].skinDrafts.drafts[body.id.uuid.toString("hex")];
  assert.equal(stored.layout, LAYOUT.toString("base64"));
  assert.equal(stored.name, "Nova");
  assert.equal(stored.lineName, "L1");
});

test("update reads the layout from its own field number, not the save one", () => {
  const state = fakeCharacterState({"7": {characterID: 7}});
  const store = makeStore(state);
  const service = createThirdPartySkinDraftGatewayService({skinDrafts: store});
  const saved = store.create(7, {name: "Old", layout: LAYOUT}).draft;

  const replacement = Buffer.from([0x12, 0x02, 0x08, 0x01]);
  const payload = Buffer.concat([
    encode(`${API}.UpdateRequest`, {id: {uuid: Buffer.from(saved.uuid, "hex")}}),
    Buffer.from([0x22, replacement.length]), replacement,
  ]);
  const result = service.handleRequest(`${API}.UpdateRequest`, envelope(payload));
  assert.equal(result.statusCode, 200, result.statusMessage);
  assert.equal(store.get(7, saved.uuid).layout, replacement.toString("base64"));
});

test("capacity, list, get, shared and delete answer from the same rows", () => {
  const state = fakeCharacterState({"7": {characterID: 7}, "8": {characterID: 8}});
  const store = makeStore(state, {EVEJS_COOP_SKIN_DRAFT_CAPACITY: "3"});
  const service = createThirdPartySkinDraftGatewayService({skinDrafts: store});

  const capacity = service.handleRequest(`${API}.GetSaveCapacityRequest`, envelope());
  assert.equal(Number(decode(`${API}.GetSaveCapacityResponse`,
    capacity.responsePayloadBuffer).capacity), 3);

  const saved = service.handleRequest(`${API}.SaveRequest`,
    envelope(encode(`${API}.SaveRequest`, {name: "Shared me"})));
  const uuid = decode(`${API}.SaveResponse`, saved.responsePayloadBuffer).id.uuid;

  const all = service.handleRequest(`${API}.GetAllSavedRequest`, envelope());
  assert.equal(decode(`${API}.GetAllSavedResponse`, all.responsePayloadBuffer).drafts.length, 1);

  const one = service.handleRequest(`${API}.GetRequest`, envelope(
    encode(`${API}.GetRequest`, {draft: {uuid}})));
  assert.equal(one.statusCode, 200);
  assert.ok(decode(`${API}.GetResponse`, one.responsePayloadBuffer).draft);

  // another character can open it by id through GetShared - that is what the call is for
  const shared = service.handleRequest(`${API}.GetSharedRequest`, envelope(
    encode(`${API}.GetSharedRequest`, {character: {sequential: 7}, draft: {uuid}}), 0));
  assert.equal(shared.statusCode, 200, shared.statusMessage);
  assert.equal(store.get(7, uuid).name, "Shared me");

  const missing = service.handleRequest(`${API}.GetRequest`, envelope(
    encode(`${API}.GetRequest`, {draft: {uuid: Buffer.alloc(16, 9)}})));
  assert.equal(missing.statusCode, 5, "a draft that is not there is NOT_FOUND");

  const deleted = service.handleRequest(`${API}.DeleteRequest`, envelope(
    encode(`${API}.DeleteRequest`, {id: {uuid}})));
  assert.equal(deleted.statusCode, 200);
  assert.deepEqual(store.list(7), []);
  assert.equal(service.handleRequest(`${API}.DeleteRequest`, envelope(
    encode(`${API}.DeleteRequest`, {id: {uuid}}))).statusCode, 5);
});

test("save is refused, not silently dropped, when capacity is used up", () => {
  const state = fakeCharacterState({"7": {characterID: 7}});
  const service = createThirdPartySkinDraftGatewayService({
    skinDrafts: makeStore(state, {EVEJS_COOP_SKIN_DRAFT_CAPACITY: "1"}),
  });
  const body = encode(`${API}.SaveRequest`, {name: "First"});
  assert.equal(service.handleRequest(`${API}.SaveRequest`, envelope(body)).statusCode, 200);
  const second = service.handleRequest(`${API}.SaveRequest`, envelope(body));
  assert.equal(second.statusCode, 9);
  assert.equal(second.statusMessage, "no draft capacity left");
});
