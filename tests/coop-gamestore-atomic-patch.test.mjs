import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {patch,entries}=require("../scripts/coop-gamestore-atomic-patch.cjs");
for(const file of Object.keys(entries)){
 test("EOL-safe byte-exact reversible native bridge hook "+file,()=>{
  for(const eol of ["\n","\r\n"]){
   const pristine=["// pristine","module.exports = {","  ping: true,","};",""].join(eol);
   const installed=patch(pristine,file);
   assert.notEqual(installed,pristine);
   assert.equal(patch(installed,file),installed);
   assert.equal(patch(installed,file,true),pristine);
   assert.equal(patch(pristine,file,true),pristine);
  }
 });
}
test("unknown native source export shape refuses installation",()=>{
 assert.throws(()=>patch("no exports here","server/src/gameStore/index.js"),/UNSUPPORTED_NATIVE_EXPORT/);
});
test("duplicated bridge hook refuses installation",()=>{
 const file="server/src/gameStore/index.js";
 const source="module.exports = {};\n"+entries[file]+"\n"+entries[file]+"\n";
 assert.throws(()=>patch(source,file),/DUPLICATE_GAMESTORE_NATIVE_BRIDGE/);
});
