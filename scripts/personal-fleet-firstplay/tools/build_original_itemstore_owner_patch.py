#!/usr/bin/env python3
"""PF107: one guarded original ItemStore writer-owner patch, WORK only.

Pure source transformer: verify the exact original stock Git blob, return a
git-apply patch, never write to the native checkout or switch feature flags.
The original stock itemStore remains the inventory owner. This integrates
its writeItems and writeItemCustomInfo sinks into the PF106 atomic gateway,
without creating any competing ItemStore singleton or record source.
"""
from __future__ import annotations

import difflib
from pathlib import Path
import subprocess

TARGET = Path("Code/server/src/services/inventory/itemStore.js")
STOCK_BLOB = "e992d56ee9cff1911d54247bf46d44d01e5d8060"
# Original sqliteStore.explodeToRows('items',root) yields row per itemID.
STOCK_SQLITE_STORE = Path("Code/server/src/gameStore/sqliteStore.js")
STOCK_SQLITE_BLOB = "d851fb5a84added2d4527c34407879e8a009bb74"



def replace_once(source: str, old: str, new: str, label: str) -> str:
    if source.count(old) != 1:
        raise ValueError("PF107_ORIGINAL_ITEMSTORE_ANCHOR_DRIFT:" + label)
    return source.replace(old, new, 1)


