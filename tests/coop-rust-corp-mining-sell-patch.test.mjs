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
 const publish=extension.slice(extension.indexOf("fn coop_corp_sell_publish_db("),
  extension.indexOf("impl MarketRuntime{",extension.indexOf("fn coop_corp_sell_publish_db(")));
 assert.ok(!publish.includes("state='open'"));
 assert.ok(!publish.includes("state = 'open'"));
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

test("corporate Rust claim-only interface adds private authenticated RPC methods",()=>{
 const installed=patch(rpc,"rpc");
 assert.match(installed,/"ClaimCorpFill" =>/);
 assert.match(installed,/"GetCorpFillClaim" =>/);
 assert.match(installed,/struct CoopCorpFillClaimParams/);
 assert.match(installed,/struct CoopCorpFillQueryParams/);
});
test("Rust corporate fill requires published original corporate order and exact price",()=>{
 assert.match(extension,/fn coop_corp_fill_claim_db/);
 assert.match(extension,/publish_phase!="published"/);
 assert.match(extension,/source!="coop-corporation"/);
 assert.match(extension,/state!="open"/);
 assert.match(extension,/native_cents\.round\(\) as i64!=price_cents/);
});
test("Rust private claim CAS isolates market order and preserves single in-flight fill",()=>{
 assert.match(extension,/CREATE UNIQUE INDEX IF NOT EXISTS coop_corp_sell_active_claim/);
 assert.match(extension,/WHERE phase='claimed'/);
 assert.match(extension,/UPDATE market_orders SET state='settling'/);
 assert.match(extension,/vol_remaining=\?3/);
 assert.match(extension,/CORP_FILL_EXCLUSIVE_LOCK_FAILED/);
});
test("Rust E2B4 finalizes and releases only after independent durable native GameStore proof",()=>{
 assert.match(extension,/EVEJS_COOP_RUST_CORP_FILL_CLAIM/);
 assert.match(extension,/fn coop_corp_fill_finalize_db/);
 assert.match(extension,/fn coop_corp_fill_release_db/);
 assert.match(extension,/coop_corp_fill_game_store_witness\(&witness\)/);
 assert.match(extension,/coop_corp_fill_audit\(&original,claim_proof\)/);
 assert.match(extension,/CORP_FILL_RELEASE_DURABLE_PAYMENT_NO_LONGER_VERIFIED/);
 assert.match(extension,/UPDATE market_orders SET state=\?3,updated_at=\?4/);
});

test("private Rust fill finalize and release RPCs use server token and exact order cycle",()=>{
 const installed=patch(rpc,"rpc");
 assert.match(installed,/"FinalizeCorpFill" =>/);
 assert.match(installed,/"ReleaseCorpFill" =>/);
 assert.match(installed,/runtime\.coop_corp_fill_finalize\(p.access_token,p.order_id,p.cycle\)/);
 assert.match(installed,/runtime\.coop_corp_fill_release\(p.access_token,p.order_id,p.cycle\)/);
});
test("independent read-only GameStore audit checks both wallet journals and delivered physical item",()=>{
 for(const witness of [
 "coop_corp_fill_signed_cents",'"buyerJournalID"', '"sellerJournalID"',
 '"feeJournalID"','"walletJournal"','"transactions"',
 '"deliveredItemID"','"sourceCargoID"','"sourceItemID"',
 '"remainingQuantity"','"lastSettledCycle"','native_receipt_key'])
  assert.ok(extension.includes(witness),witness);
 assert.match(extension,/CORP_FILL_ORIGINAL_WALLET_DEBIT_CREDIT_NOT_FOUND/);
 assert.match(extension,/CORP_FILL_ORIGINAL_MARKET_FEES_NOT_DEBITED/);
 assert.match(extension,/CORP_FILL_PARTIAL_ORIGINAL_REMAINDER_NOT_PRESERVED/);
});
test("no public corporate sale can be published before verified native full lifecycle",()=>{
 const publish=extension.slice(extension.indexOf("fn coop_corp_sell_publish_db("),
  extension.indexOf("impl MarketRuntime{",extension.indexOf("fn coop_corp_sell_publish_db(")));
 assert.match(publish,/CORP_SELL_NATIVE_FILL_SETTLEMENT_NOT_IMPLEMENTED/);
 assert.doesNotMatch(publish,/UPDATE market_orders/);
});

test("Rust private GetCorpFillClaim can inspect all durable claim phases after restart",()=>{
 assert.match(extension,/fn coop_corp_fill_inspect_db/);
 assert.match(extension,/state\.0=="claimed"/);
 assert.match(extension,/\["finalized","released"\]/);
 assert.match(extension,/CORP_FILL_GET_PERSISTED_ACK_MISMATCH/);
});
test("Rust finalization caches exact GameStore verified ACK and repeats do not double-spend",()=>{
 const f=extension.slice(extension.indexOf("fn coop_corp_fill_finalize_db("),
  extension.indexOf("fn coop_corp_fill_release_db("));
 assert.match(f,/phase=="finalized"\|\|phase=="released"/);
 assert.match(f,/ack_json/);
 assert.match(f,/coop_corp_fill_game_store_witness\(&witness\)/);
 assert.match(f,/CORP_FILL_FINALIZE_ORDER_CAS_FAILED/);
 assert.match(f,/CORP_FILL_FINALIZE_RECEIPT_CAS_FAILED/);
});
test("release remains locked until finalized original GameStore settlement",()=>{
 const f=extension.slice(extension.indexOf("fn coop_corp_fill_release_db("),
  extension.indexOf("impl MarketRuntime{",extension.indexOf("fn coop_corp_fill_release_db(")));
 assert.match(f,/phase!="finalized"/);
 assert.match(f,/coop_corp_fill_audit\(&original,claim_proof\)/);
 assert.match(f,/state='settling'/);
 assert.match(f,/phase='released'/);
 assert.match(f,/CORP_FILL_RELEASE_DURABLE_PAYMENT_NO_LONGER_VERIFIED/);
});
