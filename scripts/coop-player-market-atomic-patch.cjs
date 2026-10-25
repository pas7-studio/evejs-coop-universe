"use strict";
// Source-only native P2P full SELL shortcut. This is installed AFTER the
// existing custody, journal and Rust claim patches. All flags default OFF.
const fileName="server/src/services/market/marketProxyService.js";
const atomic='process.env.EVEJS_COOP_PLAYER_MARKET_ATOMIC === "1"';
const helper='require("../../space/coopPlayerMarketAtomicRuntime")';
function patch(source,{remove=false}={}){
 if(typeof source!=="string")throw Error("P2P_ATOMIC_SOURCE_REQUIRED");
 let text=source;
 const nl=source.includes("\r\n")?"\r\n":"\n";
 const sell="async function matchSellOrdersForBuyer({",
  buy="async function matchBuyOrdersForSeller({",
  end="async function executeBuyRequest({";
 function inject(start,stop,anchor,lines,{before=false}={}){
  const i=text.indexOf(start),j=text.indexOf(stop,i+start.length);
  if(i<0||j<0||text.indexOf(start,i+start.length)>=0)
   throw Error("P2P_ATOMIC_NATIVE_SCOPE_DRIFT");
  const original=text.slice(i,j),old=anchor.split("\n").join(nl);
  const added=lines.split("\n").join(nl);
  const wrapped=before?added+nl+old:old+nl+added;
  const count=(src,needle)=>src.split(needle).length-1;
  if(count(original,wrapped)===1){
   if(remove)text=text.slice(0,i)+original.replace(wrapped,old)+text.slice(j);
  }else if(count(original,old)===1&&!original.includes(added)){
   if(!remove)text=text.slice(0,i)+original.replace(old,wrapped)+text.slice(j);
  }else throw Error("P2P_ATOMIC_NATIVE_HOOK_DRIFT");
 }
 // Pre-admission *before* the existing #189 proof and #204 durable begin,
 // so an unsupported multi-stack/partial order cannot lock the Rust order.
 inject(sell,buy,'        purchaseCounterpartyID = sellerCharacterID;',
  '        if ('+atomic+') {\n'+
  '          const fullEscrowItems=listEscrowItemsForOrder(sellOrder && sellOrder.order_id,sellerCharacterID);\n'+
  '          if (!chargeBuyerWallet||tradedQuantity!==availableQuantity||fullEscrowItems.length!==1||\n'+
  '              fullEscrowItems[0]?.singleton!==0||fullEscrowItems[0]?.stacksize!==tradedQuantity)\n'+
  '            throw Error("P2P_ATOMIC_FULL_SINGLE_SELL_ORDER_REQUIRED");\n'+
  '        }',{before:true});
 const claim='        if (coopPlayerSellTicket) await require("../../space/coopPlayerMarketRustClaim").claim({ticket:coopPlayerSellTicket,proof:coopPlayerSellProof,client:marketDaemonClient});';
 inject(sell,buy,claim,
  '        if ('+atomic+' && coopPlayerSellTicket) {\n'+
  '          const nativeTax=computeSalesTaxAmount(buildCharacterMarketContext(null,sellerCharacterID,destinationStationID),grossCost);\n'+
  '          const physical=listEscrowItemsForOrder(sellOrder && sellOrder.order_id,sellerCharacterID);\n'+
  '          const result=await '+helper+'.settleSell({ticket:coopPlayerSellTicket,proof:coopPlayerSellProof,tax:nativeTax,sourceItemID:physical[0]?.itemID,client:marketDaemonClient});\n'+
  '          notifyOwnOrdersChanged(sellerCharacterID,[{...playerSellOrder,row:{...getOwnerOrderResponseOrder(playerSellOrder),vol_remaining:0,price:orderPrice},state:"filled"}],ORDER_REASON_FILLED);\n'+
  '          totalSpent=roundIsk(totalSpent+grossCost);\n'+
  '          totalBought+=tradedQuantity;\n'+
  '          remainingQuantity-=tradedQuantity;\n'+
  '          continue;\n'+
  '        }');
 // The existing stock BUY match consumes a prepaid escrow with no
 // independently verified native debit receipt. Do not enable it under
 // the strict atomic flag until that proof and split-stack path exist.
 const proofLine='    const coopPlayerBuyProof = !isSeedBuyOrder && process.env.EVEJS_COOP_PLAYER_MARKET_FILL_GUARD === "1" ? require("../../space/coopPlayerMarketFill").checkBuyMatch({order:playerBuyOrder,bookRow:buyOrder,escrow:getEscrowRecord(buyOrder && buyOrder.order_id),sellerCharacterID,fillableQuantity,price:orderPrice,sourceItem:sourceOrderId?null:findItemById(sourceItemID),sourceOrder:sourceOrderId && normalizeOrderId(sourceOrderId)!=="0" ? await fetchOrderById(sourceOrderId) : null,sourceEscrow:sourceOrderId?getEscrowRecord(sourceOrderId):null,sourceItems:sourceOrderId?listEscrowItemsForOrder(sourceOrderId,sellerCharacterID):null,sourceStationID:stationID,hangarFlag:ITEM_FLAGS.HANGAR}) : null;';
 inject(buy,end,proofLine,
  '    if ('+atomic+' && !isSeedBuyOrder) throw Error("P2P_ATOMIC_PREPAID_BUY_RESERVE_NOT_YET_PROVEN");',
  {before:true});
 return text;
}
module.exports={patch,fileName};
