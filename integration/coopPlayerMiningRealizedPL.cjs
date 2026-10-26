"use strict";
/**
 * CH24+31 — auditable corporate mining P&L from original native receipts.
 * This is not a sale engine. It refuses to call simulated, claimed-only or
 * unsettled revenue "profit", and never values unsold inventory as cash.
 */
const SEP="\u001f",pos=x=>Number.isSafeInteger(x)&&x>0;
const money=x=>Number.isSafeInteger(x)&&x>=0;
const key=(group,id)=>"/"+group+"/"+id;
const denied=reason=>Object.freeze({status:"BLOCKED",reason,nativeMutation:false});
function createCorporateMiningRealizedPL({gameStore,access,enabled=()=>false,
 verifyReleasedFill}={}){
 if(typeof gameStore?.read!=="function"||
  [access?.isMember,access?.canIndustry,access?.canWallet,
   enabled,verifyReleasedFill].some(f=>typeof f!=="function"))
  throw Error("CORP_PL_ORIGINAL_NATIVE_READ_AUTHORITIES_REQUIRED");
 function read(group,id){
  const r=gameStore.read("corporationRuntime",key(group,id));
  if(r?.success===true)return r.data;
  if(r?.errorMsg==="ENTRY_NOT_FOUND")return null;
  throw Error("CORP_PL_NATIVE_READ_UNAVAILABLE");
 }
 function group(name){
  const r=gameStore.read("corporationRuntime","/"+name);
  if(r?.errorMsg==="ENTRY_NOT_FOUND")return {};
  if(r?.success!==true||!r.data||typeof r.data!=="object"||
   Array.isArray(r.data)||Object.keys(r.data).length>10000)
   throw Error("CORP_PL_SOURCE_INDEX_UNVERIFIED");
  return r.data;
 }
 function report({session,corporationID,operationID}={}){
  if(enabled()!==true)return denied("CORP_PL_DISABLED");
  if(!session||session.socket?.destroyed===true||
    !pos(session.characterID)||session.corporationID!==corporationID||
    !pos(corporationID)||!/^coop-mining-shift:[a-f0-9]{32}$/.test(operationID||"")||
    access.isMember(session,corporationID)!==true||
    access.canIndustry(session,corporationID)!==true||
    access.canWallet(session,corporationID,1000)!==true)
   return denied("CORP_PL_ROLE_OR_SCOPE_DENIED");
  try{
   const shift=read("coopPlayerMiningShift",operationID);
   if(shift?.version!==1||shift.status!=="FUNDED"||
    shift.corporationID!==corporationID||shift.operationID!==operationID||
    !pos(shift.wageCents)||!pos(shift.employerCorpID))
    return denied("CORP_PL_ORIGINAL_SHIFT_NOT_FUNDED");
   const ore=group("coopPlayerMiningOreTitle"),
     sales=group("coopPlayerMiningCorpSell"),
     fills=group("coopPlayerMiningCorpFill");
   let paidOreCents=0,grossRevenueCents=0,marketFeesCents=0,
    netRevenueCents=0,quantityBought=0,quantitySold=0,
    remainingQuantity=0,returnedQuantity=0,completedFills=0;
   const cargo=new Map(),titles=[];
   for(const [id,t] of Object.entries(ore)){
    if(t?.shiftID!==operationID)continue;
    if(!pos(Number(id))||String(Number(id))!==id||
      t.version!==1||t.status!=="COMMITTED"||
      t.buyerCorpID!==corporationID||
      t.sourceCorpID!==shift.employerCorpID||
      t.cargoID!==Number(id)||!pos(t.quantity)||
      !money(t.priceCents)||!pos(t.itemID))
     return denied("CORP_PL_INVALID_ORIGINAL_PURCHASE");
    paidOreCents+=t.priceCents;quantityBought+=t.quantity;
    if(!money(paidOreCents)||!money(quantityBought))
     return denied("CORP_PL_OVERFLOW");
    cargo.set(Number(id),t);
    titles.push(t);
   }
   const saleByOrder=new Map();
   for(const [id,s] of Object.entries(sales)){
    if(s?.operationID!==operationID)continue;
    const cid=Number(id),title=cargo.get(cid);
    if(!title||s.cargoID!==cid||s.corporationID!==corporationID||
      s.itemID!==title.itemID||s.typeID!==title.typeID||
      s.stationID!==title.stationID||
      !["ESCROW_BOUND_UNSETTLED","ACTIVE_SELL","FULLY_SOLD",
        "RETURNED_UNSOLD","RETURNED_UNFILLED"].includes(s.phase)||
      typeof s.orderID!=="string"||!/^[1-9][0-9]{0,17}$/.test(s.orderID)||
      saleByOrder.has(s.orderID))
     return denied("CORP_PL_ORIGINAL_SALE_TITLE_MISMATCH");
    saleByOrder.set(s.orderID,{sale:s,title,cid,items:[]});
   }
   for(const [key,f] of Object.entries(fills)){
    if(f?.sellerCorpID!==corporationID)continue;
    if(!saleByOrder.has(f.orderID))continue;
    const record=saleByOrder.get(f.orderID);
    if(key!==f.orderID+":"+f.cycle||f.version!==1||
      f.phase!=="GAMESTORE_COMMITTED"||
      f.cargoID!==record.cid||f.sourceItemID!==record.title.itemID||
      !pos(f.cycle)||!pos(f.quantity)||!money(f.volumeAfter)||
      !pos(f.grossCents)||!money(f.transactionTaxCents)||
      !money(f.brokerFeeCents)||!money(f.netRevenueCents)||
      f.grossCents-f.transactionTaxCents-f.brokerFeeCents!==f.netRevenueCents||
      !pos(f.buyerJournalID)||!pos(f.sellerJournalID)||
      verifyReleasedFill({orderID:f.orderID,cycle:f.cycle,receipt:f})!==true)
     return denied("CORP_PL_FILL_NOT_RELEASED_OR_UNVERIFIED");
    record.items.push(f);
   }
   for(const record of saleByOrder.values()){
    record.items.sort((a,b)=>a.cycle-b.cycle);
    let volume=record.title.quantity;
    for(let i=0;i<record.items.length;i++){
     const f=record.items[i];
     if(f.cycle!==i+1||f.volumeBefore!==volume||
       f.volumeAfter!==volume-f.quantity)
      return denied("CORP_PL_FILL_SEQUENCE_NOT_CONSERVED");
     volume=f.volumeAfter;
     grossRevenueCents+=f.grossCents;
     marketFeesCents+=f.transactionTaxCents+f.brokerFeeCents;
     netRevenueCents+=f.netRevenueCents;
     quantitySold+=f.quantity;completedFills++;
    }
    if(![volume===0?"FULLY_SOLD":"ACTIVE_SELL",
      "ESCROW_BOUND_UNSETTLED","RETURNED_UNSOLD","RETURNED_UNFILLED"]
      .includes(record.sale.phase))
      return denied("CORP_PL_SALE_STATE_MISMATCH");
    if(["RETURNED_UNSOLD","RETURNED_UNFILLED"].includes(record.sale.phase)){
     const returned=record.sale.returnedQuantity??volume;
     if(returned!==volume)return denied("CORP_PL_RETURN_MISMATCH");
     returnedQuantity+=volume;
    }else remainingQuantity+=volume;
   }
   if([grossRevenueCents,marketFeesCents,netRevenueCents,quantitySold,
      remainingQuantity,returnedQuantity].some(x=>!money(x)))
    return denied("CORP_PL_OVERFLOW");
   const cashExpensesCents=shift.wageCents+paidOreCents,
    realizedNetCashCents=netRevenueCents-cashExpensesCents;
   if(!Number.isSafeInteger(cashExpensesCents)||
      !Number.isSafeInteger(realizedNetCashCents))
    return denied("CORP_PL_OVERFLOW");
   return Object.freeze({
    status:"VERIFIED_SCOPED_CASH_PL",corporationID,operationID,
    wagePaidCents:shift.wageCents,orePurchasedCents:paidOreCents,
    grossRevenueCents,marketFeesCents,netRevenueCents,
    cashExpensesCents,realizedNetCashCents,
    completedFills,quantityBought,quantitySold,remainingQuantity,
    returnedQuantity,inventoryValuationCents:null,
    accountingProfitCents:null,
    scope:"FUNDED_SHIFT_VERIFIED_NATIVE_PURCHASES_RELEASED_FILLS",
    isFullAccountingPL:false,nativeMutation:false
   });
  }catch{return denied("CORP_PL_ORIGINAL_READ_UNAVAILABLE")}
 }
 return Object.freeze({report,mode:"SOURCE_VERIFIED_REALIZED_CASH_ONLY"});
}
module.exports={createCorporateMiningRealizedPL};
