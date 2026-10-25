"use strict";
// Reversible one-statement native hook on pinned marketProxyService only.
const FILE="server/src/services/market/marketProxyService.js";
const ANCHOR='    log.debug("[MarketProxy] GetMarketGroups");';
const HOOK='    if (process.env.EVEJS_COOP_MARKET_CATALOG === "1") return require("../../space/coopMarketCatalog").getMarketGroups({read:()=>require("../_shared/referenceData").readStaticRows("itemTypes"),buildRowset,rowsetName:ROWSET_NAME});';
function patch(source,file,remove=false){
 if(file!==FILE) return source;
 const eol=source.includes("\r\n")?"\r\n":"\n";
 const line=ANCHOR+eol+HOOK;
 if(remove){
  if(source.split(line).length!==2)throw Error("Unknown or missing market catalog hook");
  return source.replace(line,ANCHOR);
 }
 if(source.split(line).length===2)return source;
 if(source.split(ANCHOR).length!==2||source.includes(HOOK))throw Error("Unexpected pinned GetMarketGroups anchor");
 return source.replace(ANCHOR,line);
}
module.exports={FILE,ANCHOR,HOOK,patch};