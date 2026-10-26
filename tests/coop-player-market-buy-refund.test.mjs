import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createBuyRefund}=require("../integration/coopPlayerMarketBuyRefund.cjs");
const keys=["EVEJS_COOP_PLAYER_MARKET_BUY_REFUND","EVEJS_COOP_PLAYER_MARKET_BUY_RESERVE",
 "EVEJS_COOP_PLAYER_MARKET_ATOMIC","EVEJS_COOP_NATIVE_ATOMIC_ROWS",
 "EVEJS_COOP_RUST_P2P_CLAIM","EVEJS_COOP_PLAYER_MARKET_FILL_GUARD",
 "EVEJS_COOP_PLAYER_MARKET_SETTLEMENT_FENCE"];
function flags(){const prior=keys.map(k=>process.env[k]);keys.forEach(k=>process.env[k]="1");
 return ()=>keys.forEach((k,i)=>prior[i]===undefined?delete process.env[k]:process.env[k]=prior[i])}
const operationID="12345678-1234-4234-8234-123456789abc",receiptKey="buy-reserve:"+operationID;
function original(state="cancelled",remaining=4){return {
 order_id:"23",owner_id:201,is_corp:false,source:"player",state,
 row:{order_id:"23",bid:true,station_id:60001234,type_id:34,
  vol_remaining:remaining,vol_entered:7,price:12.34}
}}
function fixture({filled=3}={}){
 const remaining=7-filled,escrowValue=remaining*12.34;
 let data={
  characters:{"201":{balance:911.94,walletJournal:[],marketTransactions:[]}},
  marketEscrow:{"23":{orderId:"23",escrowType:"buy",isCorp:false,
   ownerId:201,stationId:60001234,typeId:34,price:12.34,
   remainingQuantity:remaining,escrowAmount:escrowValue,
   coopReserveReceiptKey:receiptKey,coopReserveOperationID:operationID}},
  playerMarketFills:{[receiptKey]:{
   kind:"P2P_BUY_RESERVE",phase:"BOUND",key:receiptKey,orderID:"23",
   operationID,buyerID:201,stationID:60001234,typeID:34,
   priceCents:1234,quantity:7,reservedCents:8638,
   minVolume:2,durationDays:30,orderRange:0,
   spentCents:filled*1234,filledQuantity:filled,
   remainingReserveCents:remaining*1234,
   brokerCents:123,sccCents:45,totalCents:8806,
   buyerBeforeCents:100000,buyerAfterCents:91194,
   journalIDs:[5000000000000000,5000000000000001,5000000000000002],
   createdAt:123456
  }},
  identityState:{coopP2PMarketJournal:{next:5000000000000000}}
 };
 let state=structuredClone(data),commits=0;
 return {get db(){return state},get commits(){return commits},
  store:{transact:(tables,fn)=>{
   const staged=structuredClone(state),allowed=new Set(tables);
   const tx={
    get:(t,k)=>{assert.ok(allowed.has(t));return structuredClone(staged[t][k]??null)},
    put:(t,k,v)=>{assert.ok(allowed.has(t));staged[t][k]=structuredClone(v)},
    del:(t,k)=>{assert.ok(allowed.has(t));delete staged[t][k]}
   };
   const result=fn(tx);state=staged;commits++;return result;
  }}};
}
test("cancel after 3-of-7 bought refunds exact 4-unit native escrow once",()=>{
 const reset=flags();try{
 const x=fixture(),svc=createBuyRefund({gameStore:x.store,clock:()=>123456});
 assert.equal(svc.preflight(original("open")),true);
 const refunded=svc.refund(original(), "cancelled");
 assert.equal(refunded.refundCents,4936);
 assert.equal(refunded.spentCents,3702);
 assert.equal(refunded.walletBeforeCents,91194);
 assert.equal(refunded.walletAfterCents,96130);
 assert.equal(x.db.characters["201"].balance,961.30);
 assert.equal(x.db.characters["201"].walletJournal.length,1);
 assert.equal(x.db.characters["201"].walletJournal[0].entryTypeID,42);
 assert.equal(x.db.marketEscrow["23"],undefined);
 assert.equal(x.db.playerMarketFills[receiptKey].phase,"REFUNDED");
 assert.equal(x.db.playerMarketFills[receiptKey].remainingReserveCents,0);
 assert.equal(x.db.playerMarketFills[receiptKey].spentCents,3702);
 assert.equal(x.db.playerMarketFills[receiptKey].refundedCents,4936);
 assert.equal(x.db.identityState.coopP2PMarketJournal.next,5000000000000001);
 const snap=structuredClone(x.db);
 const again=svc.refund(original(),"cancelled");
 assert.equal(again.replayed,true);
 assert.deepEqual(x.db,snap);
 }finally{reset()}
});
test("unfilled original expired BUY refunds all 86.38 ISK without reversing broker/SCC",()=>{
 const reset=flags();try{
 const x=fixture({filled:0}),svc=createBuyRefund({gameStore:x.store});
 const receipt=svc.refund(original("expired",7),"expired");
 assert.equal(receipt.refundCents,8638);
 assert.equal(x.db.characters["201"].balance,998.32);
 assert.equal(x.db.playerMarketFills[receiptKey].spentCents,0);
 assert.equal(x.db.playerMarketFills[receiptKey].refundedCents,8638);
 assert.equal(x.db.marketEscrow["23"],undefined);
 assert.equal(svc.refund(original("expired",7),"expired").replayed,true);
 }finally{reset()}
});
test("refund refuses unbound, exhausted, overdrawn, forged or stale native escrow",()=>{
 const reset=flags();try{
 const mutations=[
  x=>delete x.playerMarketFills[receiptKey],
  x=>x.playerMarketFills[receiptKey].phase="SPENT",
  x=>x.playerMarketFills[receiptKey].spentCents=10000,
  x=>x.playerMarketFills[receiptKey].remainingReserveCents=9999,
  x=>x.playerMarketFills[receiptKey].buyerAfterCents=91195,
  x=>x.playerMarketFills[receiptKey].quantity=5,
  x=>x.marketEscrow["23"].coopReserveReceiptKey="made-up",
  x=>x.marketEscrow["23"].remainingQuantity=3,
  x=>x.marketEscrow["23"].escrowAmount=1,
  x=>x.marketEscrow["23"].ownerId=999,
  x=>x.characters["201"].balance=-100,
  x=>x.characters["201"].walletJournal=null,
  x=>x.characters["201"].characterID=301
 ];
 for(const mutate of mutations){
  const x=fixture();mutate(x.db);const snapshot=structuredClone(x.db);
  const svc=createBuyRefund({gameStore:x.store});
  assert.throws(()=>svc.refund(original(),"cancelled"),/P2P_BUY_REFUND_/);
  assert.equal(x.commits,0);assert.deepEqual(x.db,snapshot);
 }
 }finally{reset()}
});
test("original Rust terminal state, identity, volume, bid and price required",()=>{
 const reset=flags();try{
 const x=fixture(),svc=createBuyRefund({gameStore:x.store});
 for(const o of [
  original("open"),original("filled"),original("expired"),
  {...original(),owner_id:202},
  {...original(),source:"seed"},
  {...original(),is_corp:true},
  {...original(),row:{...original().row,bid:false}},
  {...original(),row:{...original().row,price:15}},
  {...original(),row:{...original().row,vol_remaining:3}},
  {...original(),row:{...original().row,type_id:77}},
  {...original(),row:{...original().row,station_id:77}}
 ]){
  assert.throws(()=>svc.refund(o,"cancelled"),/P2P_BUY_REFUND_/);
 }
 assert.equal(x.commits,0);
 }finally{reset()}
});
test("same Rust order cannot be refunded twice with changed terminal reason",()=>{
 const reset=flags();try{
 const x=fixture(),svc=createBuyRefund({gameStore:x.store});
 svc.refund(original(),"cancelled");const before=structuredClone(x.db);
 assert.throws(()=>svc.refund(original("expired"),"expired"),
  /REPLAY_IDENTITY_CONFLICT/);
 assert.deepEqual(x.db,before);
 }finally{reset()}
});
test("replay requires original receipt to remain conserved and escrow removed",()=>{
 const reset=flags();try{
 const x=fixture(),svc=createBuyRefund({gameStore:x.store});
 svc.refund(original(),"cancelled");
 x.db.playerMarketFills[receiptKey].refundedCents=42;
 assert.throws(()=>svc.refund(original(),"cancelled"),/COMMITTED_RESERVE_EVIDENCE_MISSING/);
 }finally{reset()}
});
test("keyed native wallet without embedded ID allowed; contradictory embedded ID refused",()=>{
 const reset=flags();try{
 const x=fixture(),svc=createBuyRefund({gameStore:x.store});
 assert.equal(svc.refund(original(),"cancelled").phase,"GAMESTORE_COMMITTED");
 const y=fixture();y.db.characters["201"].charID=999;
 const rejected=createBuyRefund({gameStore:y.store});
 assert.throws(()=>rejected.refund(original(),"cancelled"),/NATIVE_WALLET_UNVERIFIED/);
 assert.equal(y.commits,0);
 }finally{reset()}
});
test("financial BUY refund flags default OFF, no native mutation",()=>{
 const original=keys.map(k=>process.env[k]);try{
 for(const k of keys)delete process.env[k];
 const x=fixture(),svc=createBuyRefund({gameStore:x.store});
 assert.throws(()=>svc.refund(globalThis.unavailable??{state:"cancelled"},"cancelled"),
  /FLAGS_DISABLED/);
 assert.equal(x.commits,0);
 }finally{keys.forEach((k,i)=>original[i]===undefined?delete process.env[k]:process.env[k]=original[i])}
});


test("refund rejects corrupted original native debit receipt without wallet mutation",()=>{
 const reset=flags();
 try{
  const changes=[
   r=>delete r.journalIDs,
   r=>{r.journalIDs=[1,2,3]},
   r=>{r.journalIDs=[5000000000000000,5000000000000002,5000000000000003]},
   r=>delete r.createdAt,
   r=>{r.createdAt=0},
   r=>{r.minVolume=0},
   r=>{r.durationDays=0},
   r=>{r.orderRange=-1}
  ];
  for(const change of changes){
   const x=fixture();
   change(x.db.playerMarketFills[receiptKey]);
   const snapshot=structuredClone(x.db);
   const svc=createBuyRefund({gameStore:x.store,clock:()=>123456});
   assert.throws(()=>svc.preflight(original("open")),
    /P2P_BUY_REFUND_DURABLE_ORIGINAL_RESERVE_NOT_VERIFIED/);
   assert.throws(()=>svc.refund(original(),"cancelled"),
    /P2P_BUY_REFUND_DURABLE_ORIGINAL_RESERVE_NOT_VERIFIED/);
   assert.equal(x.commits,0);
   assert.deepEqual(x.db,snapshot);
  }
 }finally{reset()}
});
