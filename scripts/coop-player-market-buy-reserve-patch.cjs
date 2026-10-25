"use strict";
// Reversible original EveJS BUY placement protection, installed after P2P
// native atomic market hooks. New reserve mode is opt-in and fail-closed.
const fileName="server/src/services/market/marketProxyService.js";
const FLAG='process.env.EVEJS_COOP_PLAYER_MARKET_BUY_RESERVE === "1"';
function patch(source,{remove=false}={}){
 if(typeof source!=="string")throw Error("P2P_BUY_RESERVE_SOURCE_REQUIRED");
 const eol=source.includes("\r\n")?"\r\n":"\n";
 let s=source;
 function inject(start,end,anchor,addition,{before=true}={}){
  const i=s.indexOf(start),j=s.indexOf(end,i+start.length);
  if(i<0||j<0||s.indexOf(start,i+start.length)!==-1)
   throw Error("P2P_BUY_RESERVE_METHOD_SCOPE_DRIFT");
  const beforePart=s.slice(i,j),base=anchor.replace(/\n/g,eol),
   added=addition.replace(/\n/g,eol),
   next=before?added+eol+base:base+eol+added;
  const n=(hay,needle)=>hay.split(needle).length-1;
  let part;
  if(n(beforePart,added)===1){
   // Other market patches may install their own hooks between this
   // guard and its upstream anchor on a repeated central install.
   if(remove){
    const removeBefore=added+eol,removeAfter=eol+added;
    if(n(beforePart,removeBefore)===1)part=beforePart.replace(removeBefore,"");
    else if(n(beforePart,removeAfter)===1)part=beforePart.replace(removeAfter,"");
    else throw Error("P2P_BUY_RESERVE_INJECTED_HOOK_NOT_REVERSIBLE");
   }else part=beforePart;
  }else if(n(beforePart,added)>1){
   throw Error("P2P_BUY_RESERVE_DUPLICATE_SOURCE_GUARD");
  }else if(n(beforePart,base)===1){
   part=remove?beforePart:beforePart.replace(base,next);
  }else throw Error("P2P_BUY_RESERVE_HOOK_ANCHOR_DRIFT");
  s=s.slice(0,i)+part+s.slice(j);
 }
 const buy="async function executeBuyRequest({",
   sell="async function executeSellEntry({",
   expiry="async function applyExpiredOrderEvent(event) {",
   cancelled="function applyCancelledStructureMarketOrder(order) {",
   processed="async function processPendingExpiryEvents({",
   sync="function syncOpenBuyEscrowRecords(ownerOrders = []) {",
   moved="function updateMovedItemsOwner(changes = [], ownerID) {",
   handleCancel="  async Handle_CancelCharOrder(args, session) {",
   handleBuy="  async Handle_PlaceBuyOrder(args, session) {",
   handleModify="  async Handle_ModifyCharOrder(args, session) {",
   handleGet="  async Handle_GetCharOrders(args, session) {"; // fallback scope: inspect exact methods below
 inject(sync,moved,'  for (const ownerOrder of ensureArray(ownerOrders)) {',
  '  if ('+FLAG+') return; // Unfunded Rust rows must not reconstruct GameStore escrow');
 inject(buy,sell,'  const typeLabel = getMarketTypeLabel(typeID);',
  '  if ('+FLAG+' && (process.env.EVEJS_COOP_PLAYER_MARKET_ATOMIC !== "1" || process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS !== "1" || process.env.EVEJS_COOP_RUST_P2P_CLAIM !== "1" || process.env.EVEJS_COOP_PLAYER_MARKET_FILL_GUARD !== "1" || process.env.EVEJS_COOP_PLAYER_MARKET_SETTLEMENT_FENCE !== "1")) throw Error("P2P_BUY_RESERVE_ALL_GUARDS_REQUIRED");',
  {before:false});
 inject(buy,sell,
  '  const matchResult = await matchSellOrdersForBuyer({',
  '  if ('+FLAG+' && normalizedDuration>0) {\n'+
  '    require("../../space/coopPlayerMarketBuyReserve").assertExisting(openOrders,characterID);\n'+
  '    if(getStructureMarketLocation(stationID)) throw Error("P2P_BUY_RESERVE_STRUCTURE_OWNER_CREDIT_UNSUPPORTED");\n'+
  '    const placement=await require("../../space/coopPlayerMarketBuyReserveRuntime").place({\n'+
  '      client:marketDaemonClient,\n'+
  '      quote:{buyerID:characterID,stationID,typeID,price:normalizedPrice,\n'+
  '        quantity:normalizedQuantity,minVolume:normalizedMinVolume,\n'+
  '        durationDays:normalizedDuration,orderRange:normalizeInteger(orderRange,RANGE_STATION),\n'+
  '        brokerFee:brokerFeeUpperBound,sccSurcharge:sccSurchargeUpperBound}\n'+
  '    });\n'+
  '    const account=require("../account/walletState");\n'+
  '    account.notifyCharacterWalletChange(characterID,account.getCharacterWallet(characterID));\n'+
  '    notifyOwnOrdersChanged(characterID,[placement.order],ORDER_REASON_CREATED);\n'+
  '    return {boughtQuantity:0,totalSpent:0,createdOrder:placement.order,\n'+
  '      remainingQuantity:normalizedQuantity};\n'+
  '  }');
 inject(expiry,cancelled,
  '  if (normalizeBoolean(orderRow && orderRow.bid)) {',
  '  if ('+FLAG+' && normalizeBoolean(orderRow && orderRow.bid)) throw Error("P2P_BUY_RESERVE_EXPIRY_REQUIRES_AUDITED_SETTLEMENT");');
 inject(cancelled,processed,
  '  if (normalizeBoolean(orderRow && orderRow.bid)) {',
  '  if ('+FLAG+' && normalizeBoolean(orderRow && orderRow.bid)) throw Error("P2P_BUY_RESERVE_STATION_CANCEL_REQUIRES_AUDITED_SETTLEMENT");');
 inject(handleCancel,handleBuy,
  '      const stationID = normalizePositiveInteger(orderRow && orderRow.station_id, 0);',
  '      if ('+FLAG+' && normalizeBoolean(orderRow && orderRow.bid)) throw Error("P2P_BUY_RESERVE_CANCEL_REQUIRES_AUDITED_SETTLEMENT");');
 const start=s.indexOf(handleModify);
 if(start<0)throw Error("P2P_BUY_RESERVE_MODIFY_HANDLER_MISSING");
 // Do not rely on another handler name: operate on the exact source segment
 // from the first original orderRow assignment inside ModifyCharOrder.
 const modifyAnchor='      const orderRow = getOwnerOrderResponseOrder(order);';
 const possible=s.indexOf(modifyAnchor,start);
 if(possible<0)throw Error("P2P_BUY_RESERVE_MODIFY_ORDER_ROW_MISSING");
 const end=s.indexOf('      const oldPrice = Number(orderRow && orderRow.price)',possible);
 if(end<0)throw Error("P2P_BUY_RESERVE_MODIFY_OLD_PRICE_MISSING");
 const chunk=s.slice(possible,end),old=modifyAnchor,
  inserted='      if ('+FLAG+' && normalizeBoolean(orderRow && orderRow.bid)) throw Error("P2P_BUY_RESERVE_MODIFY_REQUIRES_AUDITED_SETTLEMENT");';
 const combined=old+eol+inserted;
 if(chunk.includes(combined)){
  if(remove)s=s.slice(0,possible)+chunk.replace(combined,old)+s.slice(end);
 }else if(!remove){
  if(chunk.split(old).length!==2||chunk.includes(inserted))
   throw Error("P2P_BUY_RESERVE_MODIFY_ANCHOR_DRIFT");
  s=s.slice(0,possible)+chunk.replace(old,combined)+s.slice(end);
 }
 return s;
}
module.exports={patch,fileName};
