import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {patch,LINE,ANCHOR}=require("../scripts/coop-npc-market-buy-safety-patch.cjs");
const ORIGINAL="async function matchSellOrdersForBuyer() {\n  for (const sellOrder of sells) {\n"+ANCHOR+"\n  }\n}\n";
for(const eol of ["LF","CRLF"]){
 test("legacy buyer guard: "+eol+" reversible",()=>{
  const original=eol==="CRLF"?ORIGINAL.replace(/\n/g,"\r\n"):ORIGINAL;
  const patched=patch(original);
  assert.equal(patched.includes(LINE),true);
  assert.equal(patch(patched,{remove:true}),original);
  assert.equal(patch(original,{remove:true}),original);
 });
}
test("already patched buyer path is refused",()=>{
 assert.throws(()=>patch(patch(ORIGINAL)),/ALREADY_PATCHED/);
});
test("different source anchor fails closed",()=>{
 assert.throws(()=>patch("unknown market implementation"),/UPSTREAM_ANCHOR_MISMATCH/);
});
test("buyer patch explicitly excludes coop-npc before escrow and wallet calls",()=>{
 const patched=patch(ORIGINAL);
 assert.ok(patched.indexOf(LINE)<patched.indexOf(ANCHOR));
 assert.match(LINE,/continue;/);
});
