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
// PF69 RESTART ADMISSION: any one-sided Personal Fleet marker poisons the pair.
// Never admit a controller-only PF original via the unmarked-entity startup path.
function pf58IsPersonalFleetRecord(record) {
  return !!record && (
    record.personalFleetOriginal === true ||
    record.operatorKind === "PERSONAL_FLEET" ||
    record.entityType === "personalFleet" ||
    record.npcEntityType === "personalFleet" ||
    record.selectionKind === "PERSONAL_FLEET" ||
    typeof record.personalFleetAssignmentID === "string" ||
    typeof record.personalFleetPilotID === "string" ||
    record.personalFleetGeneration !== undefined
  );
}
function pf58OriginalNativePairValid(entityRecord, controllerRecord) {
  if (!entityRecord || !controllerRecord ||
      entityRecord.personalFleetOriginal !== true ||
      controllerRecord.personalFleetOriginal !== true ||
      entityRecord.operatorKind !== "PERSONAL_FLEET" ||
      controllerRecord.operatorKind !== "PERSONAL_FLEET" ||
      entityRecord.entityType !== "personalFleet" ||
      controllerRecord.entityType !== "personalFleet" ||
      controllerRecord.runtimeKind !== "nativeAmbient" ||
      !Number.isSafeInteger(entityRecord.entityID) || entityRecord.entityID <= 0 ||
      entityRecord.entityID !== controllerRecord.entityID ||
      !Number.isSafeInteger(entityRecord.systemID) || entityRecord.systemID <= 0 ||
      entityRecord.systemID !== controllerRecord.systemID ||
      !Number.isSafeInteger(entityRecord.ownerID) || entityRecord.ownerID <= 0 ||
      !Number.isSafeInteger(entityRecord.personalFleetGeneration) ||
      entityRecord.personalFleetGeneration <= 0 ||
      entityRecord.personalFleetGeneration !== controllerRecord.personalFleetGeneration ||
      typeof entityRecord.personalFleetAssignmentID !== "string" ||
      !entityRecord.personalFleetAssignmentID ||
      entityRecord.personalFleetAssignmentID !== controllerRecord.personalFleetAssignmentID ||
      typeof entityRecord.personalFleetPilotID !== "string" ||
      !entityRecord.personalFleetPilotID ||
      entityRecord.personalFleetPilotID !== controllerRecord.personalFleetPilotID ||
      entityRecord.selectionKind !== "PERSONAL_FLEET" ||
      controllerRecord.selectionKind !== "PERSONAL_FLEET" ||
      entityRecord.selectionID !== entityRecord.personalFleetAssignmentID ||
      controllerRecord.selectionID !== entityRecord.personalFleetAssignmentID ||
      !entityRecord.profileID || !entityRecord.loadoutID ||
      !entityRecord.behaviorProfileID ||
      entityRecord.profileID !== controllerRecord.profileID ||
      entityRecord.loadoutID !== controllerRecord.loadoutID ||
      entityRecord.behaviorProfileID !== controllerRecord.behaviorProfileID)
    return false;
  return true;
}
// PF69 RESTART ADMISSION END
// PF72: the stock materializer reuses a same-ID actor BEFORE registering a
// controller or applying the native NPC presentation. A live player ship or
// a foreign NPC with the same ID must never be converted to Personal Fleet.
function pf58OriginalExistingSceneActorValid(actor, record) {
  return !!actor && actor.kind === "ship" &&
    actor.itemID === record.entityID &&
    actor.nativeNpc === true && actor.nativeNpcOccupied === true &&
    actor.npcEntityType === "personalFleet" &&
    actor.operatorKind === "PERSONAL_FLEET" &&
    actor.selectionKind === "PERSONAL_FLEET" &&
    actor.selectionID === record.personalFleetAssignmentID &&
    actor.ownerID === record.ownerID &&
    actor.characterID === 0 && actor.pilotCharacterID === 0 &&
    (actor.session === undefined || actor.session === null);
}
// PF58 ORIGINAL ITEMSTORE NATIVE HULL FENCE END

'''

def transform(source: str) -> str:
    s = once(source, 'function buildNativeRuntimeShipSpec(entityRecord) {',
        HEADER + 'function buildNativeRuntimeShipSpec(entityRecord) {')
    # PF71: nativeNpcService has TWO callsites into this low-level writer: the
    # stored-controller restorer and the general native spawn path. Guard the
    # common entrypoint as well as the early stored-controller read. This must
    # precede both the existing-entity register path and fresh dynamic spawn.
    lowlevel = ('function materializeNativeRuntimeEntity(scene, entityRecord, controllerRecord, definition, options = {}) {\n'
                '  const runtimeKind = String(controllerRecord && controllerRecord.runtimeKind || "nativeAmbient").trim() || "nativeAmbient";')
    guarded = ('function materializeNativeRuntimeEntity(scene, entityRecord, controllerRecord, definition, options = {}) {\n'
        '  // PF71: every native runtime materialization path must validate PF custody.\n'
        '  // A caller bypassing materializeStoredNativeController cannot register\n'
        '  // a controller or spawn a PF original without the exact durable permit.\n'
        '  if ((pf58IsPersonalFleetRecord(entityRecord) ||\n'
        '       pf58IsPersonalFleetRecord(controllerRecord)) && (\n'
        '      !pf58OriginalNativePairValid(entityRecord, controllerRecord) ||\n'
        '      !scene || scene.systemID !== entityRecord.systemID ||\n'
        '      process.env.EVEJS_COOP_PERSONAL_FLEET_NATIVE_SHIP_ADOPTION !== "1" ||\n'
        '      require(path.join(__dirname, "../coopPersonalFleetNativeBindings"))\n'
        '        .authorize(entityRecord, {allowIssuing: options.personalFleetIssuing === true}) !== true\n'
        '  )) return {success:false,errorMsg:"PF71_LOW_LEVEL_NATIVE_PERMIT_NOT_VERIFIED"};\n'
        '  const runtimeKind = String(controllerRecord && controllerRecord.runtimeKind || "nativeAmbient").trim() || "nativeAmbient";')
    s = once(s, lowlevel, guarded)
    # PF72: the same original low-level materializer has a branch which
    # reuses any preexisting scene actor by numeric ID. Refuse to register a
    # Personal Fleet controller on a player-owned or foreign runtime actor.
    # This gate is after the original read-only getEntityByID and strictly
    # BEFORE the existing-actor register/presentation/idle side effects.
    scene_anchor = ('  const existingEntity = scene.getEntityByID(entityRecord.entityID);\n'
                    '  if (existingEntity) {')
    scene_guard = ('  const existingEntity = scene.getEntityByID(entityRecord.entityID);\n'
      '  // PF72: never hijack a physical player/foreign actor with the same ID.\n'
      '  if (existingEntity &&\n'
      '      (pf58IsPersonalFleetRecord(entityRecord) ||\n'
      '       pf58IsPersonalFleetRecord(controllerRecord)) &&\n'
      '      !pf58OriginalExistingSceneActorValid(existingEntity, entityRecord))\n'
      '    return {success:false,errorMsg:"PF72_FOREIGN_EXISTING_SCENE_ACTOR"};\n'
      '  if (existingEntity) {')
    s = once(s, scene_anchor, scene_guard)
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
  // PF69: inspect BOTH stock rows before any definition, scene, or spawn work.
  // A controller-only marker is not a normal NPC; it is an ambiguous PF ship.
  if ((pf58IsPersonalFleetRecord(entityRecord) ||
       pf58IsPersonalFleetRecord(controllerRecord)) && (
      !pf58OriginalNativePairValid(entityRecord, controllerRecord) ||
      process.env.EVEJS_COOP_PERSONAL_FLEET_NATIVE_SHIP_ADOPTION !== "1" ||
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
