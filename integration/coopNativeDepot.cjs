"use strict";
// Durable native-hauler custody journal. PREPARED does not credit virtual ore.
// Exactly-once COMMITTED receipts are still NOT station stock or player items.
const fs=require("node:fs"),path=require("node:path");
const positive=v=>Number.isSafeInteger(Number(v))&&Number(v)>0?Number(v):null;
function createDepot({file,clock=()=>Date.now()}){
 if(!file)throw Error("depot file required");
 let state={version:1,receipts:{},totals:{},pending:{}};
 try{
  const saved=JSON.parse(fs.readFileSync(file,"utf8"));
  if(saved?.version!==1||!saved.receipts||!saved.totals ||
     typeof saved.receipts!=="object" ||typeof saved.totals!=="object")throw Error("bad depot state");
  state={...saved,pending:saved.pending||{}};
 }catch(e){if(e.code!=="ENOENT")throw e;}
 function persist(next){
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const tmp=file+".tmp-"+process.pid;
  try{
   const fd=fs.openSync(tmp,'w');
   try{fs.writeFileSync(fd,JSON.stringify(next));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
   fs.renameSync(tmp,file);
   // Directory fsync makes the atomic rename survive host power failure on
   // supported Linux filesystems, not just a Node process crash.
   const dirfd=fs.openSync(path.dirname(file),'r');
   try{fs.fsyncSync(dirfd);}finally{fs.closeSync(dirfd);}
  }catch(e){try{fs.unlinkSync(tmp);}catch(_ignored){}throw e;}
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
  const candidate=normalize({systemID,fleetID,item});
  if(!candidate)return {status:"INVALID"};
  const key=String(candidate.cargoID);
  if(state.receipts[key])return {status:"ALREADY_COMMITTED"};
  if(state.pending[key])return {status:same(state.pending[key],candidate)?"PREPARED":"CONFLICT"};
  persist({...state,pending:{...state.pending,[key]:{...candidate,at:clock()}}});
  return {status:"PREPARED"};
 }
 function commit({systemID,fleetID,item}={}){
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
 // Legacy API retained for old receipts/tests, but new native unload MUST use
 // prepare() -> removeNativeCargo() -> commit() instead.
 function record({systemID,fleetID,deliveries=[]}={}){
  if(!positive(systemID)||!positive(fleetID)||!Array.isArray(deliveries))return {status:"INVALID",accepted:0};
  let accepted=0,quantity=0;
  for(const item of deliveries){
   const candidate=normalize({systemID,fleetID,item,legacy:true});
   if(!candidate||state.receipts[candidate.cargoID]||state.pending[candidate.cargoID])continue;
   const previous=Number(state.totals[String(systemID)]||0);
   if(!Number.isSafeInteger(previous+candidate.quantity))continue;
   persist({...state,receipts:{...state.receipts,
    [candidate.cargoID]:{...candidate,at:clock()}},totals:{...state.totals,
     [String(systemID)]:previous+candidate.quantity}});
   accepted++;quantity+=candidate.quantity;
  }
  return {status:accepted?"RECORDED":"ALREADY_RECORDED",accepted,quantity};
 }
 return {record,prepare,commit,snapshot:()=>structuredClone(state)};
}
let nativeDepot=null;
function getNativeDepot(){
 if(!nativeDepot)nativeDepot=createDepot({
  file:process.env.EVEJS_COOP_DEPOT_FILE||"/var/lib/evejs/coop-native-depot.json"
 });
 return nativeDepot;
}
module.exports={createDepot,getNativeDepot};