"use strict";
/**
 * COOP-032D. In-process native SQLite/GameStore atomic row bridge.
 * Infrastructure only, never exports supportsAtomicInstall/Delivery.
 */
const ALLOWED=new Set(["items","characters","corporationRuntime","industryBlueprintState","industryJobs","identityState","marketEscrow","npcMarketFills","npcEntities","npcModules","npcCargo","npcWreckItems"]);
const SEP="\u001f",hasOwn=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
function assertTables(names){
 if(!Array.isArray(names)||names.length<1||names.length>ALLOWED.size||
    new Set(names).size!==names.length||names.some(t=>!ALLOWED.has(t)))throw Error("ATOMIC_TABLE_ALLOWLIST_VIOLATION");
 return names;
}
function assertRowKey(k){if(typeof k!=="string"||!k.length||k.length>200||k.includes("\0"))throw Error("INVALID_NATIVE_ROW_KEY");}
function serialize(v,t,k){
 const scalar=t==="identityState"&&["nextItemID","nextCharacterID","nextAccountID","version"].includes(k)&&Number.isSafeInteger(v)&&v>=1;
 if(!scalar&&(v===null||typeof v!=="object"||Array.isArray(v)))throw Error("NATIVE_ROW_MUST_BE_OBJECT");
 const encoded=JSON.stringify(v);
 if(typeof encoded!=="string"||encoded.length>2000000)throw Error("NATIVE_ROW_INVALID_SIZE");
 return encoded;
}
function createSqliteAdapter(getDb){
 if(typeof getDb!=="function")throw Error("NATIVE_SQLITE_PROVIDER_REQUIRED");
 let inside=false,claimed=false;
 function transact(tables,mutation){
  if(process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS!=="1")throw Error("NATIVE_SQLITE_ATOMIC_DISABLED");
  assertTables(tables);
  if(typeof mutation!=="function"||inside)throw Error("INVALID_OR_REENTRANT_ATOMIC_MUTATION");
  const db=getDb();if(!db||typeof db.exec!=="function"||typeof db.prepare!=="function")throw Error("NATIVE_SQLITE_UNAVAILABLE");
  const scope=new Set(tables),changed=new Map();
  const tbl=t=>{if(!scope.has(t))throw Error("UNDECLARED_NATIVE_TABLE");return '"'+t+'"';};
  let begun=false;inside=true;
  try{
   db.exec("BEGIN IMMEDIATE");begun=true;
   const tx=Object.freeze({
    get(t,k){const table=tbl(t);assertRowKey(k);const r=db.prepare('SELECT json FROM '+table+' WHERE key=?').get(k);return r?JSON.parse(r.json):null;},
    scan(t){const table=tbl(t);return db.prepare('SELECT key,json FROM '+table).all().map(r=>({key:r.key,value:JSON.parse(r.json)}));},
    put(t,k,value){const table=tbl(t);assertRowKey(k);const json=serialize(value,t,k);
     db.prepare('INSERT INTO '+table+'(key,json) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET json=excluded.json').run(k,json);
     if(!changed.has(t))changed.set(t,new Set());changed.get(t).add(k);},
    del(t,k){const table=tbl(t);assertRowKey(k);db.prepare('DELETE FROM '+table+' WHERE key=?').run(k);
     if(!changed.has(t))changed.set(t,new Set());changed.get(t).add(k);}
   });
   const result=mutation(tx);
   if(result&&typeof result.then==="function")throw Error("ASYNC_NATIVE_ATOMIC_MUTATION_FORBIDDEN");
   try{db.exec("COMMIT");}catch(cause){
    const uncertain=Error("NATIVE_SQLITE_COMMIT_OUTCOME_UNKNOWN");
    uncertain.coopCommitOutcomeUnknown=true;uncertain.cause=cause;throw uncertain;
   }
   begun=false;
   return {result,changed:Object.fromEntries([...changed].map(([t,keys])=>[t,[...keys]]))};
  }catch(e){if(begun){try{db.exec("ROLLBACK")}catch{}}throw e;}
  finally{inside=false;}
 }
 // Only the GameStore owner can claim this SQLite writer; a second caller is refused.
 return Object.freeze({claimTransactor(){
  if(claimed)throw Error("NATIVE_SQLITE_WRITER_ALREADY_CLAIMED");
  claimed=true;return Object.freeze({transact});
 }});
}
function reconcileObject(target,source){
 if(!target||!source||typeof target!=="object"||typeof source!=="object"||Array.isArray(target)!==Array.isArray(source))return source;
 if(Array.isArray(target)){target.splice(0,target.length,...source.map((x,i)=>reconcileObject(target[i],x)));return target;}
 for(const k of Object.keys(target))if(!hasOwn(source,k))delete target[k];
 for(const k of Object.keys(source))target[k]=hasOwn(target,k)?reconcileObject(target[k],source[k]):source[k];
 return target;
}
function createGameStoreAdapter({sqliteStore,ensureSqliteReady,ensureCached,flushTableSync,
 cache,dirty,flushTimers,inFlightFlushes,transientPaths,dirtyRowKeys,fullDirty,
 rebuildFlushBaselineFromDisk,invalidateNativeItems,fatal}={}){
 if(!sqliteStore||typeof sqliteStore.coopAtomicNativeRows?.claimTransactor!=="function"||
    typeof sqliteStore.loadTableObject!=="function"||typeof ensureSqliteReady!=="function"||
    typeof ensureCached!=="function"||typeof flushTableSync!=="function"||
    typeof rebuildFlushBaselineFromDisk!=="function"||!cache||!dirty||!flushTimers||
    !inFlightFlushes||!transientPaths||!dirtyRowKeys||!fullDirty||
    typeof invalidateNativeItems!=="function"||typeof fatal!=="function")
  throw Error("NATIVE_GAMESTORE_AUTHORITIES_REQUIRED");
 const sqliteWriter=sqliteStore.coopAtomicNativeRows.claimTransactor();
 let busy=false,poisoned=false;
 function transact(tables,mutation){
  if(poisoned)throw Error("NATIVE_GAMESTORE_POISONED");
  if(process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS!=="1")throw Error("NATIVE_GAMESTORE_ATOMIC_DISABLED");
  assertTables(tables);
  if(busy)throw Error("NATIVE_GAMESTORE_ATOMIC_REENTRANT");
  if(typeof mutation!=="function")throw Error("NATIVE_ATOMIC_MUTATION_REQUIRED");
  busy=true;let committed=false;
  try{
   ensureSqliteReady();
   for(const t of tables){
    if(!ensureCached(t))throw Error("NATIVE_GAMESTORE_TABLE_UNAVAILABLE:"+t);
    if(transientPaths[t]?.size)throw Error("NATIVE_TRANSIENT_STATE_UNSAFE:"+t);
    const result=flushTableSync(t,{log:false});
    if(!result?.success||dirty.has(t)||inFlightFlushes.has(t)||flushTimers[t])
      throw Error("NATIVE_GAMESTORE_PERSISTENCE_NOT_QUIESCENT:"+t);
   }
   if(tables.includes("items")&&invalidateNativeItems("probe")!==true)
     throw Error("NATIVE_INVENTORY_INDEX_INVALIDATOR_UNAVAILABLE");
   const result=sqliteWriter.transact(tables,mutation);
   committed=true;
   for(const t of tables){
    const snapshot=sqliteStore.loadTableObject(t),current=cache[t];
    if(!current||typeof current!=="object"||!snapshot||typeof snapshot!=="object")
      throw Error("NATIVE_CACHE_SNAPSHOT_INVALID:"+t);
    // characterState caches a normalized record by raw child object identity.
    // Replacing changed child rows (while preserving the table reference) forces
    // getCharacterRecord() to re-normalize actual committed wallet balances.
    // Other tables retain their existing deep in-place reconciliation.
    if(t==="characters"){
      for(const k of Object.keys(current))if(!hasOwn(snapshot,k))delete current[k];
      for(const [k,v] of Object.entries(snapshot))current[k]=v;
    }else reconcileObject(current,snapshot);
    rebuildFlushBaselineFromDisk(t);
    delete dirtyRowKeys[t];fullDirty.delete(t);dirty.delete(t);
   }
   if(tables.includes("items")&&invalidateNativeItems("commit")!==true)
     throw Error("NATIVE_INVENTORY_INDEX_INVALIDATION_FAILED");
   return result.result;
  }catch(e){
   if(committed||e?.coopCommitOutcomeUnknown===true){poisoned=true;fatal(e);
    throw Error("NATIVE_GAMESTORE_COMMITTED_BUT_CACHE_UNSAFE:"+String(e.message||e));}
   throw e;
  }finally{busy=false;}
 }
 return Object.freeze({transact,mode:"SERVER_INTERNAL_FLAGGED",
  supportsAtomicInstall:false,supportsAtomicDelivery:false,isPoisoned:()=>poisoned});
}
module.exports={createSqliteAdapter,createGameStoreAdapter,assertTables,reconcileObject,SEP};
