#!/usr/bin/env python3
"""Source-pinned original EveJS cooperative NPC order owner admission.

Only adds PERSONAL_FLEET to the original shared NPC order arbiter and marks it
peaceful for stock native combat fencing. It does not create a second arbiter,
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
        'const PEACEFUL = new Set(["PATROL","CIVILIAN","GATE","EXPEDITION","PERSONAL_FLEET"]);',
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
    if updated.count('"PERSONAL_FLEET"') != 1:
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
