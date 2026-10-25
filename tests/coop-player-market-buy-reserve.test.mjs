import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createBuyReserve}=require("../integration/coopPlayerMarketBuyReserve.cjs");
const keys=[
 "EVEJS_COOP_PLAYER_MARKET_BUY_RESERVE",
 "EVEJS_COOP_PLAYER_MARKET_ATOMIC",
 "EVEJS_COOP_NATIVE_ATOMIC_ROWS",
 "EVEJS_COOP_RUST_P2P_CLAIM",
 "EVEJS_COOP_PLAYER_MARKET_FILL_GUARD",
 "EVEJS_COOP_PLAYER_MARKET_SETTLEMENT_FENCE"
];
const id="12345678-1234-4234-8234-123456789abc";
function flags(){
 const original=keys.map(k=>process.env[k]);
 for(const k of keys)process.env[k]="1";
 return ()=>keys.forEach((k,i)=>original[i]===undefined?
  delete process.env[k]:process.env[k]=original[i]);
}
const quote=()=>({
 buyerID:201,stationID:60001234,typeID:34,quantity:7,
 minVolume:2,durationDays:30,orderRange:0,
 price:12.34,brokerFee:1.23,sccSurcharge:0.45
});
const order=()=>({
 order_id:"23",owner_id:201,is_corp:false,state:"open",source:"player",
 row:{order_id:"23",station_id:60001234,type_id:34,
  vol_remaining:7,min_volume:2,duration_days:30,
  range_value:0,price:12.34,bid:true}
});
function fixture(){
 const data={
  characters:{"201":{characterID:201,balance:1000,
    walletJournal:[],marketTransactions:[]}},
  identityState:{},playerMarketFills:{},marketEscrow:{}
 };
 let db=structuredClone(data),commits=0;
 return {
  get db(){return db},
  get commits(){return commits},
  gameStore:{transact:(tables,callback)=>{
   const next=structuredClone(db),allowed=new Set(tables);
   const tx={
    get:(table,key)=>{assert.ok(allowed.has(table));return structuredClone(next[table][key]??null)},
    put:(table,key,value)=>{assert.ok(allowed.has(table));next[table][key]=structuredClone(value)},
    del:(table,key)=>{assert.ok(allowed.has(table));delete next[table][key]},
    scan:table=>{assert.ok(allowed.has(table));return Object.entries(next[table]).map(
      ([key,value])=>({key,value:structuredClone(value)}))}
   };
   const result=callback(tx);db=next;commits++;return result;
  }}
 };
}
test("reserve commits original wallet debit, exact fee journals and durable pending proof once",()=>{
 const reset=flags();try{
 const x=fixture(),s=createBuyReserve({gameStore:x.gameStore,makeID:()=>id,clock:()=>123456});
 const p=s.begin(quote());
 assert.equal(x.commits,1);
 assert.equal(p.phase,"RESERVED");assert.equal(p.kind,"P2P_BUY_RESERVE");
 assert.equal(p.reservedCents,8638);
 assert.equal(p.totalCents,8806);
 assert.equal(x.db.characters["201"].balance,911.94);
 assert.equal(x.db.characters["201"].walletJournal.length,3);
 assert.deepEqual(x.db.characters["201"].walletJournal.map(x=>x.entryTypeID),[149,46,42]);
 assert.equal(x.db.marketEscrow["23"],undefined);
 assert.equal(x.db.playerMarketFills["buy-reserve:"+id].phase,"RESERVED");
 assert.equal(x.db.identityState.coopP2PMarketJournal.next,5000000000000003);
 assert.equal(s.inspect(id).phase,"RESERVED");
 }finally{reset()}
});
test("verified original Rust order binds GameStore escrow WITHOUT any second wallet debit",()=>{
 const reset=flags();try{
 const x=fixture(),s=createBuyReserve({gameStore:x.gameStore,makeID:()=>id,clock:()=>123456});
 const pending=s.begin(quote()),cash=x.db.characters["201"].balance;
 const bound=s.bind(pending,order());
 assert.equal(bound.phase,"BOUND");assert.equal(bound.orderID,"23");
 assert.equal(x.db.characters["201"].balance,cash);
 assert.equal(x.db.marketEscrow["23"].escrowAmount,86.38);
 assert.equal(x.db.marketEscrow["23"].remainingQuantity,7);
 assert.equal(x.db.marketEscrow["23"].coopReserveOperationID,id);
 assert.equal(s.inspect(id).phase,"BOUND");
 const old=structuredClone(x.db),replayed=s.bind(pending,order());
 assert.equal(replayed.replayed,true);
 assert.deepEqual(x.db,old);
 }finally{reset()}
});
test("uncertain placement remains RESERVED, forbids another operation for same buyer",()=>{
 const reset=flags();try{
 const x=fixture();
 let serial=0;
 const s=createBuyReserve({gameStore:x.gameStore,makeID:()=>
  serial++===0?id:"12345678-1234-4234-8234-123456789abd"});
 const first=s.begin(quote()),snapshot=structuredClone(x.db),commits=x.commits;
 assert.equal(first.phase,"RESERVED");
 assert.throws(()=>s.begin(quote()),/UNRESOLVED_OPERATION_FOR_BUYER/);
 assert.equal(x.commits,commits);assert.deepEqual(x.db,snapshot);
 }finally{reset()}
});
test("bad Rust order identity, bid, price, quantity or stage cannot materialize escrow",()=>{
 const reset=flags();try{
 const cases=[
  {owner_id:202},{is_corp:true},{source:"npc"},{state:"cancelled"},
  {order_id:"24"},{row:{...order().row,price:13.34}},
  {row:{...order().row,bid:false}},{row:{...order().row,vol_remaining:6}},
  {row:{...order().row,min_volume:1}},{row:{...order().row,duration_days:1}},
  {row:{...order().row,station_id:500}},{row:{...order().row,type_id:35}},
  {row:{...order().row,range_value:1}}
 ];
 const x=fixture(),s=createBuyReserve({gameStore:x.gameStore,makeID:()=>id});
 const pending=s.begin(quote()),before=structuredClone(x.db),n=x.commits;
 for(const patch of cases){
  assert.throws(()=>s.bind(pending,{...order(),...patch}),
    /RUST_ORDER_NOT_VERIFIED/);
  assert.deepEqual(x.db,before);assert.equal(x.commits,n);
 }
 }finally{reset()}
});
test("reserve preflight rejects insufficient funds, unsafe cents and duplicate receipt before debit",()=>{
 const reset=flags();try{
 const cases=[
  x=>x.db.characters["201"].balance=10,
  x=>x.db.characters["201"].walletJournal=null
 ];
 for(const apply of cases){
  const x=fixture();apply(x);const before=structuredClone(x.db);
  const s=createBuyReserve({gameStore:x.gameStore,makeID:()=>id});
  assert.throws(()=>s.begin(quote()),/P2P_BUY_RESERVE_/);
  assert.deepEqual(x.db,before);assert.equal(x.commits,0);
 }
 const x=fixture(),s=createBuyReserve({gameStore:x.gameStore,makeID:()=>id});
 for(const patch of [{quantity:0},{minVolume:8},{durationDays:0},
  {price:0},{price:12.345},{brokerFee:-1},{sccSurcharge:0.001}]){
  assert.throws(()=>s.begin({...quote(),...patch}),/P2P_BUY_RESERVE_/);
 }
 assert.equal(x.commits,0);
 }finally{reset()}
});
test("changing a bound proof or Rust order ID never creates a second escrow",()=>{
 const reset=flags();try{
 const x=fixture(),s=createBuyReserve({gameStore:x.gameStore,makeID:()=>id});
 const pending=s.begin(quote());s.bind(pending,order());
 const snapshot=structuredClone(x.db);
 assert.throws(()=>s.bind(pending,{...order(),order_id:"24",
  row:{...order().row,order_id:"24"}}),/BOUND_TO_OTHER_ORDER/);
 assert.deepEqual(x.db,snapshot);
 }finally{reset()}
});
test("new reserve has no effect when any strict feature flag is OFF",()=>{
 const original=keys.map(k=>process.env[k]);try{
 for(const k of keys)delete process.env[k];
 const x=fixture(),s=createBuyReserve({gameStore:x.gameStore,makeID:()=>id});
 assert.throws(()=>s.begin(quote()),/FLAGS_DISABLED/);
 assert.equal(x.commits,0);
 }finally{keys.forEach((k,i)=>original[i]===undefined?
  delete process.env[k]:process.env[k]=original[i])}
});


