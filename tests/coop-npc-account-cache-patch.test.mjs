import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {patch,patches}=require("../scripts/coop-npc-account-cache-patch.cjs");
const SOURCE="const characterRecordCache=new Map();\nfunction resetRuntimeCaches(){}\nmodule.exports = {resetRuntimeCaches};\n";
for(const [file,code] of Object.entries(patches)){
 for(const crlf of [false,true]){
  test("reversible production cache invalidator "+file+" "+(crlf?"CRLF":"LF"),()=>{
   const pristine=crlf?SOURCE.replace(/\n/g,"\r\n"):SOURCE;
   const patched=patch(pristine,file);
   assert.notEqual(patched,pristine);
   assert.equal(patch(patched,file),patched);
   assert.equal(patch(patched,file,true),pristine);
   assert.equal(patch(pristine,file,true),pristine);
   assert.ok(patched.includes(code));
  });
 }
}
test("stale account invalidation export refuses dangerous double registration",()=>{
 const file="server/src/services/character/characterState.js";
 const stale=SOURCE+"\nmodule.exports.coopInvalidateAfterAtomicRows = () => false;";
 assert.throws(()=>patch(stale,file),/STALE_EXPORT/);
});
test("unknown native file is not patched",()=>{
 assert.equal(patch(SOURCE,"server/src/services/market/unknown.js"),SOURCE);
});
