import test from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createNpcMarketCompletionNotifier}=
 require("../integration/coopNpcMarketCompletionNotify.cjs");
const {createSqliteAdapter}=require("../integration/coopGameStoreAtomic.cjs");
const FILL=930000000000001,KEY="npc-corpbuy:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const ORDER=456,SELLER=90000001,CORP=1000010,STATION=60000001,TYPE=34;
const receipt=()=>({phase:"NATIVE_NPC_BUY_COMMITTED",claimKey:KEY,
 fillID:FILL,orderID:ORDER,buyerCorpID:CORP,sellerID:SELLER,
 stationID:STATION,typeID:TYPE,itemID:1990000200,
 quantity:20,priceCents:125,grossCents:2500,taxCents:200,
 netCents:2300,taxPolicy:"EVEJS_NATIVE_MARKET_RULES",
 buyerBeforeCents:100000,buyerAfterCents:97500,
 sellerBeforeCents:10000,sellerAfterCents:12300,
 taxTransactionID:FILL+100000000000000,committedAt:1000001});
const rust=()=>({claim_key:KEY,state:"filled",fill_phase:"finalized",
 history_recorded:true,history_day:"2026-10-25",
 fill_id:String(FILL),order_id:String(ORDER),owner_id:String(SELLER),
 buyer_corp_id:String(CORP),station_id:STATION,type_id:TYPE,
 quantity:20,price_cents:125});
const order=()=>({source:"player",is_corp:false,state:"filled",
 owner_id:String(SELLER),row:{order_id:String(ORDER),bid:false,
 station_id:STATION,region_id:10000002,solar_system_id:30000142,
 type_id:TYPE,vol_remaining:0,price:1.25,
 issued_at:"2026-10-25T10:00:00.000Z",vol_entered:20,
 min_volume:1,duration_days:30,range_value:-1}});
const env={EVEJS_COOP_NPC_BUY_NOTIFY:"1",
 EVEJS_COOP_NATIVE_ATOMIC_ROWS:"1",EVEJS_COOP_NPC_BUY_PLAYER_ASK:"1"};
