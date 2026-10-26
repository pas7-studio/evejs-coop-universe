import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {patch,fileName}=require("../scripts/coop-player-market-rust-claim-patch.cjs");
const pfx='process.env.EVEJS_COOP_PLAYER_MARKET_SETTLEMENT_FENCE === "1"';
const admission='  if ('+pfx+' && process.env.EVEJS_COOP_PLAYER_MARKET_FILL_GUARD !== "1") throw Error("P2P_SETTLEMENT_REQUIRES_PLAYER_FILL_GUARD");';
const ticketSell='        const coopPlayerSellTicket = coopPlayerSellProof && '+pfx+' ? require("../../space/coopPlayerMarketSettlementFence").begin(coopPlayerSellProof,{chargeBuyerWallet}) : null;';
const ticketBuy='    const coopPlayerBuyTicket = coopPlayerBuyProof && '+pfx+' ? require("../../space/coopPlayerMarketSettlementFence").begin(coopPlayerBuyProof,{chargeBuyerWallet:false}) : null;';
function fixture(eol="\n"){
 return [
  "async function matchSellOrdersForBuyer({}={}) {",
  admission,
  '  const book = await marketDaemonClient.call("GetOrders", {',
  '  });',
  '  for(const sellOrder of []) {',
  '    if(true){',
  ticketSell,
  '        const fillResponse = await marketDaemonClient.call("FillOrder", {',
  '          order_id: normalizeOrderId(sellOrder && sellOrder.order_id),',
  '          fill_quantity: tradedQuantity,',
  '        });',
  '    }',
  '  }',
  '}',
  'async function matchBuyOrdersForSeller({}={}) {',
  admission,
  '  const book = await marketDaemonClient.call("GetOrders", {',
  '  });',
  '  for(const buyOrder of []) {',
  ticketBuy,
  '    const fillResponse = await marketDaemonClient.call("FillOrder", {',
  '      order_id: normalizeOrderId(buyOrder && buyOrder.order_id),',
  '      fill_quantity: fillableQuantity,',
  '    });',
  '  }',
  '}',
  'async function executeBuyRequest({}={}) {}',
  ''
 ].join(eol);
}
for(const eol of ["\n","\r\n"])
test("P2P Rust claim wiring composes in native market and restores exactly "+JSON.stringify(eol),()=>{
 const source=fixture(eol),applied=patch(source);
 assert.notEqual(applied,source);
 assert.equal(patch(applied),applied);
 assert.equal(patch(applied,{remove:true}),source);
 assert.equal((applied.match(/ClaimPlayerFill/g)||[]).length,0);
 assert.equal((applied.match(/\.claim\(\{ticket:/g)||[]).length,2);
 assert.equal((applied.match(/\.finalize\(\{ticket:/g)||[]).length,2);
 assert.doesNotThrow(()=>new Function(applied));
});
test("wrong or missing preceding native settlement hooks fail closed",()=>{
 const base=fixture();
 assert.throws(()=>patch(base.replace(ticketSell,"")),/SOURCE_ANCHOR_DRIFT/);
 assert.throws(()=>patch(base.replace("coopPlayerBuyTicket =","unprotectedBuyTicket =")),
  /SOURCE_ANCHOR_DRIFT/);
});
test("Rust claim and finalizer stay feature gated, no ordinary player wallet mutation",()=>{
 const text=patch(fixture());
 assert.match(text,/P2P_RUST_EXCLUSIVE_CLAIM_REQUIRED/);
 assert.match(text,/P2P_RUST_NATIVE_SETTLEMENT_FENCE_REQUIRED/);
 assert.match(text,/FinalizePlayerFill|coopPlayerMarketRustClaim/);
 assert.equal(text.includes("adjustCharacterBalance("),false);
});
test("stock native market authority stays in original file",()=>{
 assert.equal(fileName,"server/src/services/market/marketProxyService.js");
});