test("legacy unfunded original Rust BUY order blocks newly enabled reserved BUY creation",()=>{
 const reset=flags();try{
 const x=fixture(),s=createBuyReserve({gameStore:x.gameStore,makeID:()=>id});
 const before=structuredClone(x.db);
 assert.throws(()=>s.assertExisting([order()],201),/LEGACY_OR_UNFUNDED_BUY_ORDER/);
 assert.equal(x.commits,0);assert.deepEqual(x.db,before);
 assert.equal(s.assertExisting([],201),true);
 }finally{reset()}
});
test("all existing open BUY orders must bind exact original native reserve receipts",()=>{
 const reset=flags();try{
 const x=fixture(),s=createBuyReserve({gameStore:x.gameStore,makeID:()=>id});
 const pending=s.begin(quote());
 s.bind(pending,order());
 assert.equal(s.assertExisting([order()],201),true);
 const before=structuredClone(x.db);
 x.db.marketEscrow["23"].escrowAmount=1;
 assert.throws(()=>s.assertExisting([order()],201),/LEGACY_OR_UNFUNDED_BUY_ORDER/);
 x.db.marketEscrow["23"]=before.marketEscrow["23"];
 assert.throws(()=>s.assertExisting([{...order(),owner_id:999}],201),
  /UNVERIFIED_EXISTING_RUST_ORDER/);
 }finally{reset()}
});


