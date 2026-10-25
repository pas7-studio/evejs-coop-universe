import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createNpcBuyerCoordinator}=require("../integration/coopNpcBuyerCoordinator.cjs");
const {auditNativeNpcBuyerRecovery}=require("../integration/coopNpcBuyerRecoveryAudit.cjs");
const CORP=1000010,SELLER=90000001,STATION=60000001,ORDER=456,TYPE=34,FILL=930000000000001;
const KEY="npc-corpbuy:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const ALLOW="operator-approval-0001";
const flags={EVEJS_COOP_ALIFE_ECONOMY_ACT:"1",EVEJS_COOP_NATIVE_ATOMIC_ROWS:"1",
 EVEJS_COOP_NPC_BUY_PLAYER_ASK:"1",EVEJS_COOP_NPC_BUY_RECOVERY_OPERATOR:"1"};
const entry=()=>({phase:"PREPARED",claimKey:KEY,buyerCorpID:CORP,
 sellerID:SELLER,stationID:STATION,typeID:TYPE,orderID:ORDER,
 quantity:20,unitPriceCents:125,minReserveCents:1000,createdAt:1000000});
const rust=(state="settling")=>({source:"player",state,
 fill_phase:state==="filled"?"finalized":"claimed",
 claim_key:KEY,bid:false,is_corp:false,fill_id:String(FILL),
 order_id:String(ORDER),buyer_corp_id:String(CORP),
 owner_id:String(SELLER),station_id:STATION,type_id:TYPE,
 quantity:20,price_cents:125,vol_remaining:state==="filled"?0:20,
 history_recorded:state==="filled",
 history_day:state==="filled"?"2026-10-25":null});
const receipt=()=>({phase:"NATIVE_NPC_BUY_COMMITTED",claimKey:KEY,
 fillID:FILL,orderID:ORDER,buyerCorpID:CORP,sellerID:SELLER,
 stationID:STATION,typeID:TYPE,quantity:20,priceCents:125,
 grossCents:2500,taxCents:200,netCents:2300,
 taxPolicy:"EVEJS_NATIVE_MARKET_RULES",itemID:1990000200,committedAt:1000001});
const approval=action=>({claimKey:KEY,action,approvalID:ALLOW,
 reason:"Approved native database crash recovery after reconciliation"});
