"use strict";
// COOP-048: one native actor decision -> durable claim key -> source-backed
// Rust player order -> existing GameStore/Rust NPC corporate buyer writer.
// Not registered on the live timer; does not impersonate player sessions.
const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto");
const {planNpcNativePurchase}=require("./coopNpcMarketPolicy"+(typeof __filename==="string"&&__filename.endsWith(".js")?"":".cjs"));
const pos=x=>Number.isSafeInteger(x)&&x>0;
const cents=x=>typeof x==="number"&&Number.isFinite(x)&&x>0&&
 Number.isSafeInteger(Math.round(x*100))?Math.round(x*100):null;
function createNpcBuyerCoordinator({file,resolveActor,readProof,getOrder,buyer,
 clock=()=>Date.now(),env=process.env}={}){
 if(typeof file!=="string"||!path.isAbsolute(file)||
  [resolveActor,readProof,getOrder,clock].some(f=>typeof f!=="function")||
  typeof buyer?.purchaseOnce!=="function"||buyer.mode!=="RUST_CLAIM_PLAYER_FULL_ESCROW")
  throw Error("NPC_BUY_COORDINATOR_NATIVE_DEPENDENCIES_REQUIRED");
 const lock=file+".lock";
 function load(){
  try{
   const state=JSON.parse(fs.readFileSync(file,"utf8"));
   if(state.version!==1||!state.entries||typeof state.entries!=="object"||
      Array.isArray(state.entries))throw Error("NPC_BUY_JOURNAL_CORRUPT");
   for(const [key,row] of Object.entries(state.entries)){
    if(!/^\d+:\d+$/.test(key)||!row||!["PREPARED","SETTLED"].includes(row.phase)||
       !/^npc-corpbuy:[0-9a-f]{32}$/.test(row.claimKey)||!pos(row.buyerCorpID)||
       !pos(row.orderID)||!pos(row.stationID)||!pos(row.typeID)||
       !pos(row.sellerID)||!pos(row.quantity)||!pos(row.unitPriceCents))
     throw Error("NPC_BUY_JOURNAL_CORRUPT");
   }
   return state;
  }catch(e){if(e.code==="ENOENT")return {version:1,entries:{}};throw e;}
 }
 function save(state){
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const tmp=file+".tmp-"+process.pid+"-"+crypto.randomUUID();
  let fd;
  try{
   fd=fs.openSync(tmp,"wx",0o600);fs.writeFileSync(fd,JSON.stringify(state));
   fs.fsyncSync(fd);fs.closeSync(fd);fd=null;fs.renameSync(tmp,file);
   try{const dir=fs.openSync(path.dirname(file),"r");try{fs.fsyncSync(dir)}finally{fs.closeSync(dir)}}
   catch(e){if(process.platform!=="win32"||
      !["EPERM","EINVAL","ENOTSUP","EBADF","EISDIR"].includes(e.code))throw e;}
  }finally{
   if(fd!==null&&fd!==undefined)fs.closeSync(fd);
   try{fs.unlinkSync(tmp)}catch(e){if(e.code!=="ENOENT")throw e;}
  }
 }
 const denied=reason=>({status:"BLOCKED",reason});
 function validActor(a,corp,station){
  return a?.nativeVerified===true&&a.isNpc===true&&a.role==="trader"&&
   a.corporationID===corp&&a.stationID===station&&a.playerControlled!==true&&
   a.inWarp!==true&&a.underAttack!==true&&a.activeNativeOrder!==true;
 }
 async function tick({actorID,buyerCorpID,stationID,typeID,
  maxUnitPriceCents,maxSpendCents,minReserveCents=0}={}){
  if(env.EVEJS_COOP_ALIFE_ECONOMY_ACT!=="1"||
     env.EVEJS_COOP_NATIVE_ATOMIC_ROWS!=="1"||
     env.EVEJS_COOP_NPC_BUY_PLAYER_ASK!=="1")
   return {status:"DISABLED",nativeMutation:false};
  if(![actorID,buyerCorpID,stationID,typeID,
    maxUnitPriceCents,maxSpendCents].every(pos)||
    !Number.isSafeInteger(minReserveCents)||minReserveCents<0)
   return denied("NPC_BUY_COORDINATOR_CONTEXT_INVALID");
  let fd;
  fs.mkdirSync(path.dirname(file),{recursive:true});
  try{fd=fs.openSync(lock,"wx",0o600)}
  catch(e){if(e.code==="EEXIST")return denied("NPC_BUY_COORDINATOR_LOCKED");throw e;}
  try{
   const actor=await resolveActor(actorID);
   if(!validActor(actor,buyerCorpID,stationID))
    return denied("NPC_BUY_ACTOR_UNVERIFIED");
   const state=load(),prefix=buyerCorpID+":";
   const existing=Object.entries(state.entries).filter(([k,v])=>
    k.startsWith(prefix)&&v.phase==="PREPARED"&&
    v.stationID===stationID);
   if(existing.length>1)return denied("NPC_BUY_MULTIPLE_UNRESOLVED_CLAIMS");
   let entry=existing[0]?.[1]||null;
   if(entry&&entry.typeID!==typeID)return denied("NPC_BUY_UNRESOLVED_OTHER_PRODUCT");
   if(!entry){
    const proof=await readProof(buyerCorpID,stationID,typeID);
    if(proof?.authoritativeNative!==true||proof.ownerID!==buyerCorpID||
       proof.stationID!==stationID||proof.typeID!==typeID)
     return denied("NPC_BUY_NATIVE_PROOF_MISSING");
    const planned=planNpcNativePurchase({proof,ownerID:buyerCorpID,
     stationID,typeID,maxUnitPriceCents,maxSpendCents,
     minCashReserveCents:minReserveCents});
    if(planned.status!=="NATIVE_BUY_INTENT_ONLY")
     return {status:planned.status,reason:planned.reason||null,nativeMutation:false};
    entry={phase:"PREPARED",claimKey:"npc-corpbuy:"+
      crypto.randomUUID().replace(/-/g,""),
     buyerCorpID,orderID:planned.orderID,sellerID:planned.sellerOwnerID,
     stationID,typeID,quantity:planned.quantity,
     unitPriceCents:planned.totalCents/planned.quantity,
     minReserveCents,createdAt:clock()};
    if(!pos(entry.orderID)||!pos(entry.sellerID)||!pos(entry.quantity)||
       !pos(entry.unitPriceCents)||entry.sellerID===buyerCorpID||
       !Number.isSafeInteger(entry.unitPriceCents))
     return denied("NPC_BUY_CANDIDATE_NOT_CANONICAL");
    const id=buyerCorpID+":"+entry.orderID;
    if(Object.keys(state.entries).length>=5000)return denied("NPC_BUY_JOURNAL_CAP");
    if(state.entries[id])return denied("NPC_BUY_ORDER_ALREADY_HANDLED");
    state.entries[id]=entry;save(state); // write-ahead BEFORE first native claim
   }
   const live=await getOrder(entry.orderID);
   if(live?.source!=="player"||live.is_corp!==false||live.bid!==false||
      !["open","settling","filled"].includes(live.state)||
      Number(live.order_id)!==entry.orderID||
      Number(live.owner_id)!==entry.sellerID||
      Number(live.station_id)!==stationID||
      Number(live.type_id)!==typeID||
      cents(Number(live.price))!==entry.unitPriceCents||
      (live.state==="open"&&Number(live.vol_remaining)!==entry.quantity))
    return denied("NPC_BUY_FRESH_RUST_ORDER_CHANGED");
   if(!validActor(await resolveActor(actorID),buyerCorpID,stationID))
    return denied("NPC_BUY_ACTOR_CHANGED_BEFORE_CLAIM");
   const result=await buyer.purchaseOnce({
    claimKey:entry.claimKey,buyerCorpID,sellerID:entry.sellerID,
    stationID,typeID,orderID:entry.orderID,
    quantity:entry.quantity,maxUnitPriceCents:entry.unitPriceCents,
    minReserveCents:entry.minReserveCents});
   if(result?.status!=="NPC_PURCHASED_PLAYER_GOODS")
    return denied("NPC_BUY_NATIVE_SETTLEMENT_NOT_CONFIRMED");
   entry.phase="SETTLED";entry.fillID=result.fillID;entry.itemID=result.itemID;
   entry.committedAt=clock();save(state);
   return {status:"NPC_PLAYER_PURCHASE_SETTLED",operation:entry.claimKey,
    fillID:result.fillID,itemID:result.itemID,quantity:entry.quantity};
  }finally{fs.closeSync(fd);try{fs.unlinkSync(lock)}catch(e){if(e.code!=="ENOENT")throw e}}
 }
 return Object.freeze({tick,inspect:load,mode:"MANUAL_NATIVE_CORP_BUY_COORDINATOR",
  supportsLiveRuntime:false});
}
module.exports={createNpcBuyerCoordinator};
