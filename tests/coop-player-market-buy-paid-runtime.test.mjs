import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createAtomicRuntime}=require("../integration/coopPlayerMarketAtomicRuntime.cjs");
const ticket={orderID:"23",cycle:1};
const proof=Object.freeze({orderID:"23",bid:true,ownerID:201,counterpartyID:301,
 stationID:60001234,sellerSourceLocationID:60001234,typeID:34,
 volumeBefore:7,filledQuantity:3,volumeAfter:4,priceCents:1234});
const receipt={kind:"P2P_BUY_PAID",phase:"GAMESTORE_COMMITTED",
 key:"p2p:23:1",orderID:"23",cycle:1,buyerID:201,sellerID:301,
 quantity:3,priceCents:1234,grossCents:3702,itemID:800};
function fixture(overrides={}){
 const calls=[],push=x=>calls.push(x);
 const atomicBuyStore={
  settle:()=>{push("gameStore_COMMIT");return receipt},
  requireReceipt:()=>{push("gameStore_receipt_read");return receipt}
 };
 const rustAPI={
  details:()=>({order_id:"23",cycle:1,buyer_id:201,seller_id:301,
   volume_before:7,filled_quantity:3}),
  readClaim:async()=>{push("Rust_GetPlayerFillClaim");return {
   order_id:"23",cycle:1,phase:"claimed",buyer_id:201,seller_id:301,
   volume_before:7,filled_quantity:3,volume_after:4}},
  finalize:async()=>{push("Rust_FinalizePlayerFill_locked");return {release_pending:true}},
  release:async()=>{push("Rust_ReleasePlayerFill");return {phase:"released"}}
 };
 const journal={
  confirmRust:()=>push("journal_RUST_ACK"),
  complete:()=>push("journal_SETTLED"),
  requireSettled:()=>push("journal_readback")
 };
 return {calls,run:createAtomicRuntime({atomicBuyStore,rustAPI,journal,
  enabledFn:()=>true,...overrides}),atomicBuyStore,rustAPI,journal};
}
const args={ticket,proof,sourceItemID:800,tax:1,client:{call(){}}};
test("funded BUY payout commits native SQLite before Rust finalization and release",async()=>{
 const before=process.env.EVEJS_COOP_PLAYER_MARKET_BUY_RESERVE;
 process.env.EVEJS_COOP_PLAYER_MARKET_BUY_RESERVE="1";
 try{
 const x=fixture(),res=await x.run.settleBuy(args);
 assert.equal(res.receipt.key,"p2p:23:1");
 assert.equal(res.release.phase,"released");
 assert.deepEqual(x.calls,["Rust_GetPlayerFillClaim","gameStore_COMMIT",
  "Rust_FinalizePlayerFill_locked","journal_RUST_ACK",
  "journal_SETTLED","journal_readback",
  "gameStore_receipt_read","Rust_ReleasePlayerFill"]);
 }finally{if(before===undefined)delete process.env.EVEJS_COOP_PLAYER_MARKET_BUY_RESERVE;
 else process.env.EVEJS_COOP_PLAYER_MARKET_BUY_RESERVE=before}
});
test("lost native GameStore COMMIT reply never triggers Rust finalize or release",async()=>{
 const old=process.env.EVEJS_COOP_PLAYER_MARKET_BUY_RESERVE;
 process.env.EVEJS_COOP_PLAYER_MARKET_BUY_RESERVE="1";
 try{
 const x=fixture({atomicBuyStore:{
  settle:()=>{throw Error("NATIVE_SQLITE_COMMIT_OUTCOME_UNKNOWN")}}});
 await assert.rejects(x.run.settleBuy(args),/COMMIT_OUTCOME_UNKNOWN/);
 assert.deepEqual(x.calls,["Rust_GetPlayerFillClaim"]);
 }finally{if(old===undefined)delete process.env.EVEJS_COOP_PLAYER_MARKET_BUY_RESERVE;else process.env.EVEJS_COOP_PLAYER_MARKET_BUY_RESERVE=old}
});
test("unverified Rust claim never pays a seller from native BUY reserve",async()=>{
 const old=process.env.EVEJS_COOP_PLAYER_MARKET_BUY_RESERVE;
 process.env.EVEJS_COOP_PLAYER_MARKET_BUY_RESERVE="1";
 try{
 const x=fixture({rustAPI:{...fixture().rustAPI,
  readClaim:async()=>({...await fixture().rustAPI.readClaim(),buyer_id:999})}});
 await assert.rejects(x.run.settleBuy(args),/ORIGINAL_RUST_CLAIM_NOT_VERIFIED/);
 assert.equal(x.calls.includes("gameStore_COMMIT"),false);
 assert.equal(x.calls.includes("Rust_ReleasePlayerFill"),false);
 }finally{if(old===undefined)delete process.env.EVEJS_COOP_PLAYER_MARKET_BUY_RESERVE;else process.env.EVEJS_COOP_PLAYER_MARKET_BUY_RESERVE=old}
});
test("already-paid duplicate native receipt blocks second Rust finalize/release",async()=>{
 const old=process.env.EVEJS_COOP_PLAYER_MARKET_BUY_RESERVE;
 process.env.EVEJS_COOP_PLAYER_MARKET_BUY_RESERVE="1";
 try{
 const x=fixture({atomicBuyStore:{settle:()=>({...receipt,replayed:true})}});
 await assert.rejects(x.run.settleBuy(args),/REPLAY_REQUIRES_RECONCILIATION/);
 assert.deepEqual(x.calls,["Rust_GetPlayerFillClaim"]);
 }finally{if(old===undefined)delete process.env.EVEJS_COOP_PLAYER_MARKET_BUY_RESERVE;else process.env.EVEJS_COOP_PLAYER_MARKET_BUY_RESERVE=old}
});
test("BUY payout remains OFF without explicit reserve flag",async()=>{
 const old=process.env.EVEJS_COOP_PLAYER_MARKET_BUY_RESERVE;
 delete process.env.EVEJS_COOP_PLAYER_MARKET_BUY_RESERVE;
 try{
 const x=fixture();
 await assert.rejects(x.run.settleBuy(args),/STRICT_FLAGS_REQUIRED/);
 assert.deepEqual(x.calls,[]);
 }finally{if(old!==undefined)process.env.EVEJS_COOP_PLAYER_MARKET_BUY_RESERVE=old}
});
