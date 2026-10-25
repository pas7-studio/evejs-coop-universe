"use strict";
// Reversible, one-statement native exports. All transactional logic lives in L2.
const entries=Object.freeze({
 'server/src/gameStore/sqliteStore.js':'module.exports.coopAtomicNativeRows = require("../space/coopGameStoreAtomic").createSqliteAdapter(() => requireDb());',
 'server/src/gameStore/index.js':'module.exports.coopAtomicNativeRows = require("../space/coopGameStoreAtomic").createGameStoreAdapter({sqliteStore,ensureSqliteReady,ensureCached,flushTableSync,cache,dirty,flushTimers,inFlightFlushes,transientPaths,dirtyRowKeys,fullDirty,rebuildFlushBaselineFromDisk,invalidateNativeItems:mode=>{const inventory=require("../services/inventory/itemStore");return typeof inventory.coopInvalidateAfterAtomicRows==="function"&&inventory.coopInvalidateAfterAtomicRows(mode)===true;},invalidateNativeAccounts:(mode,tables)=>{if(tables.includes("characters")){const c=require("../services/character/characterState");if(typeof c.coopInvalidateAfterAtomicRows!=="function"||c.coopInvalidateAfterAtomicRows(mode)!==true)return false;}if(tables.includes("corporationRuntime")){const c=require("../services/corporation/corporationRuntimeState");if(typeof c.coopInvalidateAfterAtomicRows!=="function"||c.coopInvalidateAfterAtomicRows(mode)!==true)return false;}return true;},fatal:error=>{console.error("[COOP GameStore] POSTCOMMIT CACHE UNSAFE",error.message);process.exit(70);}});',
 'server/src/services/inventory/itemStore.js':'if (process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS === "1") module.exports.coopInvalidateAfterAtomicRows = mode => { if(mode === "probe") return true; itemIndexesDirty = true; itemIndexesCache = null; itemIndexKeys = new Map(); reservedItemIDBatch = []; itemMutationVersion += 1; return true; };'
});
function patch(source,file,remove=false){
 const stmt=entries[file];if(!stmt)return source;
 const count=source.split(stmt).length-1;
 if(count>1)throw Error("DUPLICATE_GAMESTORE_NATIVE_BRIDGE:"+file);
 if(!count&&source.includes("module.exports.coopAtomicNativeRows ="))
   throw Error("STALE_GAMESTORE_NATIVE_BRIDGE_EXPORT:"+file);
 const eol=source.includes("\r\n")?"\r\n":"\n";
 if(remove){if(!count)return source;return source.replace(eol+stmt,"");}
 if(count)return source;
 if(!source.includes("module.exports = {"))throw Error("UNSUPPORTED_NATIVE_EXPORT_SHAPE:"+file);
 return source.replace(/\s*$/,"")+eol+stmt+eol;
}
module.exports={patch,entries};
