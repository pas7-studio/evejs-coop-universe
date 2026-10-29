import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import path from "node:path";

// Third-party SKIN component licences. A finite licence is a capacity that is spent down, an
// infinite one is free to use, and both exist only because a grant created them. The two
// things that must never happen: a spend that goes negative, and a licence that appears for a
// component nobody granted.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const require = createRequire(import.meta.url);
const {createComponentLicences} = require(
  path.join(forkRoot, "Code/server/src/space/coopComponentLicences.js"));
const {
  COMPONENT_LICENCE_PROTO_ROOT,
  createComponentLicenceGatewayService,
} = require(path.join(forkRoot,
  "Code/server/src/_secondary/express/gatewayServices/componentLicenceGatewayService.js"));

const NOW = Date.UTC(2026, 9, 29, 18, 0, 0);
const FINITE = "eve_public.cosmetic.ship.skin.thirdparty.component.license.finite.api";
const INFINITE = "eve_public.cosmetic.ship.skin.thirdparty.component.license.infinite.api";
const OWNED = "eve_public.cosmetic.ship.skin.thirdparty.component.license.api";

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

const makeStore = (state, env = {}) => createComponentLicences({
  characterState: state,
  clock: () => NOW,
  env: {EVEJS_COOP_THIRD_PARTY_SKINS: "1", ...env},
});

const encode = (typeName, value) =>
  Buffer.from(COMPONENT_LICENCE_PROTO_ROOT.lookupType(typeName).encode(value).finish());
const decode = (typeName, buffer) =>
  COMPONENT_LICENCE_PROTO_ROOT.lookupType(typeName).decode(buffer || Buffer.alloc(0));

function envelope(value, characterID = 7) {
  return {
    payload: {value: value || Buffer.alloc(0)},
    authoritative_context: {identity: {character: {sequential: characterID}}},
  };
}

const component = (id) => ({coating: {sequential: id}});

test("a finite licence spends down and refuses to go negative", () => {
  const state = fakeCharacterState({"7": {characterID: 7}});
  const store = makeStore(state);
  assert.equal(store.takeFinite(7, 11, 1).status, "LICENCE_NOT_FOUND",
    "no row, no capacity");
  const granted = store.grantFinite(7, {component: 11, capacity: 5});
  assert.equal(granted.status, "GRANTED");
  assert.equal(granted.licence.capacity, 5);
  assert.equal(granted.licence.firstAcquiredMs, NOW);

  assert.equal(store.takeFinite(7, 11, 6).status, "NOT_ENOUGH_CAPACITY");
  assert.equal(store.finite(7, 11).capacity, 5, "a refused spend changes nothing");
  assert.equal(store.takeFinite(7, 11, 4).status, "SPENT");
  assert.equal(store.finite(7, 11).capacity, 1);

  // a second grant adds to the copy the character already has and keeps the first date
  store.grantFinite(7, {component: 11, capacity: 3});
  assert.equal(store.finite(7, 11).capacity, 4);
  assert.equal(store.finite(7, 11).firstAcquiredMs, NOW);
});

test("an infinite licence is free and is never spent", () => {
  const state = fakeCharacterState({"7": {characterID: 7}});
  const store = makeStore(state);
  assert.equal(store.takeFinite(7, 22, 3).status, "LICENCE_NOT_FOUND");
  store.grantInfinite(7, {component: 22});
  assert.equal(store.takeFinite(7, 22, 999).status, "FREE");
  assert.equal(store.infinite(7, 22).free, true);
});

test("revoke removes one kind and leaves the other, per character", () => {
  const state = fakeCharacterState({"7": {characterID: 7}, "8": {characterID: 8}});
  const store = makeStore(state);
  store.grantFinite(7, {component: 33, capacity: 2});
  store.grantInfinite(7, {component: 33});
  assert.equal(store.revoke(7, {component: 33, kind: "finite"}).status, "REVOKED");
  assert.equal(store.finite(7, 33), null);
  assert.ok(store.infinite(7, 33));
  assert.equal(store.revoke(8, {component: 33, kind: "infinite"}).status, "NOT_FOUND",
    "another character does not own this one");
  assert.equal(store.revoke(7, {component: 33, kind: "infinite"}).status, "REVOKED");
  assert.deepEqual(store.list(7), {finite: [], infinite: []});
});

test("GetOwned lists both kinds, and Get refuses a licence that is not there", () => {
  const state = fakeCharacterState({"7": {characterID: 7}});
  const service = createComponentLicenceGatewayService({componentLicences: makeStore(state)});

  assert.equal(service.handleRequest(`${OWNED}.GetOwnedRequest`, envelope()).statusCode, 200);

  service.handleRequest(`${FINITE}.admin.GrantRequest`,
    envelope(encode(`${FINITE}.admin.GrantRequest`, {component: component(44), capacity: 7})));
  service.handleRequest(`${INFINITE}.admin.GrantRequest`,
    envelope(encode(`${INFINITE}.admin.GrantRequest`, {component: component(45)})));

  const owned = decode(`${OWNED}.GetOwnedResponse`,
    service.handleRequest(`${OWNED}.GetOwnedRequest`, envelope()).responsePayloadBuffer);
  assert.equal(owned.finite.length, 1);
  assert.equal(owned.infinite.length, 1);
  assert.equal(Number(owned.finite[0].component.coating.sequential), 44);
  assert.equal(owned.finite[0].character.sequential, 7);

  const finite = service.handleRequest(`${FINITE}.GetRequest`, envelope(
    encode(`${FINITE}.GetRequest`, {license: {component: component(44)}})));
  assert.equal(finite.statusCode, 200);
  const body = decode(`${FINITE}.GetResponse`, finite.responsePayloadBuffer);
  assert.equal(Number(body.license.capacity), 7);
  assert.ok(body.license.first_acquired.seconds > 0);

  const infinite = service.handleRequest(`${INFINITE}.GetRequest`, envelope(
    encode(`${INFINITE}.GetRequest`, {license: {component: component(45)}})));
  assert.equal(infinite.statusCode, 200);
  assert.equal(decode(`${INFINITE}.GetResponse`, infinite.responsePayloadBuffer).license.free, true);

  const unknown = service.handleRequest(`${FINITE}.GetRequest`, envelope(
    encode(`${FINITE}.GetRequest`, {license: {component: component(99)}})));
  assert.equal(unknown.statusCode, 5, "a licence nobody granted is NOT_FOUND");

  const other = service.handleRequest(`${FINITE}.GetRequest`, envelope(
    encode(`${FINITE}.GetRequest`, {license: {character: {sequential: 8}, component: component(44)}})));
  assert.equal(other.statusCode, 5, "another character's id is not answered");
});

test("grant and revoke answer honestly, including the refusals", () => {
  const state = fakeCharacterState({"7": {characterID: 7}});
  const service = createComponentLicenceGatewayService({componentLicences: makeStore(state)});

  const noComponent = service.handleRequest(`${FINITE}.admin.GrantRequest`, envelope(
    encode(`${FINITE}.admin.GrantRequest`, {capacity: 5})));
  assert.equal(noComponent.statusCode, 3);
  assert.equal(noComponent.statusMessage, "a component is required");

  const noCapacity = service.handleRequest(`${FINITE}.admin.GrantRequest`, envelope(
    encode(`${FINITE}.admin.GrantRequest`, {component: component(55)})));
  assert.equal(noCapacity.statusCode, 3);

  const granted = service.handleRequest(`${FINITE}.admin.GrantRequest`, envelope(
    encode(`${FINITE}.admin.GrantRequest`, {component: component(55), capacity: 2})));
  assert.equal(granted.statusCode, 200);
  const id = decode(`${FINITE}.admin.GrantResponse`, granted.responsePayloadBuffer).license;
  assert.equal(Number(id.component.coating.sequential), 55);

  const revoked = service.handleRequest(`${FINITE}.admin.RevokeRequest`, envelope(
    encode(`${FINITE}.admin.RevokeRequest`, {license: id})));
  assert.equal(revoked.statusCode, 200);
  const again = service.handleRequest(`${FINITE}.admin.RevokeRequest`, envelope(
    encode(`${FINITE}.admin.RevokeRequest`, {license: id})));
  assert.equal(again.statusCode, 5);
});

