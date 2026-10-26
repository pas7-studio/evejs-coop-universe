import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import {DatabaseSync} from "node:sqlite";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createSqliteAdapter}=require("../integration/coopGameStoreAtomic.cjs");
const {createNativeNpcBuyerBindings}=require("../integration/coopNpcBuyerNativeBindings.cjs");
const {createNpcMarketCompletionNotifier}=
 require("../integration/coopNpcMarketCompletionNotify.cjs");
const {createLocalNpcBuyerRecoveryControl,signRequest}=
 require("../integration/coopNpcBuyerAdminControl.cjs");
// COOP-060: backend two-session E2E using real SQLite+real integration modules.
// Rust is a protocol-accurate, disk-persisted RPC simulator, NOT a Rust daemon
// or a running two-client game. The latter is a separate NOT_RUN acceptance gate.
const CORP=1000010,SELLER=90000001,OBSERVER=90000002;
const STATION=60000001,REGION=10000002,TYPE=34,ORDER=456,ITEM=1990000200;
const STOCK=999,FILL=930000000000001,PRICE=125,QUANTITY=20;
const CK="corporations\u001f"+CORP,FK="corp-buy\u001f"+FILL;
const FLAGS=["EVEJS_COOP_NATIVE_ATOMIC_ROWS","EVEJS_COOP_NPC_BUY_PLAYER_ASK"];
const AT=1761390000000;
function fixture({offline=false,initialISK=1000,wrongEscrowOwner=false,
 corruptHistory=false,dropAck=false}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"coop060-e2e-"));
 const dbFile=path.join(dir,"gamestore.sqlite"),journal=path.join(dir,"buyer.json");
 const rustFile=path.join(dir,"market-rpc-replica.json");
 let db=new DatabaseSync(dbFile),writer,loss=dropAck,corruptWitness=corruptHistory;
 let sessions=[],calls=[],grantIDs=new Set(),clock=AT,operatorAuthorizer=null;
 const get=(t,k)=>{
  const record=db.prepare('SELECT json FROM "'+t+'" WHERE key=?').get(String(k));
  return record?JSON.parse(record.json):null;
 };
 const put=(t,k,v)=>db.prepare('INSERT INTO "'+t+'"(key,json) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET json=excluded.json')
  .run(String(k),JSON.stringify(v));
 const readAll=t=>db.prepare('SELECT key,json FROM "'+t+'" ORDER BY key').all()
  .map(({key,json})=>({key,value:JSON.parse(json)}));
 for(const t of ["corporations","corporationRuntime","characters","items",
  "marketEscrow","npcMarketFills"])
  db.exec('CREATE TABLE "'+t+'"(key TEXT PRIMARY KEY,json TEXT NOT NULL)');
 put("corporations","records\u001f"+CORP,{corporationID:CORP,isNPC:true});
 put("corporationRuntime",CK,{corporationID:CORP,wallet:{divisions:{
  "1000":{balance:initialISK,journal:[],transactions:[]}}}});
 put("characters",SELLER,{characterID:SELLER,balance:100,
  walletJournal:[],marketTransactions:[]});
 put("characters",OBSERVER,{characterID:OBSERVER,balance:70,
  walletJournal:[],marketTransactions:[]});
 put("items",ITEM,{itemID:ITEM,ownerID:SELLER,typeID:TYPE,quantity:QUANTITY,
  stacksize:QUANTITY,categoryID:8,flagID:4,singleton:0,
  locationID:9200000000+ORDER});
 put("items",STOCK,{itemID:STOCK,ownerID:CORP,typeID:TYPE,quantity:10,
  stacksize:10,categoryID:8,flagID:4,singleton:0,locationID:STATION});
 put("marketEscrow",ORDER,{orderId:String(ORDER),escrowType:"sell",isCorp:false,
  ownerId:wrongEscrowOwner?OBSERVER:SELLER,stationId:STATION,typeId:TYPE,
  remainingQuantity:QUANTITY,escrowLocationID:9200000000+ORDER});
 const freshWriter=()=>{writer=createSqliteAdapter(()=>db).claimTransactor()};
 freshWriter();
 const gameStore={
  read:(table,raw)=>{
   const key=raw.split("/").filter(Boolean).join("\u001f");
   const data=get(table,key);return data==null?{success:false}:{success:true,data};
  },
  coopAtomicNativeRows:{transact:(tables,fn)=>writer.transact(tables,fn).result}
 };
 const itemStore={
  listOwnedItems:owner=>readAll("items").map(x=>x.value)
   .filter(item=>item.ownerID===owner),
  findItemById:id=>get("items",id)
 };
 const initialRust={state:"open",phase:null,claimKey:null,
  claims:0,historyVolume:0,historyOrders:0,historyDay:"2025-10-25"};
 fs.writeFileSync(rustFile,JSON.stringify(initialRust));
 const rust=()=>JSON.parse(fs.readFileSync(rustFile,"utf8"));
 const saveRust=x=>fs.writeFileSync(rustFile,JSON.stringify(x));
 const publicOrder=()=>({source:"player",order_id:String(ORDER),bid:false,
  station_id:STATION,region_id:REGION,type_id:TYPE,
  vol_remaining:rust().state==="filled"?0:QUANTITY,
  vol_entered:QUANTITY,price:PRICE/100});
 const ownerOrder=()=>({source:"player",is_corp:false,
  state:rust().state,owner_id:String(SELLER),
  row:{...publicOrder(),range_value:-1,min_volume:1,duration_days:30,
   solar_system_id:30000142,issued_at:"2025-10-25T10:00:00.000Z"}});
 const claim=()=>{
  const r=rust();
  if(!r.claimKey)throw Error("NPC corporate player claim missing");
  return {source:"player",is_corp:false,bid:false,claim_key:r.claimKey,
   state:r.state,fill_phase:r.phase,fill_id:String(FILL),
   order_id:String(ORDER),buyer_corp_id:String(CORP),
   owner_id:String(SELLER),station_id:STATION,type_id:TYPE,
   quantity:QUANTITY,price_cents:PRICE,
   vol_remaining:r.state==="filled"?0:QUANTITY,
   history_recorded:r.phase==="finalized"&&!corruptWitness,
   history_day:r.phase==="finalized"?r.historyDay:null};
 };
 const marketClient={call:async(method,args)=>{
  calls.push(method);
  if(method==="GetOrders")return {sells:rust().state==="open"?[publicOrder()]:[]};
  if(method==="GetOrder")return ownerOrder();
  if(method==="GetNpcCorpPlayerClaim"){
   if(args?.claim_key!==rust().claimKey)throw Error("NPC corporate player claim missing");
   return claim();
  }
  if(method==="ClaimNpcCorpPlayerSell"){
   const r=rust();
   if(r.claimKey&&r.claimKey!==args.claim_key)throw Error("RUST_CLAIM_CONFLICT");
   if(!r.claimKey){
    r.claimKey=args.claim_key;r.state="settling";r.phase="claimed";r.claims++;
    saveRust(r);
   }
   return claim();
  }
  if(method==="FinalizeNpcCorpPlayerSell"){
   const r=rust();
   if(r.claimKey!==args.claim_key)throw Error("RUST_CLAIM_CONFLICT");
   if(r.state!=="filled"){
    r.state="filled";r.phase="finalized";
    r.historyVolume+=QUANTITY;r.historyOrders++;saveRust(r);
   }
   if(loss){loss=false;throw Error("LOST_RUST_FINAL_ACK")}
   return claim();
  }
  throw Error("UNEXPECTED_NATIVE_RPC:"+method);
 }};
 const sellerSession={characterID:SELLER,events:[],sendNotification(...args){
  this.events.push(args)}};
 const observerSession={characterID:OBSERVER,events:[],sendNotification(...args){
  this.events.push(args)}};
 if(!offline)sessions.push(sellerSession);
 sessions.push(observerSession);
 const helpers={
  buildList:items=>({type:"list",items}),
  buildKeyVal:entries=>({type:"object",name:"util.KeyVal",args:{type:"dict",entries}}),
  buildFiletimeLong:value=>({type:"long",value})
 };
 const env={EVEJS_COOP_ALIFE_ECONOMY_ACT:"1",
  EVEJS_COOP_NATIVE_ATOMIC_ROWS:"1",EVEJS_COOP_NPC_BUY_PLAYER_ASK:"1",
  EVEJS_COOP_NPC_BUY_NOTIFY:"1",EVEJS_COOP_NPC_BUY_NOTIFY_CATCHUP:"1",
  EVEJS_COOP_NPC_BUY_RECOVERY_OPERATOR:"1"};
 const notifier=createNpcMarketCompletionNotifier({
  gameStore:gameStore.coopAtomicNativeRows,marketClient,
  sessions:{getSessions:()=>sessions},helpers,
  walletState:{
   getCharacterWallet:id=>get("characters",id),
   syncWalletToSession:(session,wallet)=>{session.walletBalance=wallet.balance},
   emitAccountChangeToSession:(session,{ownerID,balance})=>
    session.sendNotification("OnAccountChange","clientID",["cash",ownerID,balance])
  },clock:()=>clock,env
 });
 let bridge;
 const createBridge=()=>createNativeNpcBuyerBindings({
  file:journal,gameStore,itemStore,marketClient,clock:()=>clock,env,
  marketNotifier:notifier,marketRules:{
   getMarketContext:({characterID,stationID})=>({
    characterID,stationID,limits:{acc:0.08}}),
   computeSalesTaxAmount:(ctx,gross)=>Math.round(gross*ctx.limits.acc*100)/100
  },getStation:()=>({stationID:STATION,regionID:REGION}),
  resolveActor:async()=>({nativeVerified:true,isNpc:true,
   role:"trader",corporationID:CORP,stationID:STATION,
   playerControlled:false,underAttack:false,inWarp:false,activeNativeOrder:false}),
  readNeeds:()=>({authoritativeNative:true,ownerID:CORP,stationID:STATION,
   typeID:TYPE,required:80,available:10,shortage:70,observedAt:clock}),
  authorizeRecoveryOperator:async approval=>{
   if(operatorAuthorizer)return operatorAuthorizer(approval);
   if(!grantIDs.has(approval.approvalID))return false;
   grantIDs.delete(approval.approvalID);return true;
  }
 });
 bridge=createBridge();
 const tick=()=>bridge.tick({actorID:100,buyerCorpID:CORP,
  stationID:STATION,typeID:TYPE,maxUnitPriceCents:PRICE,
  maxSpendCents:10000,minReserveCents:1000});
 const paidSnapshot=()=>({
  corp:get("corporationRuntime",CK),
  seller:get("characters",SELLER),
  observer:get("characters",OBSERVER),
  escrow:get("marketEscrow",ORDER),item:get("items",ITEM),
  fill:get("npcMarketFills",FK),rust:rust()
 });
 const restart=()=>{
  db.close();db=new DatabaseSync(dbFile);freshWriter();
  bridge=createBridge();
 };
 const approve=async action=>{
  const row=bridge.inspect().entries[CORP+":"+ORDER];
  const approvalID="approved-operator-"+cryptoRandom();
  grantIDs.add(approvalID);
  return bridge.recoverApproved({actorID:100,approval:{
   claimKey:row.claimKey,action,approvalID,
   reason:"Verified both durable markets before same-key recovery"}});
 };
 const cryptoRandom=()=>require("node:crypto").randomBytes(8).toString("hex");
 return {tick,read:get,readAll,approve,restart,paidSnapshot,
  get bridge(){return bridge},rust,notifier,journal,dbFile,rustFile,
  sellerSession,observerSession,login:()=>{if(!sessions.includes(sellerSession))
   sessions.push(sellerSession)},logout:()=>{sessions=sessions.filter(s=>s!==sellerSession)},
  events:()=>({seller:sellerSession.events,observer:observerSession.events}),
  failAck:()=>{loss=true},corruptWitness:()=>{corruptWitness=true},
  setOperatorAuthorizer:fn=>{operatorAuthorizer=fn},setClock:v=>clock=v,
  close:()=>{db.close();fs.rmSync(dir,{recursive:true,force:true})}};
}
async function run(fn,opts={}){
 const prior=FLAGS.map(k=>process.env[k]);
 for(const k of FLAGS)process.env[k]="1";
 let f;
 try{f=fixture(opts);return await fn(f)}
 finally{
  if(f)f.close();
  FLAGS.forEach((key,i)=>{if(prior[i]===undefined)delete process.env[key];
   else process.env[key]=prior[i]});
 }
}
function verifyPaidOnce(f){
 const s=f.paidSnapshot();
 assert.equal(s.corp.wallet.divisions["1000"].balance,975);
 assert.equal(s.seller.balance,123);
 assert.equal(s.observer.balance,70);
 assert.equal(s.item.ownerID,CORP);
 assert.equal(s.item.locationID,STATION);
 assert.equal(s.escrow,null);
 assert.equal(s.fill.grossCents,2500);
 assert.equal(s.fill.taxCents,200);
 assert.equal(s.fill.netCents,2300);
 assert.equal(s.fill.itemID,ITEM);
 assert.equal(s.rust.historyVolume,QUANTITY);
 assert.equal(s.rust.historyOrders,1);
 assert.equal(s.rust.claims,1);
 assert.equal(s.seller.marketTransactions.length,1);
 assert.equal(s.seller.walletJournal.length,2);
}
test("COOP-060 / online real SQLite sale: 2 sessions, one durable player payout, one NPC item and one Rust history",()=>run(async f=>{
 const result=await f.tick();
 assert.equal(result.status,"NPC_PLAYER_PURCHASE_SETTLED");
 assert.equal(result.notification,"NOTIFIED");
 verifyPaidOnce(f);
 assert.equal(f.bridge.inspect().entries[CORP+":"+ORDER].phase,"SETTLED");
 assert.deepEqual(f.events().seller.map(e=>e[0]),
  ["OnOwnOrdersChanged","OnAccountChange"]);
 assert.deepEqual(f.events().observer,[]);
 assert.equal(f.sellerSession.walletBalance,123);
 assert.equal(f.paidSnapshot().fill.sellerNotifyProtocol,"NATIVE_MARKET_SELLER_AT_MOST_ONCE");
}));
test("COOP-060 / offline sale reconnect sends only seller's missed event and never repeats settlement",()=>run(async f=>{
 assert.equal((await f.tick()).status,"NPC_PLAYER_PURCHASE_SETTLED");
 verifyPaidOnce(f);
 assert.deepEqual(f.events().seller,[]);
 assert.equal(f.paidSnapshot().fill.sellerNotifyClaimedAt,undefined);
 f.restart();f.login();
 const notified=await f.notifier.notifyPendingForSeller({sellerID:SELLER});
 assert.equal(notified.status,"CATCHUP_CHECKED");
 assert.equal(notified.results[0].status,"NOTIFIED");
 assert.equal((await f.notifier.notifyPendingForSeller({sellerID:OBSERVER})).attempted,0);
 assert.equal((await f.notifier.notifyPendingForSeller({sellerID:SELLER})).attempted,0);
 verifyPaidOnce(f);
 assert.deepEqual(f.events().observer,[]);
 assert.deepEqual(f.events().seller.map(e=>e[0]),
  ["OnOwnOrdersChanged","OnAccountChange"]);
},{offline:true}));
test("COOP-060 / lost Rust ACK: no automatic A-Life replay, trusted same-key journal ACK after SQLite restart",()=>run(async f=>{
 f.failAck();
 await assert.rejects(f.tick(),/LOST_RUST_FINAL_ACK/);
 const before=f.paidSnapshot(),original=f.bridge.inspect().entries[CORP+":"+ORDER];
 assert.equal(original.phase,"PREPARED");
 assert.equal((await f.tick()).reason,"NPC_BUY_PENDING_OPERATOR_RECOVERY");
 const audit=await f.bridge.audit();
 assert.equal(audit.entries[0].status,"ACK_JOURNAL_SAME_CLAIM");
 f.restart();
 const after=await f.approve("ACK_JOURNAL_SAME_CLAIM");
 assert.equal(after.status,"NPC_BUY_OPERATOR_RECOVERED");
 assert.equal(after.operation,original.claimKey);
 assert.equal(f.bridge.inspect().entries[CORP+":"+ORDER].phase,"SETTLED");
 verifyPaidOnce(f);
 assert.equal(f.paidSnapshot().rust.historyOrders,before.rust.historyOrders);
 assert.equal(f.paidSnapshot().seller.balance,before.seller.balance);
 assert.deepEqual(f.events().observer,[]);
}));
test("COOP-060 / forbidden operator action cannot reprocess an already paid order",()=>run(async f=>{
 f.failAck();await assert.rejects(f.tick(),/LOST_RUST_FINAL_ACK/);
 const old=f.paidSnapshot();
 const wrong=await f.approve("RESUME_GAMESTORE_SAME_CLAIM");
 assert.equal(wrong.reason,"NPC_BUY_RECOVERY_AUDIT_DIVERGED");
 assert.deepEqual(f.paidSnapshot(),old);
 assert.equal(f.bridge.inspect().entries[CORP+":"+ORDER].phase,"PREPARED");
}));
test("COOP-060 / no escrow ownership means neither native claim nor ISK/item/observer event",()=>run(async f=>{
 const result=await f.tick();
 assert.equal(result.status,"BLOCKED");
 assert.equal(f.paidSnapshot().rust.claims,0);
 assert.equal(f.paidSnapshot().seller.balance,100);
 assert.equal(f.paidSnapshot().corp.wallet.divisions["1000"].balance,1000);
 assert.equal(f.paidSnapshot().item.ownerID,SELLER);
 assert.deepEqual(f.events().seller,[]);
 assert.deepEqual(f.events().observer,[]);
},{wrongEscrowOwner:true}));
test("COOP-060 / insufficient buyer ISK cannot publish fake Rust history or a seller notification",()=>run(async f=>{
 const result=await f.tick();
 assert.equal(result.reason,"NPC_BUY_NO_SPENDABLE_ISK");
 assert.equal(f.paidSnapshot().rust.historyOrders,0);
 assert.equal(f.paidSnapshot().seller.balance,100);
 assert.deepEqual(f.events().seller,[]);
},{initialISK:0}));
test("COOP-060 / forged missing Rust history witness blocks reconnect UI after a durable sale",()=>run(async f=>{
 const result=await f.tick();
 assert.equal(result.status,"NPC_PLAYER_PURCHASE_SETTLED");
 assert.equal(result.notification,"SELLER_OFFLINE");
 f.corruptWitness();f.login();
 const missed=await f.notifier.notifyPendingForSeller({sellerID:SELLER});
 assert.equal(missed.results[0].status,"NOT_SENT");
 assert.equal(missed.results[0].reason,"RUST_FINALIZE_OR_ORDER_UNVERIFIED");
 assert.equal(f.events().seller.length,0);
 assert.equal(f.events().observer.length,0);
 assert.equal(f.paidSnapshot().fill.sellerNotifyClaimedAt,undefined);
 assert.equal(f.paidSnapshot().seller.balance,123);
},{offline:true}));

