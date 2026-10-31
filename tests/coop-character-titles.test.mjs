import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import path from "node:path";

// Character titles. The catalogue is client content; the server owns ownership and the worn
// slot. Two rules matter: a title exists because an admin grant created it, and a title that is
// revoked cannot stay worn.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const require = createRequire(import.meta.url);
const {createCharacterTitles} = require(
  path.join(forkRoot, "Code/server/src/space/coopCharacterTitles.js"));
const {
  TITLE_PROTO_ROOT,
  createCharacterTitleGatewayService,
} = require(path.join(forkRoot,
  "Code/server/src/_secondary/express/gatewayServices/characterTitleGatewayService.js"));

const API = "eve_public.cosmetic.character.title.api";
const NOW = Date.UTC(2026, 9, 29, 22, 30, 0);
const TITLE_A = Buffer.alloc(16, 0xa1);
const TITLE_B = Buffer.alloc(16, 0xb2);

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

const make = (state, env = {EVEJS_COOP_CHARACTER_TITLES: "1"}) =>
  createCharacterTitles({characterState: state, clock: () => NOW, env});

const encode = (typeName, value) =>
  Buffer.from(TITLE_PROTO_ROOT.lookupType(typeName).encode(value).finish());
const decode = (typeName, buffer) =>
  TITLE_PROTO_ROOT.lookupType(typeName).decode(buffer || Buffer.alloc(0));

const envelope = (value, characterID = 7) => ({
  payload: {value: value || Buffer.alloc(0)},
  authoritative_context: {identity: {character: {sequential: characterID}}},
});

test("a title exists only because it was granted, and equipping respects that", () => {
  const state = fakeCharacterState({"7": {characterID: 7}});
  const titles = make(state);
  assert.deepEqual(titles.list(7), [], "no grant, no title");
  assert.equal(titles.equip(7, TITLE_A).status, "NOT_OWNED",
    "a title that was never granted cannot be worn");

  assert.equal(titles.grant(7, TITLE_A).status, "GRANTED");
  assert.deepEqual(titles.list(7).map((row) => row.uuid), [TITLE_A.toString("hex")]);
  assert.equal(titles.grant(7, TITLE_A).status, "GRANTED", "a repeat grant is not an error");
  assert.equal(titles.list(7)[0].grantedMs, NOW, "and it does not move the original date");

  assert.equal(titles.equip(7, TITLE_A).status, "EQUIPPED");
  assert.equal(titles.equipped(7), TITLE_A.toString("hex"));
});

test("revoking the worn title clears it, and other characters are untouched", () => {
  const state = fakeCharacterState({"7": {characterID: 7}, "8": {characterID: 8}});
  const titles = make(state);
  titles.grant(7, TITLE_A);
  titles.grant(8, TITLE_A);
  titles.equip(7, TITLE_A);
  assert.equal(titles.revoke(7, TITLE_A).status, "REVOKED");
  assert.equal(titles.equipped(7), "", "a revoked title cannot stay worn");
  assert.equal(titles.equipped(8), "", "the other character never had it on");
  assert.equal(titles.revoke(7, TITLE_A).status, "NOT_FOUND");
  assert.equal(titles.unequip(7).status, "UNEQUIPPED");
});

