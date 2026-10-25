"use strict";
// COOP-035: one-line reversible account cache invalidators for atomic GameStore.
// CharacterState normalizes and caches clones; CorporationRuntime caches a table.
// Dirty caches must be dropped after native SQL commit, not before.
const patches={
 "server/src/services/character/characterState.js":
  'module.exports.coopInvalidateAfterAtomicRows = mode => { if(mode==="probe") return true; if(mode!=="commit") return false; characterRecordCache.clear(); return true; };',
 "server/src/services/corporation/corporationRuntimeState.js":
  'module.exports.coopInvalidateAfterAtomicRows = mode => { if(mode==="probe") return true; if(mode!=="commit") return false; resetRuntimeCaches(); return true; };'
};
function patch(source,file,remove=false){
 const stmt=patches[file];if(!stmt)return source;
 const eol=source.includes("\r\n")?"\r\n":"\n",count=source.split(stmt).length-1;
 if(count>1)throw Error("NPC_ACCOUNT_CACHE_DOUBLE_PATCH");
 if(!count&&source.includes("module.exports.coopInvalidateAfterAtomicRows"))
  throw Error("NPC_ACCOUNT_CACHE_STALE_EXPORT");
 if(remove){return count?source.replace(eol+stmt,""):source}
 if(count)return source;
 if(!source.includes("module.exports = {"))throw Error("NPC_ACCOUNT_CACHE_EXPORT_DRIFT");
 return source.replace(/\s*$/,"")+eol+stmt+eol;
}
module.exports={patch,patches};
