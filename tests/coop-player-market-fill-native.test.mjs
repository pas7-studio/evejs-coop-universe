import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {checkSellMatch,checkBuyMatch,assertFillAck}=
 require("../integration/coopPlayerMarketFill.cjs");
const {patch}=require("../scripts/coop-player-market-fill-patch.cjs");
const {names,specs}=require("../scripts/patch-evejs-coop.cjs");

const id="23",station=60001234,location=9200000023;
const sellOrder={order_id:id,owner_id:201,is_corp:false,source:"player",
 row:{order_id:id,station_id:station,type_id:34,vol_remaining:7,
 price:12.34,bid:false,source:"player"}};
const buyOrder={...sellOrder,owner_id:301,
 row:{...sellOrder.row,bid:true,min_volume:1}};
const sellBook={...sellOrder.row},buyBook={...buyOrder.row};
const sellEscrow={orderId:id,ownerId:201,isCorp:false,escrowType:"sell",
 stationId:station,typeId:34,remainingQuantity:7,escrowLocationID:location};
const buyEscrow={orderId:id,ownerId:301,isCorp:false,escrowType:"buy",
 stationId:station,typeId:34,remainingQuantity:7,escrowAmount:86.38,price:12.34};
const sellItem={itemID:800,typeID:34,ownerID:201,locationID:location,
 flagID:4,stacksize:7,singleton:0};
const directItem={...sellItem,ownerID:201,locationID:station};
const sellArgs=()=>({order:sellOrder,bookRow:sellBook,escrow:sellEscrow,
 items:[sellItem],buyerCharacterID:301,tradedQuantity:3,price:12.34});
const buyArgs=()=>({order:buyOrder,bookRow:buyBook,escrow:buyEscrow,
 sellerCharacterID:201,fillableQuantity:3,price:12.34,
 sourceItem:directItem,sourceStationID:station});
const ack=proof=>({order_id:proof.orderID,owner_id:proof.ownerID,
 station_id:proof.stationID,type_id:proof.typeID,is_corp:false,
 bid:proof.bid,filled_quantity:proof.filledQuantity,
 vol_remaining:proof.volumeAfter,price:12.34,
 state:proof.volumeAfter===0?"filled":"open",invalidated:true});

