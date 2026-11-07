#!/usr/bin/env python3
"""PF61 exact-source-pinned review diff. Does not edit EveJS or run any CI.
PF59 and PF61 BOTH touch nativeNpcStore; build one reviewed combined patch
against the actual fork before any WORK activation.
"""
import argparse
import difflib
import hashlib
from pathlib import Path

REL='Code/server/src/space/npc/nativeNpcStore.js'
PIN='95724ab4537683e7ee933bc3149d0a891082ce7e'

def blob(raw):return hashlib.sha1(f'blob {len(raw)}\0'.encode()+raw).hexdigest()

INSERT='''// PF61 SCOPED TERMINAL CLEANUP. Never expose capability to client/route code.
// The only permitted bypass of PF59 native entity/controller removal guards.
let pf61TerminalAuthority = null;
function installScopedOriginalTerminalCleanupAuthority({capability, authorize} = {}) {
  if (pf61TerminalAuthority !== null) throw Error('PF61_AUTHORITY_ALREADY_INSTALLED');
  if (typeof capability !== 'symbol' || typeof authorize !== 'function')
    throw Error('PF61_INVALID_NATIVE_AUTHORITY');
  pf61TerminalAuthority = Object.freeze({capability, authorize});
  return true;
}
function removeScopedPersonalFleetTerminalNativeRows({command, capability} = {}) {
  const fail = errorMsg => ({success: false, errorMsg});
  if (process.env.EVEJS_COOP_PERSONAL_FLEET_TERMINAL_CLEANUP !== '1')
    return fail('PF61_SCOPED_CLEANUP_DISABLED');
  if (!pf61TerminalAuthority || capability !== pf61TerminalAuthority.capability ||
      !command || !Number.isSafeInteger(command.shipItemID) || command.shipItemID <= 0)
    return fail('PF61_CAPABILITY_MISSING');
  const entityID = command.shipItemID;
  try { if (pf61TerminalAuthority.authorize(command) !== true)
    return fail('PF61_DURABLE_ISSUE_NOT_AUTHORIZED'); }
  catch { return fail('PF61_DURABLE_ISSUE_READ_UNKNOWN'); }
  const entity = getNativeEntity(entityID), controller = getNativeController(entityID);
  if (!entity && !controller) return fail('PF61_NATIVE_ALREADY_ABSENT_USE_RECONCILE');
  const markerMatches = row => !row || (row.entityID === entityID &&
    row.systemID === command.systemID && row.personalFleetOriginal === true &&
    row.personalFleetAssignmentID === command.assignmentID &&
    row.personalFleetPilotID === command.pilotID &&
    row.personalFleetGeneration === command.generation);
  if (!markerMatches(entity) || !markerMatches(controller) ||
      (entity && entity.ownerID !== command.ownerCharacterID) ||
      listNativeModulesForEntity(entityID).length !== 0 ||
      listNativeCargoForEntity(entityID).length !== 0)
    return fail('PF61_FOREIGN_NATIVE_IDENTITY_OR_ASSET_ROWS');
  try { if (pf61TerminalAuthority.authorize(command) !== true)
    return fail('PF61_DURABLE_ISSUE_REVOKED'); }
  catch { return fail('PF61_DURABLE_ISSUE_READ_UNKNOWN'); }
  // These are original nativeStore private low-level row operations, not the
  // generic PF59-blocked NPC deletion functions. Not cross-table atomic:
  // PF60 one-shot intent + independent reconciliation are mandatory.
  if (controller) {
    const rc = removeCollectionRow(TABLE.CONTROLLERS, 'controllers', entityID);
    if (rc?.success !== true) return fail('PF61_CONTROLLER_WRITE_OUTCOME_UNKNOWN');
    invalidateControllerCache();
  }
  if (entity) {
    const re = removeCollectionRow(TABLE.ENTITIES, 'entities', entityID);
    if (re?.success !== true) return fail('PF61_ENTITY_WRITE_OUTCOME_UNKNOWN');
  }
  if (getNativeController(entityID) || getNativeEntity(entityID))
    return fail('PF61_NATIVE_READBACK_OUTCOME_UNKNOWN');
  return {success: true, data: {shipItemID: entityID, requiresPF60Reconcile: true}};
}
// PF61 SCOPED TERMINAL CLEANUP END

'''

def transform(src):
    needle='function removeNativeEntityCascade(entityID) {'
    if src.count(needle)!=1:raise ValueError('PF61_NATIVE_ANCHOR_DRIFT')
    src=src.replace(needle,INSERT+needle,1)
    exports='module.exports = {\n  TABLE,'
    if src.count(exports)!=1:raise ValueError('PF61_EXPORT_ANCHOR_DRIFT')
    src=src.replace(exports,'module.exports = {\n  PF61_SCOPED_ORIGINAL_NATIVE_CLEANUP_V1: true,\n  installScopedOriginalTerminalCleanupAuthority,\n  removeScopedPersonalFleetTerminalNativeRows,\n  TABLE,',1)
    return src

def build(root,output):
    raw=(root/REL).read_bytes()
    if blob(raw)!=PIN:raise ValueError(f'PF61_SOURCE_PIN_MISMATCH {blob(raw)}')
    old=raw.decode('utf-8');new=transform(old)
    patch=''.join(difflib.unified_diff(old.splitlines(keepends=True),
       new.splitlines(keepends=True),fromfile='a/'+REL,tofile='b/'+REL))
    if not patch:raise ValueError('PF61_EMPTY_PATCH')
    output.write_text(patch,encoding='utf-8')
    return patch

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('checkout',type=Path)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    print(f'PF61 review-only native patch ({len(build(args.checkout,args.output))} chars): {args.output}')
    print('NOT APPLIED; no native fork write, no WORK gameplay proof. Default OFF.')
