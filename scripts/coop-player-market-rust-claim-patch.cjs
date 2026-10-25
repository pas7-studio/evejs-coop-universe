"use strict";
// Compose AFTER coop-player-market-settlement-patch.cjs. Reversible source
// hook for Rust exclusive claim/finalize, not a separate market writer.
const fileName="server/src/services/market/marketProxyService.js";
const mod='require("../../space/coopPlayerMarketRustClaim")';
const rustFlag='process.env.EVEJS_COOP_RUST_P2P_CLAIM';
const fenceFlag='process.env.EVEJS_COOP_PLAYER_MARKET_SETTLEMENT_FENCE';
function patch(source,{remove=false}={}){
 if(typeof source!=="string")throw Error("P2P_RUST_CLIENT_SOURCE_REQUIRED");
 let text=source;
 const nl=text.includes("\r\n")?"\r\n":"\n";
 function edit(start,end,anchor,replace){
  const a=text.indexOf(start);
  if(a<0||text.indexOf(start,a+start.length)!==-1)
   throw Error("P2P_RUST_CLIENT_METHOD_SCOPE_DRIFT");
  const z=text.indexOf(end,a+start.length);
  if(z<0)throw Error("P2P_RUST_CLIENT_END_SCOPE_DRIFT");
  const part=text.slice(a,z),base=anchor.split("\n").join(nl),
    installed=replace.split("\n").join(nl);
  const count=(s,needle)=>s.split(needle).length-1;
  let result;
  if(count(part,installed)===1){
   result=remove?part.replace(installed,base):part;
  }else if(count(part,base)===1&&!part.includes(installed)){
   result=remove?part:part.replace(base,installed);
  }else throw Error("P2P_RUST_CLIENT_SOURCE_ANCHOR_DRIFT");
  text=text.slice(0,a)+result+text.slice(z);
 }
 const sell="async function matchSellOrdersForBuyer({",
  buy="async function matchBuyOrdersForSeller({",
  end="async function executeBuyRequest({";
 const admission=(indent)=>indent+'if ('+fenceFlag+' === "1" && '+rustFlag+' !== "1") throw Error("P2P_RUST_EXCLUSIVE_CLAIM_REQUIRED");'+nl+
  indent+'if ('+rustFlag+' === "1" && '+fenceFlag+' !== "1") throw Error("P2P_RUST_NATIVE_SETTLEMENT_FENCE_REQUIRED");';
 const matchAnchor='  const book = await marketDaemonClient.call("GetOrders", {';
 edit(sell,buy,matchAnchor,admission('  ')+nl+matchAnchor);
 edit(buy,end,matchAnchor,admission('  ')+nl+matchAnchor);
 const sellTicket='        const coopPlayerSellTicket = coopPlayerSellProof && '+fenceFlag+' === "1" ? require("../../space/coopPlayerMarketSettlementFence").begin(coopPlayerSellProof,{chargeBuyerWallet}) : null;';
 const buyTicket='    const coopPlayerBuyTicket = coopPlayerBuyProof && '+fenceFlag+' === "1" ? require("../../space/coopPlayerMarketSettlementFence").begin(coopPlayerBuyProof,{chargeBuyerWallet:false}) : null;';
 edit(sell,buy,sellTicket,
  sellTicket+nl+'        if (coopPlayerSellTicket) await '+mod+'.claim({ticket:coopPlayerSellTicket,proof:coopPlayerSellProof,client:marketDaemonClient});');
 edit(buy,end,buyTicket,
  buyTicket+nl+'    if (coopPlayerBuyTicket) await '+mod+'.claim({ticket:coopPlayerBuyTicket,proof:coopPlayerBuyProof,client:marketDaemonClient});');
 const sellFill='        const fillResponse = await marketDaemonClient.call("FillOrder", {\n          order_id: normalizeOrderId(sellOrder && sellOrder.order_id),\n          fill_quantity: tradedQuantity,\n        });';
 const buyFill='    const fillResponse = await marketDaemonClient.call("FillOrder", {\n      order_id: normalizeOrderId(buyOrder && buyOrder.order_id),\n      fill_quantity: fillableQuantity,\n    });';
 edit(sell,buy,sellFill,
  '        const fillResponse = coopPlayerSellTicket ? await '+mod+'.finalize({ticket:coopPlayerSellTicket,proof:coopPlayerSellProof,client:marketDaemonClient}) : await marketDaemonClient.call("FillOrder", {\n          order_id: normalizeOrderId(sellOrder && sellOrder.order_id),\n          fill_quantity: tradedQuantity,\n        });');
 edit(buy,end,buyFill,
  '    const fillResponse = coopPlayerBuyTicket ? await '+mod+'.finalize({ticket:coopPlayerBuyTicket,proof:coopPlayerBuyProof,client:marketDaemonClient}) : await marketDaemonClient.call("FillOrder", {\n      order_id: normalizeOrderId(buyOrder && buyOrder.order_id),\n      fill_quantity: fillableQuantity,\n    });');
 return text;
}
module.exports={patch,fileName};
