import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createBuySettlement}=require("../integration/coopPlayerMarketBuySettlement.cjs");
const flags=["EVEJS_COOP_PLAYER_MARKET_BUY_RESERVE","EVEJS_COOP_PLAYER_MARKET_ATOMIC",
 "EVEJS_COOP_NATIVE_ATOMIC_ROWS","EVEJS_COOP_RUST_P2P_CLAIM",
 "EVEJS_COOP_PLAYER_MARKET_FILL_GUARD","EVEJS_COOP_PLAYER_MARKET_SETTLEMENT_FENCE"];
function enabled(){const old=flags.map(k=>process.env[k]);for(const k of flags)process.env[k]="1";
 return ()=>flags.forEach((k,i)=>old[i]===undefined?delete process.env[k]:process.env[k]=old[i]);}
const operationID="12345678-1234-4234-8234-123456789abc",reserveKey="buy-reserve:"+operationID;
const ticket=(cycle=1)=>({orderID:"23",cycle});
const proof=(before=7,take=3,sourceItemID=800)=>Object.freeze({
 orderID:"23",ownerID:201,counterpartyID:301,bid:true,
 stationID:60001234,typeID:34,priceCents:1234,
 volumeBefore:before,filledQuantity:take,volumeAfter:before-take,
 sellerSourceLocationID:60001234
});
function fixture(){
 const db={
 characters:{
  "201":{characterID:201,balance:911.94,walletJournal:[],marketTransactions:[]},
  "301":{characterID:301,balance:500,walletJournal:[],marketTransactions:[]}
 },
 items:{
  "800":{itemID:800,ownerID:301,locationID:60001234,
   flagID:4,typeID:34,singleton:0,quantity:3,stacksize:3},
  "801":{itemID:801,ownerID:301,locationID:60001234,
   flagID:4,typeID:34,singleton:0,quantity:4,stacksize:4}
 },
 marketEscrow:{"23":{
  orderId:"23",ownerId:201,isCorp:false,escrowType:"buy",
  stationId:60001234,typeId:34,price:12.34,
  remainingQuantity:7,escrowAmount:86.38,
  coopReserveOperationID:operationID,coopReserveReceiptKey:reserveKey
 }},
 playerMarketFills:{
  [reserveKey]:{
   kind:"P2P_BUY_RESERVE",key:reserveKey,phase:"BOUND",
   orderID:"23",operationID,buyerID:201,stationID:60001234,
   typeID:34,priceCents:1234,quantity:7,reservedCents:8638,
   brokerCents:123,sccCents:45,totalCents:8806,
   buyerBeforeCents:100000,buyerAfterCents:91194
  }
 },
 identityState:{coopP2PMarketJournal:{next:5000000000000000}}
 };
 let state=structuredClone(db),commits=0;
 return {get db(){return state},get commits(){return commits},
  store:{transact:(tables,fn)=>{
   const rows=structuredClone(state),scope=new Set(tables);
   const tx={
    get:(t,k)=>{assert.ok(scope.has(t));return structuredClone(rows[t][k]??null)},
    put:(t,k,v)=>{assert.ok(scope.has(t));rows[t][k]=structuredClone(v)},
    del:(t,k)=>{assert.ok(scope.has(t));delete rows[t][k]},
    scan:t=>{assert.ok(scope.has(t));return Object.entries(rows[t]).map(
     ([key,value])=>({key,value:structuredClone(value)}))}
   };
   const result=fn(tx);state=rows;commits++;return result;
  }}
 };
}
test("original BUY reserve pays seller for a full 3-item stack without double charging buyer",()=>{
 const reset=enabled();try{
 const x=fixture(),s=createBuySettlement({gameStore:x.store,clock:()=>123456});
 const p=proof();
 assert.equal(s.preflight({proof:p,sourceItemID:800}),true);
 const n=x.commits,paid=s.settle({ticket:ticket(),proof:p,sourceItemID:800,tax:1});
 assert.equal(x.commits,n+1);
 assert.equal(paid.kind,"P2P_BUY_PAID");
 assert.equal(paid.phase,"GAMESTORE_COMMITTED");
 assert.equal(paid.grossCents,3702);assert.equal(paid.taxCents,100);
 assert.equal(paid.reserveBeforeCents,8638);assert.equal(paid.reserveAfterCents,4936);
 assert.equal(x.db.items["800"].ownerID,201);
 assert.equal(x.db.characters["201"].balance,911.94);
 assert.equal(x.db.characters["301"].balance,536.02);
 assert.equal(x.db.characters["201"].walletJournal.length,0);
 assert.equal(x.db.characters["301"].walletJournal.length,2);
 assert.equal(x.db.marketEscrow["23"].remainingQuantity,4);
 assert.equal(x.db.marketEscrow["23"].escrowAmount,49.36);
 assert.equal(x.db.playerMarketFills[reserveKey].spentCents,3702);
 assert.equal(x.db.playerMarketFills[reserveKey].remainingReserveCents,4936);
 assert.equal(s.requireReceipt(ticket(),p).key,"p2p:23:1");
 }finally{reset()}
});
test("two independent BUY Rust cycles exhaust 7 units and exact original 86.38 ISK reserve",()=>{
 const reset=enabled();try{
 const x=fixture(),s=createBuySettlement({gameStore:x.store,clock:()=>123456});
 const one=proof(7,3);
 s.settle({ticket:ticket(1),proof:one,sourceItemID:800,tax:1});
 const two=proof(4,4);
 const paid=s.settle({ticket:ticket(2),proof:two,sourceItemID:801,tax:1});
 assert.equal(paid.reserveAfterCents,0);
 assert.equal(x.db.marketEscrow["23"],undefined);
 assert.equal(x.db.playerMarketFills[reserveKey].phase,"SPENT");
 assert.equal(x.db.playerMarketFills[reserveKey].filledQuantity,7);
 assert.equal(x.db.playerMarketFills[reserveKey].spentCents,8638);
 assert.equal(x.db.playerMarketFills[reserveKey].remainingReserveCents,0);
 assert.equal(x.db.characters["201"].balance,911.94);
 assert.equal(x.db.characters["301"].balance,584.38);
 assert.equal(x.db.items["800"].ownerID,201);
 assert.equal(x.db.items["801"].ownerID,201);
 const snapshot=structuredClone(x.db);
 assert.equal(s.settle({ticket:ticket(2),proof:two,sourceItemID:801,tax:1}).replayed,true);
 assert.deepEqual(x.db,snapshot);
 assert.equal(s.requireReceipt(ticket(2),two).quantity,4);
 }finally{reset()}
});
test("replay with different physical source or tax fails without touching ISK or inventory",()=>{
 const reset=enabled();try{
 const x=fixture(),s=createBuySettlement({gameStore:x.store});
 s.settle({ticket:ticket(),proof:proof(),sourceItemID:800,tax:1});
 const before=structuredClone(x.db),commits=x.commits;
 for(const patch of [{sourceItemID:801},{tax:1.01},{proof:proof(7,2)}]){
  assert.throws(()=>s.settle({ticket:ticket(),proof:proof(),sourceItemID:800,tax:1,...patch}),
   /P2P_BUY_PAY_/);
  assert.deepEqual(x.db,before);
  assert.equal(x.commits,commits);
 }
 }finally{reset()}
});
test("unfunded, unbound, forged, overdrawn and stale BUY escrow fails before any mutation",()=>{
 const reset=enabled();try{
 const changes=[
  x=>delete x.playerMarketFills[reserveKey],
  x=>x.playerMarketFills[reserveKey].phase="RESERVED",
  x=>x.playerMarketFills[reserveKey].buyerAfterCents++,
  x=>x.playerMarketFills[reserveKey].reservedCents=100,
  x=>x.marketEscrow["23"].coopReserveReceiptKey="fake",
  x=>x.marketEscrow["23"].escrowAmount=500,
  x=>x.marketEscrow["23"].remainingQuantity=6,
  x=>x.items["800"].ownerID=999,
  x=>x.items["800"].quantity=2,
  x=>x.items["800"].singleton=1,
  x=>x.characters["301"].balance=NaN
 ];
 for(const change of changes){
  const x=fixture();change(x.db);const before=structuredClone(x.db);
  const s=createBuySettlement({gameStore:x.store});
  assert.throws(()=>s.settle({ticket:ticket(),proof:proof(),sourceItemID:800,tax:1}),
   /P2P_BUY_PAY_/);
  assert.equal(x.commits,0);assert.deepEqual(x.db,before);
 }
 }finally{reset()}
});
test("full seller stack requirement rejects unsupported split before native Rust claim",()=>{
 const reset=enabled();try{
 const x=fixture(),s=createBuySettlement({gameStore:x.store});
 assert.throws(()=>s.preflight({proof:proof(7,3),sourceItemID:801}),
  /P2P_BUY_PAY_/);
 x.db.marketEscrow["23"].escrowAmount=86.37;
 assert.throws(()=>s.preflight({proof:proof(),sourceItemID:800}),
  /FUNDED_ESCROW_UNVERIFIED/);
 }finally{reset()}
});
test("receipt-only zero BUY debit and exact seller gross-minus-tax evidence",()=>{
 const reset=enabled();try{
 const x=fixture(),s=createBuySettlement({gameStore:x.store});
 const p=proof();s.settle({ticket:ticket(),proof:p,sourceItemID:800,tax:1});
 const r=s.requireReceipt(ticket(),p);
 assert.equal(r.buyerBeforeCents,r.buyerAfterCents);
 assert.equal(r.sellerAfterCents-r.sellerBeforeCents,r.grossCents-r.taxCents);
 assert.equal(r.reserveBeforeCents-r.reserveAfterCents,r.grossCents);
 }finally{reset()}
});
test("strict flags default OFF blocks direct payout",()=>{
 const original=flags.map(k=>process.env[k]);try{
 for(const k of flags)delete process.env[k];
 const x=fixture(),s=createBuySettlement({gameStore:x.store});
 assert.throws(()=>s.settle({ticket:ticket(),proof:proof(),sourceItemID:800,tax:1}),
 /FLAGS_DISABLED/);
 assert.equal(x.commits,0);
 }finally{flags.forEach((k,i)=>original[i]===undefined?delete process.env[k]:process.env[k]=original[i])}
});


