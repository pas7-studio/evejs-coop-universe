import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {patch}=require("../scripts/coop-rust-npc-settlement-patch.cjs");
const {patch:prior}=require("../scripts/coop-rust-npc-pending-patch.cjs");
const RPC=`#[derive(Debug, Deserialize)]
struct RpcRequest {}
fn handler(){
    match rpc {
        "ModifyOrder" => {}
    }
}`;
const STATE=`fn modify_order_in_db(transaction:&Transaction,request:ModifyOrderRequest){
    let scope = transaction
        .query_row(
            "SELECT region_id, solar_system_id, station_id, type_id, bid, vol_remaining, state
}
fn cancel_order_in_db(transaction:&Transaction,order_id:i64){
    let scope = transaction
        .query_row(
            "SELECT state FROM market_orders WHERE order_id = ?1",
}
fn fill_order_in_db(transaction:&Transaction,request:FillOrderRequest){
    let scope = transaction
        .query_row(
            "SELECT owner_id, is_corp, region_id, solar_system_id, station_id, type_id, bid, price,
}
fn insert_order(request:PlaceOrderRequest){
    let source = request.source.unwrap_or_else(|| "player".to_string());
    let wallet_division = request.wallet_division.unwrap_or(1000);
}`;
for(const [kind,source] of [["rpc",RPC],["state",STATE]]){
 for(const eol of ["LF","CRLF"]){
  test("Rust "+kind+" settlement patch is reversible over COOP-034 ("+eol+")",()=>{
   const origin=eol==="LF"?source:source.replace(/\n/g,"\r\n");
   const old=prior(origin,kind),next=patch(old,kind);
   assert.equal(patch(next,kind,true),old);
   assert.equal(prior(old,kind,true),origin);
  });
 }
}
test("stock Rust FillOrder cannot bypass the NPC buyer claim",()=>{
 const source=patch(prior(STATE,"state"),"state");
 assert.match(source,/COOP_NPC_CORPORATE_ORDER_REQUIRES_CLAIM_FINALIZE/);
 assert.match(source,/source FROM market_orders WHERE order_id/);
 assert.match(source,/COOP_NPC_CORPORATE_ORDER_MODIFY_FORBIDDEN/);
 assert.match(source,/COOP_NPC_CORPORATE_ORDER_CANCEL_REQUIRES_RECONCILIATION/);
});
test("all Rust settlement RPCs route to exact isolated source",()=>{
 const source=patch(prior(RPC,"rpc"),"rpc");
 for(const name of ["ClaimNpcSellOrder","GetNpcSellClaim","FinalizeNpcSellOrder"])
  assert.ok(source.includes('"'+name+'"'));
});
test("Rust fill reservation is exclusive and finalization idempotent",()=>{
 const source=fs.readFileSync(require.resolve("../rust/coop_npc_market_settlement.rs"),"utf8");
 assert.match(source,/order_id INTEGER UNIQUE NOT NULL/);
 assert.match(source,/state='settling'/);
 assert.match(source,/vol_remaining=0/);
 assert.match(source,/current\["state"\]=="filled" && current\["fill_phase"\]=="filled"/);
});
test("wrong extension order refuses installation",()=>{
 assert.throws(()=>patch(RPC,"rpc"),/COOP034_RUST_DEPENDENCY_MISSING/);
 assert.throws(()=>patch(STATE,"state"),/COOP034_RUST_DEPENDENCY_MISSING/);
});
