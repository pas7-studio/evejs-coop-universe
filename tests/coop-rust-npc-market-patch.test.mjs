import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {patch}=require("../scripts/coop-rust-npc-pending-patch.cjs");
const rpc=`use anyhow::{Context,Result};
#[derive(Debug, Deserialize)]
struct RpcRequest { id: Value }
async fn dispatch_request() {
    match method {
        "ModifyOrder" => {}
    }
}`;
const state=`use anyhow::Result;
fn insert_order(request:PlaceOrderRequest) {
    let source = request.source.unwrap_or_else(|| "player".to_string());
    let wallet_division = request.wallet_division.unwrap_or(1000);
}`;
for(const [type,src] of [["rpc",rpc],["state",state]]){
 for(const eol of ["LF","CRLF"]){
  test(type+" reversible "+eol+" exact roundtrip",()=>{
   const pristine=eol==="CRLF"?src.replace(/\n/g,"\r\n"):src;
   const after=patch(pristine,type);
   assert.notEqual(after,pristine);
   assert.equal(patch(after,type,true),pristine);
   if(eol==="CRLF")assert.equal(after.replace(/\r\n/g,"").includes("\n"),false);
  });
 }
}
test("Rust activation blocked until real player-buy settlement",()=>{
 const source=fs.readFileSync(require.resolve("../rust/coop_npc_market_pending.rs"),"utf8");
 assert.match(source,/EVEJS_COOP_RUST_NPC_BUY_SETTLEMENT/);
 assert.match(source,/NPC player-buy settlement not activated/);
 assert.match(source,/state='pending'/);
 assert.match(source,/state='open'/);
});
test("ordinary PlaceOrder cannot forge unbacked coop-npc source",()=>{
 const after=patch(state,"state");
 assert.match(after,/source\.starts_with\("coop-npc"\)/);
});
test("patch fails closed on changed pinned source",()=>{
 assert.throws(()=>patch("unrelated Rust source","rpc"),/RUST_SOURCE_ANCHOR_MISMATCH/);
 assert.throws(()=>patch("unrelated Rust source","state"),/RUST_SOURCE_ANCHOR_MISMATCH/);
});
test("second application is rejected",()=>{
 assert.throws(()=>patch(patch(rpc,"rpc"),"rpc"),/RUST_RPC_ALREADY_PATCHED/);
});
test("Rust reservation identity is unique in all three dimensions",()=>{
 const source=fs.readFileSync(require.resolve("../rust/coop_npc_market_pending.rs"),"utf8");
 assert.match(source,/operation_id TEXT PRIMARY KEY/);
 assert.match(source,/source_item_id INTEGER UNIQUE/);
 assert.match(source,/order_id INTEGER UNIQUE/);
});

test("native Rust order inspection exposes remaining volume for COOP-035 finalize",()=>{
 const source=fs.readFileSync(require.resolve("../rust/coop_npc_market_pending.rs"),"utf8");
 assert.match(source,/o\\.vol_remaining/);
 assert.match(source,/"vol_remaining":remaining/);
});
