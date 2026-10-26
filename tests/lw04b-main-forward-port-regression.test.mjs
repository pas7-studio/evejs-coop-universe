import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const file=relative=>fs.readFileSync(new URL("../"+relative,import.meta.url),"utf8");

test("current-main original industry source retained strict exact wallet cents",()=>{
 const src=file("integration/coopNpcIndustryNativeBindings.cjs");
 assert.match(src,/const signedCents=/);
 assert.match(src,/const nonnegCents=/);
 assert.match(src,/siblingSuffix/);
});
test("current-main industry scope retained its deployed native .js import and 4-table boundary",()=>{
 const src=file("integration/coopNpcIndustryGameStoreScope.cjs");
 assert.match(src,/siblingSuffix/);
 assert.match(src,/const INSTALL_TABLES=Object\.freeze\(\["items","corporationRuntime","industryBlueprintState","industryJobs"\]\)/);
 assert.match(src,/const DELIVER_TABLES=/);
});
test("current-main installer contains no duplicate Living Agent or manufacturing admission",()=>{
 const src=file("scripts/patch-evejs-coop.cjs");
 const code=src.slice(src.indexOf("const names="),src.indexOf("const specs=["));
 const names=new Function(code+"return names;")();
 assert.equal(names.length,new Set(names).size);
 for(const name of ["coopLivingAgentRuntime","coopAlifeNativeManufacturingRuntime",
  "coopNpeSafety","coopNpcIndustryNativeBindings","coopAlifeNativeBuyerRuntime"]){
  assert.equal(names.filter(x=>x===name).length,1,name);
 }
});
test("original admission source fails closed without trusted live native director",()=>{
 const {createRuntimeAlifeManufacturing}=require("../integration/coopAlifeNativeManufacturingRuntime.cjs");
 assert.throws(()=>createRuntimeAlifeManufacturing(),/NATIVE_DEPENDENCIES_REQUIRED/);
 assert.doesNotMatch(file("integration/coopAlifeNativeManufacturingRuntime.cjs"),
  /\bsetInterval\s*\(|\bsetTimeout\s*\(/);
});
test("existing A-Life virtual runtime keeps manufacturing in original observation path",()=>{
 const src=file("integration/coopVirtualWorldRuntime.cjs");
 assert.match(src,/alifeManufacturingRuntime\.tick\(/);
 assert.match(src,/coopAlifeNativeManufacturingRuntime/);
 assert.doesNotMatch(src,/setInterval\(\s*[^\n]*manufacturing/i);
});
