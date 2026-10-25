"use strict";
// Fail-closed guard for native wreck items whose grant succeeded but whose
// source deletion/decrement did NOT persist. Never mutates EveJS inventory,
// wreck records, character items, or ship state.
const fs=require("node:fs"),path=require("node:path");
const positive=n=>Number.isSafeInteger(Number(n))&&Number(n)>0?Number(n):null;
const reasons=new Set(["NATIVE_LOOT_SOURCE_NOT_REMOVED","NATIVE_LOOT_SOURCE_NOT_DECREMENTED"]);
function createGuard({file,storage=fs,clock=()=>Date.now()}={}){
 if(typeof file!=="string"||!file||typeof storage.readFileSync!=="function"||
  typeof clock!=="function")throw Error("invalid native loot quarantine store");
 const local=new Set();
 let hardBlocked=false;
 const key=(w,i)=>String(w)+":"+String(i);
 function read(){
  let value;
  try{value=storage.readFileSync(file,"utf8");}
  catch(error){if(error?.code==="ENOENT")return {version:1,entries:{}};throw error;}
  const state=JSON.parse(value);
  if(state?.version!==1||!state.entries||typeof state.entries!=="object"||
   Array.isArray(state.entries))throw Error("INVALID_LOOT_QUARANTINE_FILE");
  for(const [id,row] of Object.entries(state.entries)){
   if(!positive(row?.wreckID)||!positive(row?.wreckItemID)||
    !reasons.has(row.reason)||key(row.wreckID,row.wreckItemID)!==id)
    throw Error("INVALID_LOOT_QUARANTINE_ENTRY");
  }
  return state;
 }
 function check({wreckID,wreckItemID}={}){
  const w=positive(wreckID),i=positive(wreckItemID);
  if(!w||!i)return {status:"INVALID"};
  if(hardBlocked)return {status:"QUARANTINE_STORAGE_UNSAFE"};
  const id=key(w,i);
  if(local.has(id))return {status:"QUARANTINED",wreckID:w,wreckItemID:i};
  try{
   const state=read();
   if(Object.prototype.hasOwnProperty.call(state.entries,id)){
    local.add(id);
    return {status:"QUARANTINED",wreckID:w,wreckItemID:i,
     reason:state.entries[id].reason};
   }
   return {status:"ALLOW"};
  }catch(error){
   hardBlocked=true;
   return {status:"QUARANTINE_STORAGE_UNSAFE",
    reason:String(error.message).slice(0,120)};
  }
 }
 function quarantine({wreckID,wreckItemID,reason}={}){
  const w=positive(wreckID),i=positive(wreckItemID);
  if(!w||!i||!reasons.has(reason))return {status:"INVALID"};
  const id=key(w,i);
  // In-process blocking is immediate even if the durable write fails.
  local.add(id);
  if(hardBlocked)return {status:"QUARANTINE_STORAGE_UNSAFE"};
  try{
   const state=read();
   if(!Object.prototype.hasOwnProperty.call(state.entries,id)){
    const when=Number(clock());
    if(!Number.isFinite(when))throw Error("INVALID_QUARANTINE_CLOCK");
    state.entries[id]={wreckID:w,wreckItemID:i,reason,createdAt:when};
    storage.mkdirSync(path.dirname(file),{recursive:true});
    const tmp=file+".tmp-"+process.pid;
    // An existing temp file may indicate an interrupted write; never
    // overwrite it silently. Block loot and require operator inspection.
    storage.writeFileSync(tmp,JSON.stringify(state),{flag:"wx"});
    try{storage.renameSync(tmp,file);}
    catch(error){
     try{storage.unlinkSync(tmp);}catch(_ignored){}
     throw error;
    }
   }
   return {status:"QUARANTINED",wreckID:w,wreckItemID:i};
  }catch(error){
   hardBlocked=true;
   return {status:"QUARANTINE_STORAGE_UNSAFE",
    reason:String(error.message).slice(0,120)};
  }
 }
 return {check,quarantine};
}
let singleton=null,filename=null;
function guard(){
 const file=process.env.EVEJS_COOP_NATIVE_LOOT_QUARANTINE_FILE||
  "/var/lib/evejs/coop-native-loot-quarantine.json";
 if(!singleton||filename!==file){singleton=createGuard({file});filename=file;}
 return singleton;
}
function check(request){
 if(process.env.EVEJS_COOP_NATIVE_LOOT_QUARANTINE!=="1")return {status:"ALLOW"};
 return guard().check(request);
}
function quarantine(request){
 if(process.env.EVEJS_COOP_NATIVE_LOOT_QUARANTINE!=="1")return {status:"DISABLED"};
 return guard().quarantine(request);
}
module.exports={createGuard,check,quarantine};
