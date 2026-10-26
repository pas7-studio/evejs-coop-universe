"use strict";
/**
 * Native MarketProxyEve corporate ore integration, reversible on exact pin.
 * Default: corporate SELL hidden and unbuyable. Under explicit multi-flag
 * private corporate-market activation only, allow the regular in-game Market
 * UI to call independent original Rust/GameStore corporate SELL/BUY pipelines.
 *
 * Stock character-only FillOrder/CancelOrder/ModifyOrder stay blocked for
 * source="coop-corporation" in the matching pinned Rust source patch.
 */
const FILE="server/src/services/market/marketProxyService.js";
const ROW_START="function filterMarketRowsByAccessibleStructureMarket(";
const ROW_END="function getOwnerOrderResponseOrder(";
const BUY_START="async function matchSellOrdersForBuyer({";
const BUY_END="async function matchBuyOrdersForSeller({";
const SELL_START="  async Handle_PlaceMultiSellOrder(args, session) {";
const SELL_END="  async Handle_PlacePlexSellOrder(args, session) {";
const ROW_ANCHOR="  return ensureArray(rows).filter((row) => {\n";
const BUY_ANCHOR="    const tradedQuantity = Math.min(remainingQuantity, availableQuantity);\n";
const SELL_ANCHOR="    assertPersonalMarketOnly(useCorp);\n";
const ROW_MARK=[
 '    // CH24+31 PERSONAL_MARKET_CORP_SELL_HIDDEN: stock character market NEVER owns corporate stock.',
 '    if (String(row?.source || "").toLowerCase() === "coop-corporation" &&',
 '        process.env.EVEJS_COOP_PLAYER_NPC_MINING_CORP_PUBLIC_MARKET !== "1") return false;',
 ''
].join("\n");
const BUY_MARK=[
 '    // CH24+31 PERSONAL_MARKET_CORP_SELL_DENIED: no debit on previously reserved buy orders.',
 '    if (String(sellOrder?.source || "").toLowerCase() === "coop-corporation" &&',
 '        (process.env.EVEJS_COOP_PLAYER_NPC_MINING_CORP_PUBLIC_MARKET !== "1" ||',
 '         chargeBuyerWallet !== true)) continue;',
 ''
].join("\n");
const BUY_ROUTE=[
 '    // CH24+31 NATIVE_CORP_MARKET_BUY_ROUTE: corporate stock never falls through to personal FillOrder.',
 '    if (String(sellOrder?.source || "").toLowerCase() === "coop-corporation") {',
 '      const nativeCorp = require(path.join(__dirname, "../../integration/coopPlayerMiningCorporateMarketRuntime"));',
 '      const purchased = await nativeCorp.buyFromOrder({session, sellOrder,',
 '        quantity:tradedQuantity,maxUnitPriceCents:Math.round(Number(maxPrice || 0) * 100)});',
 '      if (purchased?.status !== "CORP_SELL_FILL_RELEASED" ||',
 '          purchased.filledQuantity !== tradedQuantity ||',
 '          !Number.isSafeInteger(purchased.verifiedGrossCents) ||',
 '          purchased.verifiedGrossCents <= 0) {',
 '        throwWrappedUserError("CustomInfo", {info:',
 '          "Corporation ore transaction was not confirmed. Review the market before retrying."});',
 '      }',
 '      remainingQuantity -= tradedQuantity;',
 '      totalBought += tradedQuantity;',
 '      totalSpent = roundIsk(totalSpent + purchased.verifiedGrossCents / 100);',
 '      continue;',
 '    }',
 ''
].join("\n");
const SELL_MARK=[
 '    // CH24+31 NATIVE_CORP_MARKET_SELL_ROUTE: useCorp authorizes our original corporate custody path ONLY.',
 '    if (useCorp && process.env.EVEJS_COOP_PLAYER_NPC_MINING_CORP_PUBLIC_MARKET === "1") {',
 '      const nativeCorp = require(path.join(__dirname, "../../integration/coopPlayerMiningCorporateMarketRuntime"));',
 '      const result = await nativeCorp.sellFromEntries({session,',
 '        itemList:itemList.map(marshalObjectToPlainObject),durationDays});',
 '      if (result?.status !== "CORPORATE_SELL_PUBLISHED") {',
 '        throwWrappedUserError("CustomInfo", {info:',
 '          "Corporate SELL was not confirmed. Check corporation market records; do not blindly retry."});',
 '      }',
 '      return true;',
 '    }',
 ''
].join("\n");
function patch(source,{remove=false}={}){
 if(typeof source!=="string")throw Error("CORP_SELL_STOCK_MARKET_SOURCE_REQUIRED");
 const eol=source.includes("\r\n")?"\r\n":"\n";
 let s=source.replace(/\r\n/g,"\n");
 function apply(start,end,anchor,hook,where,marker){
  const i=s.indexOf(start),j=s.indexOf(end,i+start.length);
  if(i<0||j<0||s.indexOf(start,i+start.length)!==-1||
   s.indexOf(end,j+end.length)!==-1)throw Error("CORP_SELL_STOCK_METHOD_DRIFT");
  const part=s.slice(i,j);
  if(remove){
   if(part.split(hook).length===2)s=s.slice(0,i)+part.replace(hook,"")+s.slice(j);
   else if(part.includes(marker))throw Error("CORP_SELL_STOCK_REMOVE_DRIFT");
   return;
  }
  if(part.split(hook).length===2)return;
  if(part.split(anchor).length!==2||part.includes(marker))
   throw Error("CORP_SELL_STOCK_ANCHOR_DRIFT");
  s=s.slice(0,i)+part.replace(anchor,
    where==="before"?hook+anchor:anchor+hook)+s.slice(j);
 }
 // With all flags OFF, the stock Market UI behaves exactly as before.
 apply(ROW_START,ROW_END,ROW_ANCHOR,ROW_MARK,"after","PERSONAL_MARKET_CORP_SELL_HIDDEN");
 apply(BUY_START,BUY_END,BUY_ANCHOR,BUY_MARK,"before","PERSONAL_MARKET_CORP_SELL_DENIED");
 apply(BUY_START,BUY_END,BUY_ANCHOR,BUY_ROUTE,"after","NATIVE_CORP_MARKET_BUY_ROUTE");
 apply(SELL_START,SELL_END,SELL_ANCHOR,SELL_MARK,"before","NATIVE_CORP_MARKET_SELL_ROUTE");
 return eol==="\r\n"?s.replace(/\n/g,"\r\n"):s;
}
module.exports={patch,FILE,ROW_MARK,BUY_MARK,BUY_ROUTE,SELL_MARK};
