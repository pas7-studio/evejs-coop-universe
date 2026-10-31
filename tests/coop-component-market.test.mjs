// COOP_COMPONENT_MARKET_V1
//
// The SKIN-component market window asked `cosmetic.market.component.listing.api`
// for listings and nobody answered. The store now sells real component item types
// for real ISK. These tests pin the rules that must not drift:
//   - a price is never zero and never below CCP's base price;
//   - a bundle count can never exceed the listing's own stock (no oversell);
//   - a purchase debits the wallet and grants the items to the buyer's hangar;
//   - if delivery fails, the money is refunded and the stock is restored;
//   - a sold-out or expired listing stops selling.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createRequire} from "node:module";
import {ENGINE_CODE, skipWithoutEngine} from "./_support/engineCheckout.mjs";

const require = createRequire(import.meta.url);
const MODULE = path.join(ENGINE_CODE, "server/src/space/coopComponentListings.js");

function harness({docked = true, grantFails = false, balance = 1000000} = {}) {
  const {createComponentListings, priceForBasePrice} = require(MODULE);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "comp-market-"));
  const wallets = new Map([[140000005, {balance}]]);
  const grants = [];
  const store = createComponentListings({
    stateFile: path.join(dir, "listings.json"),
    env: {EVEJS_COOP_COMPONENT_MARKET: "1"},
    clock: () => 1_800_000_000_000,
    wallet: {
      getCharacterWallet: (id) => wallets.get(Number(id)) || null,
      adjustCharacterBalance: (id, delta, options = {}) => {
        const row = wallets.get(Number(id));
        if (!row) return {success: false, errorMsg: "CHARACTER_NOT_FOUND"};
        if (row.balance + delta < 0) return {success: false, errorMsg: "NOT_ENOUGH_MONEY"};
        row.balance += delta;
        row.last = options.description;
        return {success: true, data: {balance: row.balance}};
      },
    },
    items: {
      grantItemsToCharacterLocation: (ownerID, stationID, flagID, entries) => {
        if (grantFails) return {success: false, errorMsg: "GRANT_REFUSED"};
        grants.push({ownerID, stationID, flagID, entries});
        return {success: true, data: {items: entries}};
      },
    },
    characterState: {getCharacterRecord: () => (docked ? {stationID: 60003760} : {stationID: null})},
  });
  return {store, wallets, grants, priceForBasePrice, dir};
}

test("a price is never zero and never below the base price", (t) => {
  if (skipWithoutEngine(t)) return;
  const {priceForBasePrice} = harness();
  assert.equal(priceForBasePrice(45921.5), 45922);
  assert.equal(priceForBasePrice(0), 1);
  assert.equal(priceForBasePrice(-5), 1);
  assert.equal(priceForBasePrice("nope"), 1);
});

test("a bundle count can never exceed the listing stock", (t) => {
  if (skipWithoutEngine(t)) return;
  const {resolveBundleCount} = require(MODULE);
  assert.equal(resolveBundleCount(1, 1, 100), 1);
  assert.equal(resolveBundleCount(3, 2, 100), 3);
  assert.equal(resolveBundleCount(99, 2, 5), 2); // 2 whole bundles of 2 fit in 5
  assert.equal(resolveBundleCount(1, 1, 0), 0);
});

test("a purchase debits the wallet and grants the components to the hangar", (t) => {
  if (skipWithoutEngine(t)) return;
  const h = harness();
  h.store.seed([{typeID: 82340, basePrice: 100, bundleSize: 5, stock: 50}]);
  const [listing] = h.store.list().listings;
  const result = h.store.purchase({uuid: listing.uuid, characterID: 140000005, quantity: 2});
  assert.equal(result.status, "SOLD");
  assert.equal(result.units, 10);
  assert.equal(result.costISK, listing.priceISK * 2);
  assert.equal(h.wallets.get(140000005).balance, 1000000 - result.costISK);
  assert.equal(h.grants.length, 1);
  assert.equal(h.grants[0].stationID, 60003760);
  assert.equal(h.grants[0].entries[0].itemType, 82340);
  assert.equal(h.grants[0].entries[0].quantity, 10);
  assert.equal(h.store.list().listings[0].remaining, 40);
});

