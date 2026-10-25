"use strict";
// COOP-030: real NPC cargo -> persistent native EveJS itemStore station item.
// Intentionally NOT connected to the timer-driven mining fleet 'haulereturn'.
// A trusted caller must supply authoritative physical station arrival evidence.
const fs = require("node:fs");
const path = require("node:path");
const pos = v => Number.isSafeInteger(Number(v)) && Number(v) > 0 ? Number(v) : 0;
const marker = cargoID => `coop-warehouse:v1:cargo:${cargoID}`;
const copy = value => JSON.parse(JSON.stringify(value));
const statuses = Object.freeze({PREPARED:"PREPARED", DEBIT:"SOURCE_DEBIT_PROVEN", CREDIT:"TARGET_CREDIT_PROVEN", COMMITTED:"COMMITTED"});

function createWarehouse({root, store, items, flush, getStation, getCorporation, isNpcCorporation, verifyArrival, verifyDurableCargo, clock=()=>Date.now(), fsApi=fs}={}) {
 if(!root || !path.isAbsolute(root) || !store || !items || typeof flush!=="function" ||
    typeof getStation!=="function" || typeof getCorporation!=="function" ||
    typeof isNpcCorporation!=="function" || typeof verifyArrival!=="function" ||
    typeof verifyDurableCargo!=="function" ||
    !["listNativeCargoForEntity","removeNativeCargo"].every(x=>typeof store[x]==="function") ||
    !["findWarehouseItem","grantUniqueNpcDepotItem"].every(x=>typeof items[x]==="function"))
  throw Error("WAREHOUSE_DEPENDENCIES_REQUIRED");
 const dir=path.join(root,"receipts"),busy=new Set();
 const receiptPath=id=>path.join(dir,`${id}.json`);
 function syncDir(location){
  // Best effort on platforms where directory fsync is unsupported. File fsync
  // is compulsory; a failed file fsync is never reported as durable.
  try { const fd=fsApi.openSync(location,"r");try{fsApi.fsyncSync(fd);}finally{fsApi.closeSync(fd);} }
  catch(e){if(!["EINVAL","ENOTSUP","EISDIR","EPERM","EACCES"].includes(e.code))throw e;}
 }
 function persist(id,record){
  fsApi.mkdirSync(dir,{recursive:true});
  const file=receiptPath(id),temp=file+`.tmp-${process.pid}-${Math.floor(Math.random()*1e9)}`;
  let fd;
  try{
   fd=fsApi.openSync(temp,"wx",0o600);
   fsApi.writeFileSync(fd,JSON.stringify(record));fsApi.fsyncSync(fd);fsApi.closeSync(fd);fd=null;
   fsApi.renameSync(temp,file);syncDir(dir);
  }catch(e){if(fd!==undefined&&fd!==null)try{fsApi.closeSync(fd);}catch(_){}
   try{fsApi.unlinkSync(temp);}catch(_){}throw e;}
 }
 function load(id){
  let row;try{row=JSON.parse(fsApi.readFileSync(receiptPath(id),"utf8"));}
  catch(e){if(e.code==="ENOENT")return null;throw Error("WAREHOUSE_JOURNAL_UNREADABLE");}
  if(!row||row.version!==1||row.cargoID!==id||!Object.values(statuses).includes(row.phase)||
     !pos(row.typeID)||!pos(row.quantity)||!pos(row.haulerID)||!pos(row.stationID)||!pos(row.corporationID))
   throw Error("WAREHOUSE_JOURNAL_INVALID");
  return row;
 }
 function findCargo(record){
  return (store.listNativeCargoForEntity(record.haulerID)||[]).find(x=>Number(x.cargoID)===record.cargoID)||null;
 }
 function validateOwner(record){
  const corp=getCorporation(record.corporationID);
  const station=getStation(record.stationID);
  return Boolean(corp&&Number(corp.corporationID)===record.corporationID&&
    isNpcCorporation(record.corporationID)===true&&station&&
    Number(station.stationID)===record.stationID&&
    Number(station.solarSystemID)===record.systemID);
 }
 function checkTarget(record){
  const result=items.findWarehouseItem({ownerID:record.corporationID,stationID:record.stationID,
    cargoID:record.cargoID});
  if(result&&(!pos(result.itemID)||Number(result.typeID)!==record.typeID||
     Number(result.quantity)!==record.quantity||Number(result.ownerID)!==record.corporationID||
     Number(result.locationID)!==record.stationID||String(result.customInfo)!==marker(record.cargoID)))
   throw Error("WAREHOUSE_TARGET_IDENTITY_CONFLICT");
  return result||null;
 }
 const answer=(status,record=null,extra={})=>({status,cargoID:record?.cargoID||0,...extra});
 function commitCredit(record){
  if(!validateOwner(record))return answer("OWNER_OR_STATION_MISSING",record);
  if(findCargo(record))return answer("SOURCE_STILL_PRESENT",record);
  let target=checkTarget(record);
  if(!target){
   // This is the only item-creation path. It creates an isolated, tagged
   // native stack: stock EveJS grants would merge into existing stacks.
   const result=items.grantUniqueNpcDepotItem({ownerID:record.corporationID,
    stationID:record.stationID,typeID:record.typeID,quantity:record.quantity,cargoID:record.cargoID});
   if(!result?.success)return answer("TARGET_WRITE_UNCERTAIN",record);
  }
  const f=flush("items");
  if(!f?.success)return answer("TARGET_FLUSH_UNCERTAIN",record);
  target=checkTarget(record);
  if(!target)return answer("TARGET_NOT_VERIFIED",record);
  record={...record,phase:statuses.CREDIT,itemID:target.itemID,updatedAt:clock()};persist(record.cargoID,record);
  record={...record,phase:statuses.COMMITTED,updatedAt:clock()};persist(record.cargoID,record);
  return answer("COMMITTED",record,{itemID:record.itemID,quantity:record.quantity});
 }
 function deposit({cargoID,haulerID,fleetID,systemID,stationID,corporationID}={}){
  const id=pos(cargoID),args={cargoID:id,haulerID:pos(haulerID),fleetID:pos(fleetID),
   systemID:pos(systemID),stationID:pos(stationID),corporationID:pos(corporationID)};
  if(Object.values(args).some(v=>!v))return answer("INVALID_REQUEST");
  if(busy.has(id))return answer("IN_PROGRESS");
  busy.add(id);
  try{
   let record=load(id);
   if(record){
    if(Object.keys(args).some(k=>args[k]!==record[k]))return answer("RECEIPT_IDENTITY_CONFLICT",record);
    if(record.phase===statuses.COMMITTED){
     const target=checkTarget(record);
     return target&&Number(target.itemID)===record.itemID&&!findCargo(record)?answer("ALREADY_COMMITTED",record,{itemID:target.itemID}):answer("COMMITTED_STATE_INVALID",record);
    }
    // No automatic credit for PREPARED; the source may have disappeared
    // due to destruction before its debit was proven.
    return answer("PENDING_RECONCILIATION",record,{phase:record.phase});
   }
   if(!validateOwner(args))return answer("OWNER_OR_STATION_MISSING");
   if(verifyArrival(args)!==true)return answer("ARRIVAL_NOT_VERIFIED");
   const cargo=(store.listNativeCargoForEntity(args.haulerID)||[]).find(x=>Number(x.cargoID)===id);
   if(!cargo||Number(cargo.entityID)!==args.haulerID||!pos(cargo.typeID)||!pos(cargo.quantity)||
      Number(cargo.moduleID||0)!==0||Number(cargo.coopHaulFleetID)!==args.fleetID||
      !pos(cargo.coopHaulFromMinerID))return answer("CARGO_NOT_PROVEN");
   if(verifyDurableCargo(cargo,args)!==true)return answer("CARGO_NOT_DURABLE");
   record={version:1,...args,typeID:Number(cargo.typeID),quantity:Number(cargo.quantity),
    phase:statuses.PREPARED,at:clock(),updatedAt:clock()};
   persist(id,record); // Durably prepared before source mutation.
   const removed=store.removeNativeCargo(id);
   if(!removed?.success)return answer("SOURCE_DEBIT_UNCERTAIN",record);
   const f=flush("npcCargo");
   if(!f?.success)return answer("SOURCE_FLUSH_UNCERTAIN",record);
   if(findCargo(record))return answer("SOURCE_STILL_PRESENT",record);
   record={...record,phase:statuses.DEBIT,updatedAt:clock()};persist(id,record);
   return commitCredit(record);
  }catch(e){return answer("NEEDS_OPERATOR_REPAIR",{cargoID:id},{reason:String(e.message).slice(0,95)});}
  finally{busy.delete(id);}
 }
 function resume(cargoID,{authorize=false}={}){
  const id=pos(cargoID);if(!id||!authorize)return answer("REPAIR_AUTHORIZATION_REQUIRED");
  if(busy.has(id))return answer("IN_PROGRESS");busy.add(id);
  try{
   const record=load(id);if(!record)return answer("RECEIPT_NOT_FOUND");
   if(record.phase===statuses.COMMITTED){const t=checkTarget(record);return t&&!findCargo(record)?answer("ALREADY_COMMITTED",record):answer("COMMITTED_STATE_INVALID",record);}
   if(record.phase===statuses.PREPARED)return answer(findCargo(record)?"PREPARED_SOURCE_PRESENT":"PREPARED_SOURCE_UNKNOWN",record);
   if(record.phase===statuses.DEBIT)return commitCredit(record);
   if(record.phase===statuses.CREDIT){
    const t=checkTarget(record);
    if(!t||findCargo(record)||Number(t.itemID)!==record.itemID)return answer("TARGET_RECONCILIATION_REQUIRED",record);
    if(!flush("items")?.success)return answer("TARGET_FLUSH_UNCERTAIN",record);
    const committed={...record,phase:statuses.COMMITTED,updatedAt:clock()};persist(id,committed);
    return answer("COMMITTED",committed,{itemID:t.itemID});
   }
   return answer("NEEDS_OPERATOR_REPAIR",record);
  }catch(e){return answer("NEEDS_OPERATOR_REPAIR",{cargoID:id},{reason:String(e.message).slice(0,95)});}
  finally{busy.delete(id);}
 }
 function audit(){
  let files;try{files=fsApi.readdirSync(dir).filter(x=>/^\d+\.json$/.test(x));}
  catch(e){if(e.code==="ENOENT")return {status:"EMPTY",committed:0,pending:0,problems:[]};throw e;}
  let committed=0,pending=0;const problems=[];
  for(const file of files){const id=Number(file.slice(0,-5));try{
   const row=load(id),target=checkTarget(row),source=findCargo(row);
   if(row.phase===statuses.COMMITTED){if(!target||source||Number(target.itemID)!==row.itemID)problems.push({cargoID:id,reason:"COMMITTED_MISMATCH"});else committed++;}
   else{pending++;problems.push({cargoID:id,reason:row.phase+(source?"_SOURCE_PRESENT":"_SOURCE_ABSENT")});}
  }catch(e){problems.push({cargoID:id,reason:String(e.message).slice(0,95)});}}
  return {status:problems.length?"NEEDS_RECONCILIATION":"OK",committed,pending,problems};
 }
 return {deposit,resume,audit,marker};
}
module.exports={createWarehouse,marker};