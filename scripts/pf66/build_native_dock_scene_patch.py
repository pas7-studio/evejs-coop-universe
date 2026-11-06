#!/usr/bin/env python3
"""PF66 exact-source-pin REVIEW ONLY patch for original nativeNpcService.js.
Compose after PF58 then PF59; do NOT independently apply over their edits.
"""
from pathlib import Path
import argparse
import difflib
import hashlib

REL = 'Code/server/src/space/npc/nativeNpcService.js'
PIN = 'ca039daaaad2839d17f7109de2f3834cec0373a8'

def blob(raw):
    return hashlib.sha1(f'blob {len(raw)}\0'.encode() + raw).hexdigest()

INSERT = '''// PF66 SCOPED ORIGINAL DOCK SCENE DETACH. Only after original PF56
// DOCK_ISSUING and PF66 durable one-shot token + stock ItemStore hangar commit.
let pf66DockAuthority = null;
function installScopedPersonalFleetDockAuthority({capability, authorize, consumeSceneDetach} = {}) {
  if (pf66DockAuthority !== null) throw Error('PF66_NATIVE_AUTHORITY_ALREADY_INSTALLED');
  if (typeof capability !== 'symbol' || typeof authorize !== 'function' ||
      typeof consumeSceneDetach !== 'function')
    throw Error('PF66_NATIVE_AUTHORITY_INVALID');
  pf66DockAuthority = Object.freeze({capability, authorize, consumeSceneDetach});
  return true;
}
function detachScopedPersonalFleetDockSceneActor({row, capability} = {}) {
  const fail = errorMsg => ({success:false,errorMsg});
  if (process.env.EVEJS_COOP_PERSONAL_FLEET_NATIVE_SHIP_ADOPTION !== '1' ||
      process.env.EVEJS_COOP_PERSONAL_FLEET_DOCK_SCENE_DETACH !== '1')
    return fail('PF66_SCENE_DETACH_OFF');
  if (!pf66DockAuthority || capability !== pf66DockAuthority.capability ||
      !row || !Number.isSafeInteger(row.shipItemID) || row.shipItemID <= 0 ||
      !Number.isSafeInteger(row.systemID) || row.systemID <= 0)
    return fail('PF66_SCENE_CAPABILITY_INVALID');
  try {if (pf66DockAuthority.authorize(row) !== true)
    return fail('PF66_DURABLE_DOCK_NOT_AUTHORIZED');}
  catch {return fail('PF66_DURABLE_DOCK_UNKNOWN');}
  const shipID = row.shipItemID;
  const scene = spaceRuntime.scenes && spaceRuntime.scenes.get(row.systemID);
  const physical = scene && scene.getEntityByID(shipID);
  let nativeEntity, nativeController, runtimeController, nativeModules, nativeCargo;
  try {
    nativeEntity = nativeNpcStore.getNativeEntity(shipID);
    nativeController = nativeNpcStore.getNativeController(shipID);
    runtimeController = getControllerByEntityID(shipID);
    nativeModules = nativeNpcStore.listNativeModulesForEntity(shipID);
    nativeCargo = nativeNpcStore.listNativeCargoForEntity(shipID);
  } catch {return fail('PF66_NATIVE_IDENTITY_READ_UNKNOWN');}
  const matches = rec => rec && rec.personalFleetOriginal === true &&
    rec.entityID === shipID && rec.systemID === row.systemID &&
    rec.personalFleetAssignmentID === row.assignmentID &&
    rec.personalFleetPilotID === row.pilotID &&
    rec.personalFleetGeneration === row.reservationGeneration;
  if (!scene || scene.systemID !== row.systemID || !physical ||
      physical.itemID !== shipID || physical.nativeNpc !== true ||
      physical.ownerID !== row.ownerCharacterID ||
      physical.session?.characterID || !matches(nativeEntity) ||
      !matches(nativeController) ||
      nativeEntity.ownerID !== row.ownerCharacterID ||
      !runtimeController || runtimeController.entityID !== shipID ||
      runtimeController.systemID !== row.systemID ||
      !Array.isArray(nativeModules) || nativeModules.length !== 0 ||
      !Array.isArray(nativeCargo) || nativeCargo.length !== 0)
    return fail('PF66_FOREIGN_OR_UNVERIFIED_SCENE_ACTOR');
  try {if (pf66DockAuthority.authorize(row) !== true)
    return fail('PF66_DOCK_AUTHORITY_REVOKED');}
  catch {return fail('PF66_DOCK_AUTHORITY_UNKNOWN');}
  // Durable sub-attempt must COMMIT before the first scene mutation. On crash,
  // a stale/retained private Symbol must never re-authorize this scene removal.
  try {if (pf66DockAuthority.consumeSceneDetach(row) !== true)
    return fail('PF66_SCENE_DURABLE_ATTEMPT_NOT_COMMITTED');}
  catch {return fail('PF66_SCENE_DURABLE_COMMIT_UNKNOWN');}
  // Only scene/controller runtime state, NEVER stored NPC rows, ItemStore,
  // fittings, cargo, wrecks or wallet. PF59 generic removal remains forbidden.
  try {
    spaceRuntime.removeDynamicEntity(row.systemID, shipID,
      {allowSessionOwned:false,broadcast:true});
    if (scene.getEntityByID(shipID))
      return fail('PF66_SCENE_REMOVAL_OUTCOME_UNKNOWN');
    unregisterController(shipID);
    if (getControllerByEntityID(shipID))
      return fail('PF66_RUNTIME_CONTROLLER_STILL_PRESENT');
    return {success:true,data:{shipItemID:shipID,requiresPF60Prepare:true}};
  } catch {return fail('PF66_SCENE_DETACH_OUTCOME_UNKNOWN');}
}
// PF66 SCOPED ORIGINAL DOCK SCENE DETACH END

'''

