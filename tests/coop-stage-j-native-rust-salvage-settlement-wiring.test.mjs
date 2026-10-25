import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {names,PIN}=require("../scripts/patch-evejs-coop.cjs");
const pending=fs.readFileSync(path.join(import.meta.dirname||path.dirname(new URL(import.meta.url).pathname),
 "../rust/coop_npc_market_pending.rs"),"utf8");
test("both original industry and gated native salvage operations are explicit Rust namespaces",()=>{
 assert.match(pending,/strip_prefix\("npc-manufacture:"\)/);
 assert.match(pending,/strip_prefix\("npc-salvage:"\)/);
 assert.match(pending,/EVEJS_COOP_RUST_NPC_SALVAGE_MARKET/);
 assert.match(pending,/token\.len\(\)!=32/);
 assert.match(pending,/b'a'\.\.=b'f'/);
});
test("pinned overlay ships one existing authoritative NPC corporate wallet authority",()=>{
 assert.equal(PIN,"c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f");
 for(const name of ["coopNpcCorporateSettlement",
  "coopNpcCorporateBuyRuntime","coopSalvageNpcPendingMarket"]){
  assert.equal(names.filter(x=>x===name).length,1,name+" is not unique");
 }
 assert.equal(names.length,new Set(names).size);
});