test("the gateway answers ownership, the worn slot and honest refusals", () => {
  const state = fakeCharacterState({"7": {characterID: 7}});
  const titles = make(state);
  const service = createCharacterTitleGatewayService({characterTitles: titles});

  const empty = decode(`${API}.GetOwnedResponse`,
    service.handleRequest(`${API}.GetOwnedRequest`, envelope()).responsePayloadBuffer);
  assert.equal(empty.titles.length, 0);

  const granted = service.handleRequest(`${API}.admin.GrantRequest`, envelope(
    encode(`${API}.admin.GrantRequest`, {id: {uuid: TITLE_A}})));
  assert.equal(granted.statusCode, 200);
  const grantedB = service.handleRequest(`${API}.admin.GrantRequest`, envelope(
    encode(`${API}.admin.GrantRequest`, {id: {uuid: TITLE_B}})));
  assert.equal(grantedB.statusCode, 200);

  const owned = decode(`${API}.GetOwnedResponse`,
    service.handleRequest(`${API}.GetOwnedRequest`, envelope()).responsePayloadBuffer);
  assert.equal(owned.titles.length, 2);
  assert.equal(owned.titles[0].uuid.length, 16);

  const equipped = service.handleRequest(`${API}.EquipRequest`, envelope(
    encode(`${API}.EquipRequest`, {title: {uuid: TITLE_B}})));
  assert.equal(equipped.statusCode, 200);
  const worn = decode(`${API}.GetEquippedForCharacterResponse`,
    service.handleRequest(`${API}.GetEquippedForCharacterRequest`, envelope(
      encode(`${API}.GetEquippedForCharacterRequest`, {character: {sequential: 7}})))
      .responsePayloadBuffer);
  assert.equal(worn.no_title, false);
  assert.deepEqual(worn.title.uuid, TITLE_B);

  const wrongCharacter = service.handleRequest(`${API}.EquipRequest`, envelope(
    encode(`${API}.EquipRequest`, {title: {uuid: Buffer.alloc(16, 9)}})));
  assert.equal(wrongCharacter.statusCode, 9, "a title nobody granted is not equippable");
  assert.equal(wrongCharacter.statusMessage, "that character does not own this title");

  const noTitle = service.handleRequest(`${API}.admin.GrantRequest`, envelope());
  assert.equal(noTitle.statusCode, 3);

  service.handleRequest(`${API}.admin.RevokeRequest`, envelope(
    encode(`${API}.admin.RevokeRequest`, {id: {uuid: TITLE_B}})));
  const afterRevoke = decode(`${API}.GetEquippedForCharacterResponse`,
    service.handleRequest(`${API}.GetEquippedForCharacterRequest`, envelope(
      encode(`${API}.GetEquippedForCharacterRequest`, {character: {sequential: 7}})))
      .responsePayloadBuffer);
  assert.equal(afterRevoke.no_title, true, "the worn title went with the revoke");
  assert.equal(service.handleRequest(`${API}.admin.RevokeRequest`, envelope(
    encode(`${API}.admin.RevokeRequest`, {id: {uuid: TITLE_B}}))).statusCode, 5);
});

test("the feature gate is the only switch, and it is off by default", () => {
  const state = fakeCharacterState({"7": {characterID: 7}});
  const titles = make(state, {});
  assert.equal(titles.grant(7, TITLE_A).status, "DISABLED");
  assert.deepEqual(titles.list(7), []);
});

test("equipping and removing a title tells the client the worn title changed", () => {
  const state = fakeCharacterState({"7": {characterID: 7}});
  const titles = make(state);
  const published = [];
  const service = createCharacterTitleGatewayService({
    characterTitles: titles,
    publishGatewayNotice(typeName, payload, targetGroup) {
      published.push({typeName, payload, targetGroup});
    },
  });
  titles.grant(7, TITLE_A);

  const equipped = service.handleRequest(`${API}.EquipRequest`,
    envelope(encode(`${API}.EquipRequest`, {title: {uuid: TITLE_A}})));
  assert.equal(equipped.statusCode, 200, equipped.statusMessage);
  assert.equal(published.length, 1, "the client hears about the new worn title");
  assert.equal(published[0].typeName, `${API}.SetNotice`);
  const notice = decode(`${API}.SetNotice`, published[0].payload);
  assert.equal(notice.character.sequential, 7);
  assert.deepEqual([...notice.title.uuid], [...TITLE_A]);
  assert.equal(notice.no_title, false);
  assert.deepEqual(published[0].targetGroup, {character: 7},
    "no session, so only the owner is told - never a guessed system");

  const removed = service.handleRequest(`${API}.UnequipRequest`,
    envelope(encode(`${API}.UnequipRequest`, {})));
  assert.equal(removed.statusCode, 200, removed.statusMessage);
  const bare = decode(`${API}.SetNotice`, published[1].payload);
  assert.equal(bare.no_title, true, "removing a title says there is no title");
  assert.equal(bare.title, null);
});

test("a refused title change announces nothing, and a real grant does", () => {
  const state = fakeCharacterState({"7": {characterID: 7}});
  const titles = make(state);
  const published = [];
  const service = createCharacterTitleGatewayService({
    characterTitles: titles,
    publishGatewayNotice(typeName, payload, targetGroup) {
      published.push({typeName, payload, targetGroup});
    },
  });

  const refused = service.handleRequest(`${API}.EquipRequest`,
    envelope(encode(`${API}.EquipRequest`, {title: {uuid: TITLE_B}})));
  assert.notEqual(refused.statusCode, 200, "a title that was never granted is refused");
  assert.equal(published.length, 0, "and nothing is announced about it");

  const granted = service.handleRequest(`${API}.admin.GrantRequest`,
    envelope(encode(`${API}.admin.GrantRequest`, {id: {uuid: TITLE_B}})));
  assert.equal(granted.statusCode, 200, granted.statusMessage);
  assert.equal(published.length, 1);
  assert.equal(published[0].typeName, `${API}.GrantedNotice`);
  assert.deepEqual([...decode(`${API}.GrantedNotice`, published[0].payload).title.uuid],
    [...TITLE_B]);
});
