import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {patch}=require("../scripts/coop-player-market-buy-refund-patch.cjs");
const sample=eol=>[
 "async function applyExpiredOrderEvent(event) {",
 "  const order=event.order;",
 "  const ownerID=201;",
 "  const orderRow=order.row;",
 "  if (normalizeBoolean(orderRow && orderRow.bid)) {",
 "    oldUnsafeExpiryRefund();",
 "  }",
 "}",
 "function applyCancelledStructureMarketOrder(order) {}",
 "class Market {",
 "  async Handle_CancelCharOrder(args, session) {",
 "      const orderRow = getOwnerOrderResponseOrder(order);",
 "      const stationID = normalizePositiveInteger(orderRow && orderRow.station_id, 0);",
 "      ensureStructureMarketServiceAccess(session, stationID);",
 "      const cancelResponse = await marketDaemonClient.call('CancelOrder',{});",
 "  }",
 "  async Handle_PlaceBuyOrder(args, session) {}",
 "}"
].join(eol);
for(const eol of ["\n","\r\n"])
test("original game BUY cancellation/expiry source is reversible "+JSON.stringify(eol),()=>{
 const base=sample(eol),installed=patch(base);
 assert.equal(patch(installed),installed);
 assert.equal(patch(installed,{remove:true}),base);
 assert.doesNotThrow(()=>new Function(installed));
 assert.match(installed,/coopPlayerMarketBuyRefundRuntime.*expire/);
 assert.match(installed,/coopPlayerMarketBuyRefundRuntime.*cancel/);
 assert.match(installed,/return null;/);
});
test("invalid native cancel/expiry source anchors refuse partial patches",()=>{
 assert.throws(()=>patch(sample("\n").replace(
  "      ensureStructureMarketServiceAccess(session, stationID);","")),
 /SOURCE_HOOK_DRIFT/);
 assert.throws(()=>patch(sample("\n").replace(
  "async function applyExpiredOrderEvent(event) {","")),
 /NATIVE_SCOPE_DRIFT/);
});
