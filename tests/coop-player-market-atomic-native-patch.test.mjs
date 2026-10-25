import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {patch}=require("../scripts/coop-player-market-atomic-patch.cjs");
const sellClaim='        if (coopPlayerSellTicket) await require("../../space/coopPlayerMarketRustClaim").claim({ticket:coopPlayerSellTicket,proof:coopPlayerSellProof,client:marketDaemonClient});';
const buyProof='    const coopPlayerBuyProof = !isSeedBuyOrder && process.env.EVEJS_COOP_PLAYER_MARKET_FILL_GUARD === "1" ? require("../../space/coopPlayerMarketFill").checkBuyMatch({order:playerBuyOrder,bookRow:buyOrder,escrow:getEscrowRecord(buyOrder && buyOrder.order_id),sellerCharacterID,fillableQuantity,price:orderPrice,sourceItem:sourceOrderId?null:findItemById(sourceItemID),sourceOrder:sourceOrderId && normalizeOrderId(sourceOrderId)!=="0" ? await fetchOrderById(sourceOrderId) : null,sourceEscrow:sourceOrderId?getEscrowRecord(sourceOrderId):null,sourceItems:sourceOrderId?listEscrowItemsForOrder(sourceOrderId,sellerCharacterID):null,sourceStationID:stationID,hangarFlag:ITEM_FLAGS.HANGAR}) : null;';
function original(eol="\n"){
 return [
  'async function matchSellOrdersForBuyer({}={}) {',
  '  for(const sellOrder of []) {',
  '    try {',
  '        purchaseCounterpartyID = sellerCharacterID;',
  '        coopPlayerSellProof = true;',
  '        const coopPlayerSellTicket = {};',
  sellClaim,
  '        if (chargeBuyerWallet) buyerWalletResult=true;',
  '    } catch (error) { throw error; }',
  '  }',
  '}',
  'async function matchBuyOrdersForSeller({}={}) {',
  '  for(const buyOrder of []) {',
  '    const isSeedBuyOrder=false;',
  buyProof,
  '    const sellerInventoryChanges=[];',
  '  }',
  '}',
  'async function executeBuyRequest({}={}) {}',
  ''
 ].join(eol);
}
for(const eol of ["\n","\r\n"])test("single-stack atomic native market hook reverses byte-exactly "+JSON.stringify(eol),()=>{
 const source=original(eol),first=patch(source);
 assert.notEqual(first,source);
 assert.equal(patch(first),first);
 assert.equal(patch(first,{remove:true}),source);
 assert.doesNotThrow(()=>new Function(first));
 assert.equal((first.match(/P2P_ATOMIC_FULL_SINGLE_SELL_ORDER_REQUIRED/g)||[]).length,1);
 assert.match(first,/P2P_ATOMIC_PREPAID_BUY_RESERVE_NOT_YET_PROVEN/);
 assert.match(first,/coopPlayerMarketAtomicRuntime/);
});
test("missing original Rust claim or buyer source proof refuses stale patch",()=>{
 assert.throws(()=>patch(original().replace(sellClaim,"")),/HOOK_DRIFT/);
 assert.throws(()=>patch(original().replace(buyProof,"")),/HOOK_DRIFT/);
});
test("native full-stack branch explicitly bypasses stock double wallet debit",()=>{
 const first=patch(original());
 const atomic=first.slice(first.indexOf("if (process.env.EVEJS_COOP_PLAYER_MARKET_ATOMIC"),first.indexOf("if (chargeBuyerWallet) buyerWalletResult"));
 assert.match(atomic,/continue;/);
 assert.match(atomic,/settleSell/);
 assert.match(atomic,/notifyBuyerDelivery/);
});
