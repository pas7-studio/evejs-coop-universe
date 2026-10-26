import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {patch,ROW_MARK,BUY_MARK,BUY_ROUTE,SELL_MARK}=require("../scripts/coop-player-mining-corp-market-isolation-patch.cjs");
const source=[
 "function filterMarketRowsByAccessibleStructureMarket(session,rows=[],stationKeys=['station_id']) {",
 "  return ensureArray(rows).filter((row) => {",
 "    const stationID = normalizePositiveInteger(row.station_id,0);",
 "    return !stationID || canUseStructureMarketAtLocation(session,stationID);",
 "  });",
 "}",
 "function getOwnerOrderResponseOrder(orderResponse) {}",
 "async function matchSellOrdersForBuyer({session}={}) {",
 "  for(const sellOrder of filterMarketRowsByAccessibleStructureMarket(session, [])) {",
 "    const tradedQuantity = Math.min(remainingQuantity, availableQuantity);",
 "  }",
 "}",
 "async function matchBuyOrdersForSeller({}) {}",
 "  async Handle_PlaceMultiSellOrder(args, session) {",
 "    assertPersonalMarketOnly(useCorp);",
 "  }",
 "  async Handle_PlacePlexSellOrder(args, session) {}",
 ""
].join("\n");
test("pinned stock isolation reversible and idempotent",()=>{
 const installed=patch(source);
 assert.equal(patch(installed),installed);
 assert.equal(patch(installed,{remove:true}),source);
 assert.match(installed,/PERSONAL_MARKET_CORP_SELL_HIDDEN/);
 assert.match(installed,/PERSONAL_MARKET_CORP_SELL_DENIED/);
});
test("CRLF source round-trip reversible",()=>{
 const crlf=source.replaceAll("\n","\r\n");
 assert.equal(patch(patch(crlf),{remove:true}),crlf);
});
test("original book hides only corporation SELL source",()=>{
 const patched=patch(source);
 const fn=new Function("ensureArray","normalizePositiveInteger","canUseStructureMarketAtLocation","process",
 patched.slice(0,patched.indexOf("function getOwnerOrderResponseOrder"))+
 "return filterMarketRowsByAccessibleStructureMarket;")(x=>x,x=>Number(x)||0,()=>true,{env:{}});
 const rows=fn({},[{source:"coop-corporation",station_id:60001},
   {source:"player",station_id:60001},{source:"coop-npc",station_id:60001}]);
 assert.deepEqual(rows.map(x=>x.source),["player","coop-npc"]);
});
test("personal buyer loop always excludes corporate SELL before trade mutation",()=>{
 const s=patch(source);
 assert.ok(s.indexOf(BUY_MARK)>s.indexOf("async function matchSellOrdersForBuyer"));
 assert.ok(s.indexOf(BUY_MARK)<s.indexOf("const tradedQuantity"));
});
test("missing original source anchors fail closed",()=>{
 assert.throws(()=>patch("unknown source"),/CORP_SELL_STOCK_METHOD_DRIFT/);
 assert.throws(()=>patch(source.replace("const tradedQuantity","notTrade")),
  /CORP_SELL_STOCK_ANCHOR_DRIFT/);
});
test("stock listing without source remains visible",()=>{
 const s=patch(source);const f=new Function("ensureArray","normalizePositiveInteger",
 "canUseStructureMarketAtLocation","process",s.slice(0,s.indexOf("function getOwnerOrderResponseOrder"))+
 "return filterMarketRowsByAccessibleStructureMarket;")(x=>x,x=>Number(x)||0,()=>true,{env:{}});
 assert.equal(f({},[{station_id:60001}]).length,1);
});

test("gated stock buy route cannot fall through to character-only FillOrder",()=>{
 const installed=patch(source),buy=installed.slice(
  installed.indexOf("async function matchSellOrdersForBuyer"),
  installed.indexOf("async function matchBuyOrdersForSeller"));
 assert.ok(buy.includes("NATIVE_CORP_MARKET_BUY_ROUTE"));
 assert.ok(buy.includes("corpPlayerMiningCorpMarketRuntime")===false);
 assert.ok(buy.indexOf(BUY_ROUTE)<buy.indexOf("  }"));
 assert.ok(buy.includes("CORP_SELL_FILL_RELEASED"));
 assert.ok(buy.includes("chargeBuyerWallet !== true"));
});
test("stock market corporate SELL works only when explicit useCorp is requested",()=>{
 const installed=patch(source),sell=installed.slice(
  installed.indexOf("async Handle_PlaceMultiSellOrder"),
  installed.indexOf("async Handle_PlacePlexSellOrder"));
 assert.ok(sell.includes(SELL_MARK));
 assert.ok(sell.indexOf(SELL_MARK)<sell.indexOf("assertPersonalMarketOnly(useCorp)"));
 assert.ok(sell.includes("CORPORATE_SELL_PUBLISHED"));
});
