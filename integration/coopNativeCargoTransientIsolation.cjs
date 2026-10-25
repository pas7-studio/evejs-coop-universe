"use strict";
/**
 * ALIFE-11: mixed transient NPC cargo isolation, original GameStore authority.
 * A transient cargoID is NEVER included in sqliteStore's cargo root row.
 * All validation is synchronous and must run on the one GameStore owner.
 */
const {isDeepStrictEqual}=require("node:util");
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const numeric=x=>typeof x==="string"&&/^[1-9]\d{0,15}$/.test(x)&&
 Number.isSafeInteger(Number(x))&&Number(x)>0;
const clone=x=>JSON.parse(JSON.stringify(x));
const error=why=>{throw Error("ALIFE11_"+why)};
function getCargo(root){
 if(!root||typeof root!=="object"||Array.isArray(root)||
    !root.cargo||typeof root.cargo!=="object"||Array.isArray(root.cargo))
  error("NATIVE_CARGO_SHAPE_INVALID");
 return root.cargo;
}
/**
 * The caller has already synchronized pending worker writes with
 * flushTableSync('npcCargo') AND checked that its table is quiescent.
 * Neither durable (DB) nor transient (cache) is modified here.
 */
function capture({paths,live,durable}={}){
 if(!(paths instanceof Set)||paths.size<1||paths.size>10000)
  error("TRANSIENT_PATH_SET_UNAVAILABLE");
 const current=getCargo(live),persisted=getCargo(durable);
 const shadows={};
 for(const transientPath of paths){
  if(typeof transientPath!=="string"||!/^\/cargo\/[1-9]\d{0,15}$/.test(transientPath))
   error("TRANSIENT_PATH_NOT_ROW_SCOPED");
  const id=transientPath.slice("/cargo/".length);
  if(!numeric(id)||String(Number(id))!==id||own(shadows,id))
   error("TRANSIENT_ID_NOT_CANONICAL");
  if(!own(current,id)||own(persisted,id))
   error("TRANSIENT_ROW_MISSING_OR_ALREADY_DURABLE");
  const row=current[id];
  if(!row||typeof row!=="object"||Array.isArray(row)||
     Number(row.cargoID)!==Number(id)||!numeric(String(row.entityID))||
     !numeric(String(row.ownerID))||!numeric(String(row.typeID))||
     !Number.isSafeInteger(row.quantity)||row.quantity<=0||
     row.transient!==true)
   error("TRANSIENT_ROW_CUSTODY_UNPROVEN");
  shadows[id]=clone(row);
 }
 // The current cache stripped of exactly those explicitly transient
 // entries must match the actual SQLite root AND every other SQLite row.
 // This catches lost/pending writeback, stale baselines and orphan rows.
 const durableCache=clone(live);
 for(const id of Object.keys(shadows))delete durableCache.cargo[id];
 if(!isDeepStrictEqual(durableCache,durable))
  error("CACHE_AND_SQLITE_DURABLE_PREIMAGE_CONFLICT");
 return Object.freeze({ids:Object.freeze(Object.keys(shadows)),shadows});
}
function guardMutation(tx,witness){
 if(!witness)return tx;
 const ids=witness.ids,deny=()=>error("TRANSIENT_CARGO_SQL_WRITE_FORBIDDEN");
 return Object.freeze({
  get:(table,key)=>tx.get(table,key),
  scan:table=>tx.scan(table),
  put(table,key,value){
   if(table==="npcCargo"&&key==="cargo"){
    if(!value||typeof value!=="object"||Array.isArray(value)||
       ids.some(id=>own(value,id)))deny();
   }
   tx.put(table,key,value);
  },
  del(table,key){
   if(table==="npcCargo"&&key==="cargo")deny();
   tx.del(table,key);
  }
 });
}
/**
 * SQL COMMIT already happened. A failure here is FATAL to the GameStore
 * owner; DO NOT run a compensating cargo write or a second SQLite operation.
 */
function rehydrate({persisted,live,paths,witness}={}){
 if(!witness)return persisted;
 const durableCargo=getCargo(persisted),currentCargo=getCargo(live);
 const result=clone(persisted);
 if(!(paths instanceof Set)||paths.size!==witness.ids.length)
  error("TRANSIENT_PATHS_CHANGED_DURING_COMMIT");
 for(const id of witness.ids){
  if(!paths.has("/cargo/"+id)||
     own(durableCargo,id)||
     !own(currentCargo,id)||
     !isDeepStrictEqual(currentCargo[id],witness.shadows[id]))
   error("TRANSIENT_CARGO_CHANGED_DURING_COMMIT");
  // Only the original in-process shadow returns to the GameStore cache,
  // never to SQLite, a SQL journal or a native warehouse receipt.
  result.cargo[id]=clone(witness.shadows[id]);
 }
 return result;
}
module.exports={capture,guardMutation,rehydrate};
