import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const files=["coopNpcIndustryNativeBindings","coopNpcIndustryGameStoreScope",
 "coopNpcIndustryReady","coopNpcIndustryOfflineAtomic","coopNpcIndustryOfflineDelivery",
 "coopNpcIndustryRecoveryFence","coopNpcLiveFactoryReadiness",
 "coopNpcIndustryOriginalGameStorePreflight","coopNpcIndustryOriginalStageExecutor",
 "coopNpcIndustryOriginalRustSell","coopNpcPendingMarketEscrow",
 "coopNpcIndustryOriginalSaleAudit","coopNpcIndustryOriginalWalletWitness","coopNpcIndustryOriginalBuyerSettlement"];
const source=n=>fs.readFileSync(new URL("../integration/"+n+".cjs",import.meta.url),"utf8");
test("local .cjs native industry kernels remain loadable",()=>{
 for(const name of files){
  const mod=require("../integration/"+name+".cjs");
  assert.ok(mod&&typeof mod==="object",name);
 }
});
test("exact pinned-overlay .js graph resolves every industry kernel without .cjs files",t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"lw04-industry-js-overlay-"));
 t.after(()=>fs.rmSync(root,{force:true,recursive:true}));
 for(const name of files)fs.writeFileSync(path.join(root,name+".js"),source(name));
 const native=require(path.join(root,"coopNpcIndustryNativeBindings.js"));
 assert.equal(typeof native.createNativeIndustryBindings,"function");
 const live=require(path.join(root,"coopNpcLiveFactoryReadiness.js"));
 assert.equal(typeof live.createAuditedLiveFactoryDirector,"function");
 const manual=require(path.join(root,"coopNpcIndustryOriginalStageExecutor.js"));
 const preflight=require(path.join(root,"coopNpcIndustryOriginalGameStorePreflight.js"));
 assert.equal(typeof manual.createOriginalManufacturingStageExecutor,"function");
 assert.equal(typeof preflight.createOriginalGameStorePreflight,"function");
 const rust=require(path.join(root,"coopNpcIndustryOriginalRustSell.js"));
 assert.equal(typeof rust.createOriginalNpcRustSellStage,"function");
 const sale=require(path.join(root,"coopNpcIndustryOriginalSaleAudit.js"));
 const witness=require(path.join(root,"coopNpcIndustryOriginalWalletWitness.js"));
 const buyer=require(path.join(root,"coopNpcIndustryOriginalBuyerSettlement.js"));
 assert.equal(typeof sale.createOriginalNpcSaleSettlementAudit,"function");
 assert.equal(typeof witness.createOriginalNpcWalletReceiptWitness,"function");
 assert.equal(typeof buyer.createOriginalNpcIndustryBuyerSettlement,"function");
 assert.throws(()=>native.createNativeIndustryBindings(),/NPC_INDUSTRY_NATIVE_BINDINGS_REQUIRED/);
 for(const name of files)assert.equal(fs.existsSync(path.join(root,name+".cjs")),false);
});
test("all original trusted native kernels remain default-off without live binding contracts",()=>{
 assert.match(source("coopNpcIndustryNativeBindings"),/supportsLiveRuntime:false/);
 assert.match(source("coopNpcIndustryGameStoreScope"),/SCOPED_SQL_TABLE_REJECTED/);
 assert.match(source("coopNpcIndustryReady"),/NATIVE_NPC_SCOPE_PROOF_DISABLED/);
 assert.match(source("coopNpcIndustryOfflineAtomic"),/offlineExclusive/);
 assert.match(source("coopNpcIndustryOfflineDelivery"),/offlineExclusive/);
});
test("industry graph never starts independent NPC economy scheduler",()=>{
 for(const name of files){
  assert.doesNotMatch(source(name),/\bsetInterval\s*\(/,name);
  assert.doesNotMatch(source(name),/\bsetTimeout\s*\(/,name);
 }
});
test("new LW-04 admission is installed exactly once into central overlay",()=>{
 const text=fs.readFileSync(new URL("../scripts/patch-evejs-coop.cjs",import.meta.url),"utf8");
 const calls=[...text.matchAll(/"coopAlifeNativeManufacturingRuntime"/g)];
 assert.equal(calls.length,1);
 assert.match(text,/path\.join\(code,"server\/src\/space",name\+"\.js"\)/);
});

test("pinned overlay has no duplicate module names after concurrent merges",()=>{
 const text=fs.readFileSync(new URL("../scripts/patch-evejs-coop.cjs",import.meta.url),"utf8");
 const declaration=text.slice(text.indexOf("const names="),text.indexOf("const specs=["));
 const names=new Function(declaration+"return names;")();
 assert.equal(names.length,new Set(names).size);
 assert.equal(names.filter(x=>x==="coopCourierRuntime").length,1);
 assert.equal(names.filter(x=>x==="coopAlifeNativeManufacturingRuntime").length,1);
 assert.equal(names.filter(x=>x==="coopNpcIndustryRecoveryFence").length,1);
 assert.equal(names.filter(x=>x==="coopNpcLiveFactoryReadiness").length,1);
 assert.equal(names.filter(x=>x==="coopNpcIndustryOriginalStageExecutor").length,1);
 assert.equal(names.filter(x=>x==="coopNpcIndustryOriginalRustSell").length,1);
 for(const name of ["coopNpcIndustryOriginalSaleAudit","coopNpcIndustryOriginalWalletWitness","coopNpcIndustryOriginalBuyerSettlement"])
  assert.equal(names.filter(x=>x===name).length,1);
 assert.equal(names.filter(x=>x==="coopNpcIndustryOriginalGameStorePreflight").length,1);
});
