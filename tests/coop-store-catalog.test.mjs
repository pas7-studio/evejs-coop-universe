import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import path from "node:path";

// The New Eden Store window asks for categories, offers and products before it can draw
// anything; all seven reads were missing, so the window was blank even though the
// purchase path behind it already worked. Everything here comes from the same store state
// that path fulfils from, so a listed offer is always buyable at the listed price.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const require = createRequire(import.meta.url);
const {buildNewEdenStoreGatewayProtoRoot} = require(path.join(forkRoot,
  "Code/server/src/services/newEdenStore/storeGatewayProto.js"));

const root = buildNewEdenStoreGatewayProtoRoot();
const {buildOfferAttributes, buildCategoryAttributes, buildProductAttributes} =
  require(path.join(forkRoot,
    "Code/server/src/services/newEdenStore/storeCatalogMapping.js"));

test("an offer encodes the price, categories and products the client reads", () => {
  const offer = {
    storeOfferID: "omega_30_days",
    name: "Omega Clone State",
    tags: ["omega", "gametime"],
    canPurchase: true,
    singlePurchase: false,
    offerPricings: [{currency: "PLX", price: 500, basePrice: 600}],
    categories: [{id: 9000001}],
    products: [{id: 9100001, typeId: 0, quantity: 1}],
  };
  const attributes = buildOfferAttributes(offer);
  assert.equal(attributes.name, "Omega Clone State");
  assert.equal(attributes.can_purchase, true);
  assert.equal(attributes.no_enddate, true);
  assert.deepEqual(attributes.tags, ["omega", "gametime"]);
  assert.equal(attributes.offer_price.currency, "PLX");
  assert.equal(attributes.offer_price.amount_in_cents, 50000,
    "500 PLEX at 100 cents per PLEX");
  assert.equal(attributes.base_price.amount_in_cents, 60000);
  assert.equal(attributes.categories[0].sequential, 9000001);
  assert.equal(attributes.products[0].product.sequential, 9100001);
  assert.equal(attributes.products[0].quantity, 1);
});

test("a category knows its parent and its children", () => {
  const catalog = {
    categories: [
      {id: 9000000, name: "Featured"},
      {id: 9000001, name: "Omega", parent: {id: 9000000}},
      {id: 9000002, name: "PLEX", parent: {id: 9000000}},
    ],
    offers: [],
    products: [],
  };
  const rootless = buildCategoryAttributes(catalog.categories[0], catalog);
  assert.equal(rootless.no_parent, true);
  assert.equal(rootless.no_subcategories, false);
  assert.equal(rootless.subcategories.identifier.length, 2);

  const child = buildCategoryAttributes(catalog.categories[1], catalog);
  assert.equal(child.no_parent, false);
  assert.equal(child.parent.sequential, 9000000);
  assert.equal(child.no_subcategories, true);
});

test("a product is an item only when it really has a type id", () => {
  const catalog = {
    offers: [
      {storeOfferID: "a", products: [{id: 1, typeId: 0}]},
      {storeOfferID: "b", products: [{id: 2, typeId: 16262, quantity: 1}]},
    ],
    categories: [],
    products: [],
  };
  assert.equal(buildProductAttributes({id: 1, name: "Omega"}, catalog).item, undefined,
    "an account service must not pretend to be an inventory item");
  assert.equal(buildProductAttributes({id: 2, name: "Skill Extractor"}, catalog)
    .item.type.sequential, 16262);
});

test("the seven catalog request types are declared in the store proto", () => {
  for (const name of [
    "eve_public.store.category.api.GetAllRequest",
    "eve_public.store.category.api.GetRequest",
    "eve_public.store.offer.api.GetAllRequest",
    "eve_public.store.offer.api.GetAllByTagRequest",
    "eve_public.store.offer.api.GetAllTargetedRequest",
    "eve_public.store.offer.api.GetRequest",
    "eve_public.store.product.api.GetRequest",
  ]) {
    assert.ok(root.lookupType(name), name);
    assert.ok(root.lookupType(name.replace(/Request$/, "Response")), `${name} response`);
  }
});

test("their responses carry the fields the client fills the window from", () => {
  const offerAttributes = root.lookupType("eve_public.store.offer.Attributes");
  assert.deepEqual(
    offerAttributes.fieldsArray.map((field) => [field.name, field.id]),
    [["name", 1], ["tags", 2], ["single_purchase", 3], ["targeted", 4],
      ["no_enddate", 5], ["can_purchase", 7], ["purchase_limited_reason", 8],
      ["no_schedule", 9], ["offer_price", 12], ["base_price", 13],
      ["categories", 14], ["products", 15]],
  );
  const all = root.lookupType("eve_public.store.offer.api.GetAllResponse");
  assert.equal(all.fields.offers.repeated, true);
});