def transform(source: str) -> str:
    source = replace_once(
        source,
        'const { performance } = require("perf_hooks");\n',
        'const { performance } = require("perf_hooks");\n'
        '\n'
        '// PF107 original stock ItemStore writer owner. Lazy source-bound import: WORK\n'
        '// OFF remains byte-for-byte equivalent to original write semantics.\n'
        'let pf107OriginalGateway = null;\n'
        'const pf107ReadSnapshots = new WeakMap();\n'
        'function pf107Gateway() {\n'
        '  if (pf107OriginalGateway) return pf107OriginalGateway;\n'
        '  const moduleOwner = require(path.join(__dirname,\n'
        '    "../../space/coopPersonalFleetOriginalForeignItemWriterGateway"));\n'
        '  if (typeof moduleOwner?.createOriginalForeignItemWriterGateway !== "function")\n'
        '    throw Error("PF107_STOCK_GATEWAY_SOURCE_MISSING");\n'
        '  const gateway = moduleOwner.createOriginalForeignItemWriterGateway();\n'
        '  if (gateway?.source !== "ORIGINAL_EVEJS_PERSONAL_FLEET_FOREIGN_ITEM_WRITER_GATE_V1" ||\n'
        '      typeof gateway.executeOriginalStockRoot !== "function")\n'
        '    throw Error("PF107_STOCK_GATEWAY_NOT_AUTHORITATIVE");\n'
        '  pf107OriginalGateway = gateway;\n'
        '  return gateway;\n'
        '}\n',
        "lazy-native-gateway",
    )
    source = replace_once(
        source,
        'function readItems() {\n'
        '  if (itemsTableCache) {\n',
        'function readItems() {\n'
        '  // Stock code mutates the returned root in place BEFORE calling\n'
        '  // writeItems(). While PF is opted in, this must be detached from\n'
        '  // the authoritative GameStore cache to preserve SQLite rollback.\n'
        '  if (process.env.EVEJS_COOP_PERSONAL_FLEET_NATIVE === "1") {\n'
        '    const original = repo.read(ITEMS_TABLE, "/");\n'
        '    if (!original?.success || !original.data ||\n'
        '        typeof original.data !== "object" || Array.isArray(original.data))\n'
        '      throw Error("PF107_ORIGINAL_ITEMSTORE_CACHE_READ_UNCERTAIN");\n'
        '    const expected = structuredClone(original.data);\n'
        '    const detached = structuredClone(expected);\n'
        '    pf107ReadSnapshots.set(detached, expected);\n'
        '    return detached;\n'
        '  }\n'
        '  if (itemsTableCache) {\n',
        "detached-original-read",
    )
    source = replace_once(
        source,
        'function writeItems(data, options = {}) {\n'
        '  const { indexDelta, ...dbOptions } = options;\n'
        '  const writeResult = repo.write(ITEMS_TABLE, "/", data, dbOptions);\n',
        'function writeItems(data, options = {}) {\n'
        '  const { indexDelta, ...dbOptions } = options;\n'
        '  if (process.env.EVEJS_COOP_PERSONAL_FLEET_NATIVE === "1") {\n'
        '    // This replaces, never follows, legacy repo.write. The actual\n'
        '    // before/after diff and PF58 custody check run in ONE original\n'
        '    // BEGIN IMMEDIATE before the only stock items/items tx.put.\n'
        '    if (Object.keys(dbOptions).length) return false;\n'
        '    const expectedOriginalRoot = pf107ReadSnapshots.get(data);\n'
        '    if (!expectedOriginalRoot) return false;\n'
        '    let outcome;\n'
        '    try {\n'
        '      outcome = pf107Gateway().executeOriginalStockRoot({\n'
        '        writer: "PLAYER", proposedItems: structuredClone(data),\n'
        '        expectedOriginalRoot });\n'
        '    } catch (_error) { itemsTableCache = null; return false; }\n'
        '    itemsTableCache = null;\n'
        '    if (outcome?.status !== "COMMITTED") return false;\n'
        '    pf107ReadSnapshots.delete(data);\n'
        '    // Original native GameStore invokes coopInvalidateAfterAtomicRows\n'
        '    // to discard stale ItemStore indexes/caches on commit.\n'
        '    return true;\n'
        '  }\n'
        '  const writeResult = repo.write(ITEMS_TABLE, "/", data, dbOptions);\n',
        "same-transaction-root-write",
    )
    source = replace_once(
        source,
        'function writeItemCustomInfo(itemID, customInfo, options = {}) {\n'
        '  return repo.write(ITEMS_TABLE, `/${String(itemID)}/customInfo`, customInfo, options);\n'
        '}\n',
        'function writeItemCustomInfo(itemID, customInfo, options = {}) {\n'
        '  if (process.env.EVEJS_COOP_PERSONAL_FLEET_NATIVE === "1") {\n'
        '    // The historical direct subpath repo.write would bypass the\n'
        '    // guarded writeItems sink. Route it through the same owner.\n'
        '    if (!Number.isSafeInteger(itemID) || itemID <= 0 ||\n'
        '        (options && Object.keys(options).length))\n'
        '      return { success: false, errorMsg: "PF107_STOCK_METADATA_INVALID" };\n'
        '    try {\n'
        '      const items = readItems(), item = items[String(itemID)];\n'
        '      if (!item || item.itemID !== itemID)\n'
        '        return { success: false, errorMsg: "ITEM_NOT_FOUND" };\n'
        '      items[String(itemID)] = { ...item, customInfo };\n'
        '      const result = pf107Gateway().executeOriginalStockRoot({\n'
        '        writer: "PLAYER", proposedItems: items,\n'
        '        expectedOriginalRoot: pf107ReadSnapshots.get(items) });\n'
        '      return { success: result?.status === "COMMITTED",\n'
        '        errorMsg: result?.status === "COMMITTED" ? undefined :\n'
        '          "PF107_STOCK_METADATA_CUSTODY_DENIED" };\n'
        '    } catch (_error) {\n'
        '      return { success: false, errorMsg: "PF107_STOCK_METADATA_ATOMIC_FAILED" };\n'
        '    }\n'
        '  }\n'
        '  return repo.write(ITEMS_TABLE, `/${String(itemID)}/customInfo`, customInfo, options);\n'
        '}\n',
        "metadata-subpath-write",
    )
    # Two original warehouse/refinery paths make a SECOND clone after
    # readItems(). When Personal Fleet is enabled the read already returned
    # a detached clone with its exact preimage in pf107ReadSnapshots.
    # Retaining that second clone would lose snapshot identity and block
    # these existing stock economic writers. When OFF, keep their original
    # defensive copies unchanged.
    source = replace_once(
        source,
        '  const items=JSON.parse(JSON.stringify(readItems()));',
        '  const items=process.env.EVEJS_COOP_PERSONAL_FLEET_NATIVE === "1"\n'
        '    ?readItems():JSON.parse(JSON.stringify(readItems()));',
        "refinery-snapshot-identity",
    )
    source = replace_once(
        source,
        '  const items=JSON.parse(JSON.stringify(current));',
        '  const items=process.env.EVEJS_COOP_PERSONAL_FLEET_NATIVE === "1"\n'
        '    ?current:JSON.parse(JSON.stringify(current));',
        "player-ore-snapshot-identity",
    )
    source = replace_once(
        source,
        'if (process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS === "1") module.exports.coopInvalidateAfterAtomicRows = mode => { if(mode === "probe") return true; itemIndexesDirty = true; itemIndexesCache = null; itemIndexKeys = new Map(); reservedItemIDBatch = []; itemMutationVersion += 1; return true; };',
        'if (process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS === "1") module.exports.coopInvalidateAfterAtomicRows = mode => { if(mode === "probe") return true; itemsTableCache = null; itemIndexesDirty = true; itemIndexesCache = null; itemIndexKeys = new Map(); reservedItemIDBatch = []; itemMutationVersion += 1; return true; };',
        "clear-root-cache-after-sqlite",
    )
    return source


