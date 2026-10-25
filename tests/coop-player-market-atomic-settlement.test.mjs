import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createAtomicSell,receiptKey}=
 require("../integration/coopPlayerMarketAtomicSettlement.cjs");
const flagKeys=["EVEJS_COOP_NATIVE_ATOMIC_ROWS","EVEJS_COOP_PLAYER_MARKET_ATOMIC",
 "EVEJS_COOP_PLAYER_MARKET_FILL_GUARD",
 "EVEJS_COOP_PLAYER_MARKET_SETTLEMENT_FENCE","EVEJS_COOP_RUST_P2P_CLAIM"];
const flags=()=>{
 const prior=flagKeys.map(k=>process.env[k]);
 for(const k of flagKeys)process.env[k]="1";
 return ()=>flagKeys.forEach((k,i)=>prior[i]===undefined?delete process.env[k]:process.env[k]=prior[i]);
};
const proof=()=>Object.freeze({
 orderID:"23",ownerID:201,counterpartyID:301,bid:false,
 stationID:60001234,typeID:34,priceCents:1234,
 volumeBefore:7,filledQuantity:7,volumeAfter:0,
 sellerSourceLocationID:9200000023
});
const ticket=()=>Object.freeze({orderID:"23",cycle:1});
function fixture(){
 const init={
  characters:{
   "201":{characterID:201,balance:500,walletJournal:[],marketTransactions:[]},
   "301":{characterID:301,balance:1000,walletJournal:[],marketTransactions:[]}},
  items:{
   "800":{itemID:800,ownerID:201,typeID:34,categoryID:6,
     locationID:9200000023,flagID:4,quantity:7,stacksize:7,singleton:0}},
  marketEscrow:{
   "23":{orderId:"23",escrowType:"sell",ownerId:201,isCorp:false,
    stationId:60001234,typeId:34,remainingQuantity:7,escrowLocationID:9200000023}},
  identityState:{},playerMarketFills:{}
 };
 let db=structuredClone(init),commits=0;
 const gameStore={transact:(tables,mutate)=>{
  const clone=structuredClone(db),allowed=new Set(tables);
  const tx={
   get(t,k){if(!allowed.has(t))throw Error("bad table");return structuredClone(clone[t][k]??null)},
   scan(t){if(!allowed.has(t))throw Error("bad table");return Object.entries(clone[t]).map(([key,value])=>({key,value:structuredClone(value)}))},
   put(t,k,v){if(!allowed.has(t))throw Error("bad table");clone[t][k]=structuredClone(v)},
   del(t,k){if(!allowed.has(t))throw Error("bad table");delete clone[t][k]}
  };
  const result=mutate(tx);db=clone;commits++;return result;
 }};
 return {gameStore,get db(){return db},get commits(){return commits}};
}
test("native full SELL moves one existing item, exact ISK cents and escrow in one commit",()=>{
 const cleanup=flags();
 try{
  const x=fixture(),settler=createAtomicSell({gameStore:x.gameStore,clock:()=>123456});
  const receipt=settler.settle({ticket:ticket(),proof:proof(),tax:1.23,sourceItemID:800});
  assert.equal(x.commits,1);
  assert.equal(receipt.phase,"GAMESTORE_COMMITTED");
  assert.equal(receipt.key,receiptKey(ticket()));
  assert.equal(x.db.characters["301"].balance,913.62);
  assert.equal(x.db.characters["201"].balance,585.15);
  assert.equal(x.db.items["800"].ownerID,301);
  assert.equal(x.db.items["800"].locationID,60001234);
  assert.equal(Object.hasOwn(x.db.marketEscrow,"23"),false);
  assert.equal(x.db.characters["201"].walletJournal.length,2);
  assert.equal(x.db.characters["301"].walletJournal.length,1);
  assert.equal(settler.requireReceipt(ticket(),proof()).key,receipt.key);
 }finally{cleanup()}
});
test("replay is receipt-only, never duplicates ISK, item or ledgers",()=>{
 const cleanup=flags();try{
 const x=fixture(),s=createAtomicSell({gameStore:x.gameStore});
 const a=s.settle({ticket:ticket(),proof:proof(),tax:1.23,sourceItemID:800});
 const snapshot=structuredClone(x.db);
 const b=s.settle({ticket:ticket(),proof:proof(),tax:1.23,sourceItemID:800});
 assert.equal(a.replayed,undefined);assert.equal(b.replayed,true);
 assert.deepEqual(x.db,snapshot);
 }finally{cleanup()}
});
test("missing funds and mismatched escrow rollback without moving any item or wallet",()=>{
 const cleanup=flags();try{
 for(const change of [
   x=>x.characters["301"].balance=50,
   x=>x.marketEscrow["23"].ownerId=999,
   x=>x.items["800"].ownerID=999,
   x=>x.items["800"].stacksize=6,
   x=>x.items["801"]={...x.items["800"],itemID:801},
   x=>x.characters["201"].walletJournal=null
 ]){
  const x=fixture();change(x.db);const before=structuredClone(x.db);
  const s=createAtomicSell({gameStore:x.gameStore});
  assert.throws(()=>s.settle({ticket:ticket(),proof:proof(),tax:1.23,sourceItemID:800}),/P2P_ATOMIC_/);
  assert.equal(x.commits,0);assert.deepEqual(x.db,before);
 }
 }finally{cleanup()}
});
test("partial, BUY, wrong cycle or forged item are refused before any transaction",()=>{
 const cleanup=flags();try{
 const x=fixture(),s=createAtomicSell({gameStore:x.gameStore});
 for(const arg of [
  {proof:Object.freeze({...proof(),volumeAfter:1,filledQuantity:6})},
  {proof:Object.freeze({...proof(),bid:true})},
  {ticket:{orderID:"23",cycle:0}},
  {ticket:{orderID:"24",cycle:1}},
  {sourceItemID:900},
  {tax:99}
 ]){
  assert.throws(()=>s.settle({ticket:ticket(),proof:proof(),tax:1.23,
   sourceItemID:800,...arg}),/P2P_ATOMIC_/);
 }
 assert.equal(x.commits,0);
 }finally{cleanup()}
});
test("receipt replay with changed amounts fails closed and never reissues goods",()=>{
 const cleanup=flags();try{
 const x=fixture(),s=createAtomicSell({gameStore:x.gameStore});
 s.settle({ticket:ticket(),proof:proof(),tax:1.23,sourceItemID:800});
 const before=structuredClone(x.db);
 assert.throws(()=>s.settle({ticket:ticket(),proof:proof(),tax:1.24,sourceItemID:800}),
  /REPLAY_CONFLICT/);
 assert.deepEqual(x.db,before);
 }finally{cleanup()}
});
test("explicit flags default OFF; no writes or implicit migrations",()=>{
 const original=flagKeys.map(k=>process.env[k]);try{
  for(const k of flagKeys)delete process.env[k];
  const x=fixture(),s=createAtomicSell({gameStore:x.gameStore});
  assert.throws(()=>s.settle({ticket:ticket(),proof:proof(),tax:1.23,sourceItemID:800}),
   /FLAGS_DISABLED/);assert.equal(x.commits,0);
 }finally{flagKeys.forEach((k,i)=>original[i]===undefined?delete process.env[k]:process.env[k]=original[i])}
});
