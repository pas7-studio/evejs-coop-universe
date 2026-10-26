import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {readFileSync} from "node:fs";
import {join} from "node:path";
const require=createRequire(import.meta.url);
const {patch,PIN,TYPES,ARMS,GUARD,INCLUDE}=require(
 "../scripts/coop-rust-corp-mining-sell-patch.cjs");
const extension=readFileSync(join(import.meta.dirname,"../rust/coop_corp_mining_sell.rs"),"utf8");
const rpc=[
  "use serde::{Deserialize};",
  "#[derive(Debug, Deserialize)]",
  "struct RpcRequest { id: serde_json::Value }",
  "fn dispatch(method:&str) {",
  "match method {",
  '        "ModifyOrder" => {},',
  '        _=>{}',
  "}",
  "}",
  ""
].join("\n");
const state=[
  "fn insert_order(request: PlaceOrderRequest) {",
  '    let source = request.source.unwrap_or_else(|| "player".to_string());',
  '    let wallet_division = request.wallet_division.unwrap_or(1000);',
  "}",
  ""
].join("\n");
test("original Rust corp SELL RPC patch is idempotent and reversible",()=>{
 for(const which of ["state","rpc"]){
  const original=which==="state"?state:rpc;
  const after=patch(original,which);
  assert.equal(patch(after,which),after);
  assert.equal(patch(after,which,true),original);
 }
});
test("original Rust overlay handles CRLF without changing bytes on uninstall",()=>{
 for(const which of ["state","rpc"]){
  const src=(which==="state"?state:rpc).replaceAll("\n","\r\n");
  assert.equal(patch(patch(src,which),which,true),src);
 }
});
test("Rust client cannot use normal PlaceOrder to forge coop-corporation stock",()=>{
 const installed=patch(state,"state");
 assert.ok(installed.includes(GUARD));
 assert.ok(installed.indexOf(GUARD)<installed.indexOf("let wallet_division"));
});
test("new private corporate RPC methods do not rewrite stock FillOrder or GetOrder",()=>{
 const installed=patch(rpc,"rpc");
 assert.ok(installed.includes(TYPES));assert.ok(installed.includes(ARMS));
 for(const method of ["PrepareCorpSell","GetCorpSell",
  "VerifyCorpSellEscrow","PublishCorpSell"])
  assert.ok(installed.includes('"'+method+'"'));
 assert.ok(!installed.includes('"FillOrder" =>'));
});
test("published corporate orders are categorically unavailable until native settlement",()=>{
 assert.match(extension,/CORP_SELL_NATIVE_FILL_SETTLEMENT_NOT_IMPLEMENTED/);
 assert.match(extension,/fn coop_corp_sell_publish_db/);
 assert.ok(!extension.includes("state='open'"));
 assert.ok(!extension.includes("state = 'open'"));
});
test("Rust verifies exact same physical corporate stock and GameStore receipt before any publish",()=>{
 for(const term of ["SQLITE_OPEN_READ_ONLY","coopPlayerMiningCorpSell",
  'coop_corp_sell_json(&origin,"items"',
  'coop_corp_sell_json(&origin,"marketEscrow"',
  'receipt["escrowLocationID"]',
  'physical["ownerID"]',
  'physical["customInfo"]',
  'escrow["sourceItemIDs"]',
  'escrow["remainingQuantity"]'])
  assert.ok(extension.includes(term),term);
});
test("Rust private prepare is unique per source item, cargo ID and order",()=>{
 assert.match(extension,/operation_id TEXT PRIMARY KEY/);
 assert.match(extension,/cargo_id INTEGER UNIQUE/);
 assert.match(extension,/item_id INTEGER UNIQUE/);
 assert.match(extension,/order_id INTEGER UNIQUE/);
 assert.match(extension,/'prepared','published','cancelled'/);
});
test("Rust corporate RPC is guarded by server-held token and separate feature",()=>{
 assert.match(extension,/EVEJS_COOP_RUST_CORP_SELL_PREPARE/);
 assert.match(extension,/EVEJS_COOP_RUST_CORP_SELL_TOKEN/);
 assert.match(extension,/secret\.len\(\)<32/);
 assert.match(extension,/CORP_SELL_SERVER_TOKEN_DENIED/);
});
test("Rust pinned revision and explicit extension source path stay stable",()=>{
 assert.equal(PIN,"c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f");
 assert.match(INCLUDE,/include!\("coop_corp_mining_sell\.rs"\)/);
});
test("Rust patch fails closed when pinned source markers are absent",()=>{
 assert.throws(()=>patch("unknown source","state"),/CORP_RUST_PINNED_ANCHOR_DRIFT/);
 assert.throws(()=>patch("unknown source","rpc"),/CORP_RUST_PINNED_ANCHOR_DRIFT/);
});
