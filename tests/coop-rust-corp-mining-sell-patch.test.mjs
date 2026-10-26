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
  "fn modify_order_in_db(",
  "    let mut connection = load_connection(database_path)?;",
  "    let transaction = connection.transaction()?;",
  "}",
  "fn cancel_order_in_db(",
  "    let mut connection = load_connection(database_path)?;",
  "    let transaction = connection.transaction()?;",
  "}",
  "fn fill_order_in_db(database_path: &Path, request: FillOrderRequest) -> Result<FillOrderResponse> {",
  "    let mut connection = load_connection(database_path)?;",
  "    let transaction = connection.transaction()?;",
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
test("corporate Rust buyer quote and cancellation RPC params derive Deserialize exactly once",()=>{
 const installed=patch(rpc,"rpc");
 for(const name of ["CoopCorpBuyerQuoteParams","CoopCorpCancelParams"]){
  const marker="#[derive(Debug,Deserialize)]\nstruct "+name+" {";
  assert.equal(installed.split(marker).length,2,name);
 }
 assert.equal(installed.includes(
  "#[derive(Debug,Deserialize)]\n#[derive(Debug,Deserialize)]"),false);
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
test("private corporate SELL publish requires all settlement gates and original physical escrow",()=>{
 const publish=extension.slice(extension.indexOf("fn coop_corp_sell_publish_db("),
  extension.indexOf("impl MarketRuntime{",extension.indexOf("fn coop_corp_sell_publish_db(")));
 for(const flag of ["EVEJS_COOP_RUST_CORP_PUBLISH",
  "EVEJS_COOP_RUST_CORP_BUYER_QUOTE",
  "EVEJS_COOP_RUST_CORP_FILL_CLAIM","EVEJS_COOP_RUST_CORP_CANCEL"])
  assert.ok(publish.includes(flag),flag);
 assert.match(publish,/coop_corp_sell_verify_escrow\(&tx,op\)/);
 assert.match(publish,/CORP_SELL_PUBLISH_DURABLE_CUSTODY_NOT_VERIFIED/);
 assert.match(publish,/UPDATE market_orders SET state='open'/);
 assert.match(publish,/CORP_SELL_PUBLISH_ORDER_CAS_FAILED/);
 assert.match(publish,/CORP_SELL_PUBLISH_SOURCE_CAS_FAILED/);
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
test("corporate publish is private, source-guarded and invalidates orderbook caches",()=>{
 const publish=extension.slice(extension.indexOf("fn coop_corp_sell_publish_db("),
  extension.indexOf("impl MarketRuntime{",extension.indexOf("fn coop_corp_sell_publish_db(")));
 assert.match(publish,/CORP_SELL_PUBLISH_PIPELINE_NOT_ARMED/);
 assert.match(publish,/CORP_SELL_PUBLISH_ORDER_ALREADY_LOCKED_OR_CANCELLED/);
 assert.match(publish,/state='prepared'/);
 assert.match(publish,/source='coop-corporation'/);
 assert.match(extension,/corporate sell publish failed/);
 assert.match(extension,/self.invalidate_scope_caches\(row.row.region_id/);
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

test("stock market fill/modify/cancel cannot silently execute corporation-owned ore",()=>{
 const source=[
  "fn modify_order_in_db(",
  "    let mut connection = load_connection(database_path)?;",
  "    let transaction = connection.transaction()?;",
  "}",
  "fn cancel_order_in_db(",
  "    let mut connection = load_connection(database_path)?;",
  "    let transaction = connection.transaction()?;",
  "}",
  "fn fill_order_in_db(database_path: &Path, request: FillOrderRequest) -> Result<FillOrderResponse> {",
  "    let mut connection = load_connection(database_path)?;",
  "    let transaction = connection.transaction()?;",
  "}",
  "    let wallet_division = request.wallet_division.unwrap_or(1000);",
  ""
 ].join("\n");
 const once=patch(source,"state");
 for(const operation of ["FILL","MODIFY","CANCEL"]){
  assert.match(once,new RegExp("CORP_SELL_STOCK_"+operation+"_DENIED"));
  assert.match(once,new RegExp("CORPORATE ORDER STOCK "+operation+" GUARD BEGIN"));
 }
 assert.equal(patch(once,"state",true),source);
 assert.equal(patch(once,"state"),once);
});
test("Rust corporate partial cancellation requires released fills and exclusive order lock",()=>{
 for(const proof of [
 "fn coop_corp_cancel_lock_db",
 "CORP_CANCEL_UNSETTLED_OR_ACTIVE_FILL",
 "CORP_CANCEL_NONCONTIGUOUS_FILLS",
 "state='cancelling'",
 "phase='released'",
 "coop_corp_sell_cancel_intents",
 "CORP_CANCEL_EXCLUSIVE_ORDER_LOCK_FAILED"])
 assert.ok(extension.includes(proof),proof);
});
test("Rust finalizes original corporate cancellation only after native physical item return",()=>{
 for(const proof of [
 "fn coop_corp_cancel_finalize_db",
 "fn coop_corp_cancel_verify_return",
 '"RETURNED_UNSOLD"',
 '"returnedQuantity"',
 '"remainingQuantity"',
 '"sourceItemIDs"',
 '"customInfo"',
 "CORP_CANCEL_ORIGINAL_UNSOLD_ITEM_NOT_RETURNED",
 "CORP_CANCEL_ORDER_CAS_FAILED"])
 assert.ok(extension.includes(proof),proof);
});
test("Rust corporate private cancellation RPCs are separate from stock CancelOrder",()=>{
 const source=patch(rpc,"rpc");
 for(const method of ["LockCorpSellCancel","GetCorpSellCancel","FinalizeCorpSellCancel"])
  assert.ok(source.includes('"'+method+'"'),method);
 assert.match(source,/struct CoopCorpCancelParams/);
});
test("Rust corporate publication cannot run without explicit operational gates; stock FillOrder remains denied",()=>{
 const source=patch(state,"state");
 assert.match(source,/CORP_SELL_STOCK_FILL_DENIED/);
 const body=extension.slice(extension.indexOf("fn coop_corp_sell_publish_db("),
  extension.indexOf("impl MarketRuntime{",extension.indexOf("fn coop_corp_sell_publish_db(")));
 assert.match(body,/EVEJS_COOP_RUST_CORP_PUBLISH/);
 assert.match(body,/CORP_SELL_PUBLISH_PIPELINE_NOT_ARMED/);
});

test("Rust private original corporate buyer quote is authenticated, read-only and default-off",()=>{
 for(const s of ["fn coop_corp_buyer_quote_db",
  "EVEJS_COOP_RUST_CORP_BUYER_QUOTE","GetCorpBuyerQuote",
  "CORP_BUYER_REAL_FUNDS_MISSING","CORP_BUYER_ESCROW_OR_TITLE_DRIFT",
  "ELIGIBLE_NOT_RESERVED","buyerFundsReserved"])
   if(s==="GetCorpBuyerQuote")assert.match(patch(rpc,"rpc"),/GetCorpBuyerQuote/);
   else assert.ok(extension.includes(s),s);
});
test("Rust buyer quote verifies source market price, quantity, original physical item and ISK",()=>{
 const s=extension.slice(extension.indexOf("fn coop_corp_buyer_quote_db("));
 for(const marker of ["m.vol_remaining,m.price,p.quantity",
   "price as f64","coop_corp_fill_signed_cents",
   'coop_corp_sell_json(&gs,"marketEscrow"',
   'coop_corp_sell_json(&gs,"items"',
   'coop_corp_sell_json(&gs,"characters"',
   "coop-warehouse:v1:cargo:"])
   assert.ok(s.includes(marker),marker);
});
test("Rust buyer quote cannot publish SELL or commit wallet debits by itself",()=>{
 const s=extension.slice(extension.indexOf("fn coop_corp_buyer_quote_db("));
 assert.doesNotMatch(s,/UPDATE market_orders/);
 assert.doesNotMatch(s,/tx\.put/);
 assert.match(s,/"nativeMutation":false/);
 assert.match(s,/"buyerFundsReserved":false/);
});