function fixture({offline=false,badRust=false,badOrder=false,
 badReceipt=false,throws=false,invalidWallet=false,disabled=false,
 sendFails=false,catchup=false}={}){
 const db=new DatabaseSync(":memory:");
 db.exec('CREATE TABLE "npcMarketFills" ("key" TEXT PRIMARY KEY, "json" TEXT NOT NULL)');
 const r=receipt();
 if(badReceipt)r.taxCents=300;
 db.prepare('INSERT INTO "npcMarketFills"("key","json") VALUES(?,?)')
  .run("corp-buy\u001f"+FILL,JSON.stringify(r));
 const writer=createSqliteAdapter(()=>db).claimTransactor();
 const events=[],calls=[],marketR=rust(),marketO=order();
 if(badRust)marketR.history_recorded=false;
 if(badOrder)marketO.owner_id="90000002";
 // Retain mutable market snapshots to simulate native drift mid-flight.
 const rustClaim=marketR,ownerOrder=marketO;
 const observerEvents=[],observer={characterID:SELLER+1,
  sendNotification:(name,target,args)=>observerEvents.push({name,target,args})};
 const session={characterID:SELLER,sendNotification:(name,target,args)=>{
  if(sendFails)throw Error("CLIENT_DISCONNECTED");
  events.push({name,target,args});
 }};
 let accountChanges=0;
 const dependencies={
  gameStore:{transact:(tables,fn)=>writer.transact(tables,fn)},
  marketClient:{call:async(method,args)=>{calls.push({method,args});
   if(throws)throw Error("MARKET_RPC_UNAVAILABLE");
   if(method==="GetNpcCorpPlayerClaim")return marketR;
   if(method==="GetOrder")return marketO;
   throw Error("NON_NATIVE_METHOD");}},
  sessions:{getSessions:()=>offline?[]:[session,observer]},
  helpers:{buildList:items=>({type:"list",items}),
   buildKeyVal:entries=>({type:"object",name:"util.KeyVal",
    args:{type:"dict",entries}}),
   buildFiletimeLong:value=>({type:"long",value})},
  walletState:{
   getCharacterWallet:()=>invalidWallet?null:{
    characterID:SELLER,balance:123,balanceChange:23,aurBalance:0,plexBalance:0},
   syncWalletToSession:(s,w)=>{s.balance=w.balance},
   emitAccountChangeToSession:(s,opts)=>{accountChanges++;
    s.sendNotification("OnAccountChange","clientID",
     ["cash",opts.ownerID,opts.balance]);}},
  env:{...env,...(disabled?{EVEJS_COOP_NPC_BUY_NOTIFY:"0"}:{}),
   ...(catchup?{EVEJS_COOP_NPC_BUY_NOTIFY_CATCHUP:"1"}:{})},
  clock:()=>1000002
 };
 const notifier=createNpcMarketCompletionNotifier(dependencies);
 const read=()=>JSON.parse(db.prepare(
  'SELECT json FROM "npcMarketFills" WHERE key=?')
  .get("corp-buy\u001f"+FILL).json);
 const notify=()=>notifier.notifyCommitted({claimKey:KEY,fillID:FILL});
 return {notify,read,events,observerEvents,calls,session,notifier,dependencies,
  rustClaim,ownerOrder,
  get accountChanges(){return accountChanges},
  close:()=>db.close()};
}
async function run(fn,opts){
 const f=fixture(opts);
 const oldNative=process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS;
 process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS="1";
 try{return await fn(f)}
 finally{f.close();if(oldNative===undefined)
  delete process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS;
  else process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS=oldNative}
}
test("native seller receives official Filled order and wallet change once",()=>run(async f=>{
 const r=await f.notify();
 assert.equal(r.status,"NOTIFIED");
 assert.equal(r.delivered,1);
 assert.deepEqual(f.events.map(e=>e.name),["OnOwnOrdersChanged","OnAccountChange"]);
 assert.equal(f.events[0].target,"charid");
 assert.equal(f.events[0].args[1],"Filled");
 assert.equal(f.events[0].args[2],0);
 assert.equal(f.events[0].args[0].items.length,1);
 assert.equal(f.events[0].args[0].items[0].name,"util.KeyVal");
 assert.equal(f.session.balance,123);
 assert.equal(f.read().sellerNotifyClaimedAt,1000002);
 assert.equal(f.read().sellerNotifyProtocol,"NATIVE_MARKET_SELLER_AT_MOST_ONCE");
}));
test("duplicate finalize ACK cannot send another native market notification",()=>run(async f=>{
 assert.equal((await f.notify()).status,"NOTIFIED");
 assert.equal((await f.notify()).status,"ALREADY_CLAIMED");
 assert.equal(f.events.length,2);assert.equal(f.accountChanges,1);
}));
test("offline seller is not stamped notified, relog later can receive same history",()=>run(async f=>{
 f.dependencies.sessions.getSessions=()=>[];
 assert.equal((await f.notify()).status,"SELLER_OFFLINE");
 assert.equal(f.read().sellerNotifyClaimedAt,undefined);
 f.dependencies.sessions.getSessions=()=>[f.session];
 assert.equal((await f.notify()).status,"NOTIFIED");
 assert.equal(f.events.length,2);
},{offline:false}));
test("missing Rust history proof refuses delivery and does not stamp receipt",()=>run(async f=>{
 assert.equal((await f.notify()).reason,"RUST_FINALIZE_OR_ORDER_UNVERIFIED");
 assert.equal(f.events.length,0);
 assert.equal(f.read().sellerNotifyClaimedAt,undefined);
},{badRust:true}));
test("wrong seller owner in filled Rust order cannot emit a fake sale",()=>run(async f=>{
 assert.equal((await f.notify()).reason,"RUST_FINALIZE_OR_ORDER_UNVERIFIED");
 assert.equal(f.events.length,0);
},{badOrder:true}));
test("tax receipt conflict fails closed with no socket notification",()=>run(async f=>{
 assert.equal((await f.notify()).reason,"GAMESTORE_RECEIPT_INVALID");
 assert.equal(f.events.length,0);
},{badReceipt:true}));
test("market unavailable leaves durable receipt unclaimed for explicit retry",()=>run(async f=>{
 assert.equal((await f.notify()).reason,"MARKET_AUTHORITY_UNAVAILABLE");
 assert.equal(f.read().sellerNotifyClaimedAt,undefined);
},{throws:true}));
test("wallet read unavailable never claims transient notification",()=>run(async f=>{
 assert.equal((await f.notify()).reason,"NATIVE_WALLET_UNVERIFIED");
 assert.equal(f.read().sellerNotifyClaimedAt,undefined);
},{invalidWallet:true}));
test("feature disabled does not read Rust or mutate GameStore",()=>run(async f=>{
 const before=f.read();
 assert.equal((await f.notify()).reason,"DISABLED");
 assert.deepEqual(f.read(),before);assert.equal(f.calls.length,0);
},{disabled:true}));
test("client disconnect after durable claim never duplicates an in-flight notification",()=>run(async f=>{
 const r=await f.notify();
 assert.equal(r.status,"CLAIMED_PARTIAL");
 assert.equal(f.events.length,0);
 assert.equal((await f.notify()).status,"ALREADY_CLAIMED");
 assert.equal(f.read().sellerNotifyClaimedAt,1000002);
},{sendFails:true}));
test("invalid claim key or fill id cannot read a third-party receipt",()=>run(async f=>{
 const bad=await f.dependencies.marketClient.call("GetOrder",{order_id:"456"});
 assert.equal(bad.row.type_id,34);
 const notifier=createNpcMarketCompletionNotifier(f.dependencies);
 assert.equal((await notifier.notifyCommitted({claimKey:"wrong",fillID:FILL})).reason,
  "CLAIM_SCOPE_INVALID");
 assert.equal((await notifier.notifyCommitted({claimKey:KEY,fillID:0})).reason,
  "CLAIM_SCOPE_INVALID");
 assert.equal(f.read().sellerNotifyClaimedAt,undefined);
}));
test("receipt with already claimed transient UI event never touches Rust",()=>run(async f=>{
 assert.equal((await f.notify()).status,"NOTIFIED");
 const before=f.calls.length;
 assert.equal((await f.notify()).status,"ALREADY_CLAIMED");
 assert.equal(f.calls.length,before);
}));

