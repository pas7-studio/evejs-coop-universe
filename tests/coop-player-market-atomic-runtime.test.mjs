import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createAtomicRuntime}=require("../integration/coopPlayerMarketAtomicRuntime.cjs");
const ticket={orderID:"23",cycle:1};
const proof=Object.freeze({
 orderID:"23",ownerID:201,counterpartyID:301,bid:false,
 stationID:60001234,typeID:34,priceCents:1234,
 volumeBefore:7,filledQuantity:7,volumeAfter:0,
 sellerSourceLocationID:9200000023});
const receipt={key:"p2p:23:1",phase:"GAMESTORE_COMMITTED",
 orderID:"23",cycle:1,buyerID:301,sellerID:201,
 quantity:7,priceCents:1234,grossCents:8638};
function harness(overrides={}){
 const calls=[],push=name=>calls.push(name);
 const atomicStore={
  settle:()=>{push("atomic_commit");return receipt},
  requireReceipt:()=>{push("durable_sqlite_receipt");return receipt}};
 const rustAPI={
  details:()=>({order_id:"23",cycle:1,buyer_id:301,seller_id:201,
   volume_before:7,filled_quantity:7}),
  readClaim:async()=>{push("rust_claim_inspect");return {
   order_id:"23",cycle:1,buyer_id:301,seller_id:201,phase:"claimed",
   volume_before:7,filled_quantity:7,volume_after:0}},
  finalize:async()=>{push("rust_finalize_locked");return {release_pending:true}},
  release:async()=>{push("rust_release");return {phase:"released"}}};
 const journal={
  confirmRust:()=>push("journal_rust_ack"),
  complete:()=>push("journal_settled"),
  requireSettled:()=>push("journal_durable_read")};
 return {calls,atomicStore,rustAPI,journal,
  run:createAtomicRuntime({atomicStore,rustAPI,journal,enabledFn:()=>true,...overrides})};
}
test("native GameStore commit precedes Rust finalize and post-journal release",async()=>{
 const x=harness();
 const result=await x.run.settleSell({ticket,proof,tax:1.23,sourceItemID:800,client:{call(){}}});
 assert.equal(result.release.phase,"released");
 assert.deepEqual(x.calls,["rust_claim_inspect","atomic_commit",
  "rust_finalize_locked","journal_rust_ack","journal_settled",
  "journal_durable_read","durable_sqlite_receipt","rust_release"]);
});
test("Rust claim mismatch stops before any native SQLite transaction",async()=>{
 const x=harness({rustAPI:{...harness().rustAPI,
  readClaim:async()=>({order_id:"23",cycle:1,phase:"finalized"})}});
 await assert.rejects(x.run.settleSell({ticket,proof,tax:1.23,sourceItemID:800,client:{call(){}}}),
  /ORIGINAL_RUST_CLAIM_NOT_VERIFIED/);
 assert.deepEqual(x.calls,[]);
});
test("native SQLite commit failure never calls Rust finalize or release",async()=>{
 const x=harness({atomicStore:{...harness().atomicStore,
  settle:()=>{throw Error("NATIVE_SQLITE_COMMIT_OUTCOME_UNKNOWN")}}});
 await assert.rejects(x.run.settleSell({ticket,proof,tax:1.23,sourceItemID:800,client:{call(){}}}),
  /COMMIT_OUTCOME_UNKNOWN/);
 assert.deepEqual(x.calls,["rust_claim_inspect"]);
});
test("uncertain Rust finalize cannot unlock a protected market order",async()=>{
 const x=harness({rustAPI:{...harness().rustAPI,
  finalize:async()=>{throw Error("lost finalize response")}}});
 await assert.rejects(x.run.settleSell({ticket,proof,tax:1.23,sourceItemID:800,client:{call(){}}}),
  /lost finalize response/);
 assert.deepEqual(x.calls,["rust_claim_inspect","atomic_commit"]);
});
test("missing journal SETTLED prevents any Rust release",async()=>{
 const x=harness({journal:{...harness().journal,
  requireSettled:()=>{throw Error("P2P_SETTLEMENT_DURABLE_RECEIPT_NOT_SETTLED")}}});
 await assert.rejects(x.run.settleSell({ticket,proof,tax:1.23,sourceItemID:800,client:{call(){}}}),
  /DURABLE_RECEIPT_NOT_SETTLED/);
 assert.equal(x.calls.includes("rust_release"),false);
});
test("previously committed replay requires operator reconciliation",async()=>{
 const x=harness({atomicStore:{...harness().atomicStore,
  settle:()=>({...receipt,replayed:true})}});
 await assert.rejects(x.run.settleSell({ticket,proof,tax:1.23,sourceItemID:800,client:{call(){}}}),
  /REPLAY_REQUIRES_RECONCILIATION/);
 assert.equal(x.calls.includes("rust_release"),false);
});
