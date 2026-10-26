import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const text=rel=>fs.readFileSync(new URL("../"+rel,import.meta.url),"utf8");

test("manufacturing uses the original 30-second A-Life observation, not a new clock",()=>{
 const world=text("integration/coopVirtualWorldRuntime.cjs");
 const functionStart=world.indexOf("async function observeAlifeEconomy(){");
 const functionEnd=world.indexOf("\nfunction lockedTargets(",functionStart);
 assert.ok(functionStart>0&&functionEnd>functionStart);
 const phase=world.slice(functionStart,functionEnd);
 assert.equal((phase.match(/alifeManufacturingRuntime\.tick\(/g)||[]).length,1);
 assert.match(phase,/const decision=alifeEconomyObserver\.tick\(snap\)/);
 assert.match(phase,/if\(process\.env\.EVEJS_COOP_ALIFE_ECONOMY_ACT==="1"\)/);
 assert.match(phase,/LIVE_NATIVE_MANUFACTURING_BINDINGS_NOT_AVAILABLE|createRuntimeAlifeManufacturing/);
 assert.doesNotMatch(phase,/setInterval\s*\(|setTimeout\s*\(/);
});
test("absence of confirmed live director cannot become a producer transaction",async()=>{
 const {createRuntimeAlifeManufacturing}=require("../integration/coopAlifeNativeManufacturingRuntime.cjs");
 const src=text("integration/coopAlifeNativeManufacturingRuntime.cjs");
 assert.match(src,/LIVE_NATIVE_MANUFACTURING_BINDINGS_NOT_AVAILABLE/);
 assert.match(src,/x\?\.supportsLiveRuntime===true/);
 assert.doesNotMatch(src,/\.transact\s*\(|\.credit\s*\(|\.grantItem\s*\(/);
});
test("original installer contains one manufacturing admission and no duplicate Living Agent",()=>{
 const patch=text("scripts/patch-evejs-coop.cjs");
 const declaration=patch.slice(patch.indexOf("const names="),patch.indexOf("const specs=["));
 const names=new Function(declaration+"return names;")();
 assert.equal(names.length,new Set(names).size);
 assert.equal(names.filter(n=>n==="coopAlifeNativeManufacturingRuntime").length,1);
 assert.equal(names.filter(n=>n==="coopLivingAgentRuntime").length,1);
 assert.equal(names.filter(n=>n==="coopNpeSafety").length,1);
});
test("world probe never labels read-only admission as paid native settlement",()=>{
 const world=text("integration/coopVirtualWorldRuntime.cjs");
 assert.match(world,/nativeSettlementVerified:false/);
 assert.match(world,/NATIVE_SOURCE_ADMISSION_NOT_NATIVE_SETTLEMENT/);
});
