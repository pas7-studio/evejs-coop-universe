"use strict";
// Default-OFF native market hooks; original Rust and EveJS own all writes.
const fileName="server/src/services/market/marketProxyService.js";
function patch(source,{remove=false}={}){
 if(typeof source!=="string")throw Error("COOP_SELL_NATIVE_SOURCE_REQUIRED");
 let text=source;
 const nl=text.includes("\r\n")?"\r\n":"\n";
 const svc='require("../../space/coopMarketSellCustody")';
 const flag='process.env.EVEJS_COOP_MARKET_SELL_CUSTODY === "1"';
 const proof=(order,escrow,items)=>svc+'.assertSellEscrow({order:'+order+',escrow:'+escrow+',items:'+items+',hangarFlag:ITEM_FLAGS.HANGAR})';
 const restored=(id,owner)=>svc+'.assertSellReturned({proof:coopSellProof,remainingItems:listEscrowItemsForOrder('+id+','+owner+'),findItemById})';
 function wrap(start,end,needleLines,before,after){
  const at=text.indexOf(start);
  if(at<0||text.indexOf(start,at+start.length)>=0)throw Error("COOP_SELL_NATIVE_SECTION_DRIFT");
  const last=text.indexOf(end,at+start.length);
  if(last<0)throw Error("COOP_SELL_NATIVE_SECTION_END_DRIFT");
  const portion=text.slice(at,last),needle=needleLines.join(nl);
  const wrapped=[before,needle,after].filter(Boolean).join(nl);
  const count=(s,n)=>s.split(n).length-1;
  let changed=portion;
  if(count(portion,wrapped)===1){
   if(remove)changed=portion.replace(wrapped,needle);
  }else{
   if(count(portion,needle)!==1||
      (before&&portion.includes(before))||(after&&portion.includes(after)))
     throw Error("COOP_SELL_NATIVE_ANCHOR_DRIFT");
   if(!remove)changed=portion.replace(needle,wrapped);
  }
  text=text.slice(0,at)+changed+text.slice(last);
 }
 const exp="async function applyExpiredOrderEvent(event) {",
  structure="function applyCancelledStructureMarketOrder(order) {",
  service="async function cancelStructureMarketOrdersForServiceLoss(",
  cancel="  async Handle_CancelCharOrder(args, session) {",
  modify="  async Handle_ModifyCharOrder(args, session) {";
 wrap(exp,structure,[
  "      moveEscrowItemsBackToSeller(",
  "        orderID,",
  "        ownerID,",
  "        normalizePositiveInteger(orderRow && orderRow.station_id, 0),",
  "      );"
 ],'      const coopSellProof = '+flag+' ? '+proof("order","escrowRecord","listEscrowItemsForOrder(orderID,ownerID)")+' : null;',
 '      if (coopSellProof) '+restored("orderID","ownerID")+';');
 wrap(structure,service,[
  "    moveEscrowItemsBackToSeller(orderID, ownerID, stationID);"
 ],'    const coopSellProof = '+flag+' ? '+proof("order","getEscrowRecord(orderID)","listEscrowItemsForOrder(orderID,ownerID)")+' : null;',
 '    if (coopSellProof) '+restored("orderID","ownerID")+';');
 // Preserve the existing buy-custody hook + CancelOrder adjacency.
 // Otherwise the previous patcher treats reapplication as a missing hook.
 const nativeBuyHook='      if (process.env.EVEJS_COOP_MARKET_CANCEL_CUSTODY === "1" && normalizeBoolean(orderRow && orderRow.bid)) require("../../space/coopMarketCancelCustody").assertMatchingBuyEscrow({order:order,escrow:getEscrowRecord(orderID)});';
 const cancellationBody=text.slice(text.indexOf(cancel),text.indexOf(modify));
 const cancelAnchor=cancellationBody.includes(nativeBuyHook)?
  nativeBuyHook:'      const cancelResponse = await marketDaemonClient.call("CancelOrder", {';
 wrap(cancel,modify,[
  cancelAnchor
 ],'      const coopSellProof = '+flag+' && !normalizeBoolean(orderRow && orderRow.bid) ? '+proof("order","getEscrowRecord(orderID)","listEscrowItemsForOrder(orderID,normalizePositiveInteger(order && order.owner_id,0))")+' : null;',"");
 wrap(cancel,modify,[
  "        moveEscrowItemsBackToSeller(",
  "          orderID,",
  "          normalizePositiveInteger(order && order.owner_id, 0),",
  "          normalizePositiveInteger(orderRow && orderRow.station_id, 0),",
  "        );"
 ],"",
 '        if (coopSellProof) '+restored("orderID","normalizePositiveInteger(order && order.owner_id,0)")+';');
 return text;
}
module.exports={patch,fileName};
