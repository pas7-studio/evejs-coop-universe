import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createAmmoGate } = require('../integration/coopNpcWeaponAmmoGate.cjs');

function fixture() {
  const ship = { kind: 'ship', nativeNpc: true, itemID: 101, ownerID: 900, systemID: 30000144 };
  const module = { itemID: 401, typeID: 12001, flagID: 27, ownerID: 900 };
  const hull = { entityID: 101, ownerID: 900, systemID: 30000144 };
  const modules = [{ moduleID: 401, entityID: 101, ownerID: 900, typeID: 12001, categoryID: 7, flagID: 27, moduleState: { online: true } }];
  const cargo = [{ cargoID: 501, moduleID: 401, entityID: 101, ownerID: 900, categoryID: 8, typeID: 35, quantity: 7 }];
  const optional = new Set();
  const families = new Map();
  const env = { EVEJS_COOP_NPC_STRICT_AMMO: '1' };
  const store = { getNativeEntity: () => hull,
    listNativeModulesForEntity: () => modules,
    listNativeCargoForEntity: () => cargo };
  const dogma = {
    resolveWeaponFamily: item => families.get(item.itemID ?? item.moduleID) || 'projectileTurret',
    isChargeOptionalTurretWeapon: item => optional.has(item.itemID ?? item.moduleID),
  };
  const capability = { isNpcChargeCompatibleWithModule: () => true };
  const gate = createAmmoGate({ store, dogma, capability, env });
  return { ship, module, hull, modules, cargo, optional, families, env, gate,
    check: (overrides = {}) => gate.check({ entity: ship, moduleItem: module, ...overrides }) };
}

test('opt-in NPC with real single loaded barrel may activate; no ammo mutation', () => {
  const f = fixture();
  const before = structuredClone(f.cargo);
  assert.equal(f.check().status, 'NATIVE_LOADED_AMMO_VERIFIED');
  assert.deepEqual(f.cargo, before);
});
test('default OFF and human pilots use untouched native logic', () => {
  const f = fixture(); f.env.EVEJS_COOP_NPC_STRICT_AMMO = '0'; f.cargo.length = 0;
  assert.equal(f.check().allowed, true);
  f.env.EVEJS_COOP_NPC_STRICT_AMMO = '1'; f.ship.nativeNpc = false;
  assert.equal(f.check().status, 'DEFAULT_UNMODIFIED');
});
test('empty or stale native charge cannot authorize NPC weapon cycle', () => {
  const f = fixture(); f.cargo.length = 0;
  assert.equal(f.check().status, 'NATIVE_AMMO_EMPTY_OR_AMBIGUOUS');
  f.cargo.push({ cargoID: 501, moduleID: 401, entityID: 101, ownerID: 900, categoryID: 8, typeID: 35, quantity: 0 });
  assert.equal(f.check().allowed, false);
});
test('charge-optional barrel must still belong to actual fitted native ship', () => {
  const f = fixture(); f.optional.add(401); f.cargo.length = 0;
  assert.equal(f.check().status, 'CHARGE_OPTIONAL_WEAPON');
  f.hull.ownerID = 901;
  assert.equal(f.check().status, 'NATIVE_SHIP_CUSTODY_MISSING');
  f.hull.ownerID = 900; f.modules.length = 0;
  assert.equal(f.check().status, 'NATIVE_WEAPON_MODULE_NOT_VERIFIED');
});
test('charge-optional member cannot exempt ammo-consuming bank member', () => {
  const f = fixture(); f.optional.add(401); f.cargo.length = 0;
  f.modules.push({ moduleID: 402, entityID: 101, ownerID: 900, typeID: 12002, categoryID: 7, flagID: 28 });
  assert.equal(f.check({ bankModuleIDs: [401, 402] }).status, 'NATIVE_AMMO_EMPTY_OR_AMBIGUOUS');
  f.cargo.push({ cargoID: 502, moduleID: 402, entityID: 101, ownerID: 900, categoryID: 8, typeID: 36, quantity: 2 });
  assert.deepEqual((( { modules, charged, chargeOptional, status } ) => ({ modules, charged, chargeOptional, status }))(f.check({ bankModuleIDs: [401, 402] })),
    { modules: 2, charged: 1, chargeOptional: 1, status: 'NATIVE_LOADED_AMMO_VERIFIED' });
});
test('charge-consuming lead member cannot exempt no-charge second turret', () => {
  const f = fixture();
  f.modules.push({ moduleID: 402, entityID: 101, ownerID: 900, typeID: 12002, categoryID: 7, flagID: 28 });
  assert.equal(f.check({ bankModuleIDs: [401, 402] }).allowed, false);
  f.optional.add(402);
  assert.equal(f.check({ bankModuleIDs: [401, 402] }).allowed, true);
});
test('single NPC weapon refuses swapped native module identity and flags', () => {
  const f = fixture();
  assert.equal(f.check({ moduleItem: { ...f.module, typeID: 999 } }).status, 'NATIVE_WEAPON_MODULE_IDENTITY_MISMATCH');
  assert.equal(f.check({ moduleItem: { ...f.module, flagID: 29 } }).status, 'NATIVE_WEAPON_MODULE_IDENTITY_MISMATCH');
  assert.equal(f.check({ moduleItem: { ...f.module, ownerID: 901 } }).status, 'NATIVE_WEAPON_MODULE_IDENTITY_MISMATCH');
});
test('offline fitted module rejects activation even with loaded cargo', () => {
  const f = fixture(); f.modules[0].moduleState.online = false;
  assert.equal(f.check().status, 'NATIVE_WEAPON_MODULE_NOT_VERIFIED');
});
test('no duplicate bank member can silently collapse', () => {
  const f = fixture();
  assert.equal(f.check({ bankModuleIDs: [401, 401] }).status, 'NATIVE_BANK_MEMBERSHIP_INVALID');
  assert.equal(f.check({ bankModuleIDs: [401, 0] }).status, 'NATIVE_BANK_MEMBERSHIP_INVALID');
  assert.equal(f.check({ bankModuleIDs: [402] }).status, 'NATIVE_BANK_MEMBERSHIP_INVALID');
});
test('ambiguous duplicate charge rows, wrong owner and wrong type fail closed', () => {
  const f = fixture(); f.cargo.push({ ...f.cargo[0], cargoID: 502 });
  assert.equal(f.check().allowed, false);
  f.cargo.pop(); f.cargo[0].ownerID = 901;
  assert.equal(f.check().allowed, false);
  f.cargo[0].ownerID = 900; f.cargo[0].typeID = 0;
  assert.equal(f.check().allowed, false);
});
test('unknown weapon family cannot be activated under strict policy', () => {
  const f = fixture(); f.families.set(401, 'unknown');
  assert.equal(f.check().status, 'UNKNOWN_NATIVE_WEAPON_FAMILY');
});
test('missile launcher can never claim charge-optional exemption', () => {
  const f = fixture(); f.optional.add(401); f.families.set(401, 'missileLauncher');
  assert.equal(f.check().status, 'NATIVE_OPTIONAL_MISSILE_UNSUPPORTED');
});
test('missing native store record is a hard failure; synthetic hull branch remains deliberate', () => {
  const f = fixture(); f.ship.ownerID = 902;
  assert.equal(f.check().allowed, false);
  const synthetic = f.check({ moduleItem: { ...f.module, npcSyntheticHullWeapon: true } });
  assert.equal(synthetic.status, 'SYNTHETIC_HULL_WEAPON');
});