test("player sell offer: original Rust order, native escrow and real item custody",()=>{
 const proof=checkSellMatch(sellArgs());
 assert.equal(proof.ownerID,201);
 assert.equal(proof.counterpartyID,301);
 assert.equal(proof.volumeAfter,4);
 assert.equal(assertFillAck({proof,ack:ack(proof)}),true);
});
test("player buy offer: real reserved escrow and legitimate seller station item",()=>{
 const proof=checkBuyMatch(buyArgs());
 assert.equal(proof.ownerID,301);
 assert.equal(proof.counterpartyID,201);
 assert.equal(assertFillAck({proof,ack:ack(proof)}),true);
});
test("full-volume native sell fill expects terminal filled ACK",()=>{
 const proof=checkSellMatch({...sellArgs(),tradedQuantity:7});
 assert.equal(proof.volumeAfter,0);
 assert.equal(assertFillAck({proof,ack:ack(proof)}),true);
});
test("self trades, changed book price and changed Rust remaining are rejected",()=>{
 const s=sellArgs();
 for(const value of [
  {...s,buyerCharacterID:201},
  {...s,bookRow:{...sellBook,vol_remaining:6}},
  {...s,bookRow:{...sellBook,price:12.35}},
  {...s,price:12.345},
  {...s,tradedQuantity:8}
 ])assert.throws(()=>checkSellMatch(value),/COOP_PLAYER_MARKET_FILL_/);
});
test("unbacked or mismatched native market sell inventory is rejected",()=>{
 const s=sellArgs();
 for(const value of [
  {...s,escrow:null},{...s,items:[]},
  {...s,items:[{...sellItem,stacksize:6}]},
  {...s,escrow:{...sellEscrow,ownerId:301}},
  {...s,items:[{...sellItem,ownerID:301}]}
 ])assert.throws(()=>checkSellMatch(value),/COOP_PLAYER_MARKET_FILL_/);
});
test("buy escrow must match exact remaining reserve, cents and seller inventory",()=>{
 const b=buyArgs();
 for(const value of [
  {...b,escrow:null},{...b,escrow:{...buyEscrow,escrowAmount:1}},
  {...b,escrow:{...buyEscrow,remainingQuantity:6}},
  {...b,sourceItem:null},
  {...b,sourceItem:{...directItem,ownerID:999}},
  {...b,sourceItem:{...directItem,stacksize:2}},
  {...b,sellerCharacterID:301},
  {...b,bookRow:{...buyBook,price:12.35}}
 ])assert.throws(()=>checkBuyMatch(value),/COOP_PLAYER_MARKET_FILL_/);
});
test("source seller order requires its own native Rust record and all physical escrow",()=>{
 const src={...sellOrder,order_id:"24",row:{...sellOrder.row,order_id:"24"}};
 const sourceEscrow={...sellEscrow,orderId:"24",escrowLocationID:9200000024};
 const sourceItems=[{...sellItem,locationID:9200000024}];
 const valid={...buyArgs(),sourceItem:null,sourceOrder:src,sourceEscrow,sourceItems};
 assert.equal(checkBuyMatch(valid).volumeAfter,4);
 assert.throws(()=>checkBuyMatch({...valid,sourceItems:[]}),/COOP_PLAYER_MARKET_FILL_/);
 assert.throws(()=>checkBuyMatch({...valid,sourceOrder:buyOrder}),/COOP_PLAYER_MARKET_FILL_/);
});
test("original Rust fill ACK binds i64 order ID, sides, price, volume and owner",()=>{
 const proof=checkSellMatch(sellArgs());
 const correct=ack(proof);
 for(const bad of [
  null,{...correct,order_id:"24"},{...correct,owner_id:301},
  {...correct,type_id:35},{...correct,station_id:station+1},
  {...correct,filled_quantity:2},{...correct,vol_remaining:5},
  {...correct,price:12.35},{...correct,bid:true},
  {...correct,state:"filled"},{...correct,invalidated:false}
 ])assert.throws(()=>assertFillAck({proof,ack:bad}),/RUST_FILL_ACK_NOT_MATCHED/);
});
test("large native order identity is preserved as a string, not truncated to JS float",()=>{
 const s=sellArgs(),big="9007199254740993";
 const bogus={...s,order:{...sellOrder,order_id:big,
  row:{...sellOrder.row,order_id:big}},bookRow:{...sellBook,order_id:big}};
 assert.throws(()=>checkSellMatch(bogus),/COOP_PLAYER_MARKET_FILL_/);
});
function sourceFixture(eol="\n"){
 return [
 "async function matchSellOrdersForBuyer({}={}) {",
 "    let buyerWalletResult = null;",
 "    try {",
 "      if (true) {",
 "        purchaseCounterpartyID = sellerCharacterID;",
 "          const moveResult = moveItemToLocation(1,2,3);",
 "        const grossAmount = roundIsk(orderPrice * tradedQuantity);",
 "      }",
 "    } catch (error) {",
 "      if (buyerWalletResult) {",
 "        buyerWalletResult = null;",
 "      }",
 "    }",
 "}",
 "async function matchBuyOrdersForSeller({}={}) {",
 "    const sellerInventoryChanges = [];",
 "    const grossAmount = roundIsk(orderPrice * fillableQuantity);",
 "}",
 "async function executeBuyRequest({}={}) {}",
 ""
 ].join(eol);
}
for(const eol of ["\n","\r\n"])
test("original native market fill hooks are gated and byte-reversible "+JSON.stringify(eol),()=>{
 const original=sourceFixture(eol),applied=patch(original);
 assert.notEqual(applied,original);
 assert.equal(patch(applied),applied);
 assert.equal(patch(applied,{remove:true}),original);
 assert.equal((applied.match(/EVEJS_COOP_PLAYER_MARKET_FILL_GUARD/g)||[]).length,2);
 assert.doesNotThrow(()=>new Function(applied));
 assert.match(applied,/coopPlayerSellIrreversible = true/);
 assert.match(applied,/if \(coopPlayerSellIrreversible\) buyerWalletResult = null/);
});
test("central overlay registers exactly one source module and original market spec",()=>{
 assert.equal(names.filter(n=>n==="coopPlayerMarketFill").length,1);
 assert.equal(specs.filter(s=>s.file==="server/src/services/market/marketProxyService.js").length,1);
});
