"use strict";
// Strict, OFF-by-default, idempotent source anchors for pinned marketProxy.
// The existing transactional overlay installer calls patch() after other market patches.
function patch(src,{remove=false}={}){
 let text=String(src);
 const nl=text.includes("\r\n")?"\r\n":"\n";
 function insert(sectionStart,sectionEnd,needle,hook){
  const start=text.indexOf(sectionStart);
  if(start<0||text.indexOf(sectionStart,start+1)>=0)throw Error("COOP_CANCEL_SOURCE_SECTION_MISSING");
  const end=text.indexOf(sectionEnd,start+sectionStart.length);
  if(end<0)throw Error("COOP_CANCEL_SOURCE_SECTION_END_MISSING");
  const section=text.slice(start,end),line=hook+nl+needle;
  if(section.includes(line)){
   if(section.split(line).length!==2)throw Error("COOP_CANCEL_DUPLICATE_PATCH");
   if(remove)text=text.slice(0,start)+section.replace(line,needle)+text.slice(end);
  }else{
   if(section.split(needle).length!==2)throw Error("COOP_CANCEL_SOURCE_ANCHOR_MISMATCH");
   if(!remove)text=text.slice(0,start)+section.replace(needle,line)+text.slice(end);
  }
 }
 const gate=(order,escrow)=>`require("../../space/coopMarketCancelCustody").assertMatchingBuyEscrow({order:${order},escrow:${escrow}})`;
 const guarded=(indent,condition,call)=>`${indent}if (process.env.EVEJS_COOP_MARKET_CANCEL_CUSTODY === "1"${condition?` && ${condition}`:""}) ${call};`;
 insert("function syncOpenBuyEscrowRecords(ownerOrders = []) {","function updateMovedItemsOwner(",
  "    upsertBuyEscrowRecord(ownerOrder);",
  guarded("    ","true",gate("ownerOrder","getEscrowRecord(normalizeOrderId(getOwnerOrderResponseOrder(ownerOrder).order_id))")));
 insert("async function applyExpiredOrderEvent(event) {","function applyCancelledStructureMarketOrder(order) {",
  '      const stationID = normalizePositiveInteger(orderRow && orderRow.station_id, 0);',
  guarded("      ","true",gate("order","escrowRecord")));
 insert("function applyCancelledStructureMarketOrder(order) {","async function cancelStructureMarketOrdersForServiceLoss(",
  '    const refundAmount = escrowRecord && getEscrowType(escrowRecord) === "buy"',
  guarded("    ","true",gate("order","escrowRecord")));
 insert("  async Handle_CancelCharOrder(args, session) {","  async Handle_ModifyCharOrder(args, session) {",
  '      const cancelResponse = await marketDaemonClient.call("CancelOrder", {',
  guarded("      ",'normalizeBoolean(orderRow && orderRow.bid)',gate("order","getEscrowRecord(orderID)")));
 insert("  async Handle_CancelCharOrder(args, session) {","  async Handle_ModifyCharOrder(args, session) {",
  '      if (normalizeBoolean(orderRow && orderRow.bid) && cancelResponse && cancelResponse.invalidated) {',
  guarded("      ","true",'require("../../space/coopMarketCancelCustody").assertCancelledAck({ack:cancelResponse,orderID})'));
 insert("  async Handle_CancelCharOrder(args, session) {","  async Handle_ModifyCharOrder(args, session) {",
  '        const refundAmount = escrowRecord && getEscrowType(escrowRecord) === "buy"',
  guarded("        ","true",gate("order","escrowRecord")));
 return text;
}
module.exports={patch};
