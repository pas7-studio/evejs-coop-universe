"use strict";
// Stage J rescue offers: real NPC corporation funds a real separate escrow.
// Human pilots must each accept; payout only after entire ORIGINAL wreck
// source cargo has physically moved into the owner NPC station inventory.
const fs=require("node:fs"),path=require("node:path");
const pos=n=>Number.isSafeInteger(n)&&n>0;
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const mark=(wreckID,itemID,cargoID)=>
 "coop-rescue:v1:wreck:"+wreckID+":item:"+itemID+":cargo:"+cargoID;
function createRescueContracts({root,readEvent,readFlight,readManifest,
 readOutcomes,getWreck,getWreckItems,readWarehouseItems,
 readNativeNpcCargo,isNpcCorporation,nativeFunds,readVolunteer,clock=()=>Date.now(),io=fs,
 amountISK}={}){
 if(typeof root!=="string"||!path.isAbsolute(root)||
  [readEvent,readFlight,readManifest,readOutcomes,getWreck,
   getWreckItems,readWarehouseItems,readNativeNpcCargo,isNpcCorporation,readVolunteer,clock]
   .some(f=>typeof f!=="function")||
  ["reserveAtomic","verifyReservation","settleAtomic","verifySettlement","refundRescueAtomic"]
   .some(k=>typeof nativeFunds?.[k]!=="function")||
  !pos(amountISK)||amountISK%2||amountISK>1000000000)
  throw Error("RESCUE_CONTRACT_AUTHORITIES_REQUIRED");
 const dir=path.join(root,"rescue-native-acceptance");
 const deny=status=>({status});
 const quoteFile=id=>path.join(dir,"offer-"+id+".json");
 function readQuote(id){
  let raw;try{raw=io.readFileSync(quoteFile(id),"utf8")}
  catch(e){return e?.code==="ENOENT"?null:deny("RESCUE_QUOTE_READ_UNAVAILABLE")}
  if(typeof raw!=="string"||raw.length>16384||!raw.endsWith("\n"))
   return deny("RESCUE_QUOTE_CORRUPT");
  let q;try{q=JSON.parse(raw)}catch{return deny("RESCUE_QUOTE_CORRUPT")}
  if(q?.v!==1||q.offer?.contract?.contractID!==id||
   !Array.isArray(q.offer.expected)||!q.offer.expected.length||
   q.offer.expected.length>100||
   q.offer.expected.some(x=>![x.sourceCargoID,x.wreckItemID,
    x.typeID,x.quantity].every(pos)))
   return deny("RESCUE_QUOTE_CORRUPT");
  return q.offer;
 }
 function saveQuote(offer){
  const file=quoteFile(offer.contract.contractID);
  try{
   io.mkdirSync(dir,{recursive:true});
   let fd=io.openSync(file,"wx",0o600);
   const data=Buffer.from(JSON.stringify({v:1,offer})+"\n");
   try{
    if(io.writeSync(fd,data,0,data.length,null)!==data.length)
     throw Error("SHORT_WRITE");
    io.fsyncSync(fd);
   }finally{io.closeSync(fd)}
   fd=io.openSync(dir,"r");
   try{io.fsyncSync(fd)}finally{io.closeSync(fd)}
   return {status:"READY"};
  }catch(e){
   if(e?.code==="EEXIST")return {status:"EXISTS"};
   return deny("RESCUE_QUOTE_WRITE_UNCERTAIN");
  }
 }
 function offer(eventID){
  if(process.env.EVEJS_COOP_RESCUE_CONTRACTS!=="1")
   return deny("DISABLED");
  if(!/^convoy-\d+-\d+-\d+$/.test(String(eventID)))
   return deny("RESCUE_EVENT_INVALID");
  let event,flight,manifest,outcomes,duo;
  try{event=readEvent(eventID);flight=readFlight(event?.event?.linkedTripID);
   manifest=readManifest(event?.event?.linkedTripID);
   outcomes=readOutcomes();duo=readVolunteer(eventID)}
  catch{return deny("RESCUE_OFFER_SOURCES_UNAVAILABLE")}
  const e=event?.event,b=flight?.booking,m=manifest?.record;
  if(event?.status!=="READY"||e?.type!=="CONVOY"||
   e.stage!=="PREPARING"||e.outcome!=="DEPARTED"||
   !/^\d+-\d+-\d+$/.test(String(e.linkedTripID))||
   flight?.status!=="READY"||flight.phase!=="FUNDED"||
   !b||b.manifestKey!==e.linkedTripID||
   m?.key!==e.linkedTripID||m.systemID!==b.systemID||
   m.corporationID!==b.corporationID||
   m.stationID!==b.stationID||m.fleetID!==b.fleetID||
   e.entityID!==b.haulerID||e.systemID!==b.systemID||
   !Array.isArray(b.characters)||b.characters.length!==2||
   b.characters[0]>=b.characters[1]||
   !Array.isArray(m.cargo)||!m.cargo.length||
   duo?.status!=="VERIFIED_NATIVE_DUO_VOLUNTEER"||
   duo.fleetID!==b.playerFleetID||
   !same(duo.pilots.map(p=>p.characterID),b.characters)||
   isNpcCorporation(b.corporationID)!==true)
   return deny("RESCUE_ORIGINAL_CONTRACT_UNVERIFIED");
  const rows=outcomes?.outcomes;
  if(outcomes?.status!=="READY"||!Array.isArray(rows))
   return deny("RESCUE_LOSS_SOURCE_UNAVAILABLE");
  const losses=rows.filter(x=>x.systemID===b.systemID&&
   x.targetID===b.haulerID&&
   x.status==="HAULER_NATIVE_LOSS_VERIFIED"&&
   pos(x.haulerNativeWreckID)&&
   !(x.verifiedWarehouseStacks?.length>0));
  if(losses.length!==1)return deny("RESCUE_LOSS_NOT_UNIQUE");
  const wreckID=losses[0].haulerNativeWreckID;
  let wreck,items;
  try{wreck=getWreck(wreckID);items=getWreckItems(wreckID)}
  catch{return deny("RESCUE_WRECK_NOT_AVAILABLE")}
  if(!Array.isArray(items))return deny("RESCUE_NATIVE_WRECK_UNVERIFIED");
  if(wreck&&(wreck.wreckID!==wreckID||
   wreck.systemID!==b.systemID||
   wreck.sourceEntityID!==b.haulerID))
   return deny("RESCUE_NATIVE_WRECK_UNVERIFIED");
  const cargo=items.filter(x=>x.wreckID===wreckID&&
   x.sourceKind==="cargo"&&pos(x.sourceCargoID)&&
   pos(x.sourceOriginalQuantity)&&
   x.quantity<=x.sourceOriginalQuantity&&
   m.cargo.some(z=>z.cargoID===x.sourceCargoID&&
    z.typeID===x.typeID&&z.quantity===x.sourceOriginalQuantity));
  const persistedID="escort-rescue-"+wreckID;
  const prior=readQuote(persistedID);
  if(!wreck&&!prior)return deny("RESCUE_NATIVE_WRECK_UNVERIFIED");
  if(prior?.status&&prior.status!=="READY")return prior;
  let expected;
  if(prior){
   if(prior.eventID!==eventID||prior.wreckID!==wreckID||
    prior.stationID!==b.stationID||
    prior.contract?.corporationID!==b.corporationID||
    !same(prior.contract?.characters,b.characters)||
    prior.originalManifestKey!==b.manifestKey||
    prior.expected.some(x=>!m.cargo.some(z=>
     z.cargoID===x.sourceCargoID&&z.typeID===x.typeID&&
     z.quantity===x.quantity)))
    return deny("RESCUE_PERSISTED_QUOTE_SOURCE_CHANGED");
   expected=prior.expected;
  }else{
   if(!cargo.length||cargo.some(x=>!pos(x.wreckItemID)||
    !pos(x.typeID)||!pos(x.quantity)||
    x.quantity!==x.sourceOriginalQuantity)||
    new Set(cargo.map(x=>x.sourceCargoID)).size!==cargo.length)
    return deny("RESCUE_NATIVE_ORIGINAL_CARGO_UNVERIFIED");
   expected=cargo.map(x=>({sourceCargoID:x.sourceCargoID,
    wreckItemID:x.wreckItemID,typeID:x.typeID,
    quantity:x.quantity})).sort((a,b)=>a.sourceCargoID-b.sourceCargoID);
  }
  const first=Math.min(...expected.map(x=>x.sourceCargoID));
  const quotedISK=prior?prior.contract.amountISK:amountISK;
  const contract={contractID:persistedID,
   manifestKey:b.systemID+"-"+wreckID+"-"+first,
   corporationID:b.corporationID,
   amountISK:quotedISK,characters:b.characters.slice()};
  const quote={status:"READY",eventID,wreckID,
   stationID:b.stationID,systemID:b.systemID,
   contract,expected,
   originalManifestKey:b.manifestKey};
  if(prior){
   if(!same(prior,quote))return deny("RESCUE_PERSISTED_QUOTE_CHANGED");
   return quote;
  }
  const stored=saveQuote(quote);
  return stored.status==="READY"?quote:
   stored.status==="EXISTS"?deny("RESCUE_QUOTE_RACE_NEEDS_RETRY"):stored;
 }
 const file=(c,id)=>path.join(dir,c.contractID+"-"+id+".json");
 function readAccepted(c,id){
  let s;try{s=io.readFileSync(file(c,id),"utf8")}
  catch(e){return e?.code==="ENOENT"?null:deny("RESCUE_ACCEPTANCE_READ_UNAVAILABLE")}
  if(typeof s!=="string"||s.length>8192||!s.endsWith("\n"))
   return deny("RESCUE_ACCEPTANCE_CORRUPT");
  let x;try{x=JSON.parse(s)}catch{return deny("RESCUE_ACCEPTANCE_CORRUPT")}
  return x;
 }
 function accept({session,eventID}={}){
  const o=offer(eventID);if(o.status!=="READY")return o;
  const id=session?.characterID;
  if(!pos(id)||!o.contract.characters.includes(id)||
   session?.socket?.destroyed===true)
   return deny("RESCUE_PILOT_UNAUTHORIZED");
  const c=o.contract;
  const existing=readAccepted(c,id);
  if(existing?.status)return existing;
  if(existing&&(!same(existing.contract,c)||
    !same(existing.expected,o.expected)||existing.eventID!==eventID))
   return deny("RESCUE_ACCEPTANCE_IDENTITY_CONFLICT");
  if(!existing){
   const at=clock();
   if(!pos(at))return deny("RESCUE_CLOCK_INVALID");
   try{
    io.mkdirSync(dir,{recursive:true});
    const data=JSON.stringify({v:1,contract:c,eventID,
      wreckID:o.wreckID,stationID:o.stationID,
      expected:o.expected,characterID:id,at})+"\n";
    let fd=io.openSync(file(c,id),"wx",0o600);
    try{if(io.writeSync(fd,Buffer.from(data),0,Buffer.byteLength(data),null)!==
      Buffer.byteLength(data))throw Error("SHORT_WRITE");
     io.fsyncSync(fd)}finally{io.closeSync(fd)}
    fd=io.openSync(dir,"r");
    try{io.fsyncSync(fd)}finally{io.closeSync(fd)}
   }catch{return deny("RESCUE_ACCEPTANCE_WRITE_UNCERTAIN")}
  }
  const both=c.characters.map(x=>readAccepted(c,x));
  if(both.some(x=>!x))return {status:"RESCUE_WAITING_FOR_OTHER_PILOT",
   eventID,amountISK};
  if(both.some(x=>x?.status||!same(x.contract,c)||
   !same(x.expected,o.expected)))
   return deny("RESCUE_DUO_ACCEPTANCE_UNVERIFIED");
  let reserved;
  try{reserved=nativeFunds.verifyReservation(c)}
  catch{return deny("RESCUE_ESCROW_UNAVAILABLE")}
  if(reserved?.status==="RESERVED")
   return {status:"RESCUE_NATIVE_FUNDED",contractID:c.contractID,amountISK};
  if(reserved?.status!=="NOT_FOUND")
   return deny("RESCUE_ESCROW_TERMINAL_OR_UNCERTAIN");
  try{reserved=nativeFunds.reserveAtomic(c)}
  catch{return deny("RESCUE_ESCROW_COMMIT_UNCERTAIN")}
  return reserved?.status==="RESERVED"?
   {status:"RESCUE_NATIVE_FUNDED",contractID:c.contractID,amountISK}:
   deny("RESCUE_ESCROW_NOT_FUNDED");
 }

 // Only a native store row describing the EXACT original rival-captured
 // source makes the player mission impossible and releases corporate funds.
 function verifyRivalLoss(c){
  const q=readQuote(c?.contractID);
  if(!q||q.status!=="READY"||!same(q.contract,c)||
   !Array.isArray(q.expected)||!q.expected.length)
   return deny("RESCUE_RIVAL_ORIGINAL_QUOTE_MISSING");
  let cargo,stock;try{
   cargo=readNativeNpcCargo();stock=readWarehouseItems();
  }catch{return deny("RESCUE_RIVAL_STORE_UNAVAILABLE")}
  if(!Array.isArray(cargo)||!Array.isArray(stock))
   return deny("RESCUE_RIVAL_STORE_UNAVAILABLE");
  const captured=q.expected.flatMap(x=>{
   const inHold=cargo.filter(y=>y.coopRescueRivalSalvage===true&&
    y.sourceCargoID===x.sourceCargoID&&
    y.sourceWreckID===q.wreckID&&
    y.sourceWreckItemID===x.wreckItemID&&
    y.typeID===x.typeID&&y.ownerID!==c.corporationID&&
    pos(y.cargoID)&&pos(y.quantity)).map(y=>y.cargoID);
   const deposited=stock.filter(y=>y.customInfo===
    "coop-rescue-npc:v1:wreck:"+q.wreckID+":item:"+
    x.wreckItemID+":cargo:"+x.sourceCargoID&&
    y.ownerID!==c.corporationID&&
    pos(y.itemID)&&pos(y.quantity)).map(y=>y.itemID);
   return [...inHold,...deposited];
  });
  if(captured.length!==1)return deny("RESCUE_RIVAL_PROOF_NOT_UNIQUE");
  const complete=q.expected.every(x=>stock.some(y=>y.ownerID===
   c.corporationID&&y.locationID===q.stationID&&
   y.customInfo===mark(q.wreckID,x.wreckItemID,x.sourceCargoID)&&
   y.quantity===x.quantity));
  if(complete)return deny("RESCUE_PLAYER_DELIVERY_ALREADY_COMPLETE");
  return {status:"DURABLE_NATIVE_RESCUE_RIVAL_FAILURE",
   contractID:c.contractID,manifestKey:c.manifestKey,
   corporationID:c.corporationID,
   reason:"NATIVE_RIVAL_CARGO_CAPTURED",
   failureWitnessID:captured[0],nativeDurable:true,
   deliveryImpossible:true,noPriorPayout:true};
 }
 function cancel({session,eventID}={}){
  const o=offer(eventID);if(o.status!=="READY")return o;
  const c=o.contract;
  if(!c.characters.includes(session?.characterID)||
   c.characters.some(id=>!readAccepted(c,id)))
   return deny("RESCUE_CANCEL_NOT_AUTHORIZED");
  let paid;try{paid=nativeFunds.verifySettlement(c)}
  catch{return deny("RESCUE_TERMINAL_WALLET_UNAVAILABLE")}
  if(paid?.status==="SETTLED")return deny("RESCUE_ALREADY_PAID_NO_REFUND");
  if(!["NOT_SETTLED","NOT_FOUND"].includes(paid?.status))
   return deny("RESCUE_TERMINAL_WALLET_UNCERTAIN");
  let refunded;
  try{refunded=nativeFunds.verifyRefund(c)}
  catch{return deny("RESCUE_REFUND_LEDGER_UNAVAILABLE")}
  if(refunded?.status==="REFUNDED"&&refunded.nativeDurable===true&&
   refunded.contractID===c.contractID&&
   refunded.corporationID===c.corporationID&&
   refunded.amountISK===c.amountISK)
   return {status:"RESCUE_ALREADY_REFUNDED",
    contractID:c.contractID,amountISK:c.amountISK};
  if(!["NOT_FOUND","NOT_REFUNDED"].includes(refunded?.status))
   return deny("RESCUE_REFUND_LEDGER_UNCERTAIN");
  let r;try{r=nativeFunds.refundRescueAtomic(c)}
  catch{return deny("RESCUE_REFUND_UNCERTAIN_OR_NOT_PROVEN")}
  return r?.status==="REFUNDED"?
   {status:"RESCUE_NATIVE_RIVAL_REFUNDED",
    contractID:c.contractID,amountISK:c.amountISK}:
   deny("RESCUE_REFUND_NOT_CONFIRMED");
 }
 function claim({session,eventID}={}){
  const o=offer(eventID);if(o.status!=="READY")return o;
  const c=o.contract;
  if(!c.characters.includes(session?.characterID))
   return deny("RESCUE_CLAIM_UNAUTHORIZED");
  if(c.characters.some(id=>!readAccepted(c,id)||
   !same(readAccepted(c,id).expected,o.expected)))
   return deny("RESCUE_BOTH_PILOTS_MUST_ACCEPT");
  let previous;
  try{previous=nativeFunds.verifySettlement(c)}
  catch{return deny("RESCUE_PAYOUT_SOURCE_UNAVAILABLE")}
  if(previous?.status==="SETTLED"&&previous.nativeDurable===true)
   return {status:"RESCUE_ALREADY_PAID",contractID:c.contractID};
  if(previous?.status!=="NOT_SETTLED"&&previous?.status!=="NOT_FOUND")
   return deny("RESCUE_PAYOUT_LEDGER_UNCERTAIN");
  let reservation;
  try{reservation=nativeFunds.verifyReservation(c)}
  catch{return deny("RESCUE_ESCROW_UNAVAILABLE")}
  if(reservation?.status!=="RESERVED")
   return deny("RESCUE_NOT_FUNDED");
  let stock;
  try{stock=readWarehouseItems()}
  catch{return deny("RESCUE_WAREHOUSE_UNAVAILABLE")}
  if(!Array.isArray(stock))return deny("RESCUE_WAREHOUSE_UNAVAILABLE");
  const covered=o.expected.every(x=>{
   const seen=stock.filter(y=>y.ownerID===c.corporationID&&
    y.locationID===o.stationID&&y.flagID===4&&
    y.typeID===x.typeID&&
    y.customInfo===mark(o.wreckID,x.wreckItemID,x.sourceCargoID));
   return seen.length>0&&seen.reduce((n,y)=>n+(pos(y.quantity)?y.quantity:0),0)===x.quantity;
  });
  if(!covered){
   const rivalry=verifyRivalLoss(c);
   if(rivalry.status==="DURABLE_NATIVE_RESCUE_RIVAL_FAILURE")
    return cancel({session,eventID});
   return deny("RESCUE_NATIVE_FULL_CARGO_DELIVERY_NOT_VERIFIED");
  }
  let paid;try{paid=nativeFunds.settleAtomic({
   contractID:c.contractID,corporationID:c.corporationID,
   amountISK,credits:c.characters.map(characterID=>({
    characterID,amountISK:amountISK/2}))})}
  catch{return deny("RESCUE_NATIVE_PAYOUT_UNCERTAIN_REPAIR_REQUIRED")}
  return paid?.status==="SETTLED"?
   {status:"RESCUE_NATIVE_PAID",contractID:c.contractID,
    amountISK,perPilotISK:amountISK/2}:
   deny("RESCUE_NATIVE_PAYOUT_NOT_CONFIRMED");
 }
 return {offer,accept,claim,cancel,verifyRivalLoss};
}
module.exports={createRescueContracts,mark};
