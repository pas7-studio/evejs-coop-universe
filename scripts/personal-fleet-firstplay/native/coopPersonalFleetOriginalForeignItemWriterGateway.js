'use strict';
/**
 * PF106 — ORIGINAL GameStore-owned stock ItemStore mutation gateway.
 *
 * The transaction is OPENED HERE using the original GameStore singleton.
 * Before the one stock items/items tx.put, calculate an exhaustive diff of
 * the actual proposed item root and check every changed ORIGINAL item in BOTH
 * the pre-write and prospective post-write parent chains with the source
 * PF58 reciprocal fence. This prevents undeclared module/cargo inserts,
 * hidden ship title changes and "only item A" claims that change item B.
 *
 * It is NOT an automatic patch to PLAYER/MINING/WAR/EXPLORATION/MARKET/
 * INDUSTRY entrypoints. No writer-fenced readiness claim is exported.
 */
const gameStore=require('../gameStore');
const pf52=require('./coopPersonalFleetHangarBridge');
const permit=require('./coopPersonalFleetOriginalNativePermit');
const SOURCE='ORIGINAL_EVEJS_PERSONAL_FLEET_FOREIGN_ITEM_WRITER_GATE_V1';
const TABLE='corporationRuntime',ITEMS='items';
const WRITERS=new Set(['PLAYER','MINING','WAR','EXPLORATION','MARKET','INDUSTRY']);
const pos=x=>Number.isSafeInteger(x)&&x>0;
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const canonical=x=>typeof x==='string'&&/^[1-9][0-9]*$/.test(x)&&
  pos(Number(x))&&String(Number(x))===x;
