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
test("invalid partial proof, BUY, wrong cycle or forged item are refused before any transaction",()=>{
 const cleanup=flags();try{
 const x=fixture(),s=createAtomicSell({gameStore:x.gameStore});
 for(const arg of [
  {proof:Object.freeze({...proof(),volumeAfter:2,filledQuantity:6})},
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


test("partial native player SELL conserves exact items, wallets, escrow and item allocator",()=>{
 const cleanup=flags();
 try{
  const x=fixture();
  x.db.identityState.nextItemID=1990000900;
  const s=createAtomicSell({gameStore:x.gameStore,clock:()=>123456});
  const part=Object.freeze({...proof(),filledQuantity:3,volumeAfter:4});
  const p=s.settle({ticket:ticket(),proof:part,tax:1.00,sourceItemID:800});
  assert.equal(x.commits,1);
  assert.equal(p.itemID,1990000900);
  assert.equal(p.sourceItemID,800);
  assert.equal(p.partial,true);
  assert.equal(p.volumeBefore,7);
  assert.equal(p.volumeAfter,4);
  assert.equal(x.db.items["800"].ownerID,201);
  assert.equal(x.db.items["800"].quantity,4);
  assert.equal(x.db.items["800"].stacksize,4);
  assert.equal(x.db.items["1990000900"].ownerID,301);
  assert.equal(x.db.items["1990000900"].quantity,3);
  assert.equal(x.db.items["1990000900"].locationID,60001234);
  assert.equal(x.db.identityState.nextItemID,1990000901);
  assert.equal(x.db.marketEscrow["23"].remainingQuantity,4);
  assert.equal(x.db.characters["301"].balance,962.98);
  assert.equal(x.db.characters["201"].balance,536.02);
  assert.equal(s.requireReceipt(ticket(),part).itemID,1990000900);
  const witness=structuredClone(x.db);
  const again=s.settle({ticket:ticket(),proof:part,tax:1.00,sourceItemID:800});
  assert.equal(again.replayed,true);
  assert.deepEqual(x.db,witness);
 }finally{cleanup()}
});
test("two distinct Rust cycles close 7-unit SELL as 3 + 4 without mint or duplicate debit",()=>{
 const cleanup=flags();
 try{
  const x=fixture();
  x.db.identityState.nextItemID=1990000950;
  const s=createAtomicSell({gameStore:x.gameStore,clock:()=>123456});
  const part=Object.freeze({...proof(),filledQuantity:3,volumeAfter:4});
  const first=s.settle({ticket:ticket(),proof:part,tax:1,sourceItemID:800});
  const last=Object.freeze({...proof(),volumeBefore:4,filledQuantity:4,volumeAfter:0});
  const secondTicket=Object.freeze({...ticket(),cycle:2});
  const final=s.settle({ticket:secondTicket,proof:last,tax:1,sourceItemID:800});
  assert.equal(first.partial,true);
  assert.equal(final.partial,false);
  assert.equal(final.itemID,800);
  assert.equal(x.db.items["800"].ownerID,301);
  assert.equal(x.db.items["800"].quantity,4);
  assert.equal(x.db.items["1990000950"].quantity,3);
  assert.equal(x.db.items["1990000950"].ownerID,301);
  assert.equal(x.db.items["800"].quantity+x.db.items["1990000950"].quantity,7);
  assert.equal(x.db.marketEscrow["23"],undefined);
  assert.equal(x.db.identityState.nextItemID,1990000951);
  assert.equal(x.db.characters["301"].balance,913.62);
  assert.equal(x.db.characters["201"].balance,584.38);
  assert.equal(Object.keys(x.db.playerMarketFills).length,2);
  const snapshot=structuredClone(x.db);
  assert.equal(s.settle({ticket:secondTicket,proof:last,tax:1,sourceItemID:800}).replayed,true);
  assert.deepEqual(x.db,snapshot);
 }finally{cleanup()}
});
test("partial SELL rejects missing native allocator, occupied ID, foreign stack and stale escrow",()=>{
 const cleanup=flags();
 try{
  const part=Object.freeze({...proof(),filledQuantity:3,volumeAfter:4});
  const changes=[
    x=>delete x.identityState.nextItemID,
    x=>x.identityState.nextItemID=7,
    x=>x.identityState.nextItemID=Number.MAX_SAFE_INTEGER,
    x=>x.items["800"].stacksize=6,
    x=>x.marketEscrow["23"].remainingQuantity=6,
    x=>{x.items["801"]={...x.items["800"],itemID:801}},
    x=>{x.items["1990000900"]={...x.items["800"],itemID:1990000900}},
    x=>{x.items["wrong"]={...x.items["800"],itemID:812}}
  ];
  for(const change of changes){
   const x=fixture();
   x.db.identityState.nextItemID=1990000900;
   change(x.db);const before=structuredClone(x.db);
   const s=createAtomicSell({gameStore:x.gameStore});
   assert.throws(()=>s.settle({ticket:ticket(),proof:part,tax:1,sourceItemID:800}),/P2P_ATOMIC_/);
   assert.equal(x.commits,0);
   assert.deepEqual(x.db,before);
  }
 }finally{cleanup()}
});


test("three physical SELL stacks: exact 8-unit partial fill across 3+4+1 and 4-unit terminal",()=>{
 const cleanup=flags();
 try{
  const x=fixture(),seller=x.db.items["800"];
  seller.quantity=3;seller.stacksize=3;
  x.db.items["801"]={...seller,itemID:801,quantity:4,stacksize:4};
  x.db.items["802"]={...seller,itemID:802,quantity:5,stacksize:5};
  x.db.marketEscrow["23"].remainingQuantity=12;
  x.db.identityState.nextItemID=1990000900;
  const s=createAtomicSell({gameStore:x.gameStore,clock:()=>123456});
  const firstProof=Object.freeze({...proof(),volumeBefore:12,
   filledQuantity:8,volumeAfter:4});
  const first=s.settle({ticket:ticket(),proof:firstProof,tax:1,
   sourceItemIDs:[802,800,801]});
  assert.equal(first.partial,true);
  assert.equal(first.quantity,8);
  assert.equal(first.deliveries.length,3);
  assert.deepEqual(first.deliveries,[
   {sourceItemID:800,itemID:800,quantity:3,sourceBefore:3,sourceAfter:0},
   {sourceItemID:801,itemID:801,quantity:4,sourceBefore:4,sourceAfter:0},
   {sourceItemID:802,itemID:1990000900,quantity:1,sourceBefore:5,sourceAfter:4}
  ]);
  assert.equal(x.db.items["800"].ownerID,301);
  assert.equal(x.db.items["801"].ownerID,301);
  assert.equal(x.db.items["802"].ownerID,201);
  assert.equal(x.db.items["802"].quantity,4);
  assert.equal(x.db.items["1990000900"].ownerID,301);
  assert.equal(x.db.items["1990000900"].quantity,1);
  assert.equal(x.db.marketEscrow["23"].remainingQuantity,4);
  assert.equal(x.db.identityState.nextItemID,1990000901);
  assert.equal(x.db.characters["301"].balance,901.28);
  assert.equal(x.db.characters["201"].balance,597.72);
  assert.equal(s.requireReceipt(ticket(),firstProof).deliveries.length,3);
  const snapshot=structuredClone(x.db);
  assert.equal(s.settle({ticket:ticket(),proof:firstProof,tax:1,
   sourceItemIDs:[800,801,802]}).replayed,true);
  assert.deepEqual(x.db,snapshot);
  const secondTicket={orderID:"23",cycle:2};
  const secondProof=Object.freeze({...proof(),volumeBefore:4,
   filledQuantity:4,volumeAfter:0});
  const second=s.settle({ticket:secondTicket,proof:secondProof,tax:1,
   sourceItemIDs:[802]});
  assert.equal(second.deliveries.length,1);
  assert.equal(second.deliveries[0].itemID,802);
  assert.equal(x.db.items["802"].ownerID,301);
  assert.equal(x.db.items["802"].quantity,4);
  assert.equal(x.db.marketEscrow["23"],undefined);
  assert.equal(x.db.items["800"].quantity+x.db.items["801"].quantity+
   x.db.items["802"].quantity+x.db.items["1990000900"].quantity,12);
  assert.equal(x.db.characters["301"].balance,851.92);
  assert.equal(x.db.characters["201"].balance,646.08);
  assert.equal(Object.keys(x.db.playerMarketFills).length,2);
  assert.equal(x.commits,4); // two writes + two read-only receipt accesses
 }finally{cleanup()}
});
test("partial SELL can move an entire source stack without minting a split item",()=>{
 const cleanup=flags();
 try{
  const x=fixture();x.db.items["800"].quantity=3;
  x.db.items["800"].stacksize=3;
  x.db.items["801"]={...x.db.items["800"],itemID:801,quantity:4,stacksize:4};
  const s=createAtomicSell({gameStore:x.gameStore});
  const p=Object.freeze({...proof(),volumeBefore:7,filledQuantity:3,volumeAfter:4});
  const v=s.settle({ticket:ticket(),proof:p,tax:1,sourceItemIDs:[800,801]});
  assert.deepEqual(v.deliveries,[{sourceItemID:800,itemID:800,quantity:3,sourceBefore:3,sourceAfter:0}]);
  assert.equal(x.db.identityState.nextItemID,undefined);
  assert.equal(x.db.items["801"].ownerID,201);
  assert.equal(x.db.items["801"].quantity,4);
  assert.equal(x.db.items["800"].ownerID,301);
  assert.equal(x.db.marketEscrow["23"].remainingQuantity,4);
 }finally{cleanup()}
});
test("multi-stack escrow mismatch, duplicate source, missing allocator and altered replay roll back",()=>{
 const cleanup=flags();
 try{
  const malformed=[
   {ids:[800,800,801],apply:()=>{}},
   {ids:[800,801],apply:()=>{}},
   {ids:[800,801,802],apply:x=>x.items["802"].ownerID=999},
   {ids:[800,801,802],apply:x=>x.items["802"].quantity=4},
   {ids:[800,801,802],apply:x=>x.items["802"].stacksize=7},
   {ids:[800,801,802],apply:x=>x.items["802"].typeID=44},
   {ids:[800,801,802],apply:x=>x.identityState.nextItemID=undefined},
   {ids:[800,801,802],apply:x=>x.identityState.nextItemID=Number.MAX_SAFE_INTEGER},
   {ids:[800,801,802],apply:x=>x.items["wrong"]={...x.items["800"],itemID:123}},
  ];
  const p=Object.freeze({...proof(),volumeBefore:12,filledQuantity:8,volumeAfter:4});
  for(const {ids,apply} of malformed){
   const x=fixture();x.db.items["800"].quantity=3;x.db.items["800"].stacksize=3;
   x.db.items["801"]={...x.db.items["800"],itemID:801,quantity:4,stacksize:4};
   x.db.items["802"]={...x.db.items["800"],itemID:802,quantity:5,stacksize:5};
   x.db.marketEscrow["23"].remainingQuantity=12;
   x.db.identityState.nextItemID=1990000900;
   apply(x.db);
   const before=structuredClone(x.db),s=createAtomicSell({gameStore:x.gameStore});
   assert.throws(()=>s.settle({ticket:ticket(),proof:p,tax:1,sourceItemIDs:ids}),/P2P_ATOMIC_/);
   assert.deepEqual(x.db,before);
   assert.equal(x.commits,0);
  }
  const x=fixture();
  x.db.items["800"].quantity=3;x.db.items["800"].stacksize=3;
  x.db.items["801"]={...x.db.items["800"],itemID:801,quantity:4,stacksize:4};
  x.db.marketEscrow["23"].remainingQuantity=7;
  const s=createAtomicSell({gameStore:x.gameStore});
  const p2=Object.freeze({...proof(),filledQuantity:3,volumeAfter:4});
  s.settle({ticket:ticket(),proof:p2,tax:1,sourceItemIDs:[800,801]});
  const prev=structuredClone(x.db);
  assert.throws(()=>s.settle({ticket:ticket(),proof:p2,tax:1,
   sourceItemIDs:[800]}),/REPLAY_CONFLICT/);
  assert.deepEqual(x.db,prev);
 }finally{cleanup()}
});


test("full multi-stack SELL transfers original item IDs and never allocates",()=>{
 const cleanup=flags();
 try{
  const x=fixture();
  x.db.items["800"].quantity=3;x.db.items["800"].stacksize=3;
  x.db.items["801"]={...x.db.items["800"],itemID:801,quantity:4,stacksize:4};
  const s=createAtomicSell({gameStore:x.gameStore,clock:()=>123456});
  const result=s.settle({ticket:ticket(),proof:proof(),tax:1,
   sourceItemIDs:[801,800]});
  assert.equal(result.partial,false);
  assert.deepEqual(result.sourceItemIDs,[800,801]);
  assert.equal(result.deliveries.length,2);
  assert.equal(result.deliveries[0].sourceAfter,0);
  assert.equal(result.deliveries[1].sourceAfter,0);
  assert.equal(x.db.items["800"].ownerID,301);
  assert.equal(x.db.items["801"].ownerID,301);
  assert.equal(x.db.identityState.nextItemID,undefined);
  assert.equal(x.db.marketEscrow["23"],undefined);
  assert.equal(x.db.characters["301"].balance,913.62);
  assert.equal(x.db.characters["201"].balance,585.38);
  const snapshot=structuredClone(x.db);
  assert.equal(s.settle({ticket:ticket(),proof:proof(),tax:1,
   sourceItemIDs:[800,801]}).replayed,true);
  assert.deepEqual(x.db,snapshot);
 }finally{cleanup()}
});
