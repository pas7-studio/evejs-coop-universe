"use strict";
/**
 * CH24+31 E2B6: unconditional stock market corporate-SELL isolation.
 * Stock marketProxyService can only settle personal, P2P or seed.
 * Source='coop-corporation' is private until the original corporate
 * orderbook matching + GameStore buyer/wallet settlement path is wired.
 * No feature flags: this prevents unsafe fallback with flags OFF, too.
 */
const FILE="server/src/services/market/marketProxyService.js";
const ROW_START="function filterMarketRowsByAccessibleStructureMarket(";
const ROW_END="function getOwnerOrderResponseOrder(";
const BUY_START="async function matchSellOrdersForBuyer({";
const BUY_END="async function matchBuyOrdersForSeller({";
const ROW_ANCHOR="  return ensureArray(rows).filter((row) => {\n";
const BUY_ANCHOR="    const tradedQuantity = Math.min(remainingQuantity, availableQuantity);\n";
const ROW_MARK="    if (String(row?.source || \"\").toLowerCase() === \"coop-corporation\") return false; // CH24+31 PERSONAL_MARKET_CORP_SELL_HIDDEN\n";
const BUY_MARK="    if (String(sellOrder?.source || \"\").toLowerCase() === \"coop-corporation\") continue; // CH24+31 PERSONAL_MARKET_CORP_SELL_DENIED\n";
function patch(source,{remove=false}={}){
 if(typeof source!=="string")throw Error("CORP_SELL_STOCK_MARKET_SOURCE_REQUIRED");
 const eol=source.includes("\r\n")?"\r\n":"\n";
 let s=source.replace(/\r\n/g,"\n");
 function apply(start,end,anchor,hook){
  const i=s.indexOf(start),j=s.indexOf(end,i+start.length);
  if(i<0||j<0||s.indexOf(start,i+start.length)!==-1||
   s.indexOf(end,j+end.length)!==-1)throw Error("CORP_SELL_STOCK_METHOD_DRIFT");
  const part=s.slice(i,j);
  if(remove){
   if(part.split(hook).length===2)s=s.slice(0,i)+part.replace(hook,"")+s.slice(j);
   else if(part.includes("CH24+31 PERSONAL_MARKET_CORP_SELL"))throw Error("CORP_SELL_STOCK_REMOVE_DRIFT");
   return;
  }
  if(part.split(hook).length===2)return;
  if(part.split(anchor).length!==2||part.includes("CH24+31 PERSONAL_MARKET_CORP_SELL"))
   throw Error("CORP_SELL_STOCK_ANCHOR_DRIFT");
  s=s.slice(0,i)+part.replace(anchor,anchor+hook)+s.slice(j);
 }
 apply(ROW_START,ROW_END,ROW_ANCHOR,ROW_MARK);
 apply(BUY_START,BUY_END,BUY_ANCHOR,BUY_MARK);
 return eol==="\r\n"?s.replace(/\n/g,"\r\n"):s;
}
module.exports={patch,FILE,ROW_MARK,BUY_MARK};