test("same paid fill cannot notify with swapped seller receipt during Rust await",()=>run(async f=>{
 const rpc=f.dependencies.marketClient.call;
 f.dependencies.marketClient.call=async(method,args)=>{
  const data=await rpc(method,args);
  if(method==="GetOrder"){
   f.dependencies.gameStore.transact(["npcMarketFills"],tx=>{
    const key="corp-buy\u001f"+FILL,current=tx.get("npcMarketFills",key);
    tx.put("npcMarketFills",key,{...current,sellerID:SELLER+1});
   });
  }
  return data;
 };
 const r=await f.notify();
 assert.equal(r.status,"RECEIPT_CHANGED");
 assert.equal(f.events.length,0);
 assert.equal(f.read().sellerNotifyClaimedAt,undefined);
}));
test("concurrent duplicate notification attempts claim at most one native UI delivery",()=>run(async f=>{
 const both=await Promise.all([f.notify(),f.notify()]);
 assert.deepEqual(both.map(x=>x.status).sort(),["ALREADY_CLAIMED","NOTIFIED"]);
 assert.deepEqual(f.events.map(x=>x.name),["OnOwnOrdersChanged","OnAccountChange"]);
 assert.equal(f.read().sellerNotifyClaimedAt,1000002);
}));
test("negative seller proceeds or tax exceeding gross never produces notification",()=>run(async f=>{
 f.dependencies.gameStore.transact(["npcMarketFills"],tx=>{
  const key="corp-buy\u001f"+FILL,current=tx.get("npcMarketFills",key);
  tx.put("npcMarketFills",key,{...current,taxCents:3000,netCents:-500});
 });
 assert.equal((await f.notify()).reason,"GAMESTORE_RECEIPT_INVALID");
 assert.equal(f.events.length,0);
}));

test("two co-op clients: only actual market seller receives Filled/wallet notifications",()=>run(async f=>{
 const result=await f.notify();
 assert.equal(result.status,"NOTIFIED");
 assert.deepEqual(f.events.map(e=>e.name),["OnOwnOrdersChanged","OnAccountChange"]);
 assert.deepEqual(f.observerEvents,[]);
}));

test("offline seller catch-up leaves durable receipt unclaimed until actual login",()=>run(async f=>{
 const offline=await f.notifier.notifyPendingForSeller({sellerID:SELLER});
 assert.equal(offline.status,"CATCHUP_CHECKED");
 assert.equal(offline.attempted,1);
 assert.equal(offline.results[0].status,"SELLER_OFFLINE");
 assert.equal(f.read().sellerNotifyClaimedAt,undefined);
 f.dependencies.sessions.getSessions=()=>[f.session];
 const login=await f.notifier.notifyPendingForSeller({sellerID:SELLER});
 assert.equal(login.attempted,1);
 assert.equal(login.results[0].status,"NOTIFIED");
 assert.equal(f.events.length,2);
 assert.equal(f.read().sellerNotifyClaimedAt,1000002);
},{offline:true,catchup:true}));
test("catch-up is a one-time bounded sweep: already claimed receipt never re-sends",()=>run(async f=>{
 assert.equal((await f.notifier.notifyPendingForSeller({sellerID:SELLER})).attempted,1);
 assert.equal((await f.notifier.notifyPendingForSeller({sellerID:SELLER})).attempted,0);
 assert.equal(f.events.length,2);
},{catchup:true}));
test("second co-op client cannot catch up a different player's sale",()=>run(async f=>{
 const result=await f.notifier.notifyPendingForSeller({sellerID:SELLER+1});
 assert.equal(result.status,"CATCHUP_CHECKED");
 assert.equal(result.attempted,0);
 assert.equal(f.events.length,0);
 assert.equal(f.observerEvents.length,0);
 assert.equal(f.read().sellerNotifyClaimedAt,undefined);
},{catchup:true}));
test("catch-up is disabled independently of regular native market notices",()=>run(async f=>{
 const result=await f.notifier.notifyPendingForSeller({sellerID:SELLER});
 assert.equal(result.status,"DISABLED");
 assert.equal(f.events.length,0);
 assert.equal(f.calls.length,0);
}));
test("unbounded or invalid login notification request is rejected without a write",()=>run(async f=>{
 for(const args of [{sellerID:0},{sellerID:SELLER,maxNotifications:0},
  {sellerID:SELLER,maxNotifications:9}]){
  const result=await f.notifier.notifyPendingForSeller(args);
  assert.equal(result.reason,"SELLER_CATCHUP_SCOPE_INVALID");
 }
 assert.equal(f.events.length,0);
 assert.equal(f.read().sellerNotifyClaimedAt,undefined);
},{catchup:true}));

