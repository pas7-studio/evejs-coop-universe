import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {createRequire} from "node:module";
import {readModuleText,functionText} from "./_support/coopSourceText.mjs";
const require=createRequire(import.meta.url);
const ROOT=path.join(import.meta.dirname,"..");
const bridge=fs.readFileSync(path.join(ROOT,"integration","coopAdminBridge.cjs"),"utf8");
const runtime=readModuleText("integration/coopVirtualWorldRuntime.cjs");

// The battle leg was silent after ASSAULT_BEGUN: a tick with no order looked
// identical to a tick where every pair was ineligible. These guards prove the
// diagnostic exists, is reachable from the admin bridge, and stays read-only.
// The real verdict comes from a live container probe, never from this test.
function diagnoseCombatBody(){
 const body=functionText(runtime,"function diagnoseCombat(){");
 assert.ok(body.length>200,"diagnoseCombat must exist in the world runtime");
 return body;
}

test("the combat diagnostic is a whitelisted admin action",()=>{
 assert.match(bridge,/"war_combat_diagnose"/);
 assert.match(bridge,/if \(action === "war_combat_diagnose"\) \{/);
 assert.match(bridge,/combat: runtimeWorld\.diagnoseCombat\(\)/);
});

test("the diagnostic is exported from the world runtime",()=>{
 // Assert the real export object, not the shape of the export list: the runtime
 // may be split into modules and re-export a helper from a pure sibling.
 const exported=require(path.join(ROOT,"integration","coopVirtualWorldRuntime.cjs"));
 for(const name of ["linkSpawnedIdentity","diagnoseMobilization","diagnoseCombat",
  "diagnoseWarFunding","warFrontChat"])assert.equal(typeof exported[name],"function",name);
});

test("the diagnostic never mutates native state",()=>{
 const body=diagnoseCombatBody();
 for(const forbidden of ["registry.execute","bridge.issue","issueNativeAttack",
  "warpToEntity","\.put(","\.transact(","record(","createWarCasualtyLedger"])
  assert.ok(!body.includes(forbidden),"diagnoseCombat must not call "+forbidden);
});

test("the diagnostic reports the exact physical and controller facts",()=>{
 const body=diagnoseCombatBody();
 for(const field of ["inScene","nativeNpc","playerSession","controllerSystemID",
  "currentTargetID","manualOrder","ammoRetreat","tacticalBusy","inBattleSystem",
  "distanceMeters","inRange","verdict","reason","hp"])
  assert.ok(body.includes(field),field+" must be reported");
});

test("the pairing verdict uses the same native authority as the director",()=>{
 const body=diagnoseCombatBody();
 assert.match(body,/api\.createWarCombatAuthority\(/);
 assert.match(body,/authority\.evaluatePair\(a,b,\{requireAttackIntent:false\}\)/);
});
