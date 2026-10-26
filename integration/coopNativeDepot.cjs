"use strict";
// Durable native-hauler custody journal. PREPARED does not credit virtual ore.
// Exactly-once COMMITTED receipts are still NOT station stock or player items.
const fs=require("node:fs"),path=require("node:path");
const positive=v=>Number.isSafeInteger(Number(v))&&Number(v)>0?Number(v):null;
function createDepot({file,clock=()=>Date.now(),fsApi=fs}){
 if(!file)throw Error("depot file required");
 let state={version:1,receipts:{},totals:{},pending:{}};
 // After an uncertain rename/directory fsync the in-memory state may be
 // OLDER than the just-replaced disk journal. No further write may use it.
 let persistenceUnverified=false;
 // Damaged loaded journals cannot be amended or presented as valid supply.
 let stateUnreconciled=false;
 try{
  const saved=JSON.parse(fsApi.readFileSync(file,"utf8"));
  if(saved?.version!==1||!saved.receipts||!saved.totals||
     typeof saved.receipts!=="object"||Array.isArray(saved.receipts)||
     typeof saved.totals!=="object"||Array.isArray(saved.totals)||
     (saved.pending!=null&&(typeof saved.pending!=="object"||Array.isArray(saved.pending))))
   throw Error("bad depot state");
  state={...saved,pending:saved.pending||{}};
 }catch(e){if(e.code!=="ENOENT")throw e;}
 function persist(next){
  if(persistenceUnverified)throw Error("DEPOT_PERSISTENCE_UNVERIFIED");
  const tmp=file+".tmp-"+process.pid;
  try{
   fsApi.mkdirSync(path.dirname(file),{recursive:true});
   const fd=fsApi.openSync(tmp,'w');
   try{fsApi.writeFileSync(fd,JSON.stringify(next));fsApi.fsyncSync(fd);}finally{fsApi.closeSync(fd);}
   fsApi.renameSync(tmp,file);
   // Directory fsync makes the atomic rename survive host power failure on
   // supported (POSIX) filesystems only. Windows refuses to fsync a directory
   // handle with EPERM/EACCES, so that single step stays best-effort instead
   // of making every depot write fail on a developer machine or on NTFS.
   try{
    const dirfd=fsApi.openSync(path.dirname(file),'r');
    try{fsApi.fsyncSync(dirfd);}finally{fsApi.closeSync(dirfd);}
   }catch(error){
    if(!["EPERM","EACCES","EISDIR","EINVAL","EBADF"].includes(error?.code))throw error;
   }
  }catch(e){
   // The rename may already have changed on-disk receipts/totals. Treat
   // ALL write failures as ambiguous instead of overwriting the new disk
   // image with older in-memory state on the next prepare/commit.
   persistenceUnverified=true;
   try{fsApi.unlinkSync(tmp);}catch(_ignored){}
   throw e;
  }
  state=next;
 }
 const normalize=({systemID,fleetID,item,legacy=false}={})=>{
  const cargoID=positive(item?.cargoID),typeID=positive(item?.typeID),
    quantity=Number(item?.quantity),haulerID=positive(item?.haulerID);
  if(!positive(systemID)||!positive(fleetID)||!cargoID||!typeID||!haulerID||
     (!legacy&&!haulerID)||!Number.isSafeInteger(quantity)||quantity<=0)return null;
  return {cargoID,typeID,quantity,haulerID:haulerID||null,systemID:Number(systemID),fleetID:Number(fleetID)};
 };
 const same=(a,b)=>a&&b&&a.cargoID===b.cargoID&&a.typeID===b.typeID&&
   a.quantity===b.quantity&&a.haulerID===b.haulerID&&
   a.systemID===b.systemID&&a.fleetID===b.fleetID;
 function prepare({systemID,fleetID,item}={}){
  if(persistenceUnverified)return {status:"DEPOT_PERSISTENCE_UNVERIFIED"};
  if(stateUnreconciled)return {status:"DEPOT_STATE_UNRECONCILED"};
  const candidate=normalize({systemID,fleetID,item});
  if(!candidate)return {status:"INVALID"};
  const key=String(candidate.cargoID);
  if(state.receipts[key])return {status:"ALREADY_COMMITTED"};
  if(state.pending[key])return {status:same(state.pending[key],candidate)?"PREPARED":"CONFLICT"};
  persist({...state,pending:{...state.pending,[key]:{...candidate,at:clock()}}});
  return {status:"PREPARED"};
 }
 function commit({systemID,fleetID,item}={}){
  if(persistenceUnverified)return {status:"DEPOT_PERSISTENCE_UNVERIFIED"};
  if(stateUnreconciled)return {status:"DEPOT_STATE_UNRECONCILED"};
  const candidate=normalize({systemID,fleetID,item});
  if(!candidate)return {status:"INVALID"};
  const key=String(candidate.cargoID);
  if(state.receipts[key])return {status:"ALREADY_COMMITTED"};
  if(!same(state.pending[key],candidate))return {status:"NOT_PREPARED_OR_MISMATCH"};
  const previous=Number(state.totals[String(systemID)]||0);
  if(!Number.isSafeInteger(previous)||previous<0||
     !Number.isSafeInteger(previous+candidate.quantity))return {status:"TOTAL_OVERFLOW"};
  const pending={...state.pending};delete pending[key];
  persist({...state,pending,receipts:{...state.receipts,
    [key]:{...candidate,at:clock()}},totals:{...state.totals,
     [String(systemID)]:previous+candidate.quantity}});
  return {status:"COMMITTED",quantity:candidate.quantity};
 }
 // Legacy direct credits are deliberately disabled: the old API was able to
 // invent virtual ore without a witnessed removal from native hauler cargo.
 function record(){return {status:'UNVERIFIED_DIRECT_CREDIT_DISABLED',accepted:0,quantity:0};}
 function audit(){
  if(persistenceUnverified)return {status:"NEEDS_OPERATOR_REPAIR",
   reason:"DEPOT_PERSISTENCE_UNVERIFIED",committed:0,unresolved:0,invalid:1,
   bySystemType:{},totals:{}};
  // Derive physical input quantities from immutable committed cargo receipts.
  // Never use synthetic system totals as the source of item/type provenance.
  const bySystemType={},derived={};
  let invalid=0,committed=0;
  for(const [key,entry] of Object.entries(state.receipts)){
   // Numeric aliases such as "000777", "7e2" or "+777" can point to
   // the same original cargoID as canonical "777". An audit must NEVER
   // certify multiple receipts for the same physical source item.
   if(!positive(key)||key!==String(Number(key))||
      Number(key)!==Number(entry?.cargoID)||
      !positive(entry?.systemID)||!positive(entry?.fleetID)||
      !positive(entry?.haulerID)||!positive(entry?.typeID)||
      !Number.isSafeInteger(Number(entry?.quantity))||
      Number(entry.quantity)<=0||state.pending[key]){invalid++;continue;}
   const system=String(entry.systemID),type=String(entry.typeID),amount=Number(entry.quantity);
   bySystemType[system]??={};
   const previous=Number(bySystemType[system][type]||0);
   const total=Number(derived[system]||0);
   if(!Number.isSafeInteger(previous+amount)||!Number.isSafeInteger(total+amount)){invalid++;continue;}
   bySystemType[system][type]=previous+amount;
   derived[system]=total+amount;
   committed++;
  }
  const keys=new Set([...Object.keys(derived),...Object.keys(state.totals)]);
  for(const key of keys){
   if(!positive(key)||Number(derived[key]||0)!==Number(state.totals[key]||0))invalid++;
  }
  const unresolved=Object.keys(state.pending).length;
  for(const [key,entry] of Object.entries(state.pending)){
   // Pending may be legitimate source debits, but a malformed or aliased
   // key is NOT proof the receipt is unique and safe to finalize.
   if(!positive(key)||key!==String(Number(key))||
      Number(key)!==Number(entry?.cargoID)||
      !positive(entry?.systemID)||!positive(entry?.fleetID)||
      !positive(entry?.haulerID)||!positive(entry?.typeID)||
      !Number.isSafeInteger(Number(entry?.quantity))||
      Number(entry.quantity)<=0||state.receipts[key])invalid++;
  }
  return {status:invalid?'NEEDS_OPERATOR_REPAIR':unresolved?'PENDING_CUSTODY_RECONCILIATION':'OK',
   committed,unresolved,invalid,bySystemType,totals:derived};
 }
 // A pending-but-well-formed source debit is legitimate and may resume.
 // Any invalid receipt/totals/pending index freezes new writes instead.
 if(audit().invalid!==0)stateUnreconciled=true;
 return {record,prepare,commit,audit,snapshot:()=>{
  if(persistenceUnverified)throw Error("DEPOT_PERSISTENCE_UNVERIFIED");
  if(stateUnreconciled)throw Error("DEPOT_STATE_UNRECONCILED");
  return structuredClone(state);
 }};
}
let nativeDepot=null;
function getNativeDepot(){
 if(!nativeDepot)nativeDepot=createDepot({
  file:process.env.EVEJS_COOP_DEPOT_FILE||"/var/lib/evejs/coop-native-depot.json"
 });
 return nativeDepot;
}
module.exports={createDepot,getNativeDepot};