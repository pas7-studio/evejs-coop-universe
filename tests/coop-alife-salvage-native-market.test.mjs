import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createAlifeSalvageMarket,quoteNativeSalvage}=
 require("../integration/coopAlifeSalvageMarket.cjs");
const keys=["EVEJS_COOP_ALIFE","EVEJS_COOP_ALIFE_SALVAGE_MARKET",
 "EVEJS_COOP_ALIFE_SALVAGE_RIVALS","EVEJS_COOP_SALVAGE_NATIVE_MARKET",
 "EVEJS_COOP_NATIVE_ATOMIC_ROWS","EVEJS_COOP_NATIVE_NPC_MARKET_PENDING",
 "EVEJS_COOP_NATIVE_NPC_CORP_SETTLEMENT_PROOF",
 "EVEJS_COOP_NATIVE_NPC_CORP_SETTLEMENT"];
const fixture=(extra={})=>{
 const state={list:[],recover:[],inspect:[],prices:[],books:0};
 let journal={version:1,moves:{"9001":{state:"NPC_STOCK_DELIVERED",
   wreckItemID:9001,stationID:60001,corporationID:10001}}};
 let ops={version:1,bySource:{}};
 let book={buys:[{order_id:"921",owner_id:20001,source:"player",
  station_id:60001,type_id:34,vol_remaining:5,price:17,
  state:"open",bid:true}],sells:[]};
 const marketFactory=cents=>{
  state.prices.push(cents);
  return {inspect:id=>{
   state.inspect.push(id);
   return {status:"NATIVE_SALVAGE_STOCK_ELIGIBLE",
    wreckItemID:id,typeID:34,stationID:60001,corporationID:10001};
  },listOnce:async id=>{
   state.list.push(id);
   return {status:"NATIVE_SALVAGE_MARKET_LISTED",id};
  },reconcile:async id=>{
   state.recover.push(id);
   return {status:"NATIVE_SALVAGE_LISTED_RECOVERED"};
  }};
 };
 const driver=createAlifeSalvageMarket({marketFactory,
  readJournal:()=>journal,readOps:()=>ops,
  getStation:id=>id===60001?{stationID:60001,
   solarSystemID:30000144,regionID:10000002}:null,
  getOrders:async()=>{state.books++;if(extra.slowBook)return extra.slowBook();
   if(extra.bookThrows)throw Error("RUST_ORDER_TIMEOUT");
   return book;},
  systems:()=>new Set(extra.systems||[30000144]),
  clock:()=>1761400000000});
 return {driver,state,setBook:b=>book=b,
  setOps:o=>ops=o,setJournal:j=>journal=j};
};
async function withFlags(fn){
 const old=keys.map(k=>process.env[k]);
 for(const k of keys)process.env[k]="1";
 try{return await fn()}finally{keys.forEach((k,i)=>{
  if(old[i]===undefined)delete process.env[k];else process.env[k]=old[i]});
 }
}
test("best real Rust buy bid supplies NPC sell quote, one original source only",()=>withFlags(async()=>{
 const f=fixture(),r=await f.driver.tick();
 assert.equal(r.status,"ALIFE_SALVAGE_MARKET_ATTEMPT");
 assert.equal(r.priceCents,1700);assert.equal(r.anchor,"REAL_NATIVE_BUY");
 assert.deepEqual(f.state.list,[9001]);assert.equal(f.state.books,1);
}));
test("seed orders never authorize auto-salvage pricing",()=>withFlags(async()=>{
 const f=fixture();f.setBook({buys:[{order_id:"10",owner_id:1,
  source:"seed",station_id:60001,type_id:34,vol_remaining:500,
  price:1000,state:"open",bid:true}],sells:[]});
 const r=await f.driver.tick();
 assert.equal(r.reason,"NO_ORIGINAL_SALVAGE_WITH_REAL_MARKET_PRICE");
 assert.equal(f.state.list.length,0);
}));
test("real native competitor sell order yields bounded slightly cheaper ask",()=>withFlags(async()=>{
 const f=fixture();f.setBook({buys:[],sells:[{order_id:"22",
  owner_id:40001,source:"player",station_id:60001,type_id:34,
  vol_remaining:2,price:20,state:"open",bid:false}]});
 const r=await f.driver.tick();
 assert.equal(r.priceCents,1980);assert.equal(r.anchor,"REAL_NATIVE_ASK");
 assert.equal(f.state.list.length,1);
}));
test("a price with another NPC's unverified identity cannot be used",()=>withFlags(async()=>{
 const f=fixture();f.setBook({buys:[{order_id:"1",owner_id:10001,
  source:"player",station_id:60001,type_id:34,vol_remaining:5,
  price:30,state:"open",bid:true}],sells:[]});
 assert.equal((await f.driver.tick()).status,"ALIFE_SALVAGE_MARKET_HOLD");
 assert.equal(f.state.list.length,0);
}));
test("unresolved original journal has first priority over new listings",()=>withFlags(async()=>{
 const f=fixture();f.setOps({version:1,bySource:{"9001":{
  phase:"PREPARED",operationID:"npc-salvage:"+"a".repeat(32),at:1,
  stationID:60001}}});
 const r=await f.driver.tick();
 assert.equal(r.status,"ALIFE_SALVAGE_MARKET_RECOVERY");
 assert.deepEqual(f.state.recover,[9001]);assert.equal(f.state.list.length,0);
 assert.equal(f.state.books,0);
}));
test("invalid pending operation halts all new NPC market sales",()=>withFlags(async()=>{
 const f=fixture();f.setOps({version:1,bySource:{"9001":{
  phase:"PREPARED",operationID:"not-salvage",stationID:60001}}});
 const r=await f.driver.tick();
 assert.equal(r.reason,"NATIVE_ALIFE_UNRESOLVED_SOURCE_CORRUPT");
 assert.equal(f.state.list.length,0);
}));
test("seller is scoped to native systems currently observed by A-Life",()=>withFlags(async()=>{
 const f=fixture({systems:[30000999]});
 assert.equal((await f.driver.tick()).status,"ALIFE_SALVAGE_MARKET_HOLD");
 assert.equal(f.state.books,0);
}));
test("only one of two independent original salvage sources is processed per tick",()=>withFlags(async()=>{
 const f=fixture();f.setJournal({version:1,moves:{
  "9001":{state:"NPC_STOCK_DELIVERED",wreckItemID:9001,stationID:60001},
  "9002":{state:"NPC_STOCK_DELIVERED",wreckItemID:9002,stationID:60001}}});
 assert.equal((await f.driver.tick()).status,"ALIFE_SALVAGE_MARKET_ATTEMPT");
 assert.deepEqual(f.state.list,[9001]);
}));
test("overlapping long Rust RPC never runs two market cycles",()=>withFlags(async()=>{
 let release;
 const f=fixture({slowBook:()=>new Promise(resolve=>{release=resolve})});
 const first=f.driver.tick();
 await Promise.resolve();
 const second=await f.driver.tick();
 assert.equal(second.reason,"PREVIOUS_NATIVE_MARKET_TICK_RUNNING");
 release({buys:[{order_id:"921",owner_id:20001,source:"player",
  station_id:60001,type_id:34,vol_remaining:5,price:17,state:"open",bid:true}],
  sells:[]});
 assert.equal((await first).status,"ALIFE_SALVAGE_MARKET_ATTEMPT");
 assert.equal(f.state.list.length,1);
}));
test("native market read failure leaves original stock and intent untouched",()=>withFlags(async()=>{
 const f=fixture({bookThrows:true});
 const r=await f.driver.tick();
 assert.equal(r.reason,"NATIVE_RUST_MARKET_BOOK_UNAVAILABLE");
 assert.equal(f.state.list.length,0);
}));
test("all market decisions are OFF until explicit full-stack feature flags",async()=>{
 const f=fixture();const a=process.env.EVEJS_COOP_ALIFE_SALVAGE_MARKET;
 delete process.env.EVEJS_COOP_ALIFE_SALVAGE_MARKET;
 try{assert.equal((await f.driver.tick()).status,"ALIFE_SALVAGE_MARKET_DISABLED");
  assert.equal(f.state.books,0)}finally{
  if(a===undefined)delete process.env.EVEJS_COOP_ALIFE_SALVAGE_MARKET;
  else process.env.EVEJS_COOP_ALIFE_SALVAGE_MARKET=a;
 }
});
test("malformed nonnative price or corrupted order book cannot become a listing",()=>{
 const r=quoteNativeSalvage({book:{sells:[],buys:[{
  order_id:"77",source:"seed",owner_id:7001,station_id:60001,
  type_id:34,vol_remaining:1,price:20,state:"open",bid:true}]},
  stationID:60001,typeID:34,ownerID:10001});
 assert.notEqual(r.status,"NATIVE_MARKET_PRICE_QUOTED");
});

test("bounded salvage stock scan rotates beyond the first 128 real sources",()=>withFlags(async()=>{
 const f=fixture(),moves={};
 for(let id=9001;id<=9129;id++){
  moves[String(id)]={state:"NPC_STOCK_DELIVERED",
   wreckItemID:id,stationID:60001};
 }
 f.setJournal({version:1,moves});
 assert.equal((await f.driver.tick()).status,"ALIFE_SALVAGE_MARKET_ATTEMPT");
 assert.deepEqual(f.state.list,[9001]);
 assert.equal((await f.driver.tick()).status,"ALIFE_SALVAGE_MARKET_ATTEMPT");
 assert.deepEqual(f.state.list,[9001,9129]);
 assert.deepEqual(f.state.inspect,[9001,9129]);
}));