def transform(src):
    needle='function destroyNativeNpcController(controller, options = {}) {'
    if src.count(needle)!=1:
        raise ValueError('PF66_NATIVE_SERVICE_ANCHOR_DRIFT')
    src=src.replace(needle,INSERT+needle,1)
    # Standalone stock review and PF62 composed PF58 stock bridge have
    # DIFFERENT export anchors. Both paths are pinned, never double-insert.
    plain='module.exports = {\n  isNativeAmbientRuleOptions,'
    composed='module.exports = {\n  PF58_ORIGINAL_ITEMSTORE_BRIDGE_V1: true,\n  isNativeAmbientRuleOptions,'
    if src.count(plain)+src.count(composed)!=1:
        raise ValueError('PF66_NATIVE_EXPORT_ANCHOR_DRIFT')
    anchor=composed if src.count(composed)==1 else plain
    replacement=anchor.replace('  isNativeAmbientRuleOptions,',
        '  PF66_SCOPED_DOCK_SCENE_DETACH_V1: true,\n'
        '  installScopedPersonalFleetDockAuthority,\n'
        '  detachScopedPersonalFleetDockSceneActor,\n'
        '  isNativeAmbientRuleOptions,')
    src=src.replace(anchor,replacement,1)
    return src

def build(root,output):
    raw=(root/REL).read_bytes()
    if blob(raw)!=PIN:
        raise ValueError('PF66_NATIVE_SOURCE_PIN_MISMATCH')
    original=raw.decode('utf-8')
    modified=transform(original)
    diff=''.join(difflib.unified_diff(original.splitlines(keepends=True),
        modified.splitlines(keepends=True),fromfile='a/'+REL,tofile='b/'+REL))
    if not diff:raise ValueError('PF66_EMPTY_PATCH')
    output.write_text(diff,encoding='utf-8')
    return diff

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('checkout',type=Path)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    print(f'PF66 REVIEW ONLY: {len(build(args.checkout,args.output))} bytes, no engine edits')
