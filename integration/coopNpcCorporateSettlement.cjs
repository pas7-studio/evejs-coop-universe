"use strict";
/**
 * COOP-035: whole-stack native NPC corporate purchase, first provable slice.
 * Cross-DB protocol: durable Rust CLAIM -> atomic GameStore buyer+corp+item+
 * escrow+receipt -> idempotent Rust FINALIZE. Never uses normal character-seller.
 * No live registration; exact producer-owned item; no mint/split, no partial fill.
 */
const TABLES=Object.freeze(["characters","corporationRuntime","items","marketEscrow","npcMarketFills"]);
const ESCROW_BASE=9200000000;
const pos=x=>Number.isSafeInteger(x)&&x>0;
const cents=x=>Number.isFinite(x)&&x>=0&&Number.isSafeInteger(Math.round(x*100))?Math.round(x*100):null;
const isk=c=>Math.round(c)/100;
const validID=x=>typeof x==="string"&&/^npc-manufacture:[0-9a-f]{32}$/.test(x);
function createNpcCorporateSettlement({gameStore,market,verifyBuyerSession,verifyNpcCorporation,
 clock=()=>Date.now()}={}){
 if(typeof gameStore?.transact!=="function"||
   ["claimOnce","finalizeOnce","inspectClaim"].some(k=>typeof market?.[k]!=="function")||
   typeof verifyBuyerSession!=="function"||typeof verifyNpcCorporation!=="function"||
   typeof clock!=="function")throw Error("NPC_CORPORATE_SETTLEMENT_AUTHORITIES_REQUIRED");
 const active=new Set();
 function gate(){return process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS==="1"&&
   process.env.EVEJS_COOP_NATIVE_NPC_CORP_SETTLEMENT_PROOF==="1"}
 function requireClaim(order,buyer,identity,maxPriceCents){
  if(!order||order.source!=="coop-npc"||!["settling","filled"].includes(order.state)||
   !validID(order.operation_id)||!pos(Number(order.order_id))||
   !pos(Number(order.source_item_id))||!pos(Number(order.owner_id))||
   !pos(Number(order.station_id))||!pos(Number(order.type_id))||
   !pos(Number(order.quantity))||order.quantity>50000||
   !pos(Number(order.buyer_id))||Number(order.buyer_id)!==buyer||
   order.is_corp!==true||order.bid!==false||!pos(Number(order.fill_id))||
   !Number.isSafeInteger(Number(order.price_cents))||Number(order.price_cents)<=0||
   order.price_cents>100000000||order.fill_id===undefined)throw Error("NPC_RUST_CLAIM_NOT_CANONICAL");
  if(order.operation_id!==identity.operationID||
   Number(order.order_id)!==identity.orderID||
   Number(order.owner_id)!==identity.ownerID||
   Number(order.station_id)!==identity.stationID||
   Number(order.type_id)!==identity.typeID||
   Number(order.quantity)!==identity.quantity||
   Number(order.source_item_id)!==identity.itemID)
   throw Error("NPC_RUST_CLAIM_IDENTITY_MISMATCH");
  if(!Number.isSafeInteger(maxPriceCents)||maxPriceCents<=0||
     Number(order.price_cents)>maxPriceCents)throw Error("NPC_RUST_PRICE_EXCEEDS_PLAYER_LIMIT");
  if(verifyNpcCorporation(identity.ownerID,identity.stationID)!==true)
   throw Error("NPC_SELLER_NOT_VERIFIED");
  return {fillID:Number(order.fill_id),priceCents:Number(order.price_cents),
   grossCents:Number(order.price_cents)*identity.quantity};
 }
 function atomicSettle(order,buyerID,identity,maxPriceCents=Number(order?.price_cents)){
  const {fillID,priceCents,grossCents}=requireClaim(order,buyerID,identity,maxPriceCents);
  if(!Number.isSafeInteger(grossCents)||grossCents<=0||grossCents>100000000000)
   throw Error("NPC_CORPORATE_GROSS_COST_INVALID");
  const orderKey=String(identity.orderID),itemKey=String(identity.itemID);
  const fillKey="order"+String.fromCharCode(31)+orderKey;
  return gameStore.transact(TABLES,tx=>{
   const prior=tx.get("npcMarketFills",fillKey);
   if(prior!==null&&prior!==undefined){
    if(prior.fillID!==fillID||prior.buyerID!==buyerID||prior.itemID!==identity.itemID||
       prior.grossCents!==grossCents||prior.ownerID!==identity.ownerID||
       prior.phase!=="NATIVE_COMMITTED")throw Error("NPC_CORPORATE_FILL_REPLAY_CONFLICT");
    return {status:"ALREADY_NATIVE_COMMITTED",fillID,orderID:identity.orderID,
      buyerID,itemID:identity.itemID,quantity:identity.quantity,grossCents};
   }
   if(order.state!=="settling")throw Error("NPC_MARKET_FILLED_WITHOUT_NATIVE_RECEIPT");
   const escrow=tx.get("marketEscrow",orderKey);
   const item=tx.get("items",itemKey);
   const corpKey="corporations"+String.fromCharCode(31)+identity.ownerID;
   const corp=tx.get("corporationRuntime",corpKey);
   const character=tx.get("characters",String(buyerID));
   if(!escrow||escrow.escrowType!=="sell"||escrow.isCorp!==true||
      escrow.ownerId!==identity.ownerID||escrow.stationId!==identity.stationID||
      escrow.sourceItemID!==identity.itemID||escrow.coopOperationID!==identity.operationID||
      escrow.remainingQuantity!==identity.quantity||
      escrow.escrowLocationID!==ESCROW_BASE+identity.orderID)
    throw Error("NPC_MARKET_NATIVE_ESCROW_MISSING");
   if(!item||item.itemID!==identity.itemID||item.ownerID!==identity.ownerID||
      item.typeID!==identity.typeID||item.locationID!==ESCROW_BASE+identity.orderID||
      item.flagID!==4||item.singleton!==0||item.quantity!==identity.quantity||
      item.stacksize!==identity.quantity||
      !/^coop-industry:v1:[0-9]+$/.test(String(item.customInfo||"")))
    throw Error("NPC_MARKET_OUTPUT_CUSTODY_INVALID");
   if(!character||Number(character.characterID??character.charID??buyerID)!==buyerID||
      !Number.isFinite(character.balance)||cents(character.balance)===null||
      cents(character.balance)<grossCents)throw Error("NPC_BUYER_INSUFFICIENT_FUNDS");
   const division=corp?.wallet?.divisions?.["1000"];
   if(corp?.corporationID!==identity.ownerID||!division||
      cents(division.balance)===null||!Array.isArray(division.journal)||
      !Array.isArray(division.transactions)||!Array.isArray(character.walletJournal)||
      !Array.isArray(character.marketTransactions))
     throw Error("NPC_CORPORATE_WALLET_INVALID");
   const oldBuyer=cents(character.balance),oldCorp=cents(division.balance);
   if(oldBuyer===null||oldCorp===null)throw Error("NPC_WALLET_AMOUNT_INVALID");
   const nextBuyer=oldBuyer-grossCents,nextCorp=oldCorp+grossCents;
   if(nextBuyer<0||!Number.isSafeInteger(nextCorp))
     throw Error("NPC_CORPORATE_WALLET_OVERFLOW");
   const now=clock();if(!Number.isSafeInteger(now)||now<=0)throw Error("NPC_LEDGER_CLOCK_INVALID");
   const filetime=String(BigInt(now)*10000n+116444736000000000n);
   const journalBase={transactionID:fillID,transactionDate:filetime,referenceID:identity.orderID,
    entryTypeID:10,ownerID1:buyerID,ownerID2:identity.ownerID,accountKey:1000,
    currency:1,sortValue:1,description:"Native NPC market order "+orderKey};
   if(character.walletJournal.some(r=>r.transactionID===fillID)||
      division.journal.some(r=>r.transactionID===fillID)||
      division.transactions.some(r=>r.transactionID===fillID))
      throw Error("NPC_LEDGER_FILL_ID_COLLISION");
   const buyerAfter={...character,balance:isk(nextBuyer),balanceChange:isk(-grossCents),
     walletJournal:[{...journalBase,amount:isk(-grossCents),balance:isk(nextBuyer)},
       ...character.walletJournal].slice(0,100),
     marketTransactions:[{transactionID:fillID,transactionDate:filetime,typeID:identity.typeID,
      quantity:identity.quantity,price:isk(priceCents),stationID:identity.stationID,
      locationID:identity.stationID,buyerID,sellerID:identity.ownerID,clientID:identity.ownerID,
      accountID:1000,buyerAccountID:1000,sellerAccountID:1000,journalRefID:fillID},
      ...character.marketTransactions].slice(0,2000)};
   const corpEntry={...journalBase,amount:isk(grossCents),balance:isk(nextCorp)};
   const corpAfter={...corp,wallet:{...corp.wallet,divisions:{...corp.wallet.divisions,
      "1000":{...division,balance:isk(nextCorp),
       journal:[...division.journal,corpEntry].slice(-100),
       transactions:[...division.transactions,corpEntry].slice(-2000)}}}};
   const delivered={...item,ownerID:buyerID,locationID:identity.stationID};
   const receipt={phase:"NATIVE_COMMITTED",fillID,orderID:identity.orderID,operationID:identity.operationID,
    itemID:identity.itemID,buyerID,ownerID:identity.ownerID,stationID:identity.stationID,
    typeID:identity.typeID,quantity:identity.quantity,priceCents,grossCents,
    buyerBeforeCents:oldBuyer,buyerAfterCents:nextBuyer,
    corpBeforeCents:oldCorp,corpAfterCents:nextCorp,committedAt:now};
   // All four source-of-truth transitions plus the idempotency receipt commit together.
   tx.put("characters",String(buyerID),buyerAfter);
   tx.put("corporationRuntime",corpKey,corpAfter);
   tx.put("items",itemKey,delivered);
   tx.del("marketEscrow",orderKey);
   tx.put("npcMarketFills",fillKey,receipt);
   return {status:"NATIVE_COMMITTED",fillID,orderID:identity.orderID,buyerID,
    itemID:identity.itemID,quantity:identity.quantity,grossCents};
  });
 }
 async function purchaseOnce({buyerID,identity,maxPriceCents}={}){
  if(!gate())return {status:"BLOCKED",error:"NPC_CORPORATE_SETTLEMENT_DISABLED"};
  if(!pos(buyerID)||!Number.isSafeInteger(maxPriceCents)||maxPriceCents<=0||
     !identity||!validID(identity.operationID)||
     [identity.orderID,identity.ownerID,identity.stationID,
      identity.typeID,identity.itemID,identity.quantity].some(x=>!pos(x))||
     identity.quantity>50000)return {status:"BLOCKED",error:"NPC_CORPORATE_PURCHASE_INVALID"};
  if(verifyBuyerSession(buyerID,identity.stationID)!==true)
    return {status:"BLOCKED",error:"NPC_BUYER_SESSION_OR_DOCK_INVALID"};
  const key=identity.orderID;
  if(active.has(key))return {status:"BLOCKED",error:"NPC_PURCHASE_BUSY"};
  active.add(key);
  try{
   // Claim is durable and idempotent in Rust; only ONE buyer can win per order.
   // A mid-flight crash leaves Rust SETTLING and invisible to other buyers.
   const order=await market.claimOnce({orderID:key,buyerID,operationID:identity.operationID});
   const receipt=atomicSettle(order,buyerID,identity,maxPriceCents);
   const final=await market.finalizeOnce({orderID:key,buyerID,
      operationID:identity.operationID,fillID:receipt.fillID});
   if(final?.state!=="filled"||Number(final.order_id)!==key||
      Number(final.buyer_id)!==buyerID||Number(final.fill_id)!==receipt.fillID||
      Number(final.vol_remaining)!==0)
     throw Error("NPC_RUST_FILL_FINALIZE_UNCERTAIN");
   const observed=await market.inspectClaim({orderID:key,operationID:identity.operationID});
   if(observed?.state!=="filled"||Number(observed.fill_id)!==receipt.fillID||
      Number(observed.buyer_id)!==buyerID)
     throw Error("NPC_RUST_FILL_ACK_UNCERTAIN");
   return {...receipt,status:"PURCHASED"};
  }finally{active.delete(key)}
 }
 return Object.freeze({purchaseOnce,atomicSettle,mode:"WHOLE_STACK_PROOF_ONLY",
  supportsLiveSettlement:false});
}
module.exports={createNpcCorporateSettlement,TABLES};
