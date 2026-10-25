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
 sellerAfterCents:12300,buyerAfterCents:97500,committedAt:1000001});
const rust=()=>({claim_key:KEY,state:"filled",fill_phase:"finalized",
 history_recorded:true,history_day:"2026-10-25",
 fill_id:String(FILL),order_id:String(ORDER),owner_id:String(SELLER),
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
 sendFails=false}={}){
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
  sessions:{getSessions:()=>offline?[]:[session]},
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
  env:{...env,...(disabled?{EVEJS_COOP_NPC_BUY_NOTIFY:"0"}:{})},
  clock:()=>1000002
 };
 const notifier=createNpcMarketCompletionNotifier(dependencies);
 const read=()=>JSON.parse(db.prepare(
  'SELECT json FROM "npcMarketFills" WHERE key=?')
  .get("corp-buy\u001f"+FILL).json);
 const notify=()=>notifier.notifyCommitted({claimKey:KEY,fillID:FILL});
 return {notify,read,events,calls,session,dependencies,
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
