import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {auditNativeNpcBuyerRecovery}=require("../integration/coopNpcBuyerRecoveryAudit.cjs");
const K="npc-corpbuy:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const BUYER=1000010,ORDER=456,SELLER=90000001,STATION=60000001,FILL=930000000000001;
const entry=()=>({phase:"PREPARED",claimKey:K,buyerCorpID:BUYER,
 orderID:ORDER,sellerID:SELLER,stationID:STATION,typeID:34,
 quantity:20,unitPriceCents:125,minReserveCents:1000,createdAt:1000000});
const rust=(state="settling")=>({source:"player",state,
 fill_phase:state==="settling"?"claimed":"finalized",
 claim_key:K,is_corp:false,bid:false,fill_id:String(FILL),
 order_id:String(ORDER),buyer_corp_id:String(BUYER),
 owner_id:String(SELLER),station_id:STATION,type_id:34,
 quantity:20,price_cents:125,vol_remaining:state==="filled"?0:20,
 history_recorded:state==="filled",
 history_day:state==="filled"?"2026-10-25":null});
const receipt=()=>({phase:"NATIVE_NPC_BUY_COMMITTED",claimKey:K,
 fillID:FILL,orderID:ORDER,buyerCorpID:BUYER,sellerID:SELLER,
 stationID:STATION,typeID:34,itemID:1990000200,quantity:20,
 priceCents:125,grossCents:2500,taxCents:200,netCents:2300,
 taxPolicy:"EVEJS_NATIVE_MARKET_RULES",taxTransactionID:FILL+100000000000000,
 buyerBeforeCents:100000,buyerAfterCents:97500,
 sellerBeforeCents:10000,sellerAfterCents:12300,committedAt:1000001});
function fixture({state="settling",phase="PREPARED",
 rustClaim=rust(state),receipts=[],lockPresent=false,throws=false}={}){
 const e={...entry(),phase,fillID:FILL,itemID:1990000200};
 const journal={version:1,entries:{[BUYER+":"+ORDER]:e}};
 const before=structuredClone(journal);
 let reads=0,receiptsRead=0;
 const audit=()=>auditNativeNpcBuyerRecovery({
  journal,lockPresent,
  inspectRustClaim:async key=>{assert.equal(key,K);reads++;
   if(throws)throw Error("NETWORK_TIMEOUT");return rustClaim},
  listGameStoreReceipts:async key=>{assert.equal(key,K);
   receiptsRead++;return receipts}
 });
 return {audit,journal,before,get reads(){return reads},get receiptsRead(){return receiptsRead}};
}
const one=async(opts)=>((await fixture(opts).audit()).entries)[0];
test("journal PREPARED + authoritative Rust absence + no receipt: reuse SAME claim",async()=>{
 const f=fixture({rustClaim:null});const r=await f.audit();
 assert.equal(r.entries[0].status,"RETRY_SAME_CLAIM");
 assert.equal(r.entries[0].claimKey,K);assert.equal(r.changed,false);
 assert.deepEqual(f.journal,f.before);
});
test("Rust SETTLING without GameStore receipt: settle same durable claim",async()=>{
 assert.equal((await one()).status,"RESUME_GAMESTORE_SAME_CLAIM");
});
test("GameStore committed but Rust still SETTLING: finalize exactly same claim",async()=>{
 const r=await one({receipts:[receipt()]});
 assert.equal(r.status,"FINALIZE_RUST_SAME_CLAIM");
 assert.equal(r.fillID,FILL);
});
test("Rust FILLED + GameStore committed + PREPARED journal: ACK journal only",async()=>{
 const r=await one({state:"filled",receipts:[receipt()]});
 assert.equal(r.status,"ACK_JOURNAL_SAME_CLAIM");
 assert.equal(r.historyDay,"2026-10-25");
});
test("all 3 durable records SETTLED and with Rust history: no repair",async()=>{
 const r=await one({state:"filled",phase:"SETTLED",receipts:[receipt()]});
 assert.equal(r.status,"CONSISTENT");assert.equal(r.requiresOperator,false);
});
test("Rust already FILLED but GameStore receipt missing is a hard corruption",async()=>{
 assert.equal((await one({state:"filled"})).reason,
  "RUST_FINALIZED_WITHOUT_GAMESTORE_RECEIPT");
});
test("GameStore receipt without Rust claim is never treated as safe to retry",async()=>{
 assert.equal((await one({rustClaim:null,receipts:[receipt()]})).reason,
  "GAMESTORE_RECEIPT_WITHOUT_RUST_CLAIM");
});
test("different tax or seller receipt cannot authorize recovery",async()=>{
 for(const patch of [{taxCents:999},{sellerID:SELLER+1},{claimKey:"other"},
  {itemID:0},{grossCents:2600},{netCents:0}]){
  assert.equal((await one({receipts:[{...receipt(),...patch}]})).reason,
   "GAMESTORE_RECEIPT_IDENTITY_OR_TAX_CONFLICT");
 }
});
test("Rust altered owner/fill or missing history cannot pass",async()=>{
 for(const patch of [{owner_id:"90000002"},
  {quantity:19},{history_recorded:false},{history_day:null}]){
  const r=await one({state:"filled",rustClaim:{...rust("filled"),...patch},
   receipts:[receipt()]});
  assert.equal(r.reason,"RUST_CLAIM_IDENTITY_OR_HISTORY_CONFLICT");
 }
 const changedFill=await one({state:"filled",
  rustClaim:{...rust("filled"),fill_id:"930000000000002"},
  receipts:[receipt()]});
 assert.equal(changedFill.reason,"GAMESTORE_RECEIPT_IDENTITY_OR_TAX_CONFLICT");
});
test("transport exception never proves a durable Rust claim is absent",async()=>{
 assert.equal((await one({throws:true})).reason,"AUTHORITATIVE_DB_UNAVAILABLE");
});
test("two receipts with same claimKey cause manual hold",async()=>{
 assert.equal((await one({receipts:[receipt(),receipt()]})).reason,
  "GAMESTORE_RECEIPTS_AMBIGUOUS");
});
test("stale lock is reported, not removed or auto-reclaimed",async()=>{
 const f=fixture({state:"filled",phase:"SETTLED",
  receipts:[receipt()],lockPresent:true});
 const r=await f.audit();
 assert.equal(r.status,"LOCK_PRESENT_OPERATOR_REQUIRED");
 assert.equal(r.entries[0].status,"CONSISTENT");
 assert.equal(r.lockPresent,true);
 assert.deepEqual(f.journal,f.before);
});
test("SETTLED journal with missing Rust claim is never a green completed purchase",async()=>{
 assert.equal((await one({phase:"SETTLED",rustClaim:null})).reason,
  "JOURNAL_SETTLED_BUT_RUST_CLAIM_MISSING");
});
test("SETTLED journal with mismatching receipt itemID blocks operator recovery",async()=>{
 const f=fixture({state:"filled",phase:"SETTLED",receipts:[receipt()]});
 f.journal.entries[BUYER+":"+ORDER].itemID=123;
 assert.equal((await f.audit()).entries[0].reason,
  "SETTLED_JOURNAL_DIVERGED_FROM_NATIVE");
});
test("invalid journal, missing authorities and ambiguous phase fail closed",async()=>{
 await assert.rejects(auditNativeNpcBuyerRecovery({journal:{}}),
  /RECOVERY_AUTHORITIES_REQUIRED/);
 const f=fixture();
 f.journal.entries[BUYER+":"+ORDER].phase="FAKE";
 assert.equal((await f.audit()).entries[0].reason,"JOURNAL_IDENTITY_CONFLICT");
});

