"use strict";
// Original BUY order seller-payment hook installed AFTER atomic and BUY
// reserve source patches. Never execute original sequential seller wallet,
// escrow, physical item, Rust FillOrder or RecordTrade paths in strict mode.
const flag='process.env.EVEJS_COOP_PLAYER_MARKET_ATOMIC === "1"';
function patch(source,{remove=false}={}){
 if(typeof source!=="string")throw Error("P2P_BUY_PAY_SOURCE_REQUIRED");
 const eol=source.includes("\r\n")?"\r\n":"\n";
 const start="async function matchBuyOrdersForSeller({";
 const end="async function executeBuyRequest({";
 const i=source.indexOf(start),j=source.indexOf(end,i+start.length);
 if(i<0||j<0||source.indexOf(start,i+start.length)>=0)
  throw Error("P2P_BUY_PAY_ORIGINAL_MATCH_SCOPE_DRIFT");
 const original=source.slice(i,j);
 const anchor='    if (coopPlayerBuyTicket) await require("../../space/coopPlayerMarketRustClaim").claim({ticket:coopPlayerBuyTicket,proof:coopPlayerBuyProof,client:marketDaemonClient});';
 const hook=(
 '    if ('+flag+' && !isSeedBuyOrder && coopPlayerBuyTicket) {\n'+
 '      const grossPaid=roundIsk(orderPrice*fillableQuantity);\n'+
 '      const originalTax=computeSalesTaxAmount(sellerMarketContext,grossPaid);\n'+
 '      const completed=await require("../../space/coopPlayerMarketAtomicRuntime").settleBuy({ticket:coopPlayerBuyTicket,proof:coopPlayerBuyProof,sourceItemID,tax:originalTax,client:marketDaemonClient});\n'+
 '      const delivery=findItemById(completed.receipt.itemID);\n'+
 '      if(!delivery||delivery.ownerID!==buyerCharacterID||delivery.typeID!==typeID||delivery.locationID!==destinationStationID||delivery.quantity!==fillableQuantity||delivery.stacksize!==fillableQuantity) throw Error("P2P_BUY_PAY_POST_RELEASE_NATIVE_CUSTODY_INVALID");\n'+
 '      notifyBuyerDelivery(buyerCharacterID,[{item:delivery}]);\n'+
 '      const nativeWallet=require("../account/walletState");\n'+
 '      nativeWallet.notifyCharacterWalletChange(sellerCharacterID,nativeWallet.getCharacterWallet(sellerCharacterID));\n'+
 '      notifyOwnOrdersChanged(buyerCharacterID,[{...playerBuyOrder,row:{...getOwnerOrderResponseOrder(playerBuyOrder),vol_remaining:coopPlayerBuyProof.volumeAfter,price:orderPrice},state:completed.release.state}],completed.release.state==="filled"?ORDER_REASON_FILLED:ORDER_REASON_PARTIAL);\n'+
 '      totalSold+=fillableQuantity;\n'+
 '      totalGross=roundIsk(totalGross+grossPaid);\n'+
 '      remainingQuantity-=fillableQuantity;\n'+
 '      continue;\n'+
 '    }'
 ).replace(/\n/g,eol);
 const installed=anchor+eol+hook;
 const count=(s,x)=>s.split(x).length-1;
 let modified;
 if(count(original,installed)===1)
  modified=remove?original.replace(installed,anchor):original;
 else if(count(original,anchor)===1&&!original.includes(hook))
  modified=remove?original:original.replace(anchor,installed);
 else throw Error("P2P_BUY_PAY_RUST_CLAIM_HOOK_DRIFT");
 return source.slice(0,i)+modified+source.slice(j);
}
module.exports={patch};
