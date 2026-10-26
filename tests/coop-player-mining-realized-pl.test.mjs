import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createCorporateMiningRealizedPL}=require("../integration/coopPlayerMiningRealizedPL.cjs");
const OP="coop-mining-shift:"+"a".repeat(32),CORP=5001;
function fixture(){
 const session={characterID:44,corporationID:CORP,socket:{destroyed:false}};
 let on=true,role=true,released=true;const store={
  coopPlayerMiningShift:{[OP]:{version:1,status:"FUNDED",corporationID:CORP,
   operationID:OP,wageCents:1000,employerCorpID:6001}},
  coopPlayerMiningOreTitle:{"77":{version:1,status:"COMMITTED",shiftID:OP,
   buyerCorpID:CORP,sourceCorpID:6001,cargoID:77,quantity:8,
   priceCents:2000,itemID:901,typeID:34,stationID:12}},
  coopPlayerMiningCorpSell:{"77":{operationID:OP,cargoID:77,
   corporationID:CORP,itemID:901,typeID:34,stationID:12,
   orderID:"9521",phase:"ACTIVE_SELL"}},
  coopPlayerMiningCorpFill:{"9521:1":{version:1,phase:"GAMESTORE_COMMITTED",
   orderID:"9521",cycle:1,sellerCorpID:CORP,cargoID:77,sourceItemID:901,
   quantity:3,volumeBefore:8,volumeAfter:5,grossCents:1500,
   transactionTaxCents:75,brokerFeeCents:25,netRevenueCents:1400,
   buyerJournalID:5001,sellerJournalID:5002}}
 };
 const gs={read(_,path){const [group,...rest]=path.slice(1).split("/");
  const g=store[group],val=rest.length?g?.[rest.join("/")]:g;
  return val===undefined?{success:false,errorMsg:"ENTRY_NOT_FOUND"}:
   {success:true,data:val}}};
 const svc=createCorporateMiningRealizedPL({gameStore:gs,
  access:{isMember:()=>role,canIndustry:()=>role,canWallet:()=>role},
  verifyReleasedFill:()=>released,enabled:()=>on});
 return {svc,store,session,run:()=>svc.report({session,corporationID:CORP,operationID:OP}),
  flag:v=>on=v,role:v=>role=v,released:v=>released=v};
}
test("real cash P&L requires funded wage, paid ore and released original wallet fills",()=>{
 const f=fixture(),r=f.run();
 assert.equal(r.status,"VERIFIED_SCOPED_CASH_PL");
 assert.equal(r.wagePaidCents,1000);assert.equal(r.orePurchasedCents,2000);
 assert.equal(r.grossRevenueCents,1500);assert.equal(r.marketFeesCents,100);
 assert.equal(r.netRevenueCents,1400);assert.equal(r.realizedNetCashCents,-1600);
 assert.equal(r.quantitySold,3);assert.equal(r.remainingQuantity,5);
 assert.equal(r.accountingProfitCents,null);
 assert.equal(r.isFullAccountingPL,false);
});
test("original cost and cash output can be negative even without a sale",()=>{
 const f=fixture();f.store.coopPlayerMiningCorpSell={};
 f.store.coopPlayerMiningCorpFill={};
 const r=f.run();
 assert.equal(r.status,"VERIFIED_SCOPED_CASH_PL");
 assert.equal(r.realizedNetCashCents,-3000);
 assert.equal(r.completedFills,0);
});
test("fake revenue without finalized released Rust proof is rejected",()=>{
 const f=fixture();f.released(false);
 assert.equal(f.run().reason,"CORP_PL_FILL_NOT_RELEASED_OR_UNVERIFIED");
});
test("tampered original fill gross/fees cannot inflate corporate profit",()=>{
 const f=fixture();f.store.coopPlayerMiningCorpFill["9521:1"].netRevenueCents=9000;
 assert.equal(f.run().reason,"CORP_PL_FILL_NOT_RELEASED_OR_UNVERIFIED");
});
test("duplicate/non-contiguous fill cycles reject partial stock accounting",()=>{
 const f=fixture();f.store.coopPlayerMiningCorpFill["9521:1"].cycle=2;
 assert.equal(f.run().reason,"CORP_PL_FILL_NOT_RELEASED_OR_UNVERIFIED");
});
test("original corporate purchase receipt mismatch cannot hide expenses",()=>{
 const f=fixture();f.store.coopPlayerMiningOreTitle["77"].buyerCorpID=999;
 assert.equal(f.run().reason,"CORP_PL_INVALID_ORIGINAL_PURCHASE");
});
test("partial cancelled sale separately identifies returned quantity",()=>{
 const f=fixture();
 f.store.coopPlayerMiningCorpSell["77"].phase="RETURNED_UNSOLD";
 f.store.coopPlayerMiningCorpSell["77"].returnedQuantity=5;
 const r=f.run();
 assert.equal(r.status,"VERIFIED_SCOPED_CASH_PL");
 assert.equal(r.returnedQuantity,5);assert.equal(r.remainingQuantity,0);
});
test("disabled or unauthorized role cannot inspect company finances",()=>{
 const f=fixture();f.flag(false);
 assert.equal(f.run().reason,"CORP_PL_DISABLED");f.flag(true);f.role(false);
 assert.equal(f.run().reason,"CORP_PL_ROLE_OR_SCOPE_DENIED");
});