const deny=reason=>({status:'BLOCKED',reason,mayCommit:false});
function createOriginalForeignItemWriterGateway(){
 const a=gameStore?.coopAtomicNativeRows;
 if(a?.mode!=='SERVER_INTERNAL_FLAGGED'||typeof a.transact!=='function'||
    typeof a.isPoisoned!=='function'||
    typeof pf52?.validateIndex!=='function'||
    pf52.REGISTRY_KEY!=='coop-personal-fleet\u001fhangar-reservations-v1'||
    typeof permit?.createReciprocalWriterFence!=='function')
  throw Error('PF106_ORIGINAL_STOCK_ITEMSTORE_GATE_UNAVAILABLE');
 const reciprocal=permit.createReciprocalWriterFence({pf52});
 if(typeof reciprocal?.inTransaction!=='function')
  throw Error('PF106_ORIGINAL_PF58_RECIPROCAL_FENCE_UNAVAILABLE');
 function run({writer,declaredItemIDs,buildNext,proposedItems,
                expectedOriginalRoot,fromOriginalStockRoot=false}={}){
  // The generic original ItemStore owner writes an entire existing stock
  // root, so it cannot supply a trusted "changed IDs" list. Its exact
  // mutation set is derived INSIDE the same original SQLite transaction.
  if(!WRITERS.has(writer)||
     (fromOriginalStockRoot?!obj(proposedItems)||!obj(expectedOriginalRoot):
      typeof buildNext!=='function'||
      !Array.isArray(declaredItemIDs)||declaredItemIDs.length<1||
      declaredItemIDs.length>256||
      declaredItemIDs.some(x=>!pos(x))||
      new Set(declaredItemIDs).size!==declaredItemIDs.length))
   return deny(fromOriginalStockRoot?
    'PF107_STOCK_ITEMSTORE_ROOT_INVALID':'PF106_WRITER_DECLARATION_INVALID');
  if(a.isPoisoned()!==false)
   return deny('PF106_ORIGINAL_GAMESTORE_POISONED');
  try{
   return a.transact([TABLE,ITEMS],tx=>{
    if(a.isPoisoned()!==false||typeof tx?.get!=='function'||
       typeof tx?.put!=='function')
     throw Error('PF106_ORIGINAL_TRANSACTION_UNAVAILABLE');
    const before=tx.get(ITEMS,ITEMS);
    if(!obj(before))throw Error('PF106_ORIGINAL_ITEMS_ROOT_UNREADABLE');
    // PF107: the stock owner reads a detached in-memory snapshot BEFORE
    // its legacy inventory mutation. Recheck that original root *inside*
    // the same SQLite write transaction; otherwise an intervening native
    // writer's item change could be silently replaced by the stale root.
    if(fromOriginalStockRoot&&
       JSON.stringify(before)!==JSON.stringify(expectedOriginalRoot))
     throw Error('PF107_ORIGINAL_ITEMSTORE_SNAPSHOT_DRIFT');
    // The mutation builder never receives the authoritative reference or
    // a GameStore transaction, and cannot directly mutate stock ItemStore
    // through this API. It must return the ENTIRE next items root.
    const cloned=structuredClone(before);
    const proposed=fromOriginalStockRoot?proposedItems:buildNext(cloned);
    if(!obj(proposed))
     throw Error('PF106_NEXT_ITEMS_ROOT_REQUIRED');
    const next=structuredClone(proposed);
    const keys=new Set([...Object.keys(before),...Object.keys(next)]);
    const changed=[];
    if(keys.size>2500000)throw Error('PF106_ITEMS_ROOT_SIZE_UNSAFE');
    for(const key of keys){
     if(!Object.prototype.hasOwnProperty.call(before,key)||
        !Object.prototype.hasOwnProperty.call(next,key)||
        JSON.stringify(before[key])!==JSON.stringify(next[key])){
      if(!canonical(key))throw Error('PF106_CHANGED_ITEM_KEY_INVALID');
      changed.push(Number(key));
      if(changed.length>256)throw Error('PF106_CHANGED_ITEMS_CAP');
     }
    }
    const actual=new Set(changed);
    if(!fromOriginalStockRoot&&
       (actual.size!==declaredItemIDs.length||
        declaredItemIDs.some(id=>!actual.has(id))))
     throw Error('PF106_UNDECLARED_STOCK_ITEM_CHANGE');
    // A stock write with no actual changes is a valid idempotent no-op,
    // but must never trigger a pointless full-root GameStore write.
    if(fromOriginalStockRoot&&changed.length===0)
     return Object.freeze({status:'COMMITTED',source:SOURCE,
      changedItemIDs:Object.freeze([])});
    // The prospective view retains the original transaction's immutable
    // custody tables, but offers the complete AFTER root only to the stock
    // PF58 read-only validator. Only the actual tx performs the final put.
    const preview=Object.freeze({
     get:(table,key)=>table===ITEMS&&key===ITEMS?next:tx.get(table,key),
     put:()=>{throw Error('PF106_PREVIEW_WRITE_FORBIDDEN');}
    });
    for(const id of changed){
     const old=before[String(id)],fresh=next[String(id)];
     for(const item of [old,fresh]){
      if(item===undefined)continue;
      if(!obj(item)||item.itemID!==id||
         !pos(item.ownerID)||!pos(item.locationID)||
         !pos(item.categoryID))
       throw Error('PF106_ORIGINAL_ITEM_IDENTITY_INVALID');
     }
     if(old!==undefined){
      const r=reciprocal.inTransaction({tx,writer,affectedItemID:id,
       destinationLocationID:old.locationID});
      if(r?.mayCommit!==true||r.status!=='CLEAR_IN_SAME_TRANSACTION')
       throw Error('PF106_ORIGINAL_PREWRITE_CUSTODY_DENIED:'+
         String(r?.reason||'UNKNOWN'));
     }
     if(fresh!==undefined){
      const r=reciprocal.inTransaction({tx:preview,writer,affectedItemID:id,
       destinationLocationID:fresh.locationID});
      if(r?.mayCommit!==true||r.status!=='CLEAR_IN_SAME_TRANSACTION')
       throw Error('PF106_ORIGINAL_POSTWRITE_CUSTODY_DENIED:'+
         String(r?.reason||'UNKNOWN'));
     }
    }
    if(a.isPoisoned()!==false)
     throw Error('PF106_ORIGINAL_TRANSACTION_POISONED');
    tx.put(ITEMS,ITEMS,next);
    return Object.freeze({status:'COMMITTED',source:SOURCE,
      changedItemIDs:Object.freeze([...changed].sort((x,y)=>x-y))});
   });
  }catch(e){
   // Throwing inside the GameStore callback rolls the whole stock
   // BEGIN IMMEDIATE transaction back; never retry an ambiguous commit.
   return deny('PF106_ORIGINAL_ATOMIC_ITEM_MUTATION_ABORTED:'+
    String(e?.message||'UNKNOWN'));
  }
 }
 // Only the ORIGINAL inventory owner uses this path; no client or
 // third-party callback can supply a mutable SQLite transaction.
 const execute=params=>run(params);
 const executeOriginalStockRoot=({writer='PLAYER',proposedItems,expectedOriginalRoot}={})=>
  run({writer,proposedItems,expectedOriginalRoot,fromOriginalStockRoot:true});
 return Object.freeze({source:SOURCE,execute,executeOriginalStockRoot});
}
module.exports=Object.freeze({createOriginalForeignItemWriterGateway});
