"use strict";
// COOP-049: native read/adapt only; delegates every paid write to COOP-048.
// No NPC session impersonation, virtual wallet, synthetic cargo, or new timer.
const {createNpcCorporateBuyer}=require("./coopNpcCorporateBuyerAtomic.cjs");
const {createNpcBuyerCoordinator}=require("./coopNpcBuyerCoordinator.cjs");
const pos=x=>Number.isSafeInteger(x)&&x>0;
const count=x=>Number.isSafeInteger(x)&&x>=0;
const cents=x=>typeof x==="number"&&Number.isFinite(x)&&x>=0&&
 Number.isSafeInteger(Math.round(x*100))?Math.round(x*100):null;
function createNativeNpcBuyerBindings({gameStore,itemStore,marketClient,
 getStation,resolveActor,readNeeds,file,clock=()=>Date.now(),env=process.env}={}){
 if(typeof gameStore?.read!=="function"||
    typeof gameStore?.coopAtomicNativeRows?.transact!=="function"||
    typeof itemStore?.listOwnedItems!=="function"||
    typeof itemStore?.findItemById!=="function"||
    typeof marketClient?.call!=="function"||
    [getStation,resolveActor,readNeeds,clock].some(x=>typeof x!=="function"))
  throw Error("ALIFE_NATIVE_BUYER_AUTHORITIES_REQUIRED");
 const read=(table,key)=>{
  const result=gameStore.read(table,key);
  if(result?.success!==true||result.data==null)
   throw Error("ALIFE_BUYER_NATIVE_READ_MISSING:"+table);
  return result.data;
 };
 function corp(id){
  const record=read("corporations","/records/"+id);
  const runtime=read("corporationRuntime","/corporations/"+id);
  if(record?.corporationID!==id||record.isNPC!==true||
     runtime?.corporationID!==id||cents(runtime?.wallet?.divisions?.["1000"]?.balance)===null)
   throw Error("ALIFE_BUYER_NATIVE_CORPORATION_NOT_VERIFIED");
  return {record,runtime,walletCents:cents(runtime.wallet.divisions["1000"].balance)};
 }
 function verifyCorp(id,stationID){
  try{
   const s=getStation(stationID);
   if(!pos(id)||!pos(stationID)||s?.stationID!==stationID)return false;
   corp(id);return true;
  }catch{return false}
 }
 function verifySeller(id,stationID){
  try{
   if(!pos(id)||!pos(stationID))return false;
   const s=read("characters","/"+id);
   return Number(s?.characterID??s?.charID)===id&&
     cents(s.balance)!==null&&Array.isArray(s.walletJournal)&&
     Array.isArray(s.marketTransactions);
  }catch{return false}
 }
 const market={
  claimOnce:({claimKey,orderID,buyerCorpID,sellerID,quantity})=>
   marketClient.call("ClaimNpcCorpPlayerSell",{
    claim_key:claimKey,order_id:String(orderID),buyer_corp_id:String(buyerCorpID),
    seller_id:String(sellerID),quantity:String(quantity)}),
  finalizeOnce:({claimKey,orderID,buyerCorpID,fillID})=>
   marketClient.call("FinalizeNpcCorpPlayerSell",{
    claim_key:claimKey,order_id:String(orderID),buyer_corp_id:String(buyerCorpID),
    fill_id:String(fillID)}),
  inspectClaim:({claimKey})=>marketClient.call("GetNpcCorpPlayerClaim",{
   claim_key:claimKey})
 };
 const buyer=createNpcCorporateBuyer({gameStore:gameStore.coopAtomicNativeRows,
  market,verifyBuyerCorporation:verifyCorp,verifyPlayerSeller:verifySeller,clock});
 const actor=id=>resolveActor(id);
 async function readProof(ownerID,stationID,typeID){
  const station=getStation(stationID);
  const proof=readNeeds(ownerID,stationID,typeID);
  if(station?.stationID!==stationID||!pos(station.regionID)||
     !proof||proof.authoritativeNative!==true||
     proof.ownerID!==ownerID||proof.stationID!==stationID||
     proof.typeID!==typeID||!pos(proof.required)||!count(proof.available)||
     !count(proof.shortage)||proof.shortage!==Math.max(0,proof.required-proof.available)||
     !count(proof.observedAt)||clock()<proof.observedAt||
     clock()-proof.observedAt>30000||proof.required>50000)
   throw Error("ALIFE_BUYER_NATIVE_SDE_DEFICIT_NOT_VERIFIED");
  const owner=corp(ownerID),items=itemStore.listOwnedItems(ownerID);
  if(!Array.isArray(items)||items.length>10000)throw Error("ALIFE_BUYER_NATIVE_ITEMS_UNAVAILABLE");
  let physicalOwned=0;const ids=new Set();
  const itemProof=items.map(i=>{
   if(!pos(i?.itemID)||ids.has(i.itemID)||i.ownerID!==ownerID||
      !pos(i.typeID)||!count(i.quantity??i.stacksize))
    throw Error("ALIFE_BUYER_NATIVE_ITEM_CUSTODY_CONFLICT");
   ids.add(i.itemID);
   if(i.typeID===typeID&&i.locationID===stationID&&[4,115].includes(i.flagID)){
    physicalOwned+=i.quantity??i.stacksize;
    if(!count(physicalOwned))throw Error("ALIFE_BUYER_STOCK_OVERFLOW");
   }
   return [i.itemID,i.ownerID,i.locationID,i.flagID,i.typeID,i.quantity??i.stacksize];
  }).sort((a,b)=>a[0]-b[0]);
  if(physicalOwned!==proof.available)
   throw Error("ALIFE_BUYER_MATERIAL_SHORTAGE_STALE");
  const result=await marketClient.call("GetOrders",{
   region_id:station.regionID,type_id:typeID});
  if(!result||!Array.isArray(result.sells)||result.sells.length>2000)
   throw Error("ALIFE_BUYER_NATIVE_RUST_BOOK_MISSING");
  const asks=[],seen=new Set();
  for(const o of result.sells){
   if(o?.source!=="player"||o.is_corp!==false||o.bid!==false||
      o.state!=="open"||Number(o.station_id)!==stationID||
      Number(o.type_id)!==typeID)continue;
   const orderID=Number(o.order_id),sellerID=Number(o.owner_id),
    quantity=Number(o.vol_remaining),price=cents(Number(o.price));
   if(!pos(orderID)||seen.has(orderID)||!pos(sellerID)||sellerID===ownerID||
      !pos(quantity)||quantity>50000||!pos(price)||price>100000000)
    throw Error("ALIFE_BUYER_RUST_ASK_INVALID");
   seen.add(orderID);
   // No seller session is forged: require a canonical marketEscrow row and
   // exactly one real owner/item in stock location for this first slice.
   let escrow;
   try{escrow=read("marketEscrow","/"+orderID)}
   catch{continue}
   if(escrow?.escrowType!=="sell"||escrow.isCorp!==false||
      String(escrow.orderId)!==String(orderID)||escrow.ownerId!==sellerID||
      escrow.typeId!==typeID||escrow.stationId!==stationID||
      escrow.remainingQuantity!==quantity||
      escrow.escrowLocationID!==9200000000+orderID)continue;
   const physical=itemStore.listOwnedItems(sellerID);
   if(!Array.isArray(physical)||physical.length>10000)continue;
   const escrowItems=physical.filter(i=>i?.ownerID===sellerID&&
     i.locationID===escrow.escrowLocationID&&i.flagID===4);
   if(escrowItems.length!==1||escrowItems[0].typeID!==typeID||
      escrowItems[0].quantity!==quantity||escrowItems[0].stacksize!==quantity||
      escrowItems[0].singleton!==0)continue;
   if(!verifySeller(sellerID,stationID))continue;
   asks.push({verifiedNative:true,orderID,stationID,typeID,
    sellerOwnerID:sellerID,remainingQuantity:quantity,unitPriceCents:price,
    state:"open"});
  }
  // Any wallet/item change while the Rust book was being read invalidates the
  // entire proof; next A-Life tick may retry, no speculative order execution.
  const again=corp(ownerID),updated=itemStore.listOwnedItems(ownerID);
  if(again.walletCents!==owner.walletCents||
     !Array.isArray(updated)||updated.length!==items.length||
     JSON.stringify(updated.map(i=>[
       i.itemID,i.ownerID,i.locationID,i.flagID,i.typeID,i.quantity??i.stacksize
      ]).sort((a,b)=>a[0]-b[0]))!==JSON.stringify(itemProof))
   throw Error("ALIFE_BUYER_SOURCE_CHANGED_DURING_RUST_READ");
  return {authoritativeNative:true,source:"GAMESTORE_SDE_RUST_ESCROW",
   ownerID,stationID,typeID,walletCents:owner.walletCents,
   targetStock:proof.required,physicalOwned,incomingStock:0,
   outstandingBuys:0,asks};
 }
 const coordinator=createNpcBuyerCoordinator({
  file,resolveActor:actor,readProof,getOrder:id=>marketClient.call("GetOrder",{order_id:String(id)}),
  buyer,clock,env
 });
 return Object.freeze({tick:args=>coordinator.tick(args),inspect:()=>coordinator.inspect(),
  mode:"ALIFE_NATIVE_RUST_GAMESTORE_BUYER",supportsLiveRuntime:false});
}
module.exports={createNativeNpcBuyerBindings};
