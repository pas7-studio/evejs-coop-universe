"use strict";
// Reversible source-witness for durable P2P fills, following existing guard.
// Does NOT change original Rust market transaction implementation.
const fileName="server/src/services/market/marketProxyService.js";
const gate='process.env.EVEJS_COOP_PLAYER_MARKET_SETTLEMENT_FENCE === "1"';
const svc='require("../../space/coopPlayerMarketSettlementFence")';
function patch(src,{remove=false}={}){
 if(typeof src!=="string")throw Error("P2P_SETTLEMENT_SOURCE_REQUIRED");
 let text=src;
 const nl=src.includes("\r\n")?"\r\n":"\n";
 function edit(start,end,anchor,hook,{after=false}={}){
  const first=text.indexOf(start);
  if(first<0||text.indexOf(start,first+start.length)!==-1)
   throw Error("P2P_SETTLEMENT_METHOD_ANCHOR_MISSING");
  const last=text.indexOf(end,first+start.length);
  if(last<0)throw Error("P2P_SETTLEMENT_METHOD_END_MISSING");
  const section=text.slice(first,last);
  const applied=after?anchor+nl+hook:hook+nl+anchor;
  if(section.split(applied).length===2){
   if(remove)text=text.slice(0,first)+section.replace(applied,anchor)+text.slice(last);
  }else{
   if(section.split(anchor).length!==2||section.includes(hook))
    throw Error("P2P_SETTLEMENT_METHOD_SOURCE_DRIFT");
   if(!remove)text=text.slice(0,first)+section.replace(anchor,applied)+text.slice(last);
  }
 }
 function lineIn(start,end,prefix){
  const startAt=text.indexOf(start),endAt=text.indexOf(end,startAt+start.length);
  if(startAt<0||endAt<0)throw Error("P2P_SETTLEMENT_LINE_SCOPE_MISSING");
  const lines=text.slice(startAt,endAt).split(nl).filter(s=>s.trim().startsWith(prefix));
  if(lines.length!==1)throw Error("P2P_SETTLEMENT_GUARD_DEPENDENCY_MISSING:"+prefix);
  return lines[0];
 }
 const bs="async function matchSellOrdersForBuyer({",
  ss="async function matchBuyOrdersForSeller({",
  be="async function executeBuyRequest({",
  ce="  async Handle_CancelCharOrder(args, session) {",
  cm="  async Handle_ModifyCharOrder(args, session) {",
  exp="async function applyExpiredOrderEvent(event) {",
  stru="function applyCancelledStructureMarketOrder(order) {",
  service="async function cancelStructureMarketOrdersForServiceLoss(",
  expiry="async function processPendingExpiryEvents(";
 const configGuard='  if ('+gate+' && process.env.EVEJS_COOP_PLAYER_MARKET_FILL_GUARD !== "1") throw Error("P2P_SETTLEMENT_REQUIRES_PLAYER_FILL_GUARD");';
 edit(bs,ss,
  '  const book = await marketDaemonClient.call("GetOrders", {',
  configGuard);
 edit(ss,be,
  '  const book = await marketDaemonClient.call("GetOrders", {',
  configGuard);
 const sellProof=lineIn(bs,ss,"coopPlayerSellProof =");
 const buyProof=lineIn(ss,be,"const coopPlayerBuyProof =");
 const sellAck=lineIn(bs,ss,"if (coopPlayerSellProof) require(");
 const buyAck=lineIn(ss,be,"if (coopPlayerBuyProof) require(");
 edit(bs,ss,sellProof,
  '        if ('+gate+' && !chargeBuyerWallet) throw Error("P2P_SETTLEMENT_RESERVED_BUY_ORDER_CROSSING_UNSUPPORTED");'+nl+
  '        const coopPlayerSellTicket = coopPlayerSellProof && '+gate+
  ' ? '+svc+'.begin(coopPlayerSellProof,{chargeBuyerWallet}) : null;', {after:true});
 edit(ss,be,
  '    const sellerInventoryChanges = [];',
  '    if ('+gate+' && !isSeedBuyOrder && sourceOrderId && normalizeOrderId(sourceOrderId)!=="0") throw Error("P2P_SETTLEMENT_DOUBLE_ORDER_CROSSING_UNSUPPORTED");'+nl+
  '    const coopPlayerBuyTicket = coopPlayerBuyProof && '+gate+
  ' ? '+svc+'.begin(coopPlayerBuyProof,{chargeBuyerWallet:false}) : null;', {after:true});
 edit(bs,ss,
  '        const grossAmount = roundIsk(orderPrice * tradedQuantity);',
  '        if (coopPlayerSellTicket) '+svc+'.confirmRust(coopPlayerSellTicket,fillResponse);',{after:true});
 edit(ss,be,
  '    const grossAmount = roundIsk(orderPrice * fillableQuantity);',
  '    if (coopPlayerBuyTicket) '+svc+'.confirmRust(coopPlayerBuyTicket,fillResponse);',{after:true});
 // Proof must become SETTLED only AFTER original escrow mutation and
 // seller wallet credit/tax, not immediately after Rust acknowledges a fill.
 edit(bs,ss,
  '        }'+nl+'      }'+nl+
  '      if (String(sellOrder && sellOrder.source || "").toLowerCase() === "seed") {',
  '        if (coopPlayerSellTicket) '+svc+'.complete(coopPlayerSellTicket,{salesTax});');
 edit(ss,be,
  '      }'+nl+'    }'+nl+nl+'    totalSold += fillableQuantity;',
  '      if (coopPlayerBuyTicket) '+svc+'.complete(coopPlayerBuyTicket,{salesTax});');
 // Never allow cancel, modify, expiry, or structure-service cancellation to
 // discard Rust/escrow rows while their matching P2P fill is unresolved.
 edit(ce,cm,
  '    log.debug(\`[MarketProxy] CancelCharOrder order=\${orderID}\`);',
  '    if ('+gate+') '+svc+'.assertClear(orderID);');
 edit(cm,"  async Handle_", // next method in the class, not the same handler
  '    log.debug(\`[MarketProxy] ModifyCharOrder order=\${orderID} price=\${newPrice}\`);',
  '    if ('+gate+') '+svc+'.assertClear(orderID);');
 edit(exp,stru,
  '  const orderID = normalizeOrderId(order && order.order_id);',
  '  if ('+gate+') '+svc+'.assertClear(orderID);',{after:true});
 edit(stru,service,
  '  const orderID = normalizeOrderId(order && order.order_id);',
  '  if ('+gate+') '+svc+'.assertClear(orderID);',{after:true});
 edit(service,expiry,
  '  const quietDaemonUnavailable = options && options.quietDaemonUnavailable === true;',
  '  if ('+gate+') '+svc+'.assertStationClear(stationID);');
 return text;
}
module.exports={patch,fileName};
