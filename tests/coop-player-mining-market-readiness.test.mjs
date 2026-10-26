import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createCorporateMiningMarketReadiness}=require("../integration/coopPlayerMiningMarketReadiness.cjs");
const SEP="\u001f",PLAYER=8001,NPC=8002,SYSTEM=30000144,FLEET=901,
 SHIFT="coop-mining-shift:"+"a".repeat(32),
 CARGO=8211,ITEM=9911,OFFICE=9200,STATION=60001111;
const TITLE="coop-mining-ore-title:v1:"+SHIFT+":"+CARGO;
const cents=x=>x/100;
function fixture(){
 let enabled=true,allowed=true,take=true,office=true,writes=0,readBroken=false;
 const session={characterID:123,corporationID:PLAYER,socket:{destroyed:false}};
 const entry=(op,owner,other,amount,after)=>({
  transactionID:op,referenceID:op,ownerID1:owner,ownerID2:other,
  accountKey:1000,amount:cents(amount),balance:cents(after)});
 const shift={version:1,status:"FUNDED",operationID:SHIFT,corporationID:PLAYER,
  employerCorpID:NPC,systemID:SYSTEM,fleetID:FLEET,createdAt:1793030000000,wageCents:75000,
  buyerAfterCents:425000,employerAfterCents:875000};
 const title={version:1,status:"COMMITTED",operationID:TITLE,shiftID:SHIFT,
  cargoID:CARGO,itemID:ITEM,typeID:34,quantity:60,
  sourceCorpID:NPC,buyerCorpID:PLAYER,stationID:STATION,
  officeFolderID:OFFICE,division:115,priceCents:12000,
  buyerAfterCents:413000,sourceAfterCents:887000,committedAt:1793030001000};
 const account=(owner,after,rows)=>({corporationID:owner,wallet:{divisions:{
  "1000":{balance:cents(after),transactions:rows,journal:rows.map(x=>({...x}))}
 }}});
 const buyer=account(PLAYER,413000,[entry(SHIFT,PLAYER,NPC,-75000,425000),
  entry(TITLE,PLAYER,NPC,-12000,413000)]);
 const employer=account(NPC,887000,[entry(SHIFT,NPC,PLAYER,75000,875000),
  entry(TITLE,NPC,PLAYER,12000,887000)]);
 const item={itemID:ITEM,typeID:34,quantity:60,stacksize:60,singleton:0,
  ownerID:PLAYER,locationID:OFFICE,flagID:115,
  customInfo:"coop-warehouse:v1:cargo:"+CARGO};
 const records=new Map([
  ["corporations"+SEP+PLAYER,buyer],["corporations"+SEP+NPC,employer],
  ["coopPlayerMiningShift"+SEP+SHIFT,shift],
  ["coopPlayerMiningFleet"+SEP+SYSTEM+":"+FLEET,{
   operationID:SHIFT,corporationID:PLAYER,employerCorpID:NPC,
   systemID:SYSTEM,fleetID:FLEET}],
  ["coopPlayerMiningOreTitle"+SEP+CARGO,title]
 ]);
 const svc=createCorporateMiningMarketReadiness({
  gameStore:{read(table,p){if(readBroken)return {success:false,errorMsg:"READ_ERROR"};
   assert.equal(table,"corporationRuntime");
   if(p==="/coopPlayerMiningOreTitle"){
    const group={};
    for(const [key,value] of records)
     if(key.startsWith("coopPlayerMiningOreTitle"+SEP))
      group[key.split(SEP)[1]]=structuredClone(value);
    return Object.keys(group).length?{success:true,data:group}:
     {success:false,errorMsg:"ENTRY_NOT_FOUND"};
   }
   const val=records.get(p.slice(1).replace("/",SEP));
   return val?{success:true,data:structuredClone(val)}:
    {success:false,errorMsg:"ENTRY_NOT_FOUND"};},
    coopAtomicNativeRows:{transact(){writes++;throw Error("MUST_NOT_MUTATE");}}},
  itemStore:{findItemById:id=>id===ITEM?item:null},
  access:{isMember:()=>allowed,canIndustry:()=>allowed,
   canWallet:()=>allowed,canTake:()=>take},
  verifyOffice:()=>office,enabled:()=>enabled
 });
 return {svc,session,records,buyer,employer,shift,title,item,
  inspect:ids=>svc.inspect({session,corporationID:PLAYER,operationID:SHIFT,cargoIDs:ids||[CARGO]}),
  inspectShift:()=>svc.inspectShift({session,corporationID:PLAYER,operationID:SHIFT}),
  enabled:v=>enabled=v,allow:v=>allowed=v,take:v=>take=v,
  office:v=>office=v,readBroken:v=>readBroken=v,writes:()=>writes};
}
test("real one-shift costs are verified from both source corporation wallet ledgers",()=>{
 const x=fixture(),r=x.inspect();
 assert.equal(r.status,"NATIVE_CORPORATE_SELL_UNSUPPORTED");
 assert.equal(r.wagePaidCents,75000);
 assert.equal(r.orePurchasedCents,12000);
 assert.equal(r.verifiedCashOutflowCents,87000);
 assert.equal(r.originalCorporateOre[0].itemID,ITEM);
 assert.equal(r.scope,"ONE_FUNDED_SHIFT_AND_EXPLICIT_CARGO_IDS");
 assert.equal(r.marketOrderCreated,false);
 assert.equal(r.nativeMutation,false);
 assert.equal(r.realizedRevenueCents,null);assert.equal(r.netProfitCents,null);
 assert.equal(x.writes(),0);
});
test("empty cargo scope still reports only confirmed wage cost, not profit",()=>{
 const x=fixture(),r=x.inspect([]);
 assert.equal(r.wagePaidCents,75000);assert.equal(r.orePurchasedCents,0);
 assert.equal(r.netProfitCents,null);assert.equal(r.originalCorporateOre.length,0);
});
test("feature OFF exposes neither financial detail nor a market action",()=>{
 const x=fixture();x.enabled(false);
 assert.equal(x.inspect().reason,"NATIVE_MINING_MARKET_READ_DISABLED");
 assert.equal(x.writes(),0);
});
test("unprivileged or revoked company member cannot inspect wages or ore",()=>{
 const x=fixture();x.allow(false);
 assert.equal(x.inspect().reason,"MINING_MARKET_FINANCE_ROLE_DENIED");
 assert.equal(x.writes(),0);
});
test("authentic corporate hangar TAKE role and original office are mandatory",()=>{
 const x=fixture();x.take(false);
 assert.equal(x.inspect().reason,"MINING_MARKET_ORIGINAL_HANGAR_RIGHTS_DENIED");
 x.take(true);x.office(false);
 assert.equal(x.inspect().reason,"MINING_MARKET_ORIGINAL_HANGAR_RIGHTS_DENIED");
});
test("vanished original corporate item or fake item owner cannot be sold",()=>{
 for(const mutate of [x=>x.item.ownerID=NPC,
   x=>x.item.locationID=STATION,
   x=>x.item.quantity=59,
   x=>x.item.customInfo="duplicated",
   x=>x.item.flagID=4]){
  const x=fixture();mutate(x);
  assert.equal(x.inspect().reason,"MINING_MARKET_ORIGINAL_ITEM_NO_LONGER_IN_HANGAR");
 }
});
test("tampered corporate wage or original NPC reciprocal wallet entry fails closed",()=>{
 for(const mutate of [x=>x.buyer.wallet.divisions["1000"].journal[0].amount=-900,
  x=>x.employer.wallet.divisions["1000"].transactions[0].ownerID1=PLAYER,
  x=>x.shift.wageCents=1]){
  const x=fixture();mutate(x);
  assert.equal(x.inspect().reason,"MINING_MARKET_WAGE_WALLET_PROOF_MISSING");
 }
});
test("tampered ore title, missing original payment or copied source receipt fails closed",()=>{
 for(const mutate of [x=>x.title.sourceCorpID=PLAYER,
   x=>x.title.shiftID="coop-mining-shift:"+"b".repeat(32),
   x=>x.title.priceCents=999,
   x=>x.buyer.wallet.divisions["1000"].journal.splice(1,1),
   x=>x.employer.wallet.divisions["1000"].transactions.splice(1,1)]){
  const x=fixture();mutate(x);
  assert.match(x.inspect().reason,/MINING_MARKET_TITLE_/);
 }
});
test("duplicate cargo input, forged session or invalid shift never reaches the native market",()=>{
 const x=fixture();
 assert.equal(x.inspect([CARGO,CARGO]).reason,"MINING_MARKET_SCOPE_INVALID");
 x.session.corporationID=PLAYER+1;
 assert.equal(x.inspect().reason,"MINING_MARKET_SCOPE_INVALID");
 x.session.corporationID=PLAYER;x.shift.status="UNFUNDED";
 assert.equal(x.inspect().reason,"MINING_MARKET_FUNDED_SHIFT_NOT_VERIFIED");
 assert.equal(x.writes(),0);
});
test("native GameStore unavailable does not assume zero expense or claim success",()=>{
 const x=fixture();x.readBroken(true);
 assert.equal(x.inspect().reason,"MINING_MARKET_NATIVE_READ_UNAVAILABLE");
 assert.equal(x.writes(),0);
});
test("missing original title receipt never silently counts corporate inventory as free stock",()=>{
 const x=fixture();x.records.delete("coopPlayerMiningOreTitle"+SEP+CARGO);
 assert.equal(x.inspect().reason,"MINING_MARKET_ORIGINAL_TITLE_RECEIPT_MISSING");
});
test("one original ore item cannot be counted as two different cargo purchases",()=>{
 const x=fixture(),clone={...x.title,cargoID:CARGO+1,operationID:TITLE+"-2"};
 x.records.set("coopPlayerMiningOreTitle"+SEP+(CARGO+1),clone);
 const r=x.inspect([CARGO,CARGO+1]);
 assert.equal(r.status,"BLOCKED");
});

test("server scans original title group for exact shift, never trusts client-supplied incomplete cost list",()=>{
 const x=fixture();const result=x.inspectShift();
 assert.equal(result.status,"NATIVE_CORPORATE_SELL_UNSUPPORTED");
 assert.equal(result.verifiedCashOutflowCents,87000);
 assert.equal(result.originalCorporateOre.length,1);
 assert.equal(x.writes(),0);
});
test("missing title group scans as wage-only scope, not a fictional market sale",()=>{
 const x=fixture();x.records.delete("coopPlayerMiningOreTitle"+SEP+CARGO);
 const r=x.inspectShift();
 assert.equal(r.status,"NATIVE_CORPORATE_SELL_UNSUPPORTED");
 assert.equal(r.wagePaidCents,75000);
 assert.equal(r.orePurchasedCents,0);
 assert.equal(r.realizedRevenueCents,null);
});
test("tampered original title group cannot silently omit foreign corporate expense",()=>{
 const x=fixture();x.title.cargoID=CARGO+1;
 assert.equal(x.inspectShift().reason,"MINING_MARKET_TITLE_INDEX_CONFLICT");
});
