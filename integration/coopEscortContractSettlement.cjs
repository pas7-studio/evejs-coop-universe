"use strict";
// Strict native-funded escort settlement fence. No wallet implementation,
// simulated money, or ability to pay until an actual atomic native adapter
// is supplied. PREPARED never automatically retries a possibly applied write.
const fs = require("node:fs");
const path = require("node:path");
const positive = x => Number.isSafeInteger(x) && x > 0;
const status = name => ({status:name});
const equalSet = (a,b) => Array.isArray(a) && Array.isArray(b) &&
 a.length === b.length && new Set(a).size === a.length &&
 new Set(b).size === b.length && a.every(x=>b.includes(x));
const keyOK = x => typeof x === "string" && /^escort-[a-zA-Z0-9-]{1,48}$/.test(x);
const manifestOK = x => typeof x === "string" && /^[0-9]+-[0-9]+-[0-9]+$/.test(x);
const isErr = (e,code) => e && e.code === code;
function createEscortContractSettlement({root,io=fs,clock=()=>Date.now(),authorizeOffer,
 readManifest,verifyManifest,readIncidents,readOutcomes,readNativeDelivery,nativeFunds,readPrefunded=null}={}) {
 if(typeof root!=="string" || !path.isAbsolute(root) ||
  [authorizeOffer,readManifest,verifyManifest,readIncidents,readOutcomes,
   readNativeDelivery].some(fn=>typeof fn!=="function") ||
  ["capabilities","reserveAtomic","verifyReservation","settleAtomic",
   "verifySettlement"].some(name=>typeof nativeFunds?.[name]!=="function"))
  throw Error("ESCORT_NATIVE_AUTHORITIES_REQUIRED");
 const directory=path.join(root,"escort-contracts");
 const file=id=>path.join(directory,id+".jsonl");
 const claim=id=>path.join(directory,"claims",id+".lock");
 function syncDir(dir){let fd;try{fd=io.openSync(dir,"r");io.fsyncSync(fd);return true}
  catch{return false}finally{if(fd!==undefined)try{io.closeSync(fd)}catch{}}}
 function append(target,event,exclusive=false){
  let fd;
  try{
   io.mkdirSync(path.dirname(target),{recursive:true});
   const bytes=Buffer.from(JSON.stringify(event)+"\n");
   if(bytes.length>4096)return false;
   fd=io.openSync(target,exclusive?"wx":"a",0o600);
   if(io.writeSync(fd,bytes,0,bytes.length,null)!==bytes.length)return false;
   io.fsyncSync(fd);
  }catch{return false}finally{if(fd!==undefined)try{io.closeSync(fd)}catch{}}
  return syncDir(path.dirname(target));
 }
 function read(contractID){
  if(!keyOK(contractID))return status("CONTRACT_ID_INVALID");
  let data;
  try{data=io.readFileSync(file(contractID),"utf8")}
  catch(e){return status(isErr(e,"ENOENT")?"CONTRACT_NOT_FOUND":"CONTRACT_READ_FAILED")}
  if(typeof data!=="string"||Buffer.byteLength(data)>16384||!data.endsWith("\n"))
   return status("CONTRACT_JOURNAL_CORRUPT");
  let events;
  try{events=data.trimEnd().split("\n").map(s=>JSON.parse(s))}catch{return status("CONTRACT_JOURNAL_CORRUPT")}
  if(!events.length||events.length>5||events[0]?.phase!=="OFFERED")
   return status("CONTRACT_JOURNAL_CORRUPT");
  const contract=events[0].contract;
  if(!valid(contract)||contract.contractID!==contractID)
   return status("CONTRACT_JOURNAL_CORRUPT");
  const transitions={OFFERED:"FUNDING_PREPARED",FUNDING_PREPARED:"FUNDED",
   FUNDED:"SETTLEMENT_PREPARED",SETTLEMENT_PREPARED:"SETTLED"};
  let phase="OFFERED";
  for(let i=0;i<events.length;i++){
   const ev=events[i];
   if(ev?.v!==1||ev.contractID!==contractID||!Number.isSafeInteger(ev.at)||ev.at<=0||
    (i===0?ev.phase!=="OFFERED":ev.phase!==transitions[phase])||
    (i>0 && Object.keys(ev).some(k=>!["v","phase","contractID","at"].includes(k))))
    return status("CONTRACT_JOURNAL_CORRUPT");
   phase=ev.phase;
  }
  return {status:"READY",phase,contract};
 }
 function valid(c){
  return c && keyOK(c.contractID)&&manifestOK(c.manifestKey)&&
   [c.systemID,c.fleetID,c.haulerID,c.stationID,c.corporationID,
    c.pirateID,c.fleetDuoID,c.amountISK].every(positive)&&
   c.amountISK<=1000000000&&c.amountISK%2===0&&
   Array.isArray(c.characters)&&c.characters.length===2&&
   c.characters.every(positive)&&c.characters[0]<c.characters[1]&&
   c.incidentKey===`${c.systemID}:${c.pirateID}:${c.haulerID}`;
 }
 function capabilities(){
  try{const c=nativeFunds.capabilities();return c?.nativeDurable===true &&
   c?.atomicDualCredit===true&&c?.durableIdempotency===true}
  catch{return false}
 }
 // Lock serializes attempts across processes. Uncertain externally visible
 // mutation leaves the lock intact as a deliberate operator repair fence.
 function guarded(contractID,fn){
  const lock=file(contractID)+".writer.lock";let fd;
  try{io.mkdirSync(directory,{recursive:true});fd=io.openSync(lock,"wx",0o600)}
  catch{return status("ESCORT_WRITER_LOCKED_REPAIR_REQUIRED")}
  let release=false;
  try{const result=fn(()=>{release=true});return result}
  finally{try{io.closeSync(fd)}catch{};if(release)try{io.unlinkSync(lock)}catch{}}
 }
 function create(candidate){
  if(process.env.EVEJS_COOP_ESCORT_CONTRACTS!=="1")return status("DISABLED");
  if(!valid(candidate))return status("INVALID_CONTRACT");
  const c={contractID:candidate.contractID,manifestKey:candidate.manifestKey,
   systemID:candidate.systemID,fleetID:candidate.fleetID,
   haulerID:candidate.haulerID,stationID:candidate.stationID,
   corporationID:candidate.corporationID,pirateID:candidate.pirateID,
   incidentKey:candidate.incidentKey,fleetDuoID:candidate.fleetDuoID,
   characters:candidate.characters.slice(),amountISK:candidate.amountISK};
  let authority;
  try{authority=authorizeOffer({...c,characters:c.characters.slice()})}
  catch{return status("CONTRACT_AUTHORITY_UNAVAILABLE")}
  if(authority?.status!=="AUTHORIZED_NATIVE_ESCORT"||
   !["contractID","manifestKey","systemID","fleetID","haulerID",
     "stationID","corporationID","pirateID","incidentKey","fleetDuoID",
     "amountISK"].every(k=>authority[k]===c[k])||
   !equalSet(authority?.characters,c.characters))return status("CONTRACT_NOT_AUTHORIZED");
  let original;
  try{original=readManifest(c.manifestKey)}catch{return status("MANIFEST_AUTHORITY_UNAVAILABLE")}
  const m=original?.record;
  if(original?.status!=="READY"||m?.key!==c.manifestKey||
   m.systemID!==c.systemID||m.fleetID!==c.fleetID||
   m.stationID!==c.stationID||m.corporationID!==c.corporationID||
   !Array.isArray(m.haulerIDs)||m.haulerIDs.length!==1||m.haulerIDs[0]!==c.haulerID||
   !Array.isArray(m.cargo)||!m.cargo.length)
   return status("NATIVE_MANIFEST_OFFER_MISMATCH");
  if(!capabilities())return status("ATOMIC_NATIVE_WALLET_PROVIDER_UNAVAILABLE");
  const claimFile=claim(c.manifestKey),contractFile=file(c.contractID);
  // A trip can never be funded under a second contract ID, including after
  // restart. Leave the claimed identity for manual inspection on uncertainty.
  let claimFD;
  try{io.mkdirSync(path.dirname(claimFile),{recursive:true});
   claimFD=io.openSync(claimFile,"wx",0o600);
   io.writeFileSync(claimFD,c.contractID);io.fsyncSync(claimFD)}
  catch{return status("MANIFEST_ALREADY_CLAIMED_OR_STORAGE_UNAVAILABLE")}
  finally{if(claimFD!==undefined)try{io.closeSync(claimFD)}catch{}}
  if(!syncDir(path.dirname(claimFile)))return status("CONTRACT_CLAIM_DURABILITY_UNCERTAIN");
  if(!append(contractFile,{v:1,contractID:c.contractID,phase:"OFFERED",at:clock(),contract:c},true))
   return status("CONTRACT_OFFER_WRITE_UNCERTAIN");
  return {status:"OFFERED",contractID:c.contractID};
 }
 function fundedReceipt(c,p){
  return p?.status==="RESERVED"&&p.contractID===c.contractID&&
   p.corporationID===c.corporationID&&p.amountISK===c.amountISK&&
   p.escrowKey===c.contractID&&p.nativeDurable===true;
 }
 function paidReceipt(c,p){
  return p?.status==="SETTLED"&&p.contractID===c.contractID&&
   p.corporationID===c.corporationID&&p.amountISK===c.amountISK&&
   p.escrowKey===c.contractID&&p.escrowConsumed===true&&
   p.nativeDurable===true&&
   Array.isArray(p.credits)&&p.credits.length===2&&
   equalSet(p.credits.map(x=>x.characterID),c.characters)&&
   p.credits.every(x=>x.amountISK===c.amountISK/2);
 }
 function fund(contractID){
  if(process.env.EVEJS_COOP_ESCORT_CONTRACTS!=="1")return status("DISABLED");
  if(!keyOK(contractID))return status("CONTRACT_ID_INVALID");
  return guarded(contractID,release=>{
   const current=read(contractID);
   if(current.status!=="READY"){release();return current}
   if(current.phase!=="OFFERED"){release();return status("CONTRACT_FUNDING_NOT_REPLAYABLE")}
   if(!capabilities()){release();return status("ATOMIC_NATIVE_WALLET_PROVIDER_UNAVAILABLE")}
   const c=current.contract;
   let before;
   try{before=nativeFunds.verifyReservation(c)}catch{release();return status("RESERVATION_PREFLIGHT_UNAVAILABLE")}
   if(before?.status!=="NOT_FOUND"){release();return status("RESERVATION_PREFLIGHT_NOT_EMPTY")}
   if(!append(file(contractID),{v:1,contractID,phase:"FUNDING_PREPARED",at:clock()}))
    return status("FUNDING_PREPARE_UNCERTAIN");
   try{nativeFunds.reserveAtomic({...c,characters:c.characters.slice()})}catch{}
   let receipt;
   try{receipt=nativeFunds.verifyReservation(c)}catch{}
   if(!fundedReceipt(c,receipt))return status("NATIVE_RESERVATION_UNCERTAIN_REPAIR_REQUIRED");
   if(!append(file(contractID),{v:1,contractID,phase:"FUNDED",at:clock()}))
    return status("FUNDING_COMMIT_JOURNAL_UNCERTAIN");
   release();return {status:"FUNDED",contractID};
  });
 }
 // Pre-warp money was already reserved by the trusted escort flight gate.
 // Bind it to the later real pirate incident; DO NOT debit a second time.
 function attachPrefunded(contractID){
  if(process.env.EVEJS_COOP_ESCORT_CONTRACTS!=="1")return status("DISABLED");
  if(!keyOK(contractID))return status("CONTRACT_ID_INVALID");
  if(typeof readPrefunded!=="function")return status("PREFUNDED_GATE_UNAVAILABLE");
  return guarded(contractID,release=>{
   const current=read(contractID);
   if(current.status!=="READY"){release();return current}
   if(current.phase!=="OFFERED"){release();return status("CONTRACT_FUNDING_NOT_REPLAYABLE")}
   if(!capabilities()){release();return status("ATOMIC_NATIVE_WALLET_PROVIDER_UNAVAILABLE")}
   const c=current.contract;
   let flight;try{flight=readPrefunded(c)}catch{
    release();return status("PREFUNDED_BOOKING_UNAVAILABLE")}
   if(flight?.status!=="NATIVE_PREFUNDED_BOOKING_VERIFIED"||
     flight.contractID!==c.contractID){
    release();return status("PREFUNDED_BOOKING_NOT_VERIFIED");
   }
   let receipt;try{receipt=nativeFunds.verifyReservation(c)}catch{
    release();return status("PREFUNDED_ESCROW_UNAVAILABLE")}
   if(!fundedReceipt(c,receipt)){
    release();return status("PREFUNDED_ESCROW_NOT_VERIFIED");
   }
   if(!append(file(contractID),{v:1,contractID,phase:"FUNDING_PREPARED",at:clock()}))
    return status("PREFUNDED_JOURNAL_UNCERTAIN");
   // After PREPARED, never call reserveAtomic; both events only acknowledge
   // the existing independently verified native escrow.
   if(!append(file(contractID),{v:1,contractID,phase:"FUNDED",at:clock()}))
    return status("PREFUNDED_COMMIT_JOURNAL_UNCERTAIN");
   release();return {status:"FUNDED",contractID,prefunded:true};
  });
 }
 function proof(c){
  let m,p,incident,outcome,delivery,reservation;
  try{
   m=readManifest(c.manifestKey);
   p=verifyManifest({key:c.manifestKey,systemID:c.systemID,
    fleetID:c.fleetID,stationID:c.stationID,corporationID:c.corporationID,
    haulerIDs:[c.haulerID]});
   incident=readIncidents();outcome=readOutcomes();
   delivery=readNativeDelivery(c);reservation=nativeFunds.verifyReservation(c);
  }catch{return status("ESCORT_PROOF_AUTHORITY_UNAVAILABLE")}
  if(!fundedReceipt(c,reservation))return status("NATIVE_RESERVED_FUNDS_NOT_VERIFIED");
  if(m?.status!=="READY"||m.record?.key!==c.manifestKey||
   m.record.systemID!==c.systemID||m.record.fleetID!==c.fleetID||
   m.record.stationID!==c.stationID||m.record.corporationID!==c.corporationID||
   !equalSet(m.record.haulerIDs,[c.haulerID])||
   !Array.isArray(m.record.cargo)||!m.record.cargo.length)
   return status("ESCORT_MANIFEST_IDENTITY_UNVERIFIED");
  if(p?.status!=="FULL_NATIVE_CARGO_DELIVERY_VERIFIED"||
   p.key!==c.manifestKey||p.stationID!==c.stationID||
   !equalSet(p.haulerIDs,[c.haulerID])||
   !equalSet(p.cargoIDs,m.record.cargo.map(x=>x.cargoID)))
   return status("ESCORT_FULL_NATIVE_DELIVERY_UNVERIFIED");
  if(delivery?.status!=="DELIVERED"||delivery.terminal!==true||
   delivery.nativeFullManifestProof?.status!=="FULL_NATIVE_CARGO_DELIVERY_VERIFIED"||
   delivery.nativeFullManifestProof.key!==c.manifestKey||
   !equalSet(delivery.nativeFullManifestProof.cargoIDs,p.cargoIDs))
   return status("ESCORT_PHYSICAL_ARRIVAL_UNVERIFIED");
  if(incident?.status!=="READY"||!Array.isArray(incident.incidents))
   return status("ESCORT_NATIVE_COMBAT_UNAVAILABLE");
  const matches=incident.incidents.filter(x=>x.key===c.incidentKey);
  const i=matches.length===1?matches[0]:null;
  if(!i||i.systemID!==c.systemID||i.targetID!==c.haulerID||
   i.pirateID!==c.pirateID||i.targetRole!=="hauler"||
   i.duoFleetID!==c.fleetDuoID||!equalSet(i.characters,c.characters)||
   i.status!=="PIRATE_WRECK_CONFIRMED"||i.closed!==true||!positive(i.nativeWreckID))
   return status("ESCORT_DUO_NATIVE_COMBAT_UNVERIFIED");
  if(outcome?.status!=="READY"||!Array.isArray(outcome.outcomes))
   return status("ESCORT_NATIVE_OUTCOMES_UNAVAILABLE");
  const related=outcome.outcomes.filter(x=>x.key===c.incidentKey);
  if(related.length!==1||positive(related[0].haulerNativeWreckID)||
   !Array.isArray(related[0].verifiedWarehouseStacks)||
   related[0].verifiedWarehouseStacks.length!==m.record.cargo.length)
   return status("ESCORT_NATIVE_CUSTODY_UNVERIFIED");
  const rows=related[0].verifiedWarehouseStacks;
  if(!m.record.cargo.every(x=>rows.filter(y=>y.cargoID===x.cargoID&&
   y.quantity===x.quantity&&y.typeID===x.typeID&&
   y.stationID===c.stationID&&y.ownerID===c.corporationID&&positive(y.itemID)).length===1))
   return status("ESCORT_NATIVE_CARGO_OUTCOME_MISMATCH");
  return {status:"NATIVE_ESCORT_EVIDENCE_VERIFIED",contractID:c.contractID};
 }
 function settle(contractID){
  if(process.env.EVEJS_COOP_ESCORT_CONTRACTS!=="1")return status("DISABLED");
  if(!keyOK(contractID))return status("CONTRACT_ID_INVALID");
  return guarded(contractID,release=>{
   const current=read(contractID);
   if(current.status!=="READY"){release();return current}
   if(current.phase!=="FUNDED"){release();return status("CONTRACT_SETTLEMENT_NOT_REPLAYABLE")}
   if(!capabilities()){release();return status("ATOMIC_NATIVE_WALLET_PROVIDER_UNAVAILABLE")}
   const c=current.contract,verified=proof(c);
   if(verified.status!=="NATIVE_ESCORT_EVIDENCE_VERIFIED"){release();return verified}
   let before;
   try{before=nativeFunds.verifySettlement(c)}catch{release();return status("SETTLEMENT_PREFLIGHT_UNAVAILABLE")}
   if(before?.status!=="NOT_FOUND"){release();return status("SETTLEMENT_PREFLIGHT_NOT_EMPTY")}
   if(!append(file(contractID),{v:1,contractID,phase:"SETTLEMENT_PREPARED",at:clock()}))
    return status("SETTLEMENT_PREPARE_UNCERTAIN");
   // One native atomic DB transaction MUST consume reserved NPC money and
   // credit both real player wallets. Never call two independent transfers.
   try{nativeFunds.settleAtomic({contractID:c.contractID,
    corporationID:c.corporationID,amountISK:c.amountISK,
    credits:c.characters.map(characterID=>({characterID,amountISK:c.amountISK/2}))})}catch{}
   let paid;
   try{paid=nativeFunds.verifySettlement(c)}catch{}
   if(!paidReceipt(c,paid))return status("NATIVE_PAYOUT_UNCERTAIN_REPAIR_REQUIRED");
   if(!append(file(contractID),{v:1,contractID,phase:"SETTLED",at:clock()}))
    return status("SETTLEMENT_COMMIT_JOURNAL_UNCERTAIN");
   release();return {status:"SETTLED",contractID,credits:paid.credits};
  });
 }
 return {create,fund,attachPrefunded,settle,read,proof};
}
module.exports={createEscortContractSettlement};
