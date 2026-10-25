import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {planNpcNativePurchase,suggestNativeAskPrice,decideNpcSolvency,
 chooseNativeRegionalProduct}=require("../integration/coopNpcMarketPolicy.cjs");
const base={ownerID:1001,stationID:60001,typeID:215,maxUnitPriceCents:500,
 maxSpendCents:20000,maxQuantity:100,minCashReserveCents:2000};
const ask=(orderID,remainingQuantity=10,unitPriceCents=200,extra={})=>({
 orderID,remainingQuantity,unitPriceCents,verifiedNative:true,stationID:60001,
 typeID:215,sellerOwnerID:900+orderID,state:"open",...extra});
const proof=(asks=[])=>({authoritativeNative:true,ownerID:1001,stationID:60001,
 walletCents:50000,targetStock:100,physicalOwned:80,incomingStock:0,
 outstandingBuys:0,asks});
const priceBase={ownerID:1001,stationID:60001,typeID:215,now:1000000,
 previousPriceCents:200,unitCostCents:125,feesCents:10,minMarginCents:15,
 minPriceCents:100,maxPriceCents:500,stockQuantity:80,targetStock:100};
const fill=(fillID,unitPriceCents,quantity=1,extra={})=>({
 fillID,unitPriceCents,quantity,verifiedNative:true,stationID:60001,
 typeID:215,at:999999,...extra});
test("real affordable external ask yields purchase intent but no mutation",()=>{
 const r=planNpcNativePurchase({...base,proof:proof([ask(10)])});
 assert.equal(r.status,"NATIVE_BUY_INTENT_ONLY");
 assert.equal(r.quantity,10);assert.equal(r.totalCents,2000);
 assert.equal(r.supportsNativeMutation,false);
});
test("own corporate ask cannot be used to wash-trade",()=>{
 const r=planNpcNativePurchase({...base,proof:proof([ask(10,10,200,{sellerOwnerID:1001})])});
 assert.equal(r.status,"BLOCKED");
});
test("existing inbound supply prevents duplicate NPC purchasing",()=>{
 const s=proof([ask(10)]);s.incomingStock=20;
 const r=planNpcNativePurchase({...base,proof:s});
 assert.equal(r.status,"ENOUGH_REAL_STOCK");
});
test("real buyer cannot take part of a native whole-stack sell order",()=>{
 const r=planNpcNativePurchase({...base,proof:proof([ask(10,100)])});
 assert.equal(r.reason,"NPC_BUY_PARTIAL_STACK_REQUIRES_ATOMIC_SPLITTER");
});
test("budget reserve refuses unaffordable purchases without synthetic ISK",()=>{
 const s=proof([ask(10)]);s.walletCents=1900;
 assert.equal(planNpcNativePurchase({...base,proof:s}).reason,"NPC_BUY_NO_SPENDABLE_ISK");
});
test("duplicate Rust order IDs fail closed rather than count supply twice",()=>{
 const s=proof([ask(10),ask(10)]);
 assert.equal(planNpcNativePurchase({...base,proof:s}).reason,"NPC_BUY_RUST_ASK_NOT_ATTESTED");
});
test("native price follows verified market median within bounded daily move",()=>{
 const r=suggestNativeAskPrice({...priceBase,trades:[fill(1,240,5),fill(2,250,5)]});
 assert.equal(r.status,"NATIVE_ASK_PRICE_INTENT_ONLY");
 assert.ok(r.priceCents>=180&&r.priceCents<=220);
 assert.equal(r.supportsNativeMutation,false);
});
test("zero trades cannot invent a market reference price",()=>{
 assert.equal(suggestNativeAskPrice({...priceBase,trades:[]}).reason,"NPC_PRICE_NATIVE_TRADES_MISSING");
});
test("duplicate fills and forged market data block price revisions",()=>{
 assert.equal(suggestNativeAskPrice({...priceBase,trades:[fill(1,200),fill(1,250)]}).reason,"NPC_PRICE_NATIVE_FILL_REPLAY");
 assert.equal(suggestNativeAskPrice({...priceBase,trades:[fill(1,200,1,{verifiedNative:false})]}).reason,"NPC_PRICE_NATIVE_FILL_UNVERIFIED");
});
test("an unprofitable market cannot force a loss-making factory ask",()=>{
 const r=suggestNativeAskPrice({...priceBase,unitCostCents:490,feesCents:100,
  trades:[fill(1,100)]});
 assert.equal(r.reason,"NPC_PRICE_NOT_PROFITABLE");
});
const solvent={authoritativeNative:true,ownerID:1001,stationID:60001,
 walletCents:0,unlistedOutput:10,readyJobs:0,openSellQuantity:0,activeJobs:0};
test("zero-ISK corporation sells already paid output before any new expense",()=>{
 assert.equal(decideNpcSolvency({proof:solvent}).status,"SELL_FINISHED_NATIVE_STOCK");
});
test("zero-ISK corporation can finish ready job without buying materials",()=>{
 assert.equal(decideNpcSolvency({proof:{...solvent,unlistedOutput:0,readyJobs:1}}).status,
 "DELIVER_ALREADY_PAID_JOB");
});
test("bankrupt corporation is not handed free materials or ISK",()=>{
 assert.equal(decideNpcSolvency({proof:{...solvent,unlistedOutput:0}}).status,
 "INSOLVENT_NO_MONEY_MINT");
});
test("corporate reserve is excluded from spendable working capital",()=>{
 const r=decideNpcSolvency({proof:{...solvent,unlistedOutput:0,walletCents:5000},
  reserveCents:2000});
 assert.equal(r.status,"NORMAL_BUDGETED_OPERATIONS");
 assert.equal(r.usableCents,3000);
});
const rbase={ownerID:1001,stationID:60001,regionID:10000002};
const quote=(typeID,profit=100,extra={})=>({
 authoritativeNative:true,ownerID:1001,stationID:60001,regionID:10000002,
 typeID,hasOriginalBPO:true,factoryOnline:true,outputQuantity:10,
 actualBuyerVolume:10,realShortage:10,marketUnitPriceCents:200,
 materialsCostCents:1800-profit,industryFeeCents:100,shippingCostCents:0,...extra});
test("regional product picks highest verified positive margin",()=>{
 const r=chooseNativeRegionalProduct({...rbase,quotes:[quote(215,200),quote(218,300)]});
 assert.equal(r.status,"NATIVE_REGIONAL_PRODUCT_INTENT_ONLY");
 assert.equal(r.typeID,218);assert.equal(r.supportsNativeMutation,false);
});
test("no native buyer demand means no speculative regional production",()=>{
 const r=chooseNativeRegionalProduct({...rbase,quotes:[quote(215,400,{actualBuyerVolume:0})]});
 assert.equal(r.status,"NO_PROVEN_PROFITABLE_REGIONAL_PRODUCT");
});
test("foreign region or corporation source cannot influence local production",()=>{
 const r=chooseNativeRegionalProduct({...rbase,quotes:[quote(215,100,{regionID:10000003})]});
 assert.equal(r.reason,"NPC_REGION_PRODUCT_AUTHORITY_CONFLICT");
});
