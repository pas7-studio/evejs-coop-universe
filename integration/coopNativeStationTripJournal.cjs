"use strict";
// ALIFE-12: original NPC station route recovery from an immutable original
// cargo manifest AND a separately fsynced native warp-ACK witness.
// No warp, cargo mutation, itemStore grants or ISK operations are permitted.
const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto");
const pos=x=>Number.isSafeInteger(Number(x))&&Number(x)>0?Number(x):0;
const exact=x=>typeof x==="number"&&Number.isSafeInteger(x)&&x>0;
const hash=x=>crypto.createHash("sha256").update(JSON.stringify(x)).digest("hex");
const marker=id=>"coop-warehouse:v1:cargo:"+id;
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const fail=(reason,extra={})=>({status:"NEEDS_OPERATOR_REPAIR",reason,...extra});
function createJournal({root,manifest,store,items,getNativeEntity,io=fs,clock=()=>Date.now()}={}){
 if(typeof root!=="string"||!path.isAbsolute(root)||!manifest||
    typeof manifest.read!=="function"||
    !store||typeof store.listNativeCargoForEntity!=="function"||
    !items||typeof items.findWarehouseItem!=="function"||
    typeof getNativeEntity!=="function")throw Error("ALIFE12_AUTHORITIES_REQUIRED");
 const dir=path.join(root,"trip-departure-acks");
 const manifestDir=path.join(root,"trip-manifests");
 const receiptDir=path.join(root,"receipts");
 const keyPattern=/^([1-9]\d*)-([1-9]\d*)-([1-9]\d*)$/;
 const copy=x=>JSON.parse(JSON.stringify(x));
 const readJSON=(file)=>{
  let data;
  try{data=io.readFileSync(file,"utf8")}
  catch(error){if(error.code==="ENOENT")return null;throw error}
  if(typeof data!=="string"||Buffer.byteLength(data)>256*1024)
   throw Error("ALIFE12_DURABLE_RECORD_SIZE_INVALID");
  return JSON.parse(data);
 };
 const listing=location=>{
  try{
   const values=io.readdirSync(location);
   if(!Array.isArray(values)||values.length>5000)
    throw Error("ALIFE12_DIRECTORY_TOO_LARGE");
   return values.filter(x=>typeof x==="string"&&x.endsWith(".json"));
  }catch(e){if(e.code==="ENOENT")return[];throw e}
 };
 function sourceRecord(key){
  const m=manifest.read(key);
  if(m?.status!=="READY"||m.record?.key!==key||
     !keyPattern.test(key))throw Error("ALIFE12_SOURCE_MANIFEST_UNVERIFIED");
  return m.record;
 }
 function writeAck(key,record){
  io.mkdirSync(dir,{recursive:true});
  const file=path.join(dir,key+".json"),fd=io.openSync(file,"wx",0o600);
  try{io.writeFileSync(fd,JSON.stringify(record));io.fsyncSync(fd)}
  finally{io.closeSync(fd)}
  // Immutable manifest's fsync contract requires a directory sync as well.
  let d;
  try{d=io.openSync(dir,"r");io.fsyncSync(d)}
  finally{if(d!==undefined)io.closeSync(d)}
 }
 function confirm({manifestKey,systemID,fleetID,stationID,corporationID,
                   haulerIDs,cargoIDs,startedAt}={}){
  try{
   const key=String(manifestKey||""),m=sourceRecord(key);
   if(!exact(systemID)||!exact(fleetID)||!exact(stationID)||!exact(corporationID)||
      !exact(startedAt)||m.systemID!==systemID||m.fleetID!==fleetID||
      m.stationID!==stationID||m.corporationID!==corporationID||
      m.startedAt!==startedAt||
      !Array.isArray(haulerIDs)||!Array.isArray(cargoIDs)||
      !equal(haulerIDs.slice().sort((a,b)=>a-b),m.haulerIDs)||
      !equal(cargoIDs.slice().sort((a,b)=>a-b),m.cargo.map(x=>x.cargoID).sort((a,b)=>a-b)))
    return fail("ALIFE12_DEPARTURE_MANIFEST_IDENTITY_CONFLICT");
   const ack={version:1,status:"WARP_ACK_CONFIRMED",manifestKey:key,systemID,
    fleetID,stationID,corporationID,startedAt,
    haulerIDs:m.haulerIDs.slice(),cargoIDs:m.cargo.map(x=>x.cargoID),
    manifestHash:hash(m),confirmedAt:Number(clock())};
   if(!exact(ack.confirmedAt))return fail("ALIFE12_CONFIRMATION_TIME_UNVERIFIED");
   const prior=readJSON(path.join(dir,key+".json"));
   if(prior)return equal(prior,ack)?{status:"ALREADY_CONFIRMED",manifestKey:key}:
    fail("ALIFE12_ACK_ALREADY_EXISTS_OR_CHANGED");
   writeAck(key,ack);
   const verified=readJSON(path.join(dir,key+".json"));
   if(!equal(ack,verified))return fail("ALIFE12_ACK_READBACK_MISMATCH");
   return {status:"DURABLE_DEPARTURE_CONFIRMED",manifestKey:key};
  }catch(error){return fail("ALIFE12_ACK_WRITE_OUTCOME_UNKNOWN",{
   details:String(error?.message||error).slice(0,120)})}
 }
 function receiptMatches(row,m){
  const r=readJSON(path.join(receiptDir,row.cargoID+".json"));
  if(!r||r.version!==1||r.phase!=="COMMITTED"||
     r.cargoID!==row.cargoID||r.haulerID!==row.haulerID||
     r.typeID!==row.typeID||r.quantity!==row.quantity||
     r.systemID!==m.systemID||r.fleetID!==m.fleetID||
     r.stationID!==m.stationID||r.corporationID!==m.corporationID||
     !pos(r.itemID))return false;
  const item=items.findWarehouseItem({
   ownerID:m.corporationID,stationID:m.stationID,cargoID:row.cargoID});
  return Boolean(item&&item.itemID===r.itemID&&item.typeID===row.typeID&&
   item.quantity===row.quantity&&item.ownerID===m.corporationID&&
   item.locationID===m.stationID&&String(item.customInfo)===marker(row.cargoID));
 }
 function recover({systemID,fleetID,haulerIDs}={}){
  if(!exact(systemID)||!exact(fleetID)||!Array.isArray(haulerIDs)||
     !haulerIDs.length||haulerIDs.length>32||
     haulerIDs.some(x=>!exact(x))||
     new Set(haulerIDs).size!==haulerIDs.length)
   return fail("ALIFE12_FLEET_IDENTITY_INVALID");
  const sorted=haulerIDs.slice().sort((a,b)=>a-b);
  try{
   const ships=new Map();
   for(const id of sorted){
    const native=getNativeEntity(id);
    if(!native||Number(native.entityID||native.itemID)!==id||
       Number(native.systemID)!==systemID||native.transient===true)
     return fail("ALIFE12_HAULER_NATIVE_NOT_DURABLE");
    const cargo=store.listNativeCargoForEntity(id);
    if(!Array.isArray(cargo)||cargo.length>1000)
     return fail("ALIFE12_CARGO_UNAVAILABLE");
    ships.set(id,cargo);
   }
   const prefix=systemID+"-"+fleetID+"-";
   const names=listing(manifestDir).filter(x=>x.startsWith(prefix));
   let pending=null;
   for(const name of names){
    const key=name.slice(0,-5);
    if(!keyPattern.test(key))return fail("ALIFE12_MANIFEST_FILENAME_INVALID");
    const m=sourceRecord(key);
    if(m.systemID!==systemID||m.fleetID!==fleetID||
       !equal(m.haulerIDs,sorted))return fail("ALIFE12_MANIFEST_FLEET_CONFLICT");
    let active=0;
    const declared=new Set(m.cargo.map(x=>x.cargoID));
    for(const [id,rows] of ships){
     if(rows.some(row=>Number(row.coopHaulFleetID)===fleetID&&
        !declared.has(Number(row.cargoID))))
      return fail("ALIFE12_UNDECLARED_HAUL_CARGO");
    }
    for(const row of m.cargo){
     const rows=ships.get(row.haulerID)||[];
     const hits=rows.filter(x=>Number(x.cargoID)===row.cargoID);
     if(hits.length>1)return fail("ALIFE12_DUPLICATE_ORIGINAL_CARGO");
     if(hits.length===1){
      const c=hits[0];
      if(c.entityID!==row.haulerID||c.coopHaulFleetID!==fleetID||
         c.coopHaulFromMinerID!==row.fromMinerID||
         c.typeID!==row.typeID||c.quantity!==row.quantity||
         Number(c.moduleID||0)!==0||c.transient===true)
       return fail("ALIFE12_SOURCE_CARGO_CHANGED");
      active++;
     }else if(!receiptMatches(row,m))
      return fail("ALIFE12_SOURCE_MISSING_WITHOUT_WAREHOUSE_PROOF");
    }
    // A completed manifest is historical, not a new route to replay.
    if(active===0)continue;
    const ack=readJSON(path.join(dir,key+".json"));
    if(!ack)return fail("ALIFE12_PREPARED_BUT_WARP_UNCONFIRMED");
    if(ack.version!==1||ack.status!=="WARP_ACK_CONFIRMED"||
       ack.manifestKey!==key||ack.manifestHash!==hash(m)||
       ack.systemID!==systemID||ack.fleetID!==fleetID||
       ack.stationID!==m.stationID||ack.corporationID!==m.corporationID||
       ack.startedAt!==m.startedAt||!exact(ack.confirmedAt)||
       !equal(ack.haulerIDs,sorted)||
       !equal(ack.cargoIDs,m.cargo.map(x=>x.cargoID)))
     return fail("ALIFE12_WARP_ACK_PROVENANCE_INVALID");
    if(pending)return fail("ALIFE12_TWO_ACTIVE_DURABLE_TRIPS");
    pending={status:"RECOVERED_NATIVE_TRIP",trip:{
     systemID,fleetID,stationID:m.stationID,corporationID:m.corporationID,
     startedAt:m.startedAt,manifestID:key,
     expectedCargoIDs:m.cargo.map(x=>x.cargoID),
     haulers:Object.fromEntries(sorted.map(id=>[id,{arrivedAt:0}])),
     coopRecoveredAt:Number(clock())},activeCargo:active};
   }
   return pending||{status:"NO_PENDING_TRIP"};
  }catch(error){return fail("ALIFE12_JOURNAL_READ_OR_PROVENANCE_UNAVAILABLE",{
   details:String(error?.message||error).slice(0,120)})}
 }
 return Object.freeze({confirm,recover});
}
module.exports={createJournal};
