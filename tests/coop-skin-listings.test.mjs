import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import path from "node:path";

// Skin market listings. A listing is a promise to sell real copies, so creating one escrows them
// and cancelling returns exactly those copies. A listing can never outlive its copies or its
// expiry, and only the seller may cancel.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const require = createRequire(import.meta.url);
const {createSkinListings} = require(
  path.join(forkRoot, "Code/server/src/space/coopSkinListings.js"));
const {createThirdPartySkins} = require(
  path.join(forkRoot, "Code/server/src/space/coopThirdPartySkins.js"));
const {
  SKIN_LISTING_PROTO_ROOT,
  createSkinListingGatewayService,
} = require(path.join(forkRoot,
  "Code/server/src/_secondary/express/gatewayServices/skinListingGatewayService.js"));

const API = "eve_public.cosmetic.market.skin.listing.api";
const HEX = "a1b2c3d4e5f60718";
const START = Date.UTC(2026, 9, 30, 4, 0, 0);

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

// the market view aggregates characters, so the store needs the character table
function fakeGameStore(state) {
  return {
    read(table) {
      if (table !== "characters") return {success: false};
      return {success: true, data: structuredClone(state.records)};
    },
  };
}

function world() {
  const state = fakeCharacterState({"7": {characterID: 7}, "8": {characterID: 8}});
  const clock = {now: START};
  const env = {EVEJS_COOP_THIRD_PARTY_SKINS: "1", EVEJS_COOP_SKIN_MARKET: "1"};
  const skins = createThirdPartySkins({characterState: state, clock: () => clock.now, env});
  skins.grant(7, {skin: HEX, unactivated: 3});
  let seed = 0;
  const listings = createSkinListings({
    characterState: state,
    gameStore: fakeGameStore(state),
    skins,
    clock: () => clock.now,
    randomUuid: () => Buffer.alloc(16, ++seed),
    env,
  });
  return {state, clock, skins, listings};
}

test("creating a listing escrows the copies it promises", () => {
  const {listings, skins} = world();
  assert.equal(listings.create(7, {skin: HEX, quantity: 9, priceUnits: 100}).status,
    "NOT_ENOUGH_COPIES", "you cannot list copies you do not hold");
  assert.equal(skins.get(7, HEX).unactivated, 3, "a refused listing escrows nothing");

  const created = listings.create(7, {skin: HEX, quantity: 2, priceUnits: 1500000, durationMs: 86400000});
  assert.equal(created.status, "CREATED");
  assert.equal(skins.get(7, HEX).unactivated, 1, "two copies went to escrow");
  assert.equal(skins.get(7, HEX).escrowed, 2);
  assert.equal(listings.all().length, 1);
  assert.equal(listings.owned(7).length, 1);
  assert.equal(listings.owned(8).length, 0, "another character owns nothing");
});

test("only the seller can cancel, and cancelling returns the copies", () => {
  const {listings, skins} = world();
  const {listing} = listings.create(7, {skin: HEX, quantity: 2, priceUnits: 500});
  assert.equal(listings.cancel(8, listing.uuid).status, "NOT_YOURS");
  assert.equal(listings.cancel(7, listing.uuid).status, "CANCELLED");
  assert.equal(skins.get(7, HEX).unactivated, 3, "the escrowed copies came back");
  assert.equal(skins.get(7, HEX).escrowed, 0);
  assert.equal(listings.all().length, 0);
  assert.equal(listings.cancel(7, listing.uuid).status, "NOT_FOUND");
});

test("an expired listing disappears and its copies come back", () => {
  const {listings, skins, clock} = world();
  const {listing} = listings.create(7, {skin: HEX, quantity: 2, priceUnits: 500, durationMs: 1000});
  assert.equal(listings.setExpiration(7, listing.uuid, START).status, "EXPIRY_IN_PAST");
  clock.now = START + 1001;
  assert.equal(listings.all().length, 0, "an expired listing is not offered");
  assert.equal(skins.get(7, HEX).unactivated, 3, "and its copies are back with the seller");
});

