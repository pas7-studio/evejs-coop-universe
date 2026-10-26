import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createCorporateMarketFeeAuthority}=require("../integration/coopPlayerMiningCorporateFeeAuthority.cjs");
const ORDER="9521",CARGO=7773,ITEM=190003,CORP=5001,REP=9001;
function fixture(){
 let live=true,repActive=true,sourceValid=true;
 const claim={sellerCorpID:CORP,cargoID:CARGO,sourceItemID:ITEM,
  stationID:60001,orderID:ORDER};
 const receipt={corporationID:CORP,cargoID:CARGO,itemID:ITEM,
  stationID:60001,orderID:ORDER,sellerRepresentativeCharacterID:REP};
 const events=[];
 const gameStore={read(table,path){events.push({table,path});
  return sourceValid?{success:true,data:receipt}:{success:false,errorMsg:"ENTRY_NOT_FOUND"};}};
 const svc=createCorporateMarketFeeAuthority({
  gameStore,enabled:()=>live,
  getCharacterRecord:id=>id===REP&&repActive?{characterID:REP,corporationID:CORP}:null,
  getMarketContext:({characterID,stationID})=>({characterID,stationID,
   limits:{acc:0.04},brokerCommissionRate:0.02}),
  computeSalesTaxAmount:(_,gross)=>Math.round(gross*0.04*100)/100,
  computeBrokerFeeInfo:(_,__,gross)=>({amount:Math.round(gross*0.02*100)/100})
 });
 return {svc,claim,receipt,events,
  quote:()=>svc.quoteNativeFees({claim,grossCents:10000}),
  enabled:v=>live=v,repActive:v=>repActive=v,source:v=>sourceValid=v};
}
test("native seller-representative from persisted original corp escrow gives exact tax and broker fee",()=>{
 const x=fixture(),r=x.quote();
 assert.equal(r.verifiedNative,true);
 assert.equal(r.transactionTaxCents,400);
 assert.equal(r.brokerFeeCents,200);
 assert.equal(r.feePolicy,"EVEJS_NATIVE_MARKET_RULES_CORP_FILL");
 assert.equal(r.representativeCharacterID,REP);
 assert.deepEqual(x.events,[{table:"corporationRuntime",
  path:"/coopPlayerMiningCorpSell/"+CARGO}]);
});
test("no original corp custody receipt cannot charge guessed market tax",()=>{
 const x=fixture();x.source(false);
 assert.throws(()=>x.quote(),/ORIGINAL_ESCROW_RECEIPT_MISSING/);
});
test("representative no longer in original corp cannot price market fees",()=>{
 const x=fixture();x.repActive(false);
 assert.throws(()=>x.quote(),/REPRESENTATIVE_NO_LONGER_MEMBER/);
});
test("tampered original sell order or owner cannot quote fee",()=>{
 const x=fixture();x.receipt.orderID="9124";
 assert.throws(()=>x.quote(),/SOURCE_IDENTITY_CHANGED/);
});
test("operator flag OFF prevents even tax preview",()=>{
 const x=fixture();x.enabled(false);
 assert.throws(()=>x.quote(),/FEE_RULES_DISABLED/);
});