def verify_original_item_sqlite_layout(work: Path) -> None:
    """Fail closed if original SQLite stops persisting items as flat rows."""
    import hashlib
    target = work / STOCK_SQLITE_STORE
    if not target.is_file() or target.is_symlink():
        raise ValueError("PF108_ORIGINAL_SQLITE_STORE_NOT_FOUND")
    raw = target.read_bytes()
    digest = hashlib.sha1(
        b"blob " + str(len(raw)).encode("ascii") + b"\0" + raw
    ).hexdigest()
    if digest != STOCK_SQLITE_BLOB:
        raise ValueError("PF108_ORIGINAL_SQLITE_SOURCE_BLOB_DRIFT")
    source = raw.decode("utf-8")
    for anchor in ('const ROW_GROUPS = {', 'function explodeToRows(',
                   'function rowGroupsFor(', 'return ROW_GROUPS[table] || null'):
        if anchor not in source:
            raise ValueError("PF108_ORIGINAL_SQLITE_ROW_LAYOUT_UNVERIFIED")
    groups = source.split('const ROW_GROUPS = {', 1)[1].split(
        '\n};', 1)[0]
    if 'items:' in groups or '"items":' in groups:
        raise ValueError("PF108_ORIGINAL_ITEMS_ARE_NOT_FLAT_ROWS")
    # PF110: these native rows are grouped in the ORIGINAL source,
    # while real player characters, cargo and wrecks remain flat.
    if ('npcEntities: ["entities"]' not in groups or
        'npcModules: ["modules"]' not in groups):
        raise ValueError("PF110_ORIGINAL_NATIVE_GROUP_LAYOUT_UNVERIFIED")
    for flat in ("characters", "npcCargo", "npcWrecks", "npcWreckItems"):
        if __import__("re").search(r'(?m)^\s*' + flat + r'\s*:', groups):
            raise ValueError("PF110_ORIGINAL_NATIVE_FLAT_LAYOUT_UNVERIFIED")


def build(work: Path) -> str:
    target = work / TARGET
    if not target.is_file() or target.is_symlink():
        raise ValueError("PF107_ORIGINAL_ITEMSTORE_MISSING_OR_SYMLINK")
    verify_original_item_sqlite_layout(work)
    raw = target.read_bytes()
    # Git's blob hash pins the original unmodified upstream ItemStore owner.
    import hashlib
    digest = hashlib.sha1(
        b"blob " + str(len(raw)).encode("ascii") + b"\0" + raw
    ).hexdigest()
    if digest != STOCK_BLOB:
        raise ValueError("PF107_ORIGINAL_ITEMSTORE_SOURCE_BLOB_DRIFT")
    source = raw.decode("utf-8")
    modified = transform(source)
    return "".join(
        difflib.unified_diff(
            source.splitlines(keepends=True),
            modified.splitlines(keepends=True),
            fromfile="a/" + str(TARGET),
            tofile="b/" + str(TARGET),
        )
    )
