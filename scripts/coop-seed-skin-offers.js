#!/usr/bin/env node
"use strict";
// Seed real SKIN offers into the in-game New Eden Store (store 4).
//
// The client's SKIN panel asks `storeManager.get_offers(4)` and matches offers by the *licence* type id
// (`SearchOffersByTypeIDs(GetLicenseTypesForMaterial())`), so a SKIN offer must carry a product whose
// `typeId` is the SKIN licence type. The catalogue had 15 offers and none of them cosmetic, which is why
// the shop had nothing to buy and the skin panel stayed empty.
//
// Runs INSIDE the server container (it needs the live gameStore):
//   docker cp scripts/coop-seed-skin-offers.js evejs-server-1:/tmp/
//   docker exec evejs-server-1 node /tmp/coop-seed-skin-offers.js --dry-run
//   docker exec evejs-server-1 node /tmp/coop-seed-skin-offers.js --apply
//
// Idempotent: offers already present (by storeOfferID `skin_<licenseTypeID>`) are skipped, so a second
// run adds nothing. The whole table is backed up by gameStore.write(..., {force:true}) before writing.
const database = require("/app/server/src/gameStore");
const referenceData = require("/app/server/src/services/_shared/referenceData");

const STORE_ID = "4";
const CATEGORY_ID = 9000100;
const PRICE_PLX = 10;            // flat, documented: one permanent SKIN = 10 PLEX on this server
const MAX_PER_HULL = 4;          // the real NES lists a few variants per hull, not every material
const OFFER_ID_BASE = 9300000;
const PRODUCT_ID_BASE = 9500000;

const apply = process.argv.includes("--apply");

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

const catalog = referenceData.readStaticTable("shipCosmeticsCatalog") || {};
const licenceTypes = catalog.licenseTypesByTypeID || {};
const read = database.read("newEdenStore", "/");
if (!read || !read.success || !read.data) {
  console.error("STORE_READ_FAILED " + String(read && read.errorMsg));
  process.exit(2);
}
const root = read.data;
const store = root.stores && root.stores[STORE_ID];
if (!store) {
  console.error("STORE_MISSING " + STORE_ID);
  process.exit(2);
}

const existingStoreOfferIDs = new Set(
  (store.offers || []).map((offer) => String(offer && offer.storeOfferID || "").trim().toLowerCase()),
);
const shipTypeToLicences = new Map();
for (const licence of Object.values(licenceTypes)) {
  if (!licence || licence.published !== true || licence.missingSkinDefinition === true) continue;
  if (toInt(licence.duration, 0) !== -1) continue;
  if (String(licence.groupName || "") !== "Permanent SKIN") continue;
  const shipTypeID = toInt((licence.shipTypeIDs || [])[0], 0);
  const licenseTypeID = toInt(licence.licenseTypeID, 0);
  if (!(shipTypeID > 0) || !(licenseTypeID > 0)) continue;
  if (!shipTypeToLicences.has(shipTypeID)) shipTypeToLicences.set(shipTypeID, []);
  shipTypeToLicences.get(shipTypeID).push({ licenseTypeID, name: String(licence.typeName || licence.internalName || "") });
}

let nextOfferID = Math.max(
  OFFER_ID_BASE,
  ...(store.offers || []).map((offer) => toInt(offer && offer.id, 0) + 1),
);
let nextProductID = Math.max(
  PRODUCT_ID_BASE,
  ...(store.products || []).map((product) => toInt(product && product.id, 0) + 1),
);

const newOffers = [];
const newProducts = [];
const hulls = [...shipTypeToLicences.keys()].sort((a, b) => a - b);
for (const shipTypeID of hulls) {
  const licences = shipTypeToLicences.get(shipTypeID)
    .sort((left, right) => left.licenseTypeID - right.licenseTypeID)
    .slice(0, MAX_PER_HULL);
  for (const licence of licences) {
    const storeOfferID = `skin_${licence.licenseTypeID}`;
    if (existingStoreOfferIDs.has(storeOfferID)) continue;
    const offerID = nextOfferID++;
    const productID = nextProductID++;
    const name = licence.name || `SKIN ${licence.licenseTypeID}`;
    newProducts.push({
      id: productID,
      name,
      href: `/store/4/products/skin-${licence.licenseTypeID}`,
    });
    newOffers.push({
      id: offerID,
      storeOfferID,
      name,
      description: `Permanent SKIN for ${name.replace(/ SKIN$/, "")}.`,
      href: `/store/4/offers/skin-${licence.licenseTypeID}`,
      offerPricings: [{ currency: "PLX", price: PRICE_PLX, basePrice: PRICE_PLX }],
      imageUrl: "",
      products: [{
        id: productID,
        typeId: licence.licenseTypeID,
        quantity: 1,
        productName: name,
        imageUrl: "",
      }],
      categories: [{ id: CATEGORY_ID }],
      label: null,
      thirdpartyinfo: null,
      canPurchase: true,
      singlePurchase: false,
      tags: ["skin", "cosmetic"],
      fulfillment: { kind: "skin_license", licenseTypeID: licence.licenseTypeID },
    });
  }
}

console.log(`SKIN licenceHulls=${hulls.length} newOffers=${newOffers.length} existingOffers=${(store.offers || []).length}`);
if (newOffers.length > 0) {
  console.log(`SKIN sample=${JSON.stringify(newOffers[0]).slice(0, 320)}`);
}
if (!apply) {
  console.log("SKIN DRY_RUN (pass --apply to write)");
  process.exit(0);
}
if (newOffers.length <= 0) {
  console.log("SKIN NOTHING_TO_DO");
  process.exit(0);
}

store.categories = Array.isArray(store.categories) ? store.categories : [];
if (!store.categories.some((category) => toInt(category && category.id, 0) === CATEGORY_ID)) {
  store.categories.push({
    id: CATEGORY_ID,
    name: "SKINs",
    href: "/store/4/categories/skins",
    parent: null,
    tags: ["skin", "cosmetic"],
  });
}
store.offers = [...(store.offers || []), ...newOffers];
store.products = [...(store.products || []), ...newProducts];

const write = database.write("newEdenStore", "/", root, { force: true });
if (!write || write.success === false) {
  console.error("STORE_WRITE_FAILED " + String(write && write.errorMsg));
  process.exit(3);
}
console.log(`SKIN WRITTEN offers=${store.offers.length} products=${store.products.length} categories=${store.categories.length}`);