test("a failed delivery refunds the money and restores the stock", (t) => {
  if (skipWithoutEngine(t)) return;
  const h = harness({grantFails: true});
  h.store.seed([{typeID: 82340, basePrice: 100, bundleSize: 1, stock: 5}]);
  const [listing] = h.store.list().listings;
  const result = h.store.purchase({uuid: listing.uuid, characterID: 140000005, quantity: 1});
  assert.equal(result.status, "DELIVERY_FAILED");
  assert.equal(h.wallets.get(140000005).balance, 1000000);
  assert.equal(h.store.list().listings[0].remaining, 5);
});

test("an undocked buyer is refused and the stock survives", (t) => {
  if (skipWithoutEngine(t)) return;
  const h = harness({docked: false});
  h.store.seed([{typeID: 82340, basePrice: 100, bundleSize: 1, stock: 5}]);
  const [listing] = h.store.list().listings;
  const result = h.store.purchase({uuid: listing.uuid, characterID: 140000005, quantity: 1});
  assert.equal(result.status, "DELIVERY_FAILED");
  assert.equal(h.store.list().listings[0].remaining, 5);
});

test("a sold-out listing stops selling, and a bad id is not found", (t) => {
  if (skipWithoutEngine(t)) return;
  const h = harness();
  h.store.seed([{typeID: 82340, basePrice: 100, bundleSize: 1, stock: 2}]);
  const [listing] = h.store.list().listings;
  assert.equal(h.store.purchase({uuid: listing.uuid, characterID: 140000005, quantity: 2}).status, "SOLD");
  assert.equal(h.store.purchase({uuid: listing.uuid, characterID: 140000005, quantity: 1}).status, "NOT_ACTIVE");
  assert.equal(h.store.purchase({uuid: "comp:nope", characterID: 140000005, quantity: 1}).status, "NOT_FOUND");
});

test("a purchase answers a real 16-byte transaction uuid the client can parse", (t) => {
  if (skipWithoutEngine(t)) return;
  // Measured in the client (shipSkinComponentTradingRequestMessenger.pyj): it does
  // `uuid.UUID(bytes=response.transaction.uuid)`, which raises unless the field holds exactly
  // 16 bytes. The old answer packed the descriptive order key into 16 UTF-8 bytes, which is
  // both the wrong length for a short key and a meaningless id even when it happened to fit.
  const {
    createComponentListingGatewayService,
    PROTO_ROOT,
  } = require(path.join(ENGINE_CODE,
    "server/src/_secondary/express/gatewayServices/componentListingGatewayService.js"));
  const transactionUUID = "1e0d0abc-0000-4000-8000-0000000000ff";
  const service = createComponentListingGatewayService({
    componentListings: {
      purchase: () => ({status: "SOLD", transactionUUID, typeID: 82340, units: 1,
        costISK: 250000, stationID: 60003760, immediatelyActivate: false}),
    },
  });
  const answer = service.handleRequest(
    "eve_public.cosmetic.market.component.listing.api.InitiatePurchaseListingRequest",
    {payload: {value: Buffer.alloc(0)},
      authoritative_context: {identity: {character: {sequential: 140000005}}}},
  );
  assert.equal(answer.statusCode, 200);
  const decoded = PROTO_ROOT.lookupType(answer.responseTypeName)
    .decode(answer.responsePayloadBuffer);
  const bytes = Buffer.from(decoded.transaction.uuid || []);
  assert.equal(bytes.length, 16, "the client parses this as a UUID");
  assert.equal(bytes.toString("hex"),
    transactionUUID.replace(/-/g, ""), "and it is the id the store really issued");
});

test("the market is off unless it is switched on", (t) => {
  if (skipWithoutEngine(t)) return;
  const {createComponentListings} = require(MODULE);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "comp-off-"));
  const store = createComponentListings({stateFile: path.join(dir, "l.json"), env: {}});
  assert.equal(store.list().status, "DISABLED");
  assert.equal(store.seed([{typeID: 82340, basePrice: 1}]).status, "DISABLED");
});
