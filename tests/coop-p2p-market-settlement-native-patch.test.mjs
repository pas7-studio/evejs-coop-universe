import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {patch,fileName}=require("../scripts/coop-player-market-settlement-patch.cjs");
const {specs,names}=require("../scripts/patch-evejs-coop.cjs");

function nativeFixture(nl="\n"){
 const tick=String.fromCharCode(96),dollar=String.fromCharCode(36);
 return [
 'async function applyExpiredOrderEvent(event) {',
 '  const orderID = normalizeOrderId(order && order.order_id);',
 '}',
 'function applyCancelledStructureMarketOrder(order) {',
 '  const orderID = normalizeOrderId(order && order.order_id);',
 '}',
 'async function cancelStructureMarketOrdersForServiceLoss(structure,options={}) {',
 '  const quietDaemonUnavailable = options && options.quietDaemonUnavailable === true;',
 '}',
 'async function processPendingExpiryEvents(){}',
 'async function matchSellOrdersForBuyer({}={}) {',
 '  const book = await marketDaemonClient.call("GetOrders", {',
 '    region_id: 1,',
 '  });',
 '  for(const sellOrder of []){',
 '      if(true){',
 '        coopPlayerSellProof = process.env.EVEJS_COOP_PLAYER_MARKET_FILL_GUARD === "1" ? {} : null;',
 '        if (coopPlayerSellProof) require("../../space/coopPlayerMarketFill").assertFillAck({proof:coopPlayerSellProof,ack:fillResponse});',
 '        const grossAmount = roundIsk(orderPrice * tradedQuantity);',
 '        if (fillResponse.state === "filled") {',
 '          removeEscrowRecord(sellOrder && sellOrder.order_id);',
 '        } else if (escrowRecord) {',
 '          upsertSellEscrowRecord({remainingQuantity:fillResponse.vol_remaining});',
 '        }',
 '      }',
 '      if (String(sellOrder && sellOrder.source || "").toLowerCase() === "seed") {}',
 '  }',
 '}',
 'async function matchBuyOrdersForSeller({}={}) {',
 '  const book = await marketDaemonClient.call("GetOrders", {',
 '    region_id: 1,',
 '  });',
 '  for(const buyOrder of []){',
 '    const coopPlayerBuyProof = !isSeedBuyOrder && process.env.EVEJS_COOP_PLAYER_MARKET_FILL_GUARD === "1" ? {} : null;',
 '    const sellerInventoryChanges = [];',
 '    if (coopPlayerBuyProof) require("../../space/coopPlayerMarketFill").assertFillAck({proof:coopPlayerBuyProof,ack:fillResponse});',
 '    const grossAmount = roundIsk(orderPrice * fillableQuantity);',
 '    if (!isSeedBuyOrder) {',
 '      if (fillResponse.state === "filled") removeEscrowRecord(buyOrder && buyOrder.order_id);',
 '      }',
 '    }',
 '',
 '    totalSold += fillableQuantity;',
 '}',
 'async function executeBuyRequest({}={}){}',
 'class MarketProxy {',
 '  async Handle_CancelCharOrder(args, session) {',
 '    log.debug('+tick+'[MarketProxy] CancelCharOrder order='+dollar+'{orderID}'+tick+');',
 '  }',
 '  async Handle_ModifyCharOrder(args, session) {',
 '    log.debug('+tick+'[MarketProxy] ModifyCharOrder order='+dollar+'{orderID} price='+dollar+'{newPrice}'+tick+');',
 '  }',
 '  async Handle_GetOrders(){}',
 '}',
 ''
 ].join(nl);
}
test("native market P2P settlement overlay is source-gated and reversible",()=>{
 const source=nativeFixture(),applied=patch(source);
 assert.notEqual(applied,source);
 assert.equal(patch(applied),applied);
 assert.equal(patch(applied,{remove:true}),source);
 assert.doesNotThrow(()=>new Function(applied));
 assert.equal((applied.match(/coopPlayerMarketSettlementFence/g)||[]).length>=10,true);
 assert.match(applied,/P2P_SETTLEMENT_REQUIRES_PLAYER_FILL_GUARD/);
});
test("CRLF and uninstalled remove preserve byte-exact native source",()=>{
 const source=nativeFixture("\r\n"),applied=patch(source);
 assert.equal(patch(applied,{remove:true}),source);
 assert.equal(patch(source,{remove:true}),source);
});
test("native P2P settlement hooks refuse missing original preflight or original ACK",()=>{
 const fixture=nativeFixture();
 assert.throws(()=>patch(fixture.replace("coopPlayerSellProof = process.env",
  "unprotectedFill = process.env")),/GUARD_DEPENDENCY_MISSING/);
 assert.throws(()=>patch(fixture.replace("if (coopPlayerBuyProof) require",
  "if (unprotectedProof) require")),/GUARD_DEPENDENCY_MISSING/);
});
test("central installer retains one original market authority and one journal module",()=>{
 assert.equal(names.filter(x=>x==="coopPlayerMarketSettlementFence").length,1);
 assert.equal(specs.filter(x=>x.file===fileName).length,1);
});
