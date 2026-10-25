import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import fs from "node:fs";
import path from "node:path";
const require=createRequire(import.meta.url);
const {patch,ITEMS,RUNTIME,SERVICE,BEGIN,END,RPC_HOOK,SERVICE_HOOK}=
 require("../scripts/coop-player-ore-atomic-patch.cjs");
const examples={
 [ITEMS]:'const ITEM_FLAGS={HANGAR:4};\nmodule.exports = {\n  existing,\n};\n',
 [RUNTIME]:'const path=require("path");\nfunction reprocessItems(session, options = {}) {\n  return {success:true};\n}\n',
 [SERVICE]:'const path=require("path");\nfunction materializeOversizedSelectionsForReprocess(session, itemIDs = [], quoteOptions = {}) {\n  return {success:true};\n}\n'
};
test("each of three native source patches inserts one hook and removes byte-for-byte",()=>{
 for(const [target,source] of Object.entries(examples)){
  for(const eol of ["\n","\r\n"]){
   const original=source.replace(/\n/g,eol),after=patch(original,target);
   assert.notEqual(after,original);
   assert.equal(patch(after,target),after);
   assert.equal(patch(after,target,true),original);
  }
 }
});
test("unsupported target or ambiguous source never silently creates native hook",()=>{
 assert.throws(()=>patch("module.exports = {}","server/src/services/weapon.js"),/TARGET_MISMATCH/);
 assert.throws(()=>patch(examples[RUNTIME]+examples[RUNTIME],RUNTIME),/DRIFT/);
 assert.throws(()=>patch(examples[SERVICE]+examples[SERVICE],SERVICE),/DRIFT/);
 assert.throws(()=>patch(examples[ITEMS]+examples[ITEMS],ITEMS),/DRIFT/);
});
test("both UI split and native reprocess are default OFF, not alternate inventory engines",()=>{
 assert.match(RPC_HOOK,/EVEJS_COOP_PLAYER_ORE_ATOMIC === "1"/);
 assert.match(SERVICE_HOOK,/EVEJS_COOP_PLAYER_ORE_ATOMIC === "1"/);
 assert.match(patch(examples[ITEMS],ITEMS),/repo\.flushTableSync\(ITEMS_TABLE\)/);
 assert.match(patch(examples[ITEMS],ITEMS),/readItems\(\)/);
 assert.match(patch(examples[ITEMS],ITEMS),/items\[String\(newID\)\]/);
});
test("read-only optional pinned-source roundtrip (no Docker mutation)",()=>{
 const root=process.env.EVEJS_COOP_CODE_PATH;
 if(!root)return;
 for(const target of [ITEMS,RUNTIME,SERVICE]){
  const file=path.join(root,target);
  const source=fs.readFileSync(file,"utf8");
  const patched=patch(source,target);
  assert.equal(patch(patched,target,true),source);
 }
});
