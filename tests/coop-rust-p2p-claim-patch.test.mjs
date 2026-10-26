import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {patch,TYPES,ARMS,INCLUDE,STOCK_GUARD,PIN}=
 require("../scripts/coop-rust-p2p-claim-patch.cjs");
const rpc=[
 'use serde::{Deserialize, Serialize};',
 '#[derive(Debug, Deserialize)]',
 'struct RpcRequest {',
 '    id:Value,',
 '}',
 'async fn dispatch_request(method:&str)->Result<()> {',
 '    match method {',
 '        "FillOrder" => {',
 '            Ok(())',
 '        }',
 '    }',
 '}',
 ''
].join("\n");
const state=[
 'fn fill_order_in_db(database_path: &Path, request: FillOrderRequest) -> Result<FillOrderResponse> {',
 '    let mut connection = load_connection(database_path)?;',
 '    let transaction = connection.transaction()?;',
 '    if let Some((station_id, type_id)) = try_decode_seed_buy_order_id(request.order_id) {',
 '        bail!("seed");',
 '    }',
 '    Ok(())',
 '}',
 'fn expire_due_orders_in_db() {}',
 ''
].join("\n");
for(const eol of ["\n","\r\n"])test("pinned Rust source patch idempotent and byte reversible "+JSON.stringify(eol),()=>{
 for(const [input,which] of [[rpc,"rpc"],[state,"state"]]){
  const raw=input.replaceAll("\n",eol),once=patch(raw,which,false);
  assert.notEqual(once,raw);
  assert.equal(patch(once,which,false),once);
  assert.equal(patch(once,which,true),raw);
 }
});
test("Rust RPC exposes claim, finalize and read-only reconciliation query",()=>{
 const out=patch(rpc,"rpc");
 assert.match(out,/ClaimPlayerFill/);
 assert.match(out,/FinalizePlayerFill/);
 assert.match(out,/GetPlayerFillClaim/);
 assert.match(out,/deserializer_with_this_does_not_exist|deserialize_with="string_i64::deserialize"/);
 assert.equal(out.includes(TYPES)&&out.includes(ARMS),true);
});
test("stock Rust FillOrder refuses player order only under exact feature flag",()=>{
 const out=patch(state,"state");
 assert.ok(out.includes(STOCK_GUARD));
 assert.match(out,/EVEJS_COOP_RUST_P2P_CLAIM/);
 assert.match(out,/P2P_RUST_PLAYER_ORDER_REQUIRES_IDEMPOTENT_CLAIM/);
 assert.ok(out.includes(INCLUDE));
});
test("unexpected pinned Rust source refuses to insert a speculative hook",()=>{
 assert.throws(()=>patch("fn fill_order_in_db() {}", "state"),/METHOD_DRIFT/);
 assert.throws(()=>patch("struct WrongRpc {}","rpc"),/ANCHOR_DRIFT/);
});
test("cannot duplicate Rust source hooks without detection",()=>{
 const once=patch(rpc,"rpc");
 assert.throws(()=>patch(once+TYPES,"rpc"),/DUPLICATE_PATCH/);
});
test("source patch pin remains exact upstream hash",()=>{
 assert.equal(PIN,"c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f");
});