function fixture({initialState="settling",hasReceipt=false,
 auth=true,enabled=true,otherLock=false,failBuyer=false,
 recordOverride=null}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"coop054-"));
 const file=path.join(dir,"journal.json"),lock=file+".lock";
 let currentRust=initialState==="missing"?null:rust(initialState);
 let currentReceipt=hasReceipt?receipt():null,buyerCalls=0,verifyCalls=0;
 let actor={nativeVerified:true,isNpc:true,role:"trader",corporationID:CORP,
  stationID:STATION,playerControlled:false,inWarp:false,underAttack:false,
  activeNativeOrder:false};
 const initial={version:1,entries:{[CORP+":"+ORDER]:entry()}};
 fs.writeFileSync(file,JSON.stringify(initial));
 if(otherLock)fs.writeFileSync(lock,"existing-unknown-owner");
 const localEnv={...flags};
 if(!enabled)delete localEnv.EVEJS_COOP_NPC_BUY_RECOVERY_OPERATOR;
 const auditRecovery=()=>auditNativeNpcBuyerRecovery({
  journal:JSON.parse(fs.readFileSync(file,"utf8")),
  lockPresent:fs.existsSync(lock),
  inspectRustClaim:async()=>currentRust,
  listGameStoreReceipts:async()=>currentReceipt?[currentReceipt]:[]
 });
 const buyer={mode:"RUST_CLAIM_PLAYER_FULL_ESCROW",
  purchaseOnce:async data=>{
   buyerCalls++;
   assert.equal(data.claimKey,KEY);
   assert.equal(data.orderID,ORDER);
   assert.equal(data.sellerID,SELLER);
   if(failBuyer)throw Error("LOST_RUST_ACK_BEFORE_JOURNAL");
   currentRust=rust("filled");
   if(!currentReceipt)currentReceipt=receipt();
   return {status:"NPC_PURCHASED_PLAYER_GOODS",fillID:FILL,itemID:1990000200};
  }};
 const c=createNpcBuyerCoordinator({
  file,env:localEnv,buyer,clock:()=>1001000,
  authorizeRecoveryOperator:async values=>{verifyCalls++;
   return auth&&values.approvalID===ALLOW&&values.claimKey===KEY},
  auditRecovery,
  resolveActor:async()=>actor,
  readProof:async()=>{throw Error("REPLAY_MUST_NOT_MINT_NEW_DEMAND")},
  getOrder:async()=>({source:"player",state:currentRust?.state??"open",
   is_corp:false,bid:false,order_id:String(ORDER),owner_id:String(SELLER),
   station_id:STATION,type_id:TYPE,vol_remaining:currentRust?.state==="filled"?0:20,
   price:1.25})
 });
 const recover=action=>c.recoverApproved({actorID:111,approval:approval(action)});
 return {c,file,lock,recover,close:()=>fs.rmSync(dir,{recursive:true,force:true}),
  get buyerCalls(){return buyerCalls},get verifyCalls(){return verifyCalls},
  get rust(){return currentRust},get receipt(){return currentReceipt},
  setActor:v=>{actor=v},setRust:v=>{currentRust=v},
  setReceipt:v=>{currentReceipt=v},
  read:()=>JSON.parse(fs.readFileSync(file,"utf8"))};
}
async function run(fn,opts){
 const f=fixture(opts);try{return await fn(f)}finally{f.close()}
}
test("A-Life timer never auto-retries the persisted crash-left PREPARED key",()=>run(async f=>{
 const r=await f.c.tick({actorID:111,buyerCorpID:CORP,stationID:STATION,
  typeID:TYPE,maxUnitPriceCents:125,maxSpendCents:10000,minReserveCents:1000});
 assert.equal(r.reason,"NPC_BUY_PENDING_OPERATOR_RECOVERY");
 assert.equal(f.buyerCalls,0);
 assert.equal(f.read().entries[CORP+":"+ORDER].phase,"PREPARED");
}));
test("approved Rust claim not yet paid resumes GameStore with SAME key",()=>run(async f=>{
 const r=await f.recover("RESUME_GAMESTORE_SAME_CLAIM");
 assert.equal(r.status,"NPC_BUY_OPERATOR_RECOVERED");
 assert.equal(r.operation,KEY);assert.equal(f.buyerCalls,1);
 assert.equal(f.read().entries[CORP+":"+ORDER].phase,"SETTLED");
 assert.equal(f.rust.history_recorded,true);
}));
test("approved Rust claim explicitly missing retries SAME original key only",()=>run(async f=>{
 const r=await f.recover("RETRY_SAME_CLAIM");
 assert.equal(r.status,"NPC_BUY_OPERATOR_RECOVERED");
 assert.equal(r.operation,KEY);assert.equal(f.buyerCalls,1);
},{initialState:"missing"}));
test("approved already-paid GameStore only finalizes Rust (no second item transfer)",()=>run(async f=>{
 const r=await f.recover("FINALIZE_RUST_SAME_CLAIM");
 assert.equal(r.status,"NPC_BUY_OPERATOR_RECOVERED");
 assert.equal(f.buyerCalls,1);
 assert.deepEqual(f.receipt,receipt());
},{hasReceipt:true}));
test("FILLED+receipt only acknowledges durable journal; no wallet calls",()=>run(async f=>{
 const r=await f.recover("ACK_JOURNAL_SAME_CLAIM");
 assert.equal(r.status,"NPC_BUY_OPERATOR_RECOVERED");
 assert.equal(r.fillID,FILL);assert.equal(r.itemID,1990000200);
 assert.equal(f.buyerCalls,0);
 assert.equal(f.read().entries[CORP+":"+ORDER].phase,"SETTLED");
},{initialState:"filled",hasReceipt:true}));
test("second operator attempt cannot replay a completed journal",()=>run(async f=>{
 assert.equal((await f.recover("ACK_JOURNAL_SAME_CLAIM")).status,
  "NPC_BUY_OPERATOR_RECOVERED");
 assert.equal((await f.recover("ACK_JOURNAL_SAME_CLAIM")).reason,
  "NPC_BUY_RECOVERY_CLAIM_NOT_SINGLE_PENDING");
 assert.equal(f.buyerCalls,0);
},{initialState:"filled",hasReceipt:true}));
test("no explicit operator gate: no recovery, even with otherwise valid approval",()=>run(async f=>{
 assert.equal((await f.recover("RESUME_GAMESTORE_SAME_CLAIM")).reason,
  "NPC_BUY_RECOVERY_DISABLED");
 assert.equal(f.buyerCalls,0);
},{enabled:false}));
test("untrusted operator cannot issue a Rust or wallet write",()=>run(async f=>{
 assert.equal((await f.recover("RESUME_GAMESTORE_SAME_CLAIM")).reason,
  "NPC_BUY_RECOVERY_OPERATOR_DENIED");
 assert.equal(f.buyerCalls,0);
},{auth:false}));
test("wrong operator-selected action must match independently audited state",()=>run(async f=>{
 assert.equal((await f.recover("ACK_JOURNAL_SAME_CLAIM")).reason,
  "NPC_BUY_RECOVERY_AUDIT_DIVERGED");
 assert.equal(f.buyerCalls,0);
}));
test("pre-existing lock is never removed or bypassed by operator workflow",()=>run(async f=>{
 assert.equal((await f.recover("ACK_JOURNAL_SAME_CLAIM")).reason,
  "NPC_BUY_RECOVERY_LOCK_PRESENT");
 assert.equal(fs.readFileSync(f.lock,"utf8"),"existing-unknown-owner");
 assert.equal(f.buyerCalls,0);
},{otherLock:true,initialState:"filled",hasReceipt:true}));
test("real native actor changes into combat mode: no recovery transfer",()=>run(async f=>{
 f.setActor({nativeVerified:true,isNpc:true,role:"trader",
  corporationID:CORP,stationID:STATION,playerControlled:false,
  inWarp:false,underAttack:true,activeNativeOrder:false});
 assert.equal((await f.recover("RESUME_GAMESTORE_SAME_CLAIM")).reason,
  "NPC_BUY_RECOVERY_ACTOR_UNVERIFIED");
 assert.equal(f.buyerCalls,0);
}));
test("tax/owner receipt conflict cannot authorize a journal ACK",()=>run(async f=>{
 f.setReceipt({...receipt(),taxCents:201});
 assert.equal((await f.recover("ACK_JOURNAL_SAME_CLAIM")).reason,
  "NPC_BUY_RECOVERY_AUDIT_DIVERGED");
 assert.equal(f.buyerCalls,0);
},{initialState:"filled",hasReceipt:true}));
test("network/settlement failure keeps original PREPARED key and owned lock cleans up",()=>run(async f=>{
 await assert.rejects(f.recover("RESUME_GAMESTORE_SAME_CLAIM"),/LOST_RUST_ACK_BEFORE_JOURNAL/);
 assert.equal(f.read().entries[CORP+":"+ORDER].claimKey,KEY);
 assert.equal(f.read().entries[CORP+":"+ORDER].phase,"PREPARED");
 assert.equal(fs.existsSync(f.lock),false);
},{failBuyer:true}));
test("post-settlement audit mismatch prevents false SETTLED journal ACK",()=>run(async f=>{
 f.setRust({...rust("settling"),history_recorded:true});
 const r=await f.recover("RESUME_GAMESTORE_SAME_CLAIM");
 assert.equal(r.reason,"NPC_BUY_RECOVERY_AUDIT_DIVERGED");
 assert.equal(f.buyerCalls,0);
}));
test("missing operator metadata and mismatched key fail before lock or payment",()=>run(async f=>{
 const r=await f.c.recoverApproved({actorID:111,
  approval:{...approval("ACK_JOURNAL_SAME_CLAIM"),reason:"x"}});
 assert.equal(r.reason,"NPC_BUY_RECOVERY_APPROVAL_INVALID");
 assert.equal(f.buyerCalls,0);
 assert.equal(fs.existsSync(f.lock),false);
}));
