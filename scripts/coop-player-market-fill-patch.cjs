"use strict";
// Default-off L1 hooks for the two original player <-> player FillOrder paths.
// No new order book, wallet, item store or trade settlement writer.
const fileName="server/src/services/market/marketProxyService.js";
const flag='process.env.EVEJS_COOP_PLAYER_MARKET_FILL_GUARD === "1"';
const svc='require("../../space/coopPlayerMarketFill")';
function patch(source,{remove=false}={}){
 if(typeof source!=="string")throw Error("COOP_PLAYER_FILL_SOURCE_REQUIRED");
 let text=source;
 const nl=text.includes("\r\n")?"\r\n":"\n";
 function insert(start,end,anchor,hook,{before=true}={}){
  const at=text.indexOf(start);
  if(at<0||text.indexOf(start,at+start.length)!==-1)throw Error("COOP_PLAYER_FILL_METHOD_DRIFT");
  const last=text.indexOf(end,at+start.length);
  if(last<0)throw Error("COOP_PLAYER_FILL_METHOD_END_DRIFT");
  const body=text.slice(at,last);
  const injected=before?hook+nl+anchor:anchor+nl+hook;
  const count=(s,x)=>s.split(x).length-1;
  let next=body;
  if(count(body,injected)===1){
   if(remove)next=body.replace(injected,anchor);
  }else{
   if(count(body,anchor)!==1||body.includes(hook))
    throw Error("COOP_PLAYER_FILL_SOURCE_ANCHOR_DRIFT");
   if(!remove)next=body.replace(anchor,injected);
  }
  text=text.slice(0,at)+next+text.slice(last);
 }
 const buyerStart="async function matchSellOrdersForBuyer({",
  sellerStart="async function matchBuyOrdersForSeller({",
  buyEnd="async function executeBuyRequest({";
 insert(buyerStart,sellerStart,
  "        purchaseCounterpartyID = sellerCharacterID;",
  '        const coopPlayerSellProof = '+flag+' ? '+svc+'.checkSellMatch({order:playerSellOrder,bookRow:sellOrder,escrow:escrowRecord,items:listEscrowItemsForOrder(sellOrder && sellOrder.order_id,sellerCharacterID),buyerCharacterID,tradedQuantity,price:orderPrice}) : null;',
  {before:false});
 insert(buyerStart,sellerStart,
  '        const grossAmount = roundIsk(orderPrice * tradedQuantity);',
  '        if (coopPlayerSellProof) '+svc+'.assertFillAck({proof:coopPlayerSellProof,ack:fillResponse});');
 insert(sellerStart,buyEnd,
  '    const sellerInventoryChanges = [];',
  '    const coopPlayerBuyProof = !isSeedBuyOrder && '+flag+' ? '+svc+'.checkBuyMatch({order:playerBuyOrder,bookRow:buyOrder,escrow:getEscrowRecord(buyOrder && buyOrder.order_id),sellerCharacterID,fillableQuantity,price:orderPrice,sourceItem:sourceOrderId?null:findItemById(sourceItemID),sourceOrder:sourceOrderId && normalizeOrderId(sourceOrderId)!=="0" ? await fetchOrderById(sourceOrderId) : null,sourceEscrow:sourceOrderId?getEscrowRecord(sourceOrderId):null,sourceItems:sourceOrderId?listEscrowItemsForOrder(sourceOrderId,sellerCharacterID):null,sourceStationID:stationID,hangarFlag:ITEM_FLAGS.HANGAR}) : null;');
 insert(sellerStart,buyEnd,
  '    const grossAmount = roundIsk(orderPrice * fillableQuantity);',
  '    if (coopPlayerBuyProof) '+svc+'.assertFillAck({proof:coopPlayerBuyProof,ack:fillResponse});');
 return text;
}
module.exports={patch,fileName};
