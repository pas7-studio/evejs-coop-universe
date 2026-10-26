import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createMiningCorporatePnl}=require("../integration/coopPlayerMiningCorporatePnl.cjs");
const SHIFT="coop-mining-shift:"+"a".repeat(32),CARGO=7773,ORDER="9521",
 CORP=5001,EMPLOYER=9005,BUYER=8011,ITEM=190003,SEP="\u001f";
function fixture({sold=3,returned=false}={}){
 const session={characterID:100,corporationID:CORP,socket:{destroyed:false}};
 let enabled=true,role=true,rustValid=true,witnessReads=0;
 const entry=(id,owner,other,cents,balance,ref=id)=>({
  transactionID:id,referenceID:ref,accountKey:1000,
  ownerID1:owner,ownerID2:other,
  amount:cents/100,balance:balance/100
 });
 const titleID="coop-mining-ore-title:v1:"+SHIFT+":"+CARGO,
  fillKey="coopPlayerMiningCorpFill"+SEP+ORDER+":1";
 const wallet=(journal)=>({balance:1000,transactions:structuredClone(journal),journal:structuredClone(journal)});
 const wageBuyer=entry(SHIFT,CORP,EMPLOYER,-300,99700),
  wageEmployer=entry(SHIFT,EMPLOYER,CORP,300,100300),
  purchaseBuyer=entry(titleID,CORP,EMPLOYER,-800,98900),
  purchaseEmployer=entry(titleID,EMPLOYER,CORP,800,101100);
 const gross=sold*250,tax=sold?30:0,broker=sold?15:0,net=gross-tax-broker;
 const fill={version:1,phase:"GAMESTORE_COMMITTED",receiptKey:fillKey,orderID:ORDER,
  cycle:1,buyerCharacterID:BUYER,sellerCorpID:CORP,cargoID:CARGO,
  sourceItemID:ITEM,stationID:60001,typeID:34,quantity:sold,
  volumeBefore:8,volumeAfter:8-sold,priceCents:250,
  grossCents:gross,transactionTaxCents:tax,brokerFeeCents:broker,
  netRevenueCents:net,buyerJournalID:5100000000000000,
  sellerJournalID:5100000000000001,
  feeJournalID:5100000000000002,committedAt:1793030000000};
 const credit=entry(fill.sellerJournalID,BUYER,CORP,gross,100000+gross,fillKey),
  fee=entry(fill.feeJournalID,BUYER,CORP,-tax-broker,100000+net,fillKey),
  debit=entry(fill.buyerJournalID,BUYER,CORP,-gross,100000-gross,fillKey);
 const corpRecords={corporationID:CORP,wallet:{divisions:{"1000":
    wallet([wageBuyer,purchaseBuyer,...(sold?[credit,fee]:[])])}}},
  employerRecords={corporationID:EMPLOYER,wallet:{divisions:{"1000":
    wallet([wageEmployer,purchaseEmployer])}}};
 const sale={version:1,phase:returned?"RETURNED_UNSOLD":
  sold===8?"FULLY_SOLD":"ACTIVE_SELL",
  cargoID:CARGO,corporationID:CORP,operationID:SHIFT,
  itemID:ITEM,typeID:34,stationID:60001,quantity:8,
  orderID:ORDER,remainingQuantity:returned||sold===8?0:8-sold,
  returnedQuantity:returned?8-sold:undefined,
  settledCycles:sold?1:0,lastSettledCycle:sold?1:0,
  escrowLocationID:9200000000+Number(ORDER)};
 const groups={
   coopPlayerMiningShift:{[SHIFT]:{version:1,status:"FUNDED",
    operationID:SHIFT,corporationID:CORP,employerCorpID:EMPLOYER,
    wageCents:300,buyerAfterCents:99700,employerAfterCents:100300}},
   corporations:{[CORP]:corpRecords,[EMPLOYER]:employerRecords},
   coopPlayerMiningOreTitle:{[CARGO]:{
    version:1,status:"COMMITTED",operationID:titleID,shiftID:SHIFT,
    cargoID:CARGO,itemID:ITEM,typeID:34,quantity:8,
    stationID:60001,officeFolderID:64001,division:115,
    sourceCorpID:EMPLOYER,buyerCorpID:CORP,
    priceCents:800,buyerAfterCents:98900,sourceAfterCents:101100}},
   coopPlayerMiningCorpSell:{[CARGO]:sale},
   coopPlayerMiningCorpFill:sold?{[ORDER+":1"]:fill}:{}
 };
 const gameStore={read(table,path){
  const parts=path.split("/").slice(1),g=parts.shift();
  const data=table==="characters"?g===String(BUYER)?{
    characterID:BUYER,walletJournal:sold?[debit]:[]
  }:null:groups[g]&&(parts.length?groups[g][parts.join("/")]:groups[g]);
  return data===undefined||data===null?{success:false,errorMsg:"ENTRY_NOT_FOUND"}:
   {success:true,data};
 }};
 const sourceItem={itemID:ITEM,ownerID:CORP,typeID:34,quantity:8-sold,
  stacksize:8-sold,singleton:0,customInfo:"coop-warehouse:v1:cargo:"+CARGO,
  locationID:returned?64001:9200000000+Number(ORDER),flagID:returned?115:4};
 const service=createMiningCorporatePnl({
  gameStore,findOriginalItemById:()=>sourceItem,access:{isMember:()=>role,canIndustry:()=>role,canWallet:()=>role},
  readNativeReleased:async({orderID,cycle})=>{
   witnessReads++;
   return rustValid?{verifiedNative:true,phase:"released",
    orderID,cycle,nativeReceiptKey:fillKey,
    ack:{phase:"released",receiptKey:fillKey,volumeAfter:8-sold,
     verifiedGameStore:true}}:null;
  },enabled:()=>enabled
 });
 const run=()=>service.inspect({session,corporationID:CORP,operationID:SHIFT});
 return {run,groups,sale,fill,session,service,corpRecords,
  enabled:v=>enabled=v,role:v=>role=v,rust:v=>rustValid=v,
  nativeReads:()=>witnessReads};
}
test("partially sold ore: cash and accrual P&L account real wage and remaining inventory",async()=>{
 const x=fixture(),r=await x.run();
 assert.equal(r.status,"VERIFIED_REALIZED_MINING_PL");
 assert.equal(r.revenueGrossCents,750);
 assert.equal(r.marketFeesCents,45);
 assert.equal(r.realizedRevenueCents,705);
 assert.equal(r.costOfOreSoldCents,300);
 assert.equal(r.remainingOreInventoryCostCents,500);
 assert.equal(r.grossProfitCents,405);
 assert.equal(r.wagesPaidCents,300);
 assert.equal(r.netOperatingProfitCents,105);
 assert.equal(r.cashProfitCents,-395);
 assert.equal(r.totalSoldOreUnits,3);assert.equal(r.totalUnsoldOreUnits,5);
 assert.equal(x.nativeReads(),1);
});
test("partial unsold cancellation recognizes paid fills and remaining capital as corporate inventory",async()=>{
 const x=fixture({returned:true}),r=await x.run();
 assert.equal(r.status,"VERIFIED_REALIZED_MINING_PL");
 assert.equal(r.cargo[0].remainingQuantity,5);
 assert.equal(r.cashProfitCents,-395);
});
test("funded shift with purchased ore and no sales never invents revenue",async()=>{
 const x=fixture({sold:0}),r=await x.run();
 assert.equal(r.status,"VERIFIED_REALIZED_MINING_PL");
 assert.equal(r.realizedRevenueCents,0);
 assert.equal(r.remainingOreInventoryCostCents,800);
 assert.equal(r.costOfOreSoldCents,0);
 assert.equal(r.netOperatingProfitCents,-300);
 assert.equal(r.cashProfitCents,-1100);
});
test("real 8/8 full sale consumes original cost basis once",async()=>{
 const x=fixture({sold:8}),r=await x.run();
 assert.equal(r.status,"VERIFIED_REALIZED_MINING_PL");
 assert.equal(r.costOfOreSoldCents,800);assert.equal(r.remainingOreInventoryCostCents,0);
 assert.equal(r.realizedRevenueCents,1955);
 assert.equal(r.netOperatingProfitCents,855);
 assert.equal(r.cashProfitCents,855);
});
test("unreleased Rust fill is excluded rather than treated as realized ISK",async()=>{
 const x=fixture();x.rust(false);
 assert.equal((await x.run()).reason,"MINING_PL_ORIGINAL_RUST_FILL_NOT_RELEASED");
});
test("forged corporate wallet credit or transaction fee blocks profit",async()=>{
 const x=fixture();x.corpRecords.wallet.divisions["1000"].journal.at(-2).amount=100;
 assert.equal((await x.run()).reason,"MINING_PL_ORIGINAL_FILL_OR_ISK_UNVERIFIED");
});
test("missing actual buyer wallet debit blocks sales instead of inventing revenue",async()=>{
 const x=fixture();const old=x.groups.corporations[CORP];
 x.groups.coopPlayerMiningCorpFill[ORDER+":1"].buyerJournalID=12;
 assert.equal((await x.run()).reason,"MINING_PL_ORIGINAL_BUYER_DEBIT_NOT_VERIFIED");
});
test("corporation ownership and wage transaction authorization required",async()=>{
 const x=fixture();x.role(false);
 assert.equal((await x.run()).reason,"MINING_PL_CORPORATE_AUTHORITY_DENIED");
});
test("wrong sale source order or overreported inventory fails closed",async()=>{
 const x=fixture();x.sale.remainingQuantity=8;
 assert.equal((await x.run()).reason,"MINING_PL_ORIGINAL_INVENTORY_NOT_CONSERVED");
});
test("feature flag default OFF prevents original wallet or Rust access",async()=>{
 const x=fixture();x.enabled(false);
 assert.equal((await x.run()).reason,"MINING_PL_DISABLED");
 assert.equal(x.nativeReads(),0);
});