test("pinned EveJS keyed character BUY reserve debits native wallet once and binds same order",()=>{
 const reset=flags();try{
  const x=fixture();delete x.db.characters["201"].characterID;
  const s=createBuyReserve({gameStore:x.gameStore,makeID:()=>id,clock:()=>123456});
  const first=s.begin(quote());
  assert.equal(first.phase,"RESERVED");
  assert.equal(first.buyerID,201);
  assert.equal(x.db.characters["201"].balance,911.94);
  assert.equal(x.commits,1);
  const bound=s.bind(first,order());
  assert.equal(bound.phase,"BOUND");
  assert.equal(bound.orderID,"23");
  assert.equal(x.db.marketEscrow["23"].escrowAmount,86.38);
  assert.equal(x.db.characters["201"].walletJournal.length,3);
  const snapshot=structuredClone(x.db);
  assert.equal(s.bind(first,order()).replayed,true);
  assert.deepEqual(x.db,snapshot);
 }finally{reset()}
});
test("explicit native buyer identity mismatch cannot reserve or debit player ISK",()=>{
 const reset=flags();try{
  for(const change of [
   x=>x.characters["201"].characterID=999,
   x=>x.characters["201"].charID=999
  ]){
   const x=fixture();delete x.db.characters["201"].characterID;
   change(x.db);const before=structuredClone(x.db);
   const s=createBuyReserve({gameStore:x.gameStore,makeID:()=>id,clock:()=>123456});
   assert.throws(()=>s.begin(quote()),/P2P_BUY_RESERVE_WALLET_AUTHORITY_UNAVAILABLE/);
   assert.equal(x.commits,0);
   assert.deepEqual(x.db,before);
  }
 }finally{reset()}
});
test("original keyed native BUY reserve still rejects wallet without journal authority",()=>{
 const reset=flags();try{
  for(const field of ["walletJournal","marketTransactions"]){
   const x=fixture();delete x.db.characters["201"].characterID;
   delete x.db.characters["201"][field];
   const before=structuredClone(x.db);
   const s=createBuyReserve({gameStore:x.gameStore,makeID:()=>id,clock:()=>123456});
   assert.throws(()=>s.begin(quote()),/P2P_BUY_RESERVE_WALLET_AUTHORITY_UNAVAILABLE/);
   assert.equal(x.commits,0);assert.deepEqual(x.db,before);
  }
 }finally{reset()}
});


