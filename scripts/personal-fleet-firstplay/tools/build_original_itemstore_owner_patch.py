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
        '    return structuredClone(original.data);\n'
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
        '    let outcome;\n'
        '    try {\n'
        '      outcome = pf107Gateway().executeOriginalStockRoot({\n'
        '        writer: "PLAYER", proposedItems: structuredClone(data) });\n'
        '    } catch (_error) { itemsTableCache = null; return false; }\n'
        '    itemsTableCache = null;\n'
        '    if (outcome?.status !== "COMMITTED") return false;\n'
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
        '        writer: "PLAYER", proposedItems: items });\n'
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
    source = replace_once(
        source,
        'if (process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS === "1") module.exports.coopInvalidateAfterAtomicRows = mode => { if(mode === "probe") return true; itemIndexesDirty = true; itemIndexesCache = null; itemIndexKeys = new Map(); reservedItemIDBatch = []; itemMutationVersion += 1; return true; };',
        'if (process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS === "1") module.exports.coopInvalidateAfterAtomicRows = mode => { if(mode === "probe") return true; itemsTableCache = null; itemIndexesDirty = true; itemIndexesCache = null; itemIndexKeys = new Map(); reservedItemIDBatch = []; itemMutationVersion += 1; return true; };',
        "clear-root-cache-after-sqlite",
    )
    return source


def build(work: Path) -> str:
    target = work / TARGET
    if not target.is_file() or target.is_symlink():
        raise ValueError("PF107_ORIGINAL_ITEMSTORE_MISSING_OR_SYMLINK")
    raw = target.read_bytes()
    # Git's blob hash pins the original unmodified upstream ItemStore owner.
    import hashlib
    digest = hashlib.sha1(
        b"blob " + str(len(raw)).encode("ascii") + b"\\0" + raw
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