test("the gateway serves real listings, with honest refusals", () => {
  const {listings} = world();
  const service = createSkinListingGatewayService({skinListings: listings});
  const encode = (typeName, value) =>
    Buffer.from(SKIN_LISTING_PROTO_ROOT.lookupType(typeName).encode(value).finish());
  const decode = (typeName, buffer) =>
    SKIN_LISTING_PROTO_ROOT.lookupType(typeName).decode(buffer || Buffer.alloc(0));
  const envelope = (value, characterID = 7) => ({
    payload: {value: value || Buffer.alloc(0)},
    authoritative_context: {identity: {character: {sequential: characterID}}},
  });

  const created = service.handleRequest(`${API}.InitiateCreateListingRequest`, envelope(
    encode(`${API}.InitiateCreateListingRequest`, {
      price_isk: {units: 2500000, nanos: 0},
      skin: {skin: {hex: HEX}},
      quantity: 2,
      duration: {seconds: 86400},
    })));
  assert.equal(created.statusCode, 200, created.statusMessage);
  const transaction = decode(`${API}.InitiateCreateListingResponse`,
    created.responsePayloadBuffer).transaction;
  assert.equal(transaction.uuid.length, 16);

  const all = decode(`${API}.GetAllResponse`,
    service.handleRequest(`${API}.GetAllRequest`, envelope()).responsePayloadBuffer);
  assert.equal(all.listings.length, 1);
  assert.equal(all.listings[0].attributes.quantity, 2);
  assert.equal(Number(all.listings[0].attributes.isk.units), 2500000);
  assert.equal(all.listings[0].attributes.skin.skin.hex, HEX,
    "the licence identifier names the seller and the skin");
  assert.equal(all.listings[0].attributes.skin.character.sequential, 7);
  assert.equal(all.listings[0].attributes.seller.sequential, 7);
  assert.ok(all.listings[0].attributes.expires.seconds > all.listings[0].attributes.created.seconds);

  const owned = decode(`${API}.GetAllOwnedResponse`,
    service.handleRequest(`${API}.GetAllOwnedRequest`, envelope()).responsePayloadBuffer);
  assert.equal(owned.listings.length, 1);
  const otherOwned = decode(`${API}.GetAllOwnedResponse`,
    service.handleRequest(`${API}.GetAllOwnedRequest`, envelope(undefined, 8)).responsePayloadBuffer);
  assert.equal(otherOwned.listings.length, 0);

  const id = all.listings[0].id;
  const one = service.handleRequest(`${API}.GetRequest`, envelope(
    encode(`${API}.GetRequest`, {listing: id})));
  assert.equal(one.statusCode, 200);
  assert.equal(decode(`${API}.GetResponse`, one.responsePayloadBuffer).listing.attributes.quantity, 2);

  const tooMuch = service.handleRequest(`${API}.InitiateCreateListingRequest`, envelope(
    encode(`${API}.InitiateCreateListingRequest`, {
      price_isk: {units: 1}, skin: {skin: {hex: HEX}}, quantity: 99,
    })));
  assert.equal(tooMuch.statusCode, 9, "copying more than is held is refused");
  assert.equal(tooMuch.statusMessage,
    "there are not enough unactivated copies of that skin");

  const foreignCancel = service.handleRequest(`${API}.CancelListingRequest`, envelope(
    encode(`${API}.CancelListingRequest`, {listing: id}), 8));
  assert.equal(foreignCancel.statusCode, 7);

  const cancel = service.handleRequest(`${API}.CancelListingRequest`, envelope(
    encode(`${API}.CancelListingRequest`, {listing: id})));
  assert.equal(cancel.statusCode, 200);
  assert.equal(decode(`${API}.GetAllResponse`,
    service.handleRequest(`${API}.GetAllRequest`, envelope()).responsePayloadBuffer).listings.length, 0);
});

