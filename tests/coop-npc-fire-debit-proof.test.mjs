import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { createFireDebitProof } = require("../integration/coopNpcFireDebitProof.cjs");

// Live finding (war battle leg, container evejs-server-1): a real durable
// Serpentis cruiser with 5 online turrets and 5 real Shadow Antimatter charges
// activated its module and every cycle was refused with NO_AMMO. The proof
// demanded `flagID` on the native cargo row, which the native cargo writer
// never stamps, so a fully loaded warship could never apply damage.
const entityID = 980000016639, ownerID = 1000135;
const moduleRow = {
  moduleID: 980100051793, entityID, ownerID, typeID: 13884, categoryID: 7,
  flagID: 27, moduleState: { online: true },
};
// Exactly the native row shape observed in the container: no flagID.
const cargoRow = {
  cargoID: 980200004763, entityID, ownerID, moduleID: 980100051793,
  typeID: 20057, categoryID: 8, quantity: 1,
};
const entity = { itemID: entityID, kind: "ship", nativeNpc: true, ownerID };
const moduleItem = { itemID: moduleRow.moduleID, typeID: moduleRow.typeID, flagID: 27, ownerID };
const chargeItem = { itemID: cargoRow.cargoID, typeID: cargoRow.typeID, quantity: 1 };

function proofWith(overrides = {}) {
  const modules = overrides.modules || [moduleRow];
  const cargo = overrides.cargo || [cargoRow];
  return createFireDebitProof({
    env: { EVEJS_COOP_NPC_STRICT_AMMO: "1" },
    compatible: overrides.compatible || (() => true),
    store: {
      getNativeEntity: () => ({ entityID, ownerID, systemID: 30001363 }),
      listNativeModulesForEntity: () => modules,
      listNativeCargoForEntity: () => cargo,
    },
  });
}

test("a native charge row without flagID is a verified charge, not a forgery", () => {
  const result = proofWith().verify({ entity, moduleItem, chargeItem });
  assert.equal(result.allowed, true);
  assert.equal(result.status, "NATIVE_FIRE_CARGO_VERIFIED");
  assert.equal(result.cargoID, cargoRow.cargoID);
});

test("the whole bank verifies for a real 5-turret cruiser", () => {
  const modules = [], cargo = [];
  for (let i = 0; i < 5; i += 1) {
    modules.push({ ...moduleRow, moduleID: 980100051793 + i, flagID: 27 + i });
    cargo.push({ ...cargoRow, cargoID: 980200004763 + i, moduleID: 980100051793 + i });
  }
  const proof = proofWith({ modules, cargo });
  const entries = modules.map((row, i) => ({
    moduleItem: { itemID: row.moduleID, typeID: row.typeID, flagID: row.flagID, ownerID },
    chargeItem: { itemID: cargo[i].cargoID, typeID: cargo[i].typeID, quantity: 1 },
  }));
  const bank = proof.verifyBank({ entity, entries });
  assert.equal(bank.allowed, true);
  assert.equal(bank.status, "NATIVE_FIRE_BANK_VERIFIED");
  assert.equal(bank.weaponCount, 5);
});

test("a cargo row that does carry a different flagID is still refused", () => {
  const result = proofWith({ cargo: [{ ...cargoRow, flagID: 99 }] })
    .verify({ entity, moduleItem, chargeItem });
  assert.equal(result.allowed, false);
  assert.equal(result.status, "NATIVE_FIRE_STALE_OR_FORGED_CHARGE");
});

test("the other custody checks stay strict", () => {
  const wrongOwner = proofWith({ cargo: [{ ...cargoRow, ownerID: 7 }] })
    .verify({ entity, moduleItem, chargeItem });
  assert.equal(wrongOwner.allowed, false);
  const wrongModule = proofWith({ cargo: [{ ...cargoRow, moduleID: 42 }] })
    .verify({ entity, moduleItem, chargeItem });
  assert.equal(wrongModule.allowed, false);
  const incompatible = proofWith({ compatible: () => false })
    .verify({ entity, moduleItem, chargeItem });
  assert.equal(incompatible.allowed, false);
  const missingCharge = proofWith({ cargo: [] })
    .verify({ entity, moduleItem, chargeItem });
  assert.equal(missingCharge.allowed, false);
  assert.equal(missingCharge.status, "NATIVE_FIRE_CARGO_MISSING");
  const offlineModule = proofWith({ modules: [{ ...moduleRow, categoryID: 8 }] })
    .verify({ entity, moduleItem, chargeItem });
  assert.equal(offlineModule.allowed, false);
});

test("a player ship and a disabled flag keep the legacy path", () => {
  const proof = createFireDebitProof({
    env: {}, compatible: () => true, store: {
      getNativeEntity: () => null,
      listNativeModulesForEntity: () => [],
      listNativeCargoForEntity: () => [],
    },
  });
  const result = proof.verify({ entity: { ...entity, nativeNpc: false }, moduleItem, chargeItem });
  assert.equal(result.allowed, true);
  assert.equal(result.status, "LEGACY_UNCHANGED");
});