test("negative-net settlement receipt cannot authorize Rust finalization or journal ACK",async()=>{
 const bad={...receipt(),taxCents:2501,netCents:-1};
 for(const state of ["settling","filled"]){
  const r=await one({state,receipts:[bad]});
  assert.equal(r.status,"HOLD_MANUAL");
  assert.equal(r.reason,"GAMESTORE_RECEIPT_IDENTITY_OR_TAX_CONFLICT");
 }
});
test("duplicate durable claim key quarantines BOTH entries before querying any database",async()=>{
 const f=fixture({rustClaim:null});
 f.journal.entries[BUYER+":"+(ORDER+1)]={...entry(),orderID:ORDER+1};
 const r=await f.audit();
 assert.equal(r.status,"HOLD_MANUAL");
 assert.equal(r.entries.length,2);
 assert.deepEqual(r.entries.map(x=>x.reason),
  ["JOURNAL_IDENTITY_CONFLICT","JOURNAL_IDENTITY_CONFLICT"]);
 assert.equal(f.reads,0);
 assert.equal(f.receiptsRead,0);
});
test("recovery journal exceeding native purchase limits is not actionable",async()=>{
 for(const change of [
  {quantity:50001},
  {unitPriceCents:100000001},
  {quantity:50000,unitPriceCents:3000000}
 ]){
  const f=fixture({rustClaim:null});
  Object.assign(f.journal.entries[BUYER+":"+ORDER],change);
  const r=await f.audit();
  assert.equal(r.status,"HOLD_MANUAL");
  assert.equal(r.entries[0].reason,"JOURNAL_IDENTITY_CONFLICT");
  assert.equal(f.reads,0);
 }
});


test("paid Rust receipt with missing financial witnesses must never suggest finalization",async()=>{
 const {buyerBeforeCents,...incomplete}=receipt();
 for(const state of ["settling","filled"]){
  const r=await one({state,receipts:[incomplete]});
  assert.equal(r.status,"HOLD_MANUAL");
  assert.equal(r.reason,"GAMESTORE_RECEIPT_IDENTITY_OR_TAX_CONFLICT");
 }
});
test("buyer debit, seller net, tax ID or committed date corruption always blocks recovery",async()=>{
 const original=receipt();
 for(const corrupt of [
  {buyerAfterCents:original.buyerBeforeCents},
  {buyerBeforeCents:original.grossCents-1},
  {sellerAfterCents:original.sellerBeforeCents},
  {sellerBeforeCents:Number.MAX_SAFE_INTEGER},
  {taxTransactionID:null},
  {committedAt:0}
 ]){
  for(const state of ["settling","filled"]){
   const r=await one({state,receipts:[{...original,...corrupt}]});
   assert.equal(r.status,"HOLD_MANUAL");
   assert.equal(r.reason,"GAMESTORE_RECEIPT_IDENTITY_OR_TAX_CONFLICT");
  }
 }
});
test("zero-tax native corporate receipt needs no invented tax transaction ID",async()=>{
 const r=await one({receipts:[{...receipt(),taxCents:0,netCents:2500,
  sellerAfterCents:12500,taxTransactionID:null}]});
 assert.equal(r.status,"FINALIZE_RUST_SAME_CLAIM");
});