test("original BUY reserve cannot bind a corrupt paid witness after Rust ACK",()=>{
 const reset=flags();try{
  const invalid=[
   r=>{r.buyerAfterCents=r.buyerBeforeCents},
   r=>{r.buyerBeforeCents=-1;r.buyerAfterCents=-8807},
   r=>{delete r.journalIDs},
   r=>{r.journalIDs=[1,2,3]},
   r=>{r.createdAt=0},
   r=>{r.reservedCents-=1},
   r=>{r.key="buy-reserve:foreign"}
  ];
  for(const corrupt of invalid){
   const x=fixture(),s=createBuyReserve({gameStore:x.gameStore,makeID:()=>id,clock:()=>123456});
   const pending=s.begin(quote());
   corrupt(x.db.playerMarketFills[pending.key]);
   const before=structuredClone(x.db),count=x.commits;
   assert.throws(()=>s.bind(pending,order()),/P2P_BUY_RESERVE_COMMITTED_DEBIT_NOT_FOUND/);
   assert.deepEqual(x.db,before);
   assert.equal(x.commits,count);
   assert.equal(x.db.marketEscrow["23"],undefined);
  }
 }finally{reset()}
});
test("open native Rust BUY order cannot rely on a corrupted bound debit receipt",()=>{
 const reset=flags();try{
  const corrupt=[
   r=>{r.buyerAfterCents=r.buyerBeforeCents},
   r=>{r.buyerBeforeCents=-1;r.buyerAfterCents=-8807},
   r=>{delete r.journalIDs},
   r=>{r.journalIDs=[1,2,3]},
   r=>{r.createdAt=0},
   r=>{r.key="buy-reserve:foreign"}
  ];
  for(const change of corrupt){
   const x=fixture(),s=createBuyReserve({gameStore:x.gameStore,makeID:()=>id,clock:()=>123456});
   s.bind(s.begin(quote()),order());
   change(x.db.playerMarketFills["buy-reserve:"+id]);
   const before=structuredClone(x.db),count=x.commits;
   assert.throws(()=>s.assertExisting([order()],201),/P2P_BUY_RESERVE_LEGACY_OR_UNFUNDED_BUY_ORDER/);
   assert.deepEqual(x.db,before);
   assert.equal(x.commits,count);
  }
 }finally{reset()}
});
test("already-bound replay does not accept forged original Rust BUY escrow identity",()=>{
 const reset=flags();try{
  for(const mutate of [
   e=>{e.ownerId=202},
   e=>{e.stationId=60000001},
   e=>{e.typeId=35},
   e=>{e.remainingQuantity=6},
   e=>{e.price=11.34},
   e=>{e.coopReserveReceiptKey="buy-reserve:other"}
  ]){
   const x=fixture(),s=createBuyReserve({gameStore:x.gameStore,makeID:()=>id,clock:()=>123456});
   const pending=s.begin(quote());s.bind(pending,order());
   mutate(x.db.marketEscrow["23"]);
   const before=structuredClone(x.db),count=x.commits;
   assert.throws(()=>s.bind(pending,order()),/P2P_BUY_RESERVE_ESCROW_RECEIPT_MISMATCH/);
   assert.deepEqual(x.db,before);
   assert.equal(x.commits,count);
  }
 }finally{reset()}
});
test("valid original BUY reserve still binds, verifies and replays without second wallet debit",()=>{
 const reset=flags();try{
  const x=fixture();delete x.db.characters["201"].characterID;
  const s=createBuyReserve({gameStore:x.gameStore,makeID:()=>id,clock:()=>123456});
  const pending=s.begin(quote());
  const bound=s.bind(pending,order());
  assert.equal(bound.phase,"BOUND");
  assert.equal(s.assertExisting([order()],201),true);
  const saved=structuredClone(x.db);
  assert.equal(s.bind(pending,order()).replayed,true);
  assert.deepEqual(x.db,saved);
  assert.equal(x.db.characters["201"].balance,911.94);
 }finally{reset()}
});
