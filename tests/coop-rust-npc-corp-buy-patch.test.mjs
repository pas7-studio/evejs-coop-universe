import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {patch,TYPES,ARMS,INCLUDE}=require("../scripts/coop-rust-npc-corp-buy-patch.cjs");
const baseRpc=(eol="\n")=>("// COOP-047 PARTIAL RPC ARMS BEGIN\n"+
 "#[derive(Debug, Deserialize)]\nstruct RpcRequest{}\n"+
 '        "ModifyOrder" => {}\n').replace(/\n/g,eol);
const baseState=(eol="\n")=>("// COOP-047 PARTIAL SETTLEMENT BEGIN\nfn original(){}\n")
 .replace(/\n/g,eol);
for(const eol of ["\n","\r\n"]){
 test("COOP-048 Rust RPC and state overlay reverses exactly "+JSON.stringify(eol),()=>{
  const rpc=baseRpc(eol),state=baseState(eol);
  const pr=patch(rpc,"rpc"),ps=patch(state,"state");
  assert.ok(pr.includes("ClaimNpcCorpPlayerSell"));
  assert.ok(pr.includes("GetNpcCorpPlayerClaim"));
  assert.ok(pr.includes("FinalizeNpcCorpPlayerSell"));
  assert.ok(ps.includes('include!("coop_npc_corp_buy_player.rs")'));
  assert.equal(patch(pr,"rpc",true),rpc);
  assert.equal(patch(ps,"state",true),state);
 });
}
test("COOP-048 overlay fails without COOP-047 base",()=>{
 assert.throws(()=>patch("#[derive(Debug, Deserialize)]\nstruct RpcRequest{}\n","rpc"),/NEEDS_COOP047/);
 assert.throws(()=>patch("fn original(){}\n","state"),/NEEDS_COOP047/);
});
test("COOP-048 overlay refuses duplicate and stale removal",()=>{
 assert.throws(()=>patch(patch(baseRpc(),"rpc"),"rpc"),/ALREADY_PATCHED/);
 assert.throws(()=>patch(baseRpc(),"rpc",true),/NOT_PATCHED/);
 assert.throws(()=>patch(patch(baseState(),"state"),"state"),/ALREADY_PATCHED/);
});
test("all three NPC corporate buyer RPCs have distinct explicit declarations",()=>{
 for(const name of ["ClaimNpcCorpPlayerSell","GetNpcCorpPlayerClaim","FinalizeNpcCorpPlayerSell"])
  assert.equal((ARMS.match(new RegExp('"'+name+'"',"g"))||[]).length,1);
 assert.ok(TYPES.includes("buyer_corp_id:i64"));
 assert.ok(INCLUDE.includes("coop_npc_corp_buy_player.rs"));
});
