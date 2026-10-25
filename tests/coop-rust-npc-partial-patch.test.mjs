import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {patch,TYPES,ARMS,INCLUDE}=require("../scripts/coop-rust-npc-partial-patch.cjs");
function fixtures(eol="\n"){
 const rpc='// COOP-035 RPC ARMS BEGIN\n#[derive(Debug, Deserialize)]\nstruct RpcRequest{}\n        "ModifyOrder" => {}\n';
 const state='// COOP-035 SETTLEMENT EXTENSION BEGIN\nfn original(){}\n';
 return {rpc:rpc.replace(/\n/g,eol),state:state.replace(/\n/g,eol)};
}
for(const eol of ["\n","\r\n"]){
 test("Rust partial overlay patches and reverses byte-for-byte "+JSON.stringify(eol),()=>{
  const {rpc,state}=fixtures(eol);
  const modifiedRpc=patch(rpc,"rpc"),modifiedState=patch(state,"state");
  assert.ok(modifiedRpc.includes("ClaimNpcPartialSell"));
  assert.ok(modifiedRpc.includes("FinalizeNpcPartialSell"));
  assert.ok(modifiedRpc.includes("GetNpcPartialClaim"));
  assert.ok(modifiedState.includes('include!("coop_npc_market_partial.rs")'));
  assert.equal(patch(modifiedRpc,"rpc",true),rpc);
  assert.equal(patch(modifiedState,"state",true),state);
 });
}
test("Rust patch fails closed without COOP-035 dependencies",()=>{
 assert.throws(()=>patch('#[derive(Debug, Deserialize)]\nstruct RpcRequest{}\n        "ModifyOrder" => {}\n',"rpc"),/REQUIRES_COOP035/);
 assert.throws(()=>patch("fn foo(){}\n","state"),/REQUIRES_COOP035/);
});
test("Rust patch forbids duplicate installs or inconsistent removal",()=>{
 const {rpc,state}=fixtures();
 const modified=patch(rpc,"rpc");
 assert.throws(()=>patch(modified,"rpc"),/ALREADY_PATCHED/);
 assert.throws(()=>patch(rpc,"rpc",true),/NOT_INSTALLED/);
 const modifiedState=patch(state,"state");
 assert.throws(()=>patch(modifiedState,"state"),/ALREADY_PATCHED/);
});
test("Rust RPC and include contract have unique auditable markers",()=>{
 assert.equal((ARMS.match(/"ClaimNpcPartialSell"/g)||[]).length,1);
 assert.equal((ARMS.match(/"GetNpcPartialClaim"/g)||[]).length,1);
 assert.equal((ARMS.match(/"FinalizeNpcPartialSell"/g)||[]).length,1);
 assert.ok(TYPES.includes("quantity:i64"));
 assert.ok(INCLUDE.includes("coop_npc_market_partial.rs"));
});
