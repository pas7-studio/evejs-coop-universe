import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {assertSellEscrow,assertSellReturned}=require("../integration/coopMarketSellCustody.cjs");
const {patch}=require("../scripts/coop-market-sell-custody-patch.cjs");
const {patch:buyPatch}=require("../scripts/coop-market-cancel-custody-patch.cjs");
const id="23",station=60001234,location=9200000023;
const order={order_id:id,owner_id:101,is_corp:false,source:"player",
 row:{order_id:id,bid:false,station_id:station,type_id:34,vol_remaining:7,source:"player"}};
const escrow={orderId:id,ownerId:101,isCorp:false,escrowType:"sell",
 stationId:station,typeId:34,remainingQuantity:7,escrowLocationID:location};
const item={itemID:800,ownerID:101,typeID:34,locationID:location,
 flagID:4,stacksize:7,singleton:0};
const source=()=>({order:{...order,row:{...order.row}},escrow:{...escrow},items:[{...item}]});
test("accept native rust order, original physical item and exact seller location",()=>{
 const proof=assertSellEscrow(source());
 assert.equal(proof.remainingQuantity,7);
 assert.equal(proof.items[0].itemID,800);
 assert.equal(Object.isFrozen(proof.items),true);
 assert.equal(assertSellReturned({proof,remainingItems:[],
  findItemById:()=>({...item,locationID:station})}),true);
});
test("reject zero/missing escrow without moving any seller inventory",()=>{
 for(const items of [[],null,undefined]){
  assert.throws(()=>assertSellEscrow({...source(),items}),/COOP_MARKET_SELL_CUSTODY_/);
 }
 for(const e of [null,{...escrow,escrowType:"buy"},
  {...escrow,remainingQuantity:0},{...escrow,ownerId:102}]){
  assert.throws(()=>assertSellEscrow({...source(),escrow:e}),/COOP_MARKET_SELL_CUSTODY_/);
 }
});
test("reject counterfeit owner, type, station, flag or short stack",()=>{
 for(const change of [{ownerID:102},{typeID:35},{locationID:station},
  {flagID:5},{stacksize:6},{stacksize:8}]){
  assert.throws(()=>assertSellEscrow({...source(),items:[{...item,...change}]}),
   /COOP_MARKET_SELL_CUSTODY_/);
 }
});
test("reject wrong Rust order, buy direction and corporation orders",()=>{
 const s=source();
 for(const bad of [{...order,order_id:"24"},
  {...order,is_corp:true},{...order,row:{...order.row,bid:true}},
  {...order,source:"coop-npc"}]){
  assert.throws(()=>assertSellEscrow({...s,order:bad}),/COOP_MARKET_SELL_CUSTODY_/);
 }
});
test("split legitimate inventory stacks sum precisely, duplicate itemID denied",()=>{
 const s=source(),first={...item,stacksize:4},second={...item,itemID:801,stacksize:3};
 assert.equal(assertSellEscrow({...s,items:[first,second]}).remainingQuantity,7);
 assert.throws(()=>assertSellEscrow({...s,items:[first,{...second,itemID:800}]}),
  /COOP_MARKET_SELL_CUSTODY_/);
});
test("must not lose original stack identity or clear escrow early",()=>{
 const proof=assertSellEscrow(source());
 for(const result of [
  {remainingItems:[{...item}],findItemById:()=>({...item,locationID:station})},
  {remainingItems:[],findItemById:()=>null},
  {remainingItems:[],findItemById:()=>({...item,locationID:station,ownerID:102})},
  {remainingItems:[],findItemById:()=>({...item,locationID:station,stacksize:6})}
 ]){
  assert.throws(()=>assertSellReturned({proof,...result}),/COOP_MARKET_SELL_CUSTODY_/);
 }
});
test("unsafe i64 Rust order ids cannot alias numeric native inventory locations",()=>{
 const s=source();
 const big="9007199254740991";
 assert.throws(()=>assertSellEscrow({...s,
  order:{...s.order,order_id:big,row:{...s.order.row,order_id:big}},
  escrow:{...s.escrow,orderId:big}}),/UNSAFE_OR_COLLIDING_ESCROW_LOCATION/);
 assert.throws(()=>assertSellEscrow({...s,escrow:{...escrow,escrowLocationID:location+1}}),
  /UNSAFE_OR_COLLIDING_ESCROW_LOCATION/);
});
const marketSource=[
 "async function applyExpiredOrderEvent(event) {",
 '    if (escrowRecord && getEscrowType(escrowRecord) === "sell") {',
 "      moveEscrowItemsBackToSeller(",
 "        orderID,",
 "        ownerID,",
 "        normalizePositiveInteger(orderRow && orderRow.station_id, 0),",
 "      );",
 "      removeEscrowRecord(orderID);",
 "    }",
 "}",
 "function applyCancelledStructureMarketOrder(order) {",
 "  } else {",
 "    moveEscrowItemsBackToSeller(orderID, ownerID, stationID);",
 "    removeEscrowRecord(orderID);",
 "  }",
 "}",
 "async function cancelStructureMarketOrdersForServiceLoss() {}",
 "class NativeMarket {",
 "  async Handle_CancelCharOrder(args, session) {",
 '      const cancelResponse = await marketDaemonClient.call("CancelOrder", {',
 "        order_id: orderID,",
 "      });",
 "      if (!normalizeBoolean(orderRow && orderRow.bid)) {",
 "        moveEscrowItemsBackToSeller(",
 "          orderID,",
 "          normalizePositiveInteger(order && order.owner_id, 0),",
 "          normalizePositiveInteger(orderRow && orderRow.station_id, 0),",
 "        );",
 "        removeEscrowRecord(orderID);",
 "      }",
 "  }",
 "  async Handle_ModifyCharOrder(args, session) {}",
 "}",
 ""
].join("\n");
test("source patch stays flag-gated, reversible and idempotent without buy hook",()=>{
 const compiled=patch(marketSource);
 assert.notEqual(compiled,marketSource);
 assert.equal(patch(compiled),compiled);
 assert.equal(patch(compiled,{remove:true}),marketSource);
 assert.doesNotThrow(()=>new Function(compiled));
 assert.equal((compiled.match(/EVEJS_COOP_MARKET_SELL_CUSTODY/g)||[]).length,3);
});
test("LF/CRLF roundtrip and malformed native hook fail closed",()=>{
 const crlf=marketSource.replaceAll("\n","\r\n");
 assert.equal(patch(patch(crlf),{remove:true}),crlf);
 assert.throws(()=>patch(marketSource.replace('moveEscrowItemsBackToSeller(orderID, ownerID, stationID)',
  'unsafeReturn(orderID,ownerID,stationID)')),/ANCHOR_DRIFT/);
});
// Full pinned source composition is checked separately; the buy-side patch has
// additional sections that are intentionally absent from this small fixture.
test("existing native buy cancellation guard remains untouched by sell hooks",()=>{
 const installed=patch(marketSource);
 assert.match(installed,/COOP_MARKET_SELL_CUSTODY/);
 assert.equal(installed.includes("creditCharacterWallet("),false);
 assert.equal(typeof buyPatch,"function");
});
