"use strict";
// P0: native BUY reserve custody proof. This is a GameStore escrow, not
// a parallel wallet or a Rust transaction. The pending reserve is never
// automatically refunded after an uncertain PlaceOrder outcome.
const {randomUUID}=require("node:crypto");
const TABLES=Object.freeze(["characters","identityState","playerMarketFills","marketEscrow"]);
const positive=n=>typeof n==="number"&&Number.isSafeInteger(n)&&n>0;
const natural=n=>typeof n==="number"&&Number.isSafeInteger(n)&&n>=0;
const orderID=id=>typeof id==="string"&&/^[1-9][0-9]*$/.test(id);
const toCents=n=>{
 if(typeof n!=="number"||!Number.isFinite(n)||n<0)return null;
 const value=n*100,c=Math.round(value);
 return natural(c)&&Math.abs(value-c)<0.000001?c:null;
};
const isk=n=>n/100;
const keyFor=operationID=>"buy-reserve:"+operationID;
function requireQuote(quote){
 if(!quote||!positive(quote.buyerID)||!positive(quote.stationID)||
    !positive(quote.typeID)||!positive(quote.quantity)||
    !positive(quote.minVolume)||quote.minVolume>quote.quantity||
    !positive(quote.durationDays)||!Number.isSafeInteger(quote.orderRange)||
    quote.orderRange<0)
  throw Error("P2P_BUY_RESERVE_ORIGINAL_QUOTE_INVALID");
 const priceCents=toCents(quote.price),
  brokerCents=toCents(quote.brokerFee),
  sccCents=toCents(quote.sccSurcharge);
 if(!positive(priceCents)||brokerCents===null||sccCents===null)
  throw Error("P2P_BUY_RESERVE_PRICE_OR_FEE_INVALID");
 const reservedCents=priceCents*quote.quantity;
 const totalCents=reservedCents+brokerCents+sccCents;
 if(!positive(reservedCents)||!positive(totalCents)||
    !Number.isSafeInteger(totalCents))
  throw Error("P2P_BUY_RESERVE_ISK_OVERFLOW");
 return Object.freeze({...quote,priceCents,brokerCents,sccCents,
   reservedCents,totalCents});
}
function createBuyReserve({gameStore,makeID=randomUUID,clock=()=>Date.now()}={}){
 if(typeof gameStore?.transact!=="function"||
    typeof makeID!=="function"||typeof clock!=="function")
  throw Error("P2P_BUY_RESERVE_NATIVE_GAMESTORE_REQUIRED");
 function enabled(){
  return [
   "EVEJS_COOP_PLAYER_MARKET_BUY_RESERVE",
   "EVEJS_COOP_PLAYER_MARKET_ATOMIC",
   "EVEJS_COOP_NATIVE_ATOMIC_ROWS",
   "EVEJS_COOP_RUST_P2P_CLAIM",
   "EVEJS_COOP_PLAYER_MARKET_FILL_GUARD",
   "EVEJS_COOP_PLAYER_MARKET_SETTLEMENT_FENCE"
  ].every(k=>process.env[k]==="1");
 }
 function begin(quote){
  if(!enabled())throw Error("P2P_BUY_RESERVE_FLAGS_DISABLED");
  const q=requireQuote(quote);
  const operationID=makeID();
  if(typeof operationID!=="string"||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(operationID))
   throw Error("P2P_BUY_RESERVE_OPERATION_ID_REQUIRED");
  const key=keyFor(operationID);
  return gameStore.transact(TABLES,tx=>{
   if(tx.get("playerMarketFills",key))
    throw Error("P2P_BUY_RESERVE_OPERATION_ALREADY_EXISTS");
   for(const entry of tx.scan("playerMarketFills")){
    if(entry.value?.kind==="P2P_BUY_RESERVE"&&
       entry.value?.phase==="RESERVED"&&entry.value?.buyerID===q.buyerID)
     throw Error("P2P_BUY_RESERVE_UNRESOLVED_OPERATION_FOR_BUYER");
   }
   const wallet=tx.get("characters",String(q.buyerID));
   if(!wallet||Number(wallet.characterID??wallet.charID)!==q.buyerID||
      !Array.isArray(wallet.walletJournal)||
      !Array.isArray(wallet.marketTransactions))
    throw Error("P2P_BUY_RESERVE_WALLET_AUTHORITY_UNAVAILABLE");
   const before=toCents(wallet.balance);
   if(before===null||before<q.totalCents)
    throw Error("P2P_BUY_RESERVE_FUNDS_INSUFFICIENT");
   const after=before-q.totalCents;
   const sequence=tx.get("identityState","coopP2PMarketJournal");
   const next=sequence?.next??5000000000000000;
   if(!positive(next)||next<5000000000000000||
      !positive(next+3)||next+3>Number.MAX_SAFE_INTEGER)
    throw Error("P2P_BUY_RESERVE_WALLET_JOURNAL_OVERFLOW");
   const at=clock();
   if(!positive(at))throw Error("P2P_BUY_RESERVE_CLOCK_INVALID");
   const time=String(BigInt(at)*10000n+116444736000000000n);
   const amounts=[
    {id:next,amount:q.reservedCents,entryTypeID:42,description:"P2P original BUY reserve"},
    {id:next+1,amount:q.brokerCents,entryTypeID:46,description:"P2P original BUY broker fee"},
    {id:next+2,amount:q.sccCents,entryTypeID:149,description:"P2P original BUY SCC surcharge"}
   ];
   const used=new Set(wallet.walletJournal.map(e=>e?.transactionID));
   if(amounts.some(e=>used.has(e.id)))
    throw Error("P2P_BUY_RESERVE_JOURNAL_ID_COLLISION");
   let running=before;
   const entries=[];
   for(const a of amounts){
    if(a.amount===0)continue;
    running-=a.amount;
    entries.unshift({
      transactionID:a.id,transactionDate:time,entryTypeID:a.entryTypeID,
      amount:isk(-a.amount),balance:isk(running),
      referenceID:q.stationID,ownerID1:q.buyerID,ownerID2:q.stationID,
      currency:1,accountKey:1000,sortValue:1,
      description:a.description+" "+operationID
    });
   }
   if(running!==after)throw Error("P2P_BUY_RESERVE_BALANCE_CONSERVATION");
   const receipt={
    kind:"P2P_BUY_RESERVE",phase:"RESERVED",
    key,operationID,buyerID:q.buyerID,stationID:q.stationID,
    typeID:q.typeID,quantity:q.quantity,minVolume:q.minVolume,
    durationDays:q.durationDays,orderRange:q.orderRange,
    priceCents:q.priceCents,brokerCents:q.brokerCents,
    sccCents:q.sccCents,reservedCents:q.reservedCents,
    totalCents:q.totalCents,buyerBeforeCents:before,
    buyerAfterCents:after,journalIDs:amounts.map(a=>a.id),
    createdAt:at,orderID:null
   };
   tx.put("characters",String(q.buyerID),{
    ...wallet,balance:isk(after),balanceChange:isk(-q.totalCents),
    walletJournal:[...entries,...wallet.walletJournal].slice(0,100)
   });
   tx.put("identityState","coopP2PMarketJournal",{next:next+3});
   tx.put("playerMarketFills",key,receipt);
   return receipt;
  });
 }
 function bind(receipt,order){
  if(!enabled())throw Error("P2P_BUY_RESERVE_FLAGS_DISABLED");
  if(!receipt||receipt.kind!=="P2P_BUY_RESERVE"||
     typeof receipt.operationID!=="string"||
     !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(receipt.operationID))
   throw Error("P2P_BUY_RESERVE_RECEIPT_INVALID");
  const id=String(order?.order_id??"");
  const row=order?.row;
  if(!orderID(id)||!row||String(row.order_id)!==id||
     order.owner_id!==receipt.buyerID||order.is_corp!==false||
     order.source!=="player"||order.state!=="open"||
     row.bid!==true||row.station_id!==receipt.stationID||
     row.type_id!==receipt.typeID||
     row.vol_remaining!==receipt.quantity||
     row.min_volume!==receipt.minVolume||
     row.duration_days!==receipt.durationDays||
     row.range_value!==receipt.orderRange||
     toCents(row.price)!==receipt.priceCents)
   throw Error("P2P_BUY_RESERVE_RUST_ORDER_NOT_VERIFIED");
  return gameStore.transact(["playerMarketFills","marketEscrow"],tx=>{
   const original=tx.get("playerMarketFills",receipt.key);
   if(!original||original.kind!=="P2P_BUY_RESERVE"||
      original.operationID!==receipt.operationID||
      original.buyerID!==receipt.buyerID||
      original.stationID!==receipt.stationID||
      original.typeID!==receipt.typeID||
      original.quantity!==receipt.quantity||
      original.priceCents!==receipt.priceCents||
      original.minVolume!==receipt.minVolume||
      original.durationDays!==receipt.durationDays||
      original.orderRange!==receipt.orderRange||
      original.brokerCents!==receipt.brokerCents||
      original.sccCents!==receipt.sccCents||
      original.reservedCents!==receipt.reservedCents||
      original.totalCents!==receipt.totalCents)
    throw Error("P2P_BUY_RESERVE_COMMITTED_DEBIT_NOT_FOUND");
   if(original.phase==="BOUND"){
    if(original.orderID!==id)throw Error("P2P_BUY_RESERVE_BOUND_TO_OTHER_ORDER");
    const escrow=tx.get("marketEscrow",id);
    if(!escrow||escrow.coopReserveOperationID!==original.operationID||
       toCents(escrow.escrowAmount)!==original.reservedCents)
     throw Error("P2P_BUY_RESERVE_ESCROW_RECEIPT_MISMATCH");
    return {...original,replayed:true};
   }
   if(original.phase!=="RESERVED"||original.orderID!==null)
    throw Error("P2P_BUY_RESERVE_UNRECONCILED_STATE");
   for(const entry of tx.scan("playerMarketFills")){
    if(entry.key!==receipt.key&&
      entry.value?.kind==="P2P_BUY_RESERVE"&&entry.value?.orderID===id)
     throw Error("P2P_BUY_RESERVE_ORDER_ID_ALREADY_BOUND");
   }
   if(tx.get("marketEscrow",id)!==null)
    throw Error("P2P_BUY_RESERVE_EXISTING_ESCROW_CONFLICT");
   const escrow={
    orderId:id,ownerId:receipt.buyerID,isCorp:false,escrowType:"buy",
    typeId:receipt.typeID,stationId:receipt.stationID,
    price:isk(receipt.priceCents),remainingQuantity:receipt.quantity,
    escrowAmount:isk(receipt.reservedCents),
    coopReserveOperationID:receipt.operationID,
    coopReserveReceiptKey:receipt.key,
    createdAt:new Date(receipt.createdAt).toISOString(),
    updatedAt:new Date(receipt.createdAt).toISOString()
   };
   const updated={...original,phase:"BOUND",orderID:id};
   tx.put("marketEscrow",id,escrow);
   tx.put("playerMarketFills",receipt.key,updated);
   return updated;
  });
 }
 function inspect(operationID){
  if(typeof operationID!=="string"||!operationID)
   throw Error("P2P_BUY_RESERVE_OPERATION_ID_REQUIRED");
  return gameStore.transact(["playerMarketFills"],tx=>
    tx.get("playerMarketFills",keyFor(operationID)));
 }
 return Object.freeze({begin,bind,inspect});
}
let runtime=null;
function active(){
 if(!runtime)runtime=createBuyReserve({gameStore:
  require("../gameStore").coopAtomicNativeRows});
 return runtime;
}
module.exports={createBuyReserve,requireQuote,
 begin:q=>active().begin(q),bind:(receipt,order)=>active().bind(receipt,order),
 inspect:id=>active().inspect(id)};
