"use strict";
// Stage J: true NPC corporation-funded RESCUE escrow, two native player credits
// only after all uniquely identified original stock is physically warehoused.
// Independent escrow namespace; never reuses the original Escort reservation.
const crypto=require("node:crypto");
const pos=x=>Number.isSafeInteger(x)&&x>0;
const cents=x=>Number.isFinite(x)&&Math.abs(Math.round(x*100)-x*100)<0.00001&&
 Number.isSafeInteger(Math.round(x*100))?Math.round(x*100):null;
const money=n=>n/100;
const deny=status=>({status});
const SEP="\u001f",CORP_ESCROWS="coopSalvageEscrows",CORP_ACCOUNT="1000";
const marker=(key,cargoID,wreckItemID)=>
 "coop-salvage:v1:"+key+":"+cargoID+":"+wreckItemID;
const copy=x=>JSON.parse(JSON.stringify(x));
function createSalvageNativeRewards({atomic,isNpcCorporation,readWitness,
 readManifest,readAcceptedDuo,clock=()=>Date.now(),
 ratePerUnitISK=5,maxRewardISK=1000000}={}){
 if(typeof atomic?.transact!=="function"||
  [isNpcCorporation,readWitness,readManifest,readAcceptedDuo,clock]
  .some(x=>typeof x!=="function")||
  !pos(ratePerUnitISK)||!pos(maxRewardISK)||maxRewardISK>1000000000)
  throw Error("SALVAGE_NATIVE_WALLET_AUTHORITIES_REQUIRED");
 function quote(manifestKey){
  if(!/^\d+-\d+-\d+$/.test(String(manifestKey)))return deny("SALVAGE_QUOTE_INVALID_KEY");
  let witness,manifest,accept;try{
   witness=readWitness(manifestKey);manifest=readManifest(manifestKey);
   accept=readAcceptedDuo(manifestKey);
  }catch{return deny("SALVAGE_QUOTE_SOURCE_UNAVAILABLE")}
  const r=witness?.record,m=manifest?.record;
  if(witness?.status!=="READY"||r?.manifestKey!==manifestKey||
   manifest?.status!=="READY"||m?.key!==manifestKey||
   r.stationID!==m.stationID||r.corporationID!==m.corporationID||
   !isNpcCorporation(r.corporationID)||!Array.isArray(r.rows)||
   !r.rows.length||r.rows.length>1000)
   return deny("SALVAGE_QUOTE_ORIGINAL_STOCK_UNVERIFIED");
  const qty=r.rows.reduce((n,x)=>n+x.quantity,0);
  if(!Number.isSafeInteger(qty)||!pos(qty))return deny("SALVAGE_QUOTE_QUANTITY_OVERFLOW");
  const reward=Math.min(maxRewardISK,Math.floor(qty*ratePerUnitISK/2)*2);
  if(!pos(reward)||!Number.isSafeInteger(reward))return deny("SALVAGE_QUOTE_NOT_PAYABLE");
  if(accept?.status!=="VERIFIED_DUO_SALVAGE_ACCEPT"||
   accept.manifestKey!==manifestKey||
   !Array.isArray(accept.characters)||accept.characters.length!==2||
   !accept.characters.every(pos)||
   accept.characters[0]>=accept.characters[1])
   return deny("SALVAGE_EXPLICIT_DUO_ACCEPT_REQUIRED");
  return {status:"SALVAGE_NATIVE_QUOTE_READY",contractID:"salvage-"+manifestKey,
   manifestKey,stationID:r.stationID,corporationID:r.corporationID,
   wreckID:r.wreckID,characters:accept.characters.slice(),
   amountISK:reward,quantity:qty,rows:copy(r.rows)};
 }
 function ready(){
  return process.env.EVEJS_COOP_SALVAGE_REWARDS==="1"&&
   process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS==="1"&&
   atomic.mode==="SERVER_INTERNAL_FLAGGED"&&
   atomic.isPoisoned?.()===false;
 }
 function row(tx,key){return tx.get("corporationRuntime",key)}
 function ledger(tx){const r=row(tx,CORP_ESCROWS);
  if(r===null)return {version:1,byContract:{}};
  if(r?.version!==1||!r.byContract||
   typeof r.byContract!=="object"||Array.isArray(r.byContract)||
   Object.keys(r.byContract).length>512)throw Error("SALVAGE_ESCROW_LEDGER_INVALID");
  return r;
 }
 function corp(tx,c){const key="corporations"+SEP+c.corporationID,rec=row(tx,key);
  const division=rec?.wallet?.divisions?.[CORP_ACCOUNT];
  if(!rec||!division||division.key!==1000||
   cents(division.balance)===null||
   !Array.isArray(division.journal)||!Array.isArray(division.transactions))
   throw Error("SALVAGE_CORP_WALLET_UNAVAILABLE");
  return {key,rec,division,balance:cents(division.balance)};
 }
 function chars(tx,c){return c.characters.map(id=>{
  const r=tx.get("characters",String(id));
  if(r?.characterID!==id||cents(r.balance)===null||
   !Array.isArray(r.walletJournal))
   throw Error("SALVAGE_PLAYER_WALLET_UNAVAILABLE");
  return r;
 })}
 function transactionID(c,stage,i=0){
  return Number.parseInt(crypto.createHash("sha256")
   .update(c.contractID+":"+stage+":"+i).digest("hex").slice(0,12),16);
 }
 function entry(c,stage,amountCents,balanceCents,now,ownerID2=0,i=0){
  const id=transactionID(c,stage,i);
  return {transactionID:id,referenceID:id,
   transactionDate:String(116444736000000000n+BigInt(now)*10000n),
   entryTypeID:10,ownerID1:c.corporationID,ownerID2,
   accountKey:1000,amount:money(amountCents),balance:money(balanceCents),
   currency:1,sortValue:1,
   description:"Native salvage "+stage+" "+c.contractID,
   salvageContractID:c.contractID};
 }
 function reserve(manifestKey){
  if(!ready())return deny("DISABLED");
  const c=quote(manifestKey);
  if(c.status!=="SALVAGE_NATIVE_QUOTE_READY")return c;
  try{return atomic.transact(["corporationRuntime","characters"],tx=>{
   const l=ledger(tx);
   if(l.byContract[c.contractID]){
    const saved=l.byContract[c.contractID];
    if(saved.amountISK!==c.amountISK||
     saved.corporationID!==c.corporationID||
     JSON.stringify(saved.characters)!==JSON.stringify(c.characters))
     throw Error("SALVAGE_ESCROW_IDENTITY_CONFLICT");
    return {status:saved.status==="SETTLED"?"SALVAGE_ALREADY_PAID":"SALVAGE_ALREADY_RESERVED",
     contractID:c.contractID};
   }
   if(Object.keys(l.byContract).length>=512)
    throw Error("SALVAGE_ESCROW_CAP");
   chars(tx,c);
   const company=corp(tx,c),debit=cents(c.amountISK);
   if(company.balance<debit)throw Error("SALVAGE_CORP_INSUFFICIENT_FUNDS");
   const now=clock();if(!pos(now))throw Error("SALVAGE_CLOCK_INVALID");
   const remaining=company.balance-debit;
   company.division.balance=money(remaining);
   const e=entry(c,"reserve",-debit,remaining,now);
   company.division.journal=[...company.division.journal,e].slice(-100);
   company.division.transactions=[...company.division.transactions,e].slice(-2000);
   tx.put("corporationRuntime",company.key,company.rec);
   l.byContract[c.contractID]={contractID:c.contractID,
    manifestKey:c.manifestKey,stationID:c.stationID,
    corporationID:c.corporationID,amountISK:c.amountISK,
    characters:c.characters,rows:c.rows,status:"RESERVED",reservedAt:now};
   tx.put("corporationRuntime",CORP_ESCROWS,l);
   return {status:"SALVAGE_NATIVE_CORP_ESCROW_RESERVED",contractID:c.contractID,
    amountISK:c.amountISK,characters:c.characters};
  })}catch{return deny("SALVAGE_NATIVE_ESCROW_UNCERTAIN")}
 }
 function verify(manifestKey){
  if(!ready())return deny("DISABLED");
  const c=quote(manifestKey);
  if(c.status!=="SALVAGE_NATIVE_QUOTE_READY")return c;
  try{return atomic.transact(["corporationRuntime"],tx=>{
   const saved=ledger(tx).byContract[c.contractID];
   if(!saved)return deny("NOT_FOUND");
   if(saved.amountISK!==c.amountISK||
    saved.corporationID!==c.corporationID||
    JSON.stringify(saved.characters)!==JSON.stringify(c.characters))
    return deny("SALVAGE_NATIVE_ESCROW_IDENTITY_CONFLICT");
   return {status:saved.status,contractID:c.contractID,
    characters:c.characters,amountISK:c.amountISK,nativeDurable:true};
  })}catch{return deny("SALVAGE_NATIVE_ESCROW_SOURCE_UNAVAILABLE")}
 }
 function settle(manifestKey){
  if(!ready())return deny("DISABLED");
  const c=quote(manifestKey);
  if(c.status!=="SALVAGE_NATIVE_QUOTE_READY")return c;
  try{return atomic.transact(["corporationRuntime","characters","items","npcWreckItems"],tx=>{
   const l=ledger(tx),saved=l.byContract[c.contractID];
   if(!saved)return deny("SALVAGE_ESCROW_NOT_RESERVED");
   if(saved.amountISK!==c.amountISK||
    saved.corporationID!==c.corporationID||
    JSON.stringify(saved.characters)!==JSON.stringify(c.characters)||
    JSON.stringify(saved.rows)!==JSON.stringify(c.rows))
    throw Error("SALVAGE_ESCROW_IDENTITIES_CHANGED");
   if(saved.status==="SETTLED")return {status:"SALVAGE_ALREADY_PAID",contractID:c.contractID};
   if(saved.status!=="RESERVED")throw Error("SALVAGE_ESCROW_NOT_PAYABLE");
   // All original cargo must remain in the real native station and NO
   // source wreck items can still be available for another pickup.
   const all=tx.scan("items"),wrecks=tx.get("npcWreckItems","items");
   const nativeMoves=tx.get("corporationRuntime","coopSalvageMoves");
   if(nativeMoves?.version!==1||!nativeMoves.moves)
    throw Error("SALVAGE_NATIVE_MOVE_JOURNAL_MISSING");
   const used=new Set();
   for(const r of c.rows){
    if(wrecks?.[String(r.wreckItemID)])
     throw Error("SALVAGE_ORIGINAL_WRECK_STILL_HAS_ITEM");
    const move=nativeMoves.moves[manifestKey+":"+r.cargoID];
    if(move?.v!==1||move.state!=="DELIVERED"||
     move.manifestKey!==manifestKey||move.cargoID!==r.cargoID||
     move.wreckItemID!==r.wreckItemID||move.wreckID!==c.wreckID||
     move.corporationID!==c.corporationID||
     move.stationID!==c.stationID||move.quantity!==r.quantity||
     !pos(move.nativeItemID)||
     !c.characters.includes(move.characterID))
     throw Error("SALVAGE_NATIVE_ATOMIC_DELIVERY_RECEIPT_UNVERIFIED");
    const matches=all.filter(x=>x.value?.customInfo===
     marker(manifestKey,r.cargoID,r.wreckItemID));
    if(matches.length!==1||matches[0].value?.itemID!==move.nativeItemID||
     used.has(matches[0].key))
     throw Error("SALVAGE_NATIVE_CARGO_NOT_ALL_DELIVERED");
    used.add(matches[0].key);
    const item=matches[0].value;
    if(!pos(item.itemID)||item.typeID!==r.typeID||
     item.ownerID!==c.corporationID||item.locationID!==c.stationID||
     item.flagID!==4||item.quantity!==r.quantity||
     item.stacksize!==r.quantity||item.singleton!==0)
     throw Error("SALVAGE_NATIVE_CUSTODY_NOT_FINAL");
   }
   const people=chars(tx,c),half=cents(c.amountISK/2);
   const now=clock();if(!pos(now))throw Error("SALVAGE_CLOCK_INVALID");
   for(let i=0;i<people.length;i++){
    const p=people[i],balance=cents(p.balance)+half;
    if(!Number.isSafeInteger(balance))throw Error("SALVAGE_WALLET_OVERFLOW");
    p.balance=money(balance);p.balanceChange=c.amountISK/2;
    p.walletJournal=[entry(c,"pilot",half,balance,now,c.characters[i],i+1),
     ...p.walletJournal].slice(0,100);
    tx.put("characters",String(c.characters[i]),p);
   }
   saved.status="SETTLED";saved.settledAt=now;
   saved.credits=c.characters.map(characterID=>({
    characterID,amountISK:c.amountISK/2}));
   tx.put("corporationRuntime",CORP_ESCROWS,l);
   return {status:"SALVAGE_NATIVE_DUO_PAID",contractID:c.contractID,
    amountISK:c.amountISK,credits:saved.credits,nativeDurable:true};
  })}catch{return deny("SALVAGE_SETTLEMENT_NOT_VERIFIED_OR_UNCERTAIN")}
 }
 return {quote,reserve,verify,settle};
}
module.exports={createSalvageNativeRewards};