// A licence item is an inventory item somebody mapped to a component; consuming it is the only
// way an item turns into capacity. The item is read from the real inventory, must belong to the
// character, and only then is the licence written.
function fakeItems(initial = {}) {
  const rows = structuredClone(initial);
  return {
    rows,
    findItemById(id) {
      const row = rows[String(id)];
      return row ? {...row} : null;
    },
    consumeInventoryItemQuantity(id, quantity) {
      const row = rows[String(id)];
      if (!row) return {success: false, errorMsg: "ITEM_NOT_FOUND"};
      if ((row.quantity || 0) < quantity) return {success: false, errorMsg: "INSUFFICIENT_ITEMS"};
      row.quantity -= quantity;
      if (row.quantity === 0) delete rows[String(id)];
      return {success: true};
    },
  };
}

const LICENCE_ITEMS = {EVEJS_COOP_THIRD_PARTY_SKINS: "1",
  EVEJS_COOP_COMPONENT_LICENCE_ITEMS: JSON.stringify({
    45678: {component: 66, capacity: 2},
    45679: {component: 67, infinite: true},
  })};

test("consuming a mapped item is the only way an item becomes capacity", () => {
  const state = fakeCharacterState({"7": {characterID: 7}});
  const items = fakeItems({
    9001: {itemID: 9001, ownerID: 7, typeID: 45678, quantity: 5},
    9002: {itemID: 9002, ownerID: 8, typeID: 45678, quantity: 5},
    9003: {itemID: 9003, ownerID: 7, typeID: 11111, quantity: 5},
    9004: {itemID: 9004, ownerID: 7, typeID: 45679, quantity: 1},
  });
  const store = createComponentLicences({characterState: state, itemStore: items, env: LICENCE_ITEMS});

  assert.equal(store.consumeItem(7, {itemID: 0, quantity: 1}).status, "ITEM_REQUIRED");
  assert.equal(store.consumeItem(7, {itemID: 9001, quantity: 0}).status, "QUANTITY_REQUIRED");
  assert.equal(store.consumeItem(7, {itemID: 9999, quantity: 1}).status, "ITEM_NOT_FOUND");
  assert.equal(store.consumeItem(7, {itemID: 9002, quantity: 1}).status, "ITEM_NOT_OWNED");
  assert.equal(store.consumeItem(7, {itemID: 9003, quantity: 1}).status, "NOT_A_LICENCE_ITEM");
  assert.equal(store.consumeItem(7, {itemID: 9001, quantity: 9}).status, "NOT_ENOUGH_ITEMS");
  assert.equal(items.rows["9001"].quantity, 5, "a refused consume takes nothing");

  const consumed = store.consumeItem(7, {itemID: 9001, quantity: 3});
  assert.equal(consumed.status, "CONSUMED");
  assert.equal(consumed.capacity, 6, "each item is worth the mapped capacity");
  assert.equal(items.rows["9001"].quantity, 2, "the real stack went down by the quantity");

  const infinite = store.consumeItem(7, {itemID: 9004, quantity: 1});
  assert.equal(infinite.status, "CONSUMED");
  assert.equal(infinite.infinite, true);
  assert.ok(store.infinite(7, 67), "the infinite licence really exists now");
});

test("ConsumeRequest answers 200 only when a real item was spent", () => {
  const state = fakeCharacterState({"7": {characterID: 7}});
  const items = fakeItems({9001: {itemID: 9001, ownerID: 7, typeID: 45678, quantity: 2}});
  const store = createComponentLicences({characterState: state, itemStore: items, env: LICENCE_ITEMS});
  const service = createComponentLicenceGatewayService({componentLicences: store});
  const CONSUME = "eve_public.cosmetic.ship.skin.thirdparty.component.license.item.api.ConsumeRequest";

  const ok = service.handleRequest(CONSUME, envelope(
    encode(CONSUME, {item: {item: {sequential: 9001}}, quantity: 2})));
  assert.equal(ok.statusCode, 200, ok.statusMessage);
  assert.equal(store.finite(7, 66).capacity, 4);
  assert.equal(items.rows["9001"], undefined, "the whole stack was consumed");

  const missing = service.handleRequest(CONSUME, envelope(
    encode(CONSUME, {item: {item: {sequential: 9001}}, quantity: 1})));
  assert.equal(missing.statusCode, 5, "consuming what is not there is NOT_FOUND");

  const noQuantity = service.handleRequest(CONSUME, envelope(
    encode(CONSUME, {item: {item: {sequential: 9001}}})));
  assert.equal(noQuantity.statusCode, 3);
  assert.equal(noQuantity.statusMessage, "quantity must be greater than zero");
});