test("native Rust claim with wrong corporation or station cannot notify seller",()=>run(async f=>{
 for(const patch of [{buyer_corp_id:String(CORP+1)},
  {station_id:STATION+1},{type_id:TYPE+1}]){
  const saved={...f.rustClaim};
  Object.assign(f.rustClaim,patch);
  assert.equal((await f.notify()).reason,"RUST_FINALIZE_OR_ORDER_UNVERIFIED");
  assert.equal(f.events.length,0);
  Object.assign(f.rustClaim,saved);
 }
 assert.equal(f.read().sellerNotifyClaimedAt,undefined);
}));
test("partially filled or stale old order volume cannot report full original fill",()=>run(async f=>{
 f.ownerOrder.row.vol_entered=19;
 assert.equal((await f.notify()).reason,"RUST_FINALIZE_OR_ORDER_UNVERIFIED");
 assert.equal(f.events.length,0);
 assert.equal(f.read().sellerNotifyClaimedAt,undefined);
}));

test("previous partial player order sales do not suppress correct final NPC fill",()=>run(async f=>{
 f.ownerOrder.row.vol_entered=200;
 const result=await f.notify();
 assert.equal(result.status,"NOTIFIED");
 assert.equal(f.events.filter(x=>x.name==="OnOwnOrdersChanged").length,1);
 assert.equal(f.events.filter(x=>x.name==="OnAccountChange").length,1);
}));


test("seller must not receive an NPC paid notice based on a missing or fabricated wallet debit",()=>run(async f=>{
 const cases=[
  {buyerBeforeCents:undefined},
  {buyerAfterCents:100000},
  {sellerAfterCents:10000},
  {taxTransactionID:null},
  {committedAt:0}
 ];
 for(const corruption of cases){
  const key="corp-buy\u001f"+FILL;
  const original=f.read();
  f.dependencies.gameStore.transact(["npcMarketFills"],tx=>
   tx.put("npcMarketFills",key,{...original,...corruption}));
  assert.equal((await f.notify()).reason,"GAMESTORE_RECEIPT_INVALID");
  assert.equal(f.events.length,0);
  assert.equal(f.read().sellerNotifyClaimedAt,undefined);
  f.dependencies.gameStore.transact(["npcMarketFills"],tx=>
   tx.put("npcMarketFills",key,original));
 }
 assert.equal((await f.notify()).status,"NOTIFIED");
}));
test("seller catch-up cannot claim a forged receipt and skips it without Rust calls",()=>run(async f=>{
 const key="corp-buy\u001f"+FILL,original=f.read();
 f.dependencies.gameStore.transact(["npcMarketFills"],tx=>tx.put(
  "npcMarketFills",key,{...original,buyerAfterCents:100000}));
 const result=await f.notifier.notifyPendingForSeller({sellerID:SELLER});
 assert.equal(result.status,"CATCHUP_CHECKED");
 assert.equal(result.attempted,0);
 assert.equal(f.calls.length,0);
 assert.equal(f.read().sellerNotifyClaimedAt,undefined);
},{catchup:true}));
test("canonical market price and wallet balance are required for seller notification",()=>run(async f=>{
 f.ownerOrder.row.price=1.254;
 assert.equal((await f.notify()).reason,"RUST_FINALIZE_OR_ORDER_UNVERIFIED");
 f.ownerOrder.row.price=1.25;
 f.dependencies.walletState.getCharacterWallet=()=>({
  characterID:SELLER,balance:123.004});
 assert.equal((await f.notify()).reason,"NATIVE_WALLET_UNVERIFIED");
 assert.equal(f.read().sellerNotifyClaimedAt,undefined);
}));
test("zero-tax completed native receipt remains notifyable without artificial tax ledger",()=>run(async f=>{
 const key="corp-buy\u001f"+FILL,r=f.read();
 f.dependencies.gameStore.transact(["npcMarketFills"],tx=>
  tx.put("npcMarketFills",key,{...r,taxCents:0,netCents:2500,
   sellerAfterCents:12500,taxTransactionID:null}));
 assert.equal((await f.notify()).status,"NOTIFIED");
}));
