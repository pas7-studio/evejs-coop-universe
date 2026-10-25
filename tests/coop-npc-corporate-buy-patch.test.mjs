import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {patch}=require("../scripts/coop-npc-corporate-buy-patch.cjs");
const {patch:guard,LINE}=require("../scripts/coop-npc-market-buy-safety-patch.cjs");
const ANCHOR='    const tradedQuantity = Math.min(remainingQuantity, availableQuantity);';
const SRC="async function marketProxy(){\n  for (const sellOrder of orders) {\n"+ANCHOR+"\n  }\n}\n";
for(const eol of ["LF","CRLF"]){
 test("native NPC buyer overlay reversible after COOP-034 guard ("+eol+")",()=>{
  const original=eol==="LF"?SRC:SRC.replace(/\n/g,"\r\n");
  const prior=guard(original),nested=patch(prior),restored=patch(nested,{remove:true});
  assert.equal(restored,prior);
  assert.equal(guard(restored,{remove:true}),original);
 });
}
test("client buyer stays default off and whole-stack only",()=>{
 const applied=patch(guard(SRC));
 assert.match(applied,/EVEJS_COOP_NATIVE_NPC_CORP_SETTLEMENT !== "1"/);
 assert.match(applied,/!chargeBuyerWallet \|\| remainingQuantity < availableQuantity/);
 assert.match(applied,/remainingQuantity < availableQuantity/);
 assert.match(applied,/coopNpcCorporateBuyRuntime/);
 assert.match(applied,/npcPurchase\.grossCents \/ 100/);
});
test("patch refuses unguarded upstream market code",()=>{
 assert.throws(()=>patch(SRC),/MISSING_COOP034_DEPENDENCY/);
});
test("second application does not duplicate the settlement branch",()=>{
 const once=patch(guard(SRC));assert.equal(patch(once),once);
});
test("repeated central install never appends COOP-034 after COOP-035",()=>{
 const original=guard(SRC),native=patch(original);
 assert.equal(guard(native),native);
 const removed=patch(native,{remove:true});
 assert.equal(guard(removed,{remove:true}),SRC);
});
test("mixed old and new NPC buy guards fail closed rather than suppressing buying",()=>{
 const original=patch(guard(SRC));
 const mixed=original.replace(ANCHOR,LINE+"\n"+ANCHOR);
 assert.throws(()=>guard(mixed),/MIXED_COOP034_COOP035/);
});
test("guard rejects all not-PURCHASED results without stock seller fallback",()=>{
 const modified=patch(guard(SRC));
 assert.match(modified,/npcPurchase\?\.status !== "PURCHASED"/);
 assert.match(modified,/throw Error\("NPC_CORPORATE_MARKET_BUY_BLOCKED:/);
 assert.match(modified,/remainingQuantity -= availableQuantity/);
});

test("NPC corporate buy bypasses already-reserved buyer-wallet matching path",()=>{
 const patched=patch(guard(SRC));
 assert.ok(patched.includes("!chargeBuyerWallet || remainingQuantity < availableQuantity"));
 assert.ok(patched.indexOf("!chargeBuyerWallet")<patched.indexOf("coopNpcCorporateBuyRuntime"));
});
