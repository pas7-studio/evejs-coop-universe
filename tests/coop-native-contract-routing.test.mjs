import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {createRequire} from "node:module";
import fs from "node:fs";
const require=createRequire(import.meta.url);
const {patch}=require("../scripts/coop-native-contract-routing-patch.cjs");
const {specs,transform}=require("../scripts/patch-evejs-coop.cjs");
const samples={
 "server/index.js":"const log={success(){}}; const serviceManager={count:2,lookup(){},registerAlias(){}};\nlog.success(\`registered ${serviceManager.count} services\`);\n",
 "server/src/services/machoNet/machoNetService.js":"const services=[\n        [\"contractMgr\", null],\n];\n",
 "server/src/services/contracts/contractRuntimeState.js":"function completeCourierContract(contract, session) { return true; }\nfunction failCourierContract(contract, session) { return false; }\n"
};
test("disabled native contracts feature keeps other gameplay flags unchanged",()=>{
 const deployed=fs.readFileSync(new URL("../scripts/Deploy-Coop-RuntimeProbe.ps1",import.meta.url),"utf8");
 assert.ok(!deployed.includes("EVEJS_COOP_NATIVE_CONTRACTS: '1'"));
});
for(const [file,source] of Object.entries(samples)){
 test("native contracts pinned patch exact apply/remove in "+file,()=>{
  const spec=specs.find(s=>s.file===file);
  assert.ok(spec);
  const a=patch(source,file,false);
  assert.equal(patch(a,file,false),a);
  assert.equal(patch(a,file,true),source);
  assert.equal(transform(source,spec,false),a);
  assert.equal(transform(a,spec,false),a);
  assert.equal(transform(a,spec,true),source);
  new vm.Script(a,{filename:file});
 });
}
test("contract source patch refuses unknown sources",()=>{
 assert.throws(()=>patch("other source","server/index.js",false),/UNKNOWN_PINNED/);
 assert.throws(()=>patch("x","unsupported.js",false),/UNSUPPORTED/);
});
