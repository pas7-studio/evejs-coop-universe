#!/usr/bin/env python3
"""Source-pinned original EveJS cooperative NPC order owner admission.

Adds PERSONAL_FLEET to the original shared NPC order arbiter; PF95 keeps
it non-peaceful so a verified ATTACK may be stopped or retasked by the same
original exclusive lease. Other peaceful NPC directors remain combat-fenced. It does not create a second arbiter,
automatically bind it, or activate Personal Fleet. Review/apply to WORK only.
"""
from __future__ import annotations
import difflib
import hashlib
from pathlib import Path

ARB = 'Code/server/src/space/coopNpcOrderArbiter.js'
BRIDGE = 'Code/server/src/space/coopNpcOrderBridge.js'
PINS = {
    ARB: 'aa5447ada4015b1ac8262d14bae5cd975af6ec6b',
    BRIDGE: 'c0f93af3e5a67703a84dc03cab8da29a65afdf3b',
}
MARKERS = {
    ARB: (
        'const OWNERS = new Set(["RAID","TACTICS","GATE","PATROL","CIVILIAN","WAR","EXPEDITION"]);',
        'const OWNERS = new Set(["RAID","TACTICS","GATE","PATROL","CIVILIAN","WAR","EXPEDITION","PERSONAL_FLEET"]);',
    ),
    BRIDGE: (
        'const PEACEFUL = new Set(["PATROL","CIVILIAN","GATE","EXPEDITION"]);',
        'const PEACEFUL=new Set(["PATROL","CIVILIAN","GATE","EXPEDITION"]); // PF95 stock-combat-checked owner "PERSONAL_FLEET" is NOT peaceful',
    ),
}

def git_blob(raw: bytes) -> str:
    return hashlib.sha1(b'blob ' + str(len(raw)).encode() + b'\x00' + raw).hexdigest()

def transform(path: str, source: str) -> str:
    if path not in MARKERS:
        raise ValueError('PF_ORDER_UNKNOWN_ORIGINAL_SOURCE')
    old, new = MARKERS[path]
    if source.count(old) != 1 or source.count(new) != 0:
        raise ValueError('PF_ORDER_NATIVE_ARBITER_SOURCE_DRIFT: ' + path)
    if '\r' in source or not source.endswith('\n'):
        raise ValueError('PF_ORDER_NATIVE_UNEXPECTED_LINE_ENDINGS')
    updated = source.replace(old, new, 1)
    if path == BRIDGE:
        # PF96 re-adopts its own original ACKED GUARD after the stock native
        # NPC materializer resets the live manualOrder. Existing Destiny
        # FOLLOW can outlive the process-local order lease. Only the exact
        # source-backed bridge callback may permit that one re-adoption.
        changes=(
         (' warShipClaim=null}={}) {',
          ' warShipClaim=null,personalFleetRecoveryProof=null}={}) {'),
         (' if(warShipClaim!==null&&typeof warShipClaim!=="function")throw Error("WAR_SHIP_CLAIM_AUTHORITY_INVALID");',
          ' if(warShipClaim!==null&&typeof warShipClaim!=="function")throw Error("WAR_SHIP_CLAIM_AUTHORITY_INVALID");\n if(personalFleetRecoveryProof!==null&&typeof personalFleetRecoveryProof!=="function")throw Error("PF96_RECOVERY_PROOF_AUTHORITY_INVALID");'),
         ('  if((state.manualBusy||state.movementBusy)&&owner!=="TACTICS"&&\n   (!lease||lease.owner!==owner)&&!warOwnsItsPatrol)',
          '  const provenPfResume=owner==="PERSONAL_FLEET"&&action==="pf-resume-guard"&&\n'
          '   !state.manualBusy&&state.movementBusy&&\n'
          '   (!lease||lease.owner==="PERSONAL_FLEET")&&\n'
          '   personalFleetRecoveryProof?.(link)===true;\n'
          '  if((state.manualBusy||state.movementBusy)&&owner!=="TACTICS"&&\n'
          '   (!lease||lease.owner!==owner)&&!warOwnsItsPatrol&&!provenPfResume)'),
        )
        for before,after in changes:
            if updated.count(before)!=1 or updated.count(after)!=0:
                raise ValueError('PF96_ORIGINAL_BRIDGE_RECOVERY_SOURCE_DRIFT')
            updated=updated.replace(before,after,1)
    # The bridge may now mention this owner in its tightly-scoped
    # source-authenticated PF96 readoption condition. Count the exact marker,
    # not all legitimate references to the owner in native source.
    if updated.count(new) != 1 or (path == ARB and
       updated.count('"PERSONAL_FLEET"') != 1):
        raise ValueError('PF_ORDER_DUPLICATE_FLEET_OWNER')
    return updated

def build(work: Path) -> str:
    sections = []
    for path, pin in PINS.items():
        native = work/path
        if not native.is_file() or native.is_symlink():
            raise ValueError('PF_ORDER_STOCK_SOURCE_MISSING: '+path)
        raw = native.read_bytes()
        if git_blob(raw) != pin:
            raise ValueError('PF_ORDER_ORIGINAL_BLOB_DRIFT: '+path)
        before = raw.decode('utf-8')
        after = transform(path, before)
        lines = list(difflib.unified_diff(
            before.splitlines(keepends=True), after.splitlines(keepends=True),
            fromfile='a/'+path, tofile='b/'+path))
        if not lines:
            raise ValueError('PF_ORDER_NO_SOURCE_CHANGE: '+path)
        sections.extend(lines)
    patch = ''.join(sections)
    if patch.count('--- a/') != 2 or patch.count('+++ b/') != 2:
        raise ValueError('PF_ORDER_TWO_FILE_PATCH_REQUIRED')
    return patch
