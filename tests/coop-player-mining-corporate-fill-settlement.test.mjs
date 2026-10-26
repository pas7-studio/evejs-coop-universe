import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createCorporateSellFillSettlement}=require("../integration/coopPlayerMiningCorporateFillSettlement.cjs");
const SEP="\u001f",CORP=5001,BUYER=8011,CARGO=7773,ITEM=190003,
 STATION=60001,ORDER="9521",ESCROW_LOCATION=9200000000+9521;
function fixture(){
 let enabled=true,poisoned=false,failAck=false,writes=0,now=1793030000000;
 const original={itemID:ITEM,ownerID:CORP,locationID:ESCROW_LOCATION,
  flagID:4,typeID:34,quantity:8,stacksize:8,singleton:0,
  customInfo:"coop-warehouse:v1:cargo:"+CARGO};
 const corp={corporationID:CORP,wallet:{divisions:{"1000":{
  balance:120,journal:[],transactions:[]}}}};
 const char={characterID:BUYER,balance:200,
  walletJournal:[],marketTransactions:[]};
 const sell={version:1,phase:"ESCROW_BOUND_UNSETTLED",
  orderID:ORDER,itemID:ITEM,cargoID:CARGO,corporationID:CORP,
  typeID:34,stationID:STATION,escrowLocationID:ESCROW_LOCATION,quantity:8};
 const escrow={orderId:ORDER,escrowType:"sell",isCorp:true,ownerId:CORP,
  typeId:34,stationId:STATION,escrowLocationID:ESCROW_LOCATION,
  remainingQuantity:8,sourceItemIDs:[ITEM],phase:"ESCROW_BOUND_UNSETTLED"};
 let data={
  characters:new Map([[String(BUYER),char]]),
  corporationRuntime:new Map([["corporations"+SEP+CORP,corp],
   ["coopPlayerMiningCorpSell"+SEP+CARGO,sell]]),
  items:new Map([[String(ITEM),original]]),
  marketEscrow:new Map([[ORDER,escrow]]),
  identityState:new Map([["nextItemID",1990000001]])
 };
 let claim={verifiedNative:true,phase:"claimed",state:"settling",source:"coop-corporation",
  is_corp:true,bid:false,orderID:ORDER,cycle:1,buyerCharacterID:BUYER,
  sellerCorpID:CORP,stationID:STATION,typeID:34,cargoID:CARGO,
  sourceItemID:ITEM,priceCents:250,volumeBefore:8,quantity:3,
  volumeAfter:5,escrowLocationID:ESCROW_LOCATION};
 let fees={verifiedNative:true,transactionTaxCents:30,brokerFeeCents:15};
 const gameStore={coopAtomicNativeRows:{
  mode:"SERVER_INTERNAL_FLAGGED",isPoisoned:()=>poisoned,
  transact(tables,fn){
   assert.deepEqual(tables,["characters","corporationRuntime","items",
    "marketEscrow","identityState"]);
   const backup=Object.fromEntries(tables.map(t=>[t,structuredClone([...data[t]])]));
   const tx={get:(t,k)=>data[t].get(k)??null,
    scan:t=>[...data[t]].map(([key,value])=>({key,value})),
    put(t,k,v){data[t].set(k,structuredClone(v));writes++}};
   try{
    const result=fn(tx);
    if(failAck)throw Error("COMMIT_ACK_LOST");
    return result;
   }catch(e){
    if(!failAck)for(const t of tables)data[t]=new Map(backup[t]);
    throw e;
   }
  }}};
 const settlement=createCorporateSellFillSettlement({
  gameStore,readNativeClaim:()=>claim,quoteNativeFees:()=>fees,
  clock:()=>now,enabled:()=>enabled});
 const get=(t,k)=>data[t].get(k),run=()=>settlement.settle({orderID:ORDER,cycle:claim.cycle});
 const next=()=>{claim={...claim,cycle:2,volumeBefore:5,quantity:5,volumeAfter:0}};
 return {settlement,run,next,get,claim:()=>claim,
  source:()=>get("items",String(ITEM)),
  corp:()=>get("corporationRuntime","corporations"+SEP+CORP),
  buyer:()=>get("characters",String(BUYER)),
  escrow:()=>get("marketEscrow",ORDER),
  receipt:cycle=>get("corporationRuntime","coopPlayerMiningCorpFill"+SEP+ORDER+":"+cycle),
  writes:()=>writes,enabled:x=>enabled=x,poison:x=>poisoned=x,
  loseAck:x=>failAck=x,fees:x=>fees=x,
  tamperClaim:f=>{claim=f(claim)},now:x=>now=x};
}
test("original native partial SELL: debit actual buyer, credit corporation after exact fees",()=>{
 const x=fixture(),r=x.run();
 assert.equal(r.phase,"GAMESTORE_COMMITTED");
 assert.equal(r.quantity,3);assert.equal(r.volumeAfter,5);
 assert.equal(r.grossCents,750);assert.equal(r.netRevenueCents,705);
 assert.equal(x.buyer().balance,192.50);assert.equal(x.corp().wallet.divisions["1000"].balance,127.05);
 assert.equal(x.source().itemID,ITEM);assert.equal(x.source().quantity,5);
 assert.equal(x.source().ownerID,CORP);assert.equal(x.escrow().remainingQuantity,5);
 assert.equal(x.get("items",String(r.deliveredItemID)).ownerID,BUYER);
 assert.equal(x.get("items",String(r.deliveredItemID)).sourceCargoID,CARGO);
 assert.equal(x.get("items",String(r.deliveredItemID)).quantity,3);
 assert.equal(x.get("items",String(r.deliveredItemID)).sourceItemID,ITEM);
 assert.notEqual(r.deliveredItemID,ITEM);
});
test("two original partial/full cycles conserve all eight original units and exact ISK",()=>{
 const x=fixture(),a=x.run();x.next();const b=x.run();
 assert.equal(b.phase,"GAMESTORE_COMMITTED");assert.equal(b.deliveredItemID,ITEM);
 assert.equal(x.source().ownerID,BUYER);assert.equal(x.source().quantity,5);
 assert.equal(x.escrow().remainingQuantity,0);assert.equal(x.escrow().phase,"FULLY_SOLD");
 assert.equal(x.get("items",String(a.deliveredItemID)).quantity,3);
 assert.equal(x.get("items",String(a.deliveredItemID)).ownerID,BUYER);
 assert.equal(x.receipt(1).quantity+x.receipt(2).quantity,8);
 assert.equal(x.buyer().balance,180);
 assert.equal(x.corp().wallet.divisions["1000"].balance,139.10);
});
test("identical Rust claimed fill replay cannot double debit the buyer or duplicate cargo",()=>{
 const x=fixture();const first=x.run(),writes=x.writes();
 const second=x.run();assert.equal(second.replayed,true);
 assert.equal(second.deliveredItemID,first.deliveredItemID);
 assert.equal(x.writes(),writes);
 assert.equal(x.buyer().balance,192.50);
});
test("Rust claim with altered cycle, quantity or corporate source cannot settle",()=>{
 for(const f of [c=>({...c,phase:"finalized"}),
  c=>({...c,is_corp:false}),c=>({...c,source:"player"}),
  c=>({...c,volumeAfter:9}),c=>({...c,quantity:0}),
  c=>({...c,buyerCharacterID:CORP})]){
  const x=fixture();x.tamperClaim(f);
  assert.equal(x.run().reason,"CORP_FILL_ORIGINAL_RUST_CLAIM_INVALID");
  assert.equal(x.writes(),0);
 }
});
test("insufficient original buyer ISK prevents corporate revenue and item movement",()=>{
 const x=fixture();x.buyer().balance=5;
 assert.equal(x.run().reason,"CORP_FILL_NATIVE_SETTLEMENT_OUTCOME_UNKNOWN");
 assert.equal(x.source().ownerID,CORP);
 assert.equal(x.corp().wallet.divisions["1000"].balance,120);
});
test("unverified or overlarge taxes and broker fees cannot mint or negative-credit ISK",()=>{
 for(const fees of [
  {verifiedNative:false,transactionTaxCents:30,brokerFeeCents:0},
  {verifiedNative:true,transactionTaxCents:751,brokerFeeCents:0},
  {verifiedNative:true,transactionTaxCents:-1,brokerFeeCents:0},
  {verifiedNative:true,transactionTaxCents:750,brokerFeeCents:1}
 ]){
  const x=fixture();x.fees(fees);
  assert.equal(x.run().reason,"CORP_FILL_NATIVE_FEES_UNATTESTED");
  assert.equal(x.writes(),0);
 }
});
test("stale marketEscrow or original corporate cargo provenance cannot settle",()=>{
 for(const f of [x=>{x.source().ownerID=BUYER},
  x=>{x.source().locationID=STATION},
  x=>{x.escrow().remainingQuantity=7},
  x=>{x.source().customInfo="NOT_ORIGINAL"},
  x=>{x.source().quantity=2}]){
  const x=fixture();f(x);
  assert.equal(x.run().reason,"CORP_FILL_NATIVE_SETTLEMENT_OUTCOME_UNKNOWN");
  assert.equal(x.corp().wallet.divisions["1000"].balance,120);
  assert.equal(x.receipt(1),undefined);
 }
});
test("out-of-sequence second cycle cannot spend buyer wallet or physical escrow",()=>{
 const x=fixture();x.next();
 assert.equal(x.run().reason,"CORP_FILL_NATIVE_SETTLEMENT_OUTCOME_UNKNOWN");
 assert.equal(x.receipt(2),undefined);
});
test("buyer item ID allocation reuses original item on full single fill",()=>{
 const x=fixture();
 x.tamperClaim(c=>({...c,quantity:8,volumeAfter:0}));
 const r=x.run();
 assert.equal(r.phase,"GAMESTORE_COMMITTED");
 assert.equal(r.deliveredItemID,ITEM);
 assert.equal(x.source().ownerID,BUYER);
 assert.equal(x.escrow().remainingQuantity,0);
});
test("empty or corrupted original identityState allocator blocks partial sales",()=>{
 const x=fixture();
 // The source item index is part of the native identity allocator's
 // conservation check; corrupt indices must fail before any split/mint.
 x.get("items",String(ITEM)).itemID=ITEM+1;
 assert.equal(x.run().reason,"CORP_FILL_NATIVE_SETTLEMENT_OUTCOME_UNKNOWN");
 assert.equal(x.receipt(1),undefined);
});
test("default OFF and poisoned native GameStore never mutate original company",()=>{
 const x=fixture();x.enabled(false);
 assert.equal(x.run().reason,"CORP_FILL_DISABLED");
 x.enabled(true);x.poison(true);
 assert.equal(x.run().reason,"CORP_FILL_NATIVE_STORE_POISONED");
 assert.equal(x.writes(),0);
});
test("ambiguous SQLite COMMIT never retries a potentially paid corporate fill",()=>{
 const x=fixture();x.loseAck(true);
 assert.equal(x.run().reason,"CORP_FILL_NATIVE_SETTLEMENT_OUTCOME_UNKNOWN");
 assert.deepEqual(x.settlement.requiresOperatorReconciliation(),[ORDER]);
 x.loseAck(false);
 assert.equal(x.run().reason,"CORP_FILL_ORDER_SCOPE_OR_OUTCOME_UNKNOWN");
});

test("tampered previous corporate fill quantity/cycle receipt cannot purchase more physical ore",()=>{
 const x=fixture();const first=x.run();assert.equal(first.phase,"GAMESTORE_COMMITTED");
 x.next();x.get("corporationRuntime","coopPlayerMiningCorpSell"+SEP+CARGO).remainingQuantity=6;
 assert.equal(x.run().reason,"CORP_FILL_NATIVE_SETTLEMENT_OUTCOME_UNKNOWN");
 assert.equal(x.receipt(2),undefined);
});
test("a fake native Rust claim with out-of-order volume cannot bypass previous fill receipt",()=>{
 const x=fixture();const first=x.run();assert.equal(first.phase,"GAMESTORE_COMMITTED");
 x.next();x.tamperClaim(c=>({...c,cycle:3}));
 assert.equal(x.run().reason,"CORP_FILL_NATIVE_SETTLEMENT_OUTCOME_UNKNOWN");
 assert.equal(x.receipt(3),undefined);
});