// Buying pays for real through the native wallet transfer, charges the sales tax to the seller,
// and only then moves the escrowed copies. Anything that fails after the transfer is rolled back.
function fakeWallet(initial) {
  const balances = {...initial};
  return {
    balances,
    getCharacterWallet(id) {
      return balances[String(id)] === undefined ? null : {balance: balances[String(id)]};
    },
    transferCharacterBalance(from, to, amount) {
      if (this.getCharacterWallet(from) === null || this.getCharacterWallet(to) === null) {
        return {success: false, errorMsg: "CHARACTER_NOT_FOUND"};
      }
      if (balances[String(from)] < amount) return {success: false, errorMsg: "INSUFFICIENT_FUNDS"};
      balances[String(from)] -= amount;
      balances[String(to)] += amount;
      return {success: true};
    },
    adjustCharacterBalance(id, amount) {
      if (this.getCharacterWallet(id) === null) return {success: false, errorMsg: "CHARACTER_NOT_FOUND"};
      balances[String(id)] += amount;
      return {success: true};
    },
  };
}

function market() {
  const state = fakeCharacterState({"7": {characterID: 7}, "8": {characterID: 8}});
  const clock = {now: START};
  const env = {EVEJS_COOP_THIRD_PARTY_SKINS: "1", EVEJS_COOP_SKIN_MARKET: "1"};
  const skins = createThirdPartySkins({characterState: state, clock: () => clock.now, env});
  skins.grant(7, {skin: HEX, unactivated: 2, name: "Nova"});
  const wallet = fakeWallet({"7": 0, "8": 10000000});
  let seed = 0;
  const listings = createSkinListings({
    characterState: state,
    gameStore: fakeGameStore(state),
    skins,
    wallet,
    clock: () => clock.now,
    randomUuid: () => Buffer.alloc(16, ++seed),
    env,
  });
  return {listings, skins, wallet};
}

test("buying moves ISK, charges tax and hands over the escrowed copies", () => {
  const {listings, skins, wallet} = market();
  const {listing} = listings.create(7, {skin: HEX, quantity: 2, priceUnits: 1000000});
  assert.equal(listings.purchase(7, listing.uuid, 1).status, "OWN_LISTING");

  const bought = listings.purchase(8, listing.uuid, 1);
  assert.equal(bought.status, "PURCHASED");
  assert.equal(bought.gross, 1000000);
  assert.equal(bought.tax, 25000, "2.5 % of the gross");
  assert.equal(wallet.balances["8"], 9000000, "the buyer paid the gross price");
  assert.equal(wallet.balances["7"], 975000, "the seller received the price minus tax");
  assert.equal(skins.get(8, HEX).unactivated, 1, "the copy is the buyer's now");
  assert.equal(skins.get(7, HEX).unactivated, 0, "both copies were listed, so none is loose");
  assert.equal(skins.get(7, HEX).escrowed, 1, "one copy is still escrowed for the open listing");
  assert.equal(listings.all().length, 1);
  assert.equal(listings.all()[0].quantity, 1, "the listing keeps only what is left");

  assert.equal(listings.purchase(8, listing.uuid, 5).status, "NOT_ENOUGH_STOCK");
});

test("a purchase that cannot be paid for moves nothing", () => {
  const {listings, skins, wallet} = market();
  const {listing} = listings.create(7, {skin: HEX, quantity: 1, priceUnits: 5000000});
  const poor = listings.purchase(7, listing.uuid, 1);
  assert.equal(poor.status, "OWN_LISTING");
  wallet.balances["8"] = 1000;
  const failed = listings.purchase(8, listing.uuid, 1);
  assert.equal(failed.status, "NOT_ENOUGH_ISK");
  assert.equal(wallet.balances["8"], 1000);
  assert.equal(wallet.balances["7"], 0);
  assert.equal(skins.get(8, HEX), null, "no copies were delivered");
  assert.equal(listings.all()[0].quantity, 1, "the listing is untouched");
});
