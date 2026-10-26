import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {patch}=require("../scripts/coop-player-market-buy-reserve-patch.cjs");
function fixture(eol="\n"){
 return [
  'async function applyExpiredOrderEvent(event) {',
  '  const orderRow = getOwnerOrderResponseOrder(event.order);',
  '  if (normalizeBoolean(orderRow && orderRow.bid)) {',
  '    refund();',
  '  }',
  '}',
  'function applyCancelledStructureMarketOrder(order) {',
  '  const orderRow = getOwnerOrderResponseOrder(order);',
  '  if (normalizeBoolean(orderRow && orderRow.bid)) {',
  '    refund();',
  '  }',
  '}',
  'async function processPendingExpiryEvents({}={}) {}',
  'function syncOpenBuyEscrowRecords(ownerOrders = []) {',
  '  for (const ownerOrder of ensureArray(ownerOrders)) {',
  '    upsertBuyEscrowRecord(ownerOrder);',
  '  }',
  '}',
  'function updateMovedItemsOwner(changes = [], ownerID) {}',
  'async function executeBuyRequest({}={}) {',
  '  const typeLabel = getMarketTypeLabel(typeID);',
  '  const matchResult = await matchSellOrdersForBuyer({',
  '  });',
  '}',
  'async function executeSellEntry({}={}) {}',
  'class MarketProxy {',
  '  async Handle_CancelCharOrder(args, session) {',
  '    const orderRow = getOwnerOrderResponseOrder(order);',
  '      const stationID = normalizePositiveInteger(orderRow && orderRow.station_id, 0);',
  '      const cancelResponse = await marketDaemonClient.call("CancelOrder", {',
  '      });',
  '  }',
  '  async Handle_PlaceBuyOrder(args, session) {}',
  '  async Handle_ModifyCharOrder(args, session) {',
  '      const orderRow = getOwnerOrderResponseOrder(order);',
  '      const oldPrice = Number(orderRow && orderRow.price) || 0;',
  '  }',
  '}',
  ''
 ].join(eol);
}
for(const eol of ["\n","\r\n"])test("BUY reserve original market source reversible and idempotent "+JSON.stringify(eol),()=>{
 const input=fixture(eol),once=patch(input);
 assert.notEqual(once,input);
 assert.equal(patch(once),once);
 assert.equal(patch(once,{remove:true}),input);
 assert.doesNotThrow(()=>new Function(once));
 assert.match(once,/coopPlayerMarketBuyReserveRuntime/);
 assert.match(once,/P2P_BUY_RESERVE_ALL_GUARDS_REQUIRED/);
 assert.match(once,/P2P_BUY_RESERVE_CANCEL_REQUIRES_AUDITED_SETTLEMENT/);
 assert.match(once,/P2P_BUY_RESERVE_MODIFY_REQUIRES_AUDITED_SETTLEMENT/);
 assert.match(once,/P2P_BUY_RESERVE_STATION_CANCEL_REQUIRES_AUDITED_SETTLEMENT/);
 assert.match(once,/P2P_BUY_RESERVE_EXPIRY_REQUIRES_AUDITED_SETTLEMENT/);
});
test("untrusted stock BUY escrow reconstruction is suppressed only in guarded mode",()=>{
 const out=patch(fixture());
 assert.match(out,/if \(process.env\.EVEJS_COOP_PLAYER_MARKET_BUY_RESERVE === "1"\) return/);
 assert.match(out,/if \(process\.env\.EVEJS_COOP_PLAYER_MARKET_BUY_RESERVE === "1" && normalizedDuration>0\)/);
 assert.match(out,/P2P_BUY_RESERVE_STRUCTURE_OWNER_CREDIT_UNSUPPORTED/);
});
test("missing pinned source regions refuse a speculative BUY source patch",()=>{
 assert.throws(()=>patch(fixture().replace("async function executeSellEntry({}={}) {}","")),
  /METHOD_SCOPE_DRIFT/);
 assert.throws(()=>patch(fixture().replace("const oldPrice = Number(orderRow && orderRow.price) || 0;","")),
  /MODIFY_OLD_PRICE_MISSING/);
});
