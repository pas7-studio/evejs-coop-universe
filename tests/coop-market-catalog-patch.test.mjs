import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {FILE,HOOK,ANCHOR,patch}=require("../scripts/coop-market-catalog-patch.cjs");
const native=`"use strict";\nclass MarketProxy {\n  Handle_GetMarketGroups() {\n${ANCHOR}\n    return [];\n  }\n}\nmodule.exports=MarketProxy;\n`;
test("one-statement opt-in hook is reversible, idempotent and isolated",()=>{
 const installed=patch(native,FILE);
 assert.equal(installed.split(HOOK).length,2);
 assert.equal(patch(installed,FILE),installed);
 assert.equal(patch(installed,FILE,true),native);
 assert.equal(patch(native,"unrelated.js"),native);
 new Function("module","exports","require","process",installed);
});
test("Windows CRLF exact roundtrip",()=>{
 const src=native.replace(/\n/g,"\r\n");
 assert.equal(patch(patch(src,FILE),FILE,true),src);
});
test("refuses changed upstream anchors without silently generating market data",()=>{
 assert.throws(()=>patch(native.replace(ANCHOR,"    // removed"),FILE),/anchor/);
});