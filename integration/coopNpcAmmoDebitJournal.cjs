"use strict";
/**
 * Fail-closed, durable, per-native-module ammo debit fence.
 *
 * One durable PREPARED receipt is written and fsynced BEFORE the existing
 * source-owned nativeNpcStore update. COMMITTED is written only AFTER the
 * caller has re-read and verified the exact native cargo quantity.
 *
 * PREPARED, corrupt state, stale writer lock or uncertain disk result NEVER
 * causes an automatic retry or refund. Operator reconciliation required.
 * This does not make a cross-store missile spawn + ammo debit atomic.
 */
const fs = require("node:fs");
const path = require("node:path");
const positive = v => Number.isSafeInteger(Number(v)) && Number(v)>0 ? Number(v) : null;
const validBoundary = n => typeof n==="number" && Number.isFinite(n) && n>0;
let sequence = 0;
const MAX_TX_BYTES = 8192;
function createAmmoDebitJournal({root,store,clock=()=>Date.now()}={}){
 if(typeof root!=="string"||!path.isAbsolute(root)||root.length<2||
  typeof store?.listNativeCargoForEntity!=="function"||
  typeof store?.getNativeEntity!=="function"||
  typeof clock!=="function")
  throw Error("INVALID_NATIVE_AMMO_JOURNAL_DEPENDENCIES");
 function fileFor(entityID,moduleID){
  return path.join(root,"ships",String(entityID),String(moduleID)+".json");
 }
 function load(file){
  let raw;
  try{raw=fs.readFileSync(file,"utf8");}
  catch(e){if(e.code==="ENOENT")return null;throw e;}
  if(typeof raw!=="string"||raw.length>MAX_TX_BYTES)throw Error("INVALID_JOURNAL_SIZE");
  const value=JSON.parse(raw);
  if(value?.version!==1||!["PREPARED","COMMITTED"].includes(value.phase)||
   !positive(value.entityID)||!positive(value.ownerID)||
   !positive(value.moduleID)||!positive(value.cargoID)||
   !positive(value.typeID)||!validBoundary(value.boundaryMs)||
   !positive(value.beforeQuantity)||!Number.isSafeInteger(value.afterQuantity)||
   value.afterQuantity<0||value.afterQuantity>=value.beforeQuantity||
   typeof value.nonce!=="string"||value.nonce.length>128)
   throw Error("INVALID_JOURNAL_RECORD");
  return value;
 }
 function syncDir(dir){
  const fd=fs.openSync(dir,"r");
  try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 }
 function atomic(file,value){
  const dir=path.dirname(file);
  const tmp=file+".tmp-"+String(process.pid)+"-"+String(++sequence);
  const bytes=JSON.stringify(value);
  if(bytes.length>MAX_TX_BYTES)throw Error("JOURNAL_TOO_LARGE");
  let fd=null;
  try{
   fd=fs.openSync(tmp,"wx",0o600);
   fs.writeFileSync(fd,bytes);
   fs.fsyncSync(fd);
   fs.closeSync(fd);fd=null;
   fs.renameSync(tmp,file);
   syncDir(dir);
  }finally{
   if(fd!==null){try{fs.closeSync(fd);}catch(_){}}
   // Temp files are intentionally left for operator inspection when
   // an I/O fault occurs; the exclusive lock remains as a safety fence.
  }
 }
 function begin({entity,moduleItem,chargeItem,quantity=1,whenMs}={}){
  const entityID=positive(entity?.itemID),moduleID=positive(moduleItem?.itemID),
   cargoID=positive(chargeItem?.itemID),typeID=positive(chargeItem?.typeID),
   ownerID=positive(entity?.ownerID),debit=positive(quantity),
   boundaryMs=Number(whenMs);
  if(!entityID||!moduleID||!cargoID||!typeID||!ownerID||!debit||
   !validBoundary(boundaryMs))
   return {ok:false,status:"NATIVE_AMMO_CYCLE_IDENTITY_INVALID"};
  const beforeQuantity=Number(chargeItem?.quantity ?? chargeItem?.stacksize);
  if(!Number.isSafeInteger(beforeQuantity)||beforeQuantity<debit)
   return {ok:false,status:"NATIVE_AMMO_CYCLE_QUANTITY_INVALID"};
  const file=fileFor(entityID,moduleID),dir=path.dirname(file),
   lock=file+".lock";
  try{
   // A previous unresolved cycle cannot be replayed, regardless of the
   // current live cache. Monotonic boundary stops any older replay too.
   const previous=load(file);
   if(previous&&(previous.entityID!==entityID||
    previous.moduleID!==moduleID))
    return {ok:false,status:"NATIVE_AMMO_JOURNAL_IDENTITY_MISMATCH"};
   if(previous?.phase==="PREPARED")
    return {ok:false,status:"NATIVE_AMMO_CYCLE_NEEDS_RECONCILIATION"};
   if(previous&&boundaryMs<=previous.boundaryMs)
    return {ok:false,status:"NATIVE_AMMO_CYCLE_REPLAY"};
   fs.mkdirSync(dir,{recursive:true});
   const lockFD=fs.openSync(lock,"wx",0o600);
   try{
    fs.writeFileSync(lockFD,JSON.stringify({version:1,entityID,moduleID,
     cargoID,boundaryMs,pid:process.pid,at:clock()}));
    fs.fsyncSync(lockFD);
   }finally{fs.closeSync(lockFD);}
   syncDir(dir);
   // Never delete the lock after an I/O failure, even if preparation
   // appears to have failed. Its presence requires operator inspection.
   const fresh=load(file);
   if(JSON.stringify(fresh)!==JSON.stringify(previous))
    return {ok:false,status:"NATIVE_AMMO_JOURNAL_CHANGED"};
   const record={version:1,phase:"PREPARED",entityID,moduleID,cargoID,
    ownerID,typeID,boundaryMs,beforeQuantity,
    afterQuantity:beforeQuantity-debit,
    nonce:String(process.pid)+":"+String(clock())+":"+String(++sequence)};
   atomic(file,record);
   return {ok:true,status:"PREPARED",token:Object.freeze({
    ...record,file,lock
   })};
  }catch(_){return {ok:false,status:"NATIVE_AMMO_JOURNAL_UNSAFE"};}
 }
 function commit(token){
  const err=status=>({ok:false,status});
  if(!token||token.phase!=="PREPARED"||
   !positive(token.entityID)||!positive(token.moduleID)||
   !positive(token.cargoID)||!validBoundary(token.boundaryMs))
   return err("NATIVE_AMMO_COMMIT_TOKEN_INVALID");
  const file=fileFor(token.entityID,token.moduleID),lock=file+".lock";
  if(token.file!==file||token.lock!==lock)
   return err("NATIVE_AMMO_COMMIT_TOKEN_INVALID");
  try{
   // The claimant must still own the same exclusive writer lock. A
   // missing/replaced lock is never permission to finish a debit.
   const lockOwner=JSON.parse(fs.readFileSync(lock,"utf8"));
   if(lockOwner?.entityID!==token.entityID||
    lockOwner.moduleID!==token.moduleID||
    lockOwner.cargoID!==token.cargoID||
    lockOwner.boundaryMs!==token.boundaryMs||
    lockOwner.pid!==process.pid)
    return err("NATIVE_AMMO_COMMIT_LOCK_LOST");
   const record=load(file);
   if(!record||record.phase!=="PREPARED"||
    record.nonce!==token.nonce||
    record.entityID!==token.entityID||
    record.moduleID!==token.moduleID||
    record.cargoID!==token.cargoID||
    record.beforeQuantity!==token.beforeQuantity||
    record.afterQuantity!==token.afterQuantity||
    record.boundaryMs!==token.boundaryMs)
    return err("NATIVE_AMMO_COMMIT_JOURNAL_MISMATCH");
   // The caller has already verified this after the native cargo write.
   // Check it again here so the journal cannot settle without a matching
   // persisted native state.
   const owner=store.getNativeEntity(record.entityID);
   if(Number(owner?.ownerID)!==record.ownerID)
    return err("NATIVE_AMMO_COMMIT_SHIP_CHANGED");
   const rows=store.listNativeCargoForEntity(record.entityID).filter(c=>
    Number(c?.cargoID)===record.cargoID);
   if(record.afterQuantity>0){
    if(rows.length!==1||Number(rows[0].quantity)!==record.afterQuantity||
     Number(rows[0].entityID)!==record.entityID||
     Number(rows[0].ownerID)!==record.ownerID||
     Number(rows[0].moduleID)!==record.moduleID||
     Number(rows[0].typeID)!==record.typeID)
     return err("NATIVE_AMMO_COMMIT_STOCK_MISMATCH");
   }else if(rows.length!==0)
    return err("NATIVE_AMMO_COMMIT_STOCK_MISMATCH");
   atomic(file,{...record,phase:"COMMITTED"});
   // The durable cycle receipt stays; only the exclusive writer lock is
   // cleared after the committed file + parent directory have been fsynced.
   fs.unlinkSync(lock);
   syncDir(path.dirname(file));
   return {ok:true,status:"NATIVE_AMMO_DEBIT_COMMITTED",
    entityID:record.entityID,moduleID:record.moduleID,
    cargoID:record.cargoID,boundaryMs:record.boundaryMs};
  }catch(_){return err("NATIVE_AMMO_COMMIT_UNSAFE");}
 }
 function inspect({entityID,moduleID}={}){
  const e=positive(entityID),m=positive(moduleID);
  if(!e||!m)return {status:"INVALID"};
  const file=fileFor(e,m);
  try{
   const state=load(file),lockExists=fs.existsSync(file+".lock");
   return {status:lockExists?"LOCKED_RECONCILE":
    state?.phase==="PREPARED"?"PREPARED_RECONCILE":
    state?.phase==="COMMITTED"?"COMMITTED":"EMPTY",
    state,lockExists};
  }catch(_){return {status:"CORRUPT_RECONCILE"};}
 }
 return {begin,commit,inspect};
}
let defaultJournal=null,defaultRoot=null;
function active(){
 const root=process.env.EVEJS_COOP_NPC_AMMO_DEBIT_ROOT||
  "/var/lib/evejs/coop-npc-ammo-debits";
 if(!defaultJournal||defaultRoot!==root){
  defaultJournal=createAmmoDebitJournal({
   root,store:require("./npc/nativeNpcStore")
  });defaultRoot=root;
 }
 return defaultJournal;
}
function begin(args){
 if(process.env.EVEJS_COOP_NPC_STRICT_AMMO!=="1"||
  process.env.EVEJS_COOP_NPC_AMMO_DURABLE_CYCLE!=="1")
  return {ok:true,status:"OFF",token:null};
 try{return active().begin(args);}
 catch(_){return {ok:false,status:"NATIVE_AMMO_JOURNAL_UNSAFE"};}
}
function commit(token){
 if(!token)return {ok:true,status:"OFF"};
 try{return active().commit(token);}
 catch(_){return {ok:false,status:"NATIVE_AMMO_COMMIT_UNSAFE"};}
}
module.exports={createAmmoDebitJournal,begin,commit};