test("keyed-only original EveJS buyer and seller wallets settle without embedded character IDs",()=>{
 const reset=enabled();try{
 const x=fixture();
 delete x.db.characters["201"].characterID;
 delete x.db.characters["301"].characterID;
 const s=createBuySettlement({gameStore:x.store});
 const paid=s.settle({ticket:ticket(),proof:proof(),sourceItemID:800,tax:1});
 assert.equal(paid.phase,"GAMESTORE_COMMITTED");
 assert.equal(x.db.characters["201"].balance,911.94);
 assert.equal(x.db.characters["301"].balance,536.02);
 assert.equal(x.db.items["800"].ownerID,201);
 }finally{reset()}
});
test("contradictory embedded native wallet ID blocks payment without moving items or ISK",()=>{
 const reset=enabled();try{
 for(const who of ["201","301"]){
  const x=fixture();x.db.characters[who].characterID=999;
  const before=structuredClone(x.db);
  const s=createBuySettlement({gameStore:x.store});
  assert.throws(()=>s.settle({ticket:ticket(),proof:proof(),sourceItemID:800,tax:1}),
    /P2P_BUY_PAY_NATIVE_CHARACTER_ACCOUNTS_MISSING/);
  assert.equal(x.commits,0);assert.deepEqual(x.db,before);
 }
 }finally{reset()}
});
