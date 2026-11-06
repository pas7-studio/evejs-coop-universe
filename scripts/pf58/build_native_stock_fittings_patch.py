#!/usr/bin/env python3
"""Source-pin and produce a reviewable git patch for nativeNpcService.js.

Default is read-only. An out-of-date or changed source refuses to patch.
The native stock ship handoff stays OFF until explicitly wired by original
bootstrap and all reciprocal writers are fenced. No deploy or git merge.
"""
from pathlib import Path
import argparse
import difflib
import hashlib
import sys

REL = 'Code/server/src/space/npc/nativeNpcService.js'
EXPECTED_SHA1 = 'ca039daaaad2839d17f7109de2f3834cec0373a8'

def blob_hash(raw: bytes) -> str:
    return hashlib.sha1(f'blob {len(raw)}\0'.encode() + raw).hexdigest()

def once(text: str, old: str, new: str):
    if text.count(old) != 1:
        raise ValueError(f'PF58_NATIVE_ANCHOR_DRIFT: {old[:100]!r} count={text.count(old)}')
    return text.replace(old, new, 1)

HEADER = '''// PF58 ORIGINAL ITEMSTORE NATIVE HULL FENCE — source-pinned, OFF by default.
// Stock ship has ONE ItemStore title. Never use nativeNPC module/cargo builders
// for that ship; there are no corresponding synthetic native item allocations.
function pf58OriginalStockModules(record) {
  if (process.env.EVEJS_COOP_PERSONAL_FLEET_NATIVE_SHIP_ADOPTION !== "1")
    throw Error("PF58_NATIVE_SHIP_ADOPTION_OFF");
  const inventory = require(path.join(__dirname, "../../services/inventory/itemStore"));
  const ship = inventory.findItemById(record.entityID);
  if (!ship || ship.itemID !== record.entityID ||
      ship.ownerID !== record.ownerID || ship.typeID !== record.typeID ||
      ship.categoryID !== 6 || ship.locationID !== record.systemID ||
      ship.flagID !== 0 || ship.spaceState?.systemID !== record.systemID)
    throw Error("PF58_ORIGINAL_STOCK_ITEM_MISSING_OR_MOVED");
  const fitting = require(path.join(__dirname, "../../services/fitting/liveFittingState"));
  const modules = fitting.getFittedModuleItems(record.ownerID, record.entityID);
  if (!Array.isArray(modules))throw Error("PF58_STOCK_FITTED_ITEMS_NOT_READABLE");
  return modules.map(moduleItem => ({...moduleItem}));
}
function pf58OriginalStockSlimModules(record) {
  pf58OriginalStockModules(record);
  const fitting = require(path.join(__dirname, "../../services/fitting/liveFittingState"));
  const slim = fitting.buildSlimModuleTuples(record.ownerID, record.entityID);
  if (!Array.isArray(slim))throw Error("PF58_STOCK_SLIM_MODULES_NOT_READABLE");
  return slim;
}
// PF58 ORIGINAL ITEMSTORE NATIVE HULL FENCE END

'''

def transform(source: str) -> str:
    s = once(source, 'function buildNativeRuntimeShipSpec(entityRecord) {',
        HEADER + 'function buildNativeRuntimeShipSpec(entityRecord) {')
    s = once(s,
        '    fittedItems: nativeNpcStore.buildNativeFittedItems(entityRecord.entityID),',
        '    fittedItems: entityRecord.personalFleetOriginal === true\n'
        '      ? pf58OriginalStockModules(entityRecord)\n'
        '      : nativeNpcStore.buildNativeFittedItems(entityRecord.entityID),')
    s = once(s,
        '    nativeCargoItems: nativeNpcStore.buildNativeCargoItems(entityRecord.entityID),',
        '    nativeCargoItems: entityRecord.personalFleetOriginal === true\n'
        '      ? [] : nativeNpcStore.buildNativeCargoItems(entityRecord.entityID),')
    s = once(s,
        '    modules: nativeNpcStore.buildNativeSlimModuleTuples(entityRecord.entityID),',
        '    modules: entityRecord.personalFleetOriginal === true\n'
        '      ? pf58OriginalStockSlimModules(entityRecord)\n'
        '      : nativeNpcStore.buildNativeSlimModuleTuples(entityRecord.entityID),')
    s = once(s,
        '  entity.fittedItems = nativeNpcStore.buildNativeFittedItems(entityRecord.entityID);',
        '  entity.fittedItems = entityRecord.personalFleetOriginal === true\n'
        '    ? pf58OriginalStockModules(entityRecord)\n'
        '    : nativeNpcStore.buildNativeFittedItems(entityRecord.entityID);')
    s = once(s,
        '  entity.nativeCargoItems = nativeNpcStore.buildNativeCargoItems(entityRecord.entityID);',
        '  entity.nativeCargoItems = entityRecord.personalFleetOriginal === true\n'
        '    ? [] : nativeNpcStore.buildNativeCargoItems(entityRecord.entityID);')
    s = once(s,
        '  entity.modules = nativeNpcStore.buildNativeSlimModuleTuples(entityRecord.entityID);',
        '  entity.modules = entityRecord.personalFleetOriginal === true\n'
        '    ? pf58OriginalStockSlimModules(entityRecord)\n'
        '    : nativeNpcStore.buildNativeSlimModuleTuples(entityRecord.entityID);')
    anchor = ('  const entityRecord = nativeNpcStore.getNativeEntity(normalizedEntityID);\n'
              '  const controllerRecord = nativeNpcStore.getNativeController(normalizedEntityID);')
    s = once(s, anchor, anchor + '''
  // An ISSUING permit is valid only for one explicit adoption call. Startup
  // never auto-repairs a partially handed-off original player ship.
  if (entityRecord?.personalFleetOriginal === true && (
      process.env.EVEJS_COOP_PERSONAL_FLEET_NATIVE_SHIP_ADOPTION !== "1" ||
      controllerRecord?.runtimeKind !== "nativeAmbient" ||
      require(path.join(__dirname, "../coopPersonalFleetNativeBindings"))
        .authorize(entityRecord, {allowIssuing: options.personalFleetIssuing === true}) !== true
  )) return {success:false,errorMsg:"PF58_ORIGINAL_NATIVE_PERMIT_NOT_VERIFIED"};''')
    s = once(s,
        'module.exports = {\n  isNativeAmbientRuleOptions,',
        'module.exports = {\n  PF58_ORIGINAL_ITEMSTORE_BRIDGE_V1: true,\n  isNativeAmbientRuleOptions,')
    return s

def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('checkout', type=Path, help='clean pas7-studio/EveJS checkout root')
    ap.add_argument('--output', type=Path, default=Path('PF58-nativeNpcService-stock.patch'))
    args = ap.parse_args()
    source_file = args.checkout / REL
    raw = source_file.read_bytes()
    actual = blob_hash(raw)
    if actual != EXPECTED_SHA1:
        raise SystemExit(f'PF58_SOURCE_PIN_MISMATCH: expected {EXPECTED_SHA1}, got {actual}')
    old = raw.decode('utf-8')
    new = transform(old)
    delta = ''.join(difflib.unified_diff(old.splitlines(keepends=True),new.splitlines(keepends=True),
          fromfile='a/'+REL,tofile='b/'+REL))
    args.output.write_text(delta, encoding='utf-8')
    print(f'PF58 native patch written to {args.output}; source blob {actual}')
    print('INERT: verify file placement, apply on isolated WORK branch only; flags remain OFF')

if __name__ == '__main__':
    main()
