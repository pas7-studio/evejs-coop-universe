import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createNativeNpcSellerTaxQuote}=require("../integration/coopNpcSellerTaxAuthority.cjs");
const rateRules=(rate=0.08)=>({
 getMarketContext:({characterID,stationID,session})=>({
  characterID,stationID,limits:{acc:rate},session}),
 computeSalesTaxAmount:(context,gross)=>Math.round(gross*context.limits.acc*100)/100
});
test("8% native market sales tax on 25 ISK is 2 ISK",()=>{
 const q=createNativeNpcSellerTaxQuote(rateRules());
 assert.deepEqual(q({sellerID:90000001,stationID:60000001,grossCents:2500}),{
  sellerID:90000001,stationID:60000001,grossCents:2500,
  taxCents:200,policy:"EVEJS_NATIVE_MARKET_RULES",rate:0.08});
});
test("Accounting/location native discount context is respected, no flat 8% levy",()=>{
 const q=createNativeNpcSellerTaxQuote(rateRules(0.036));
 assert.equal(q({sellerID:90000001,stationID:60000001,grossCents:10000}).taxCents,360);
});
test("one-cent gross can legally round tax to zero",()=>{
 const q=createNativeNpcSellerTaxQuote(rateRules());
 assert.equal(q({sellerID:90000001,stationID:60000001,grossCents:1}).taxCents,0);
});
test("wrong seller or station market context fails closed",()=>{
 const r=rateRules();r.getMarketContext=({stationID})=>({
  characterID:90000002,stationID,limits:{acc:0.08}});
 const q=createNativeNpcSellerTaxQuote(r);
 assert.throws(()=>q({sellerID:90000001,stationID:60000001,grossCents:100}),
 /TAX_CONTEXT_UNVERIFIED/);
});
test("missing context, negative and inflated tax rates refuse native settlement",()=>{
 for(const rate of [-0.1,0.09,Number.NaN]){
  const q=createNativeNpcSellerTaxQuote(rateRules(rate));
  assert.throws(()=>q({sellerID:90000001,stationID:60000001,grossCents:2500}),
  /TAX_CONTEXT_UNVERIFIED/);
 }
});
test("tax outside gross amount, noncent or wrong monetary output is rejected",()=>{
 for(const amount of [-1,26,Number.NaN,0.001]){
  const r=rateRules();r.computeSalesTaxAmount=()=>amount;
  const q=createNativeNpcSellerTaxQuote(r);
  assert.throws(()=>q({sellerID:90000001,stationID:60000001,grossCents:2500}),
   /TAX_QUOTE_INVALID|TAX_NOT_CENT_EXACT/);
 }
});
test("missing authoritative market rules cannot silently fall back to no tax",()=>{
 assert.throws(()=>createNativeNpcSellerTaxQuote({}),/NATIVE_TAX_RULES_REQUIRED/);
});