test("COOP-060 / signed localhost admin audit to original Rust/GameStore recovery through two sessions",()=>run(async f=>{
 f.failAck();await assert.rejects(f.tick(),/LOST_RUST_FINAL_ACK/);
 const before=f.paidSnapshot();
 const secret=path.join(path.dirname(f.journal),"operator.key");
 const log=path.join(path.dirname(f.journal),"operator-audit.jsonl");
 const key=crypto.randomBytes(48);
 fs.writeFileSync(secret,key,{mode:0o600});fs.chmodSync(secret,0o600);
 const control=createLocalNpcBuyerRecoveryControl({
  getBinding:()=>f.bridge,secretFile:secret,auditLogFile:log,port:0,
  clock:()=>AT,env:{
   EVEJS_COOP_NPC_BUY_ADMIN_LOCAL:"1",
   EVEJS_COOP_NPC_BUY_RECOVERY_OPERATOR:"1",
   EVEJS_COOP_NATIVE_ATOMIC_ROWS:"1",
   EVEJS_COOP_NPC_BUY_PLAYER_ASK:"1"
  }
 });
 f.setOperatorAuthorizer(control.authorizeRecoveryOperator);
 const {port}=await control.start();
 async function post(route,payload){
  const body=JSON.stringify(payload),timestamp=String(AT);
  const nonce=crypto.randomBytes(18).toString("hex");
  const signature=signRequest(key,{timestamp,nonce,path:route,body});
  return await new Promise((resolve,reject)=>{
   const request=http.request({
    hostname:"127.0.0.1",port,path:route,method:"POST",
    headers:{"Content-Type":"application/json",
     "X-Evejs-Timestamp":timestamp,"X-Evejs-Nonce":nonce,
     "X-Evejs-Signature":signature}
   },response=>{
    let text="";response.on("data",chunk=>text+=chunk);
    response.on("end",()=>resolve({code:response.statusCode,data:JSON.parse(text)}));
   });
   request.on("error",reject);request.end(body);
  });
 }
 try{
  f.restart();
  const keyOriginal=f.bridge.inspect().entries[CORP+":"+ORDER].claimKey;
  const audited=await post("/v1/recovery/audit",{claimKey:keyOriginal});
  assert.equal(audited.code,200);
  assert.equal(audited.data.action,"ACK_JOURNAL_SAME_CLAIM");
  const approved=await post("/v1/recovery/execute",{
   ticket:audited.data.ticket,claimKey:keyOriginal,
   action:audited.data.action,actorID:100,
   reason:"Verified persistent native Rust history and original GameStore payout"
  });
  assert.equal(approved.code,200);
  assert.equal(approved.data.status,"NPC_BUY_OPERATOR_RECOVERED");
  assert.equal(f.bridge.inspect().entries[CORP+":"+ORDER].phase,"SETTLED");
  verifyPaidOnce(f);
  assert.equal(f.paidSnapshot().rust.historyOrders,before.rust.historyOrders);
  assert.deepEqual(f.events().observer,[]);
  assert.deepEqual(f.events().seller.map(e=>e[0]),
   ["OnOwnOrdersChanged","OnAccountChange"]);
  assert.deepEqual(fs.readFileSync(log,"utf8").trim().split("\n")
   .map(x=>JSON.parse(x).stage),["APPROVED","RESULT"]);
  const replay=await post("/v1/recovery/execute",{
   ticket:audited.data.ticket,claimKey:keyOriginal,
   action:audited.data.action,actorID:100,
   reason:"Verified persistent native Rust history and original GameStore payout"
  });
  assert.equal(replay.code,409);
  verifyPaidOnce(f);
 }finally{await control.close()}
}));
