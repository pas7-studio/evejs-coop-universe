import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const {requiredModules,testFiles}=require("../scripts/pve-native-gate-manifest.cjs");
const runner=require("../scripts/Run-Pve-Native-Gates.cjs");
const {PIN,names}=require("../scripts/patch-evejs-coop.cjs");
const scenario=JSON.parse(fs.readFileSync(
 path.join(root,"tests/scenarios/chat19-21-native-two-client-pve-e2e.json"),"utf8"));
test("all PVE and original native mission/loot modules are registered exactly once",()=>{
 assert.equal(new Set(requiredModules).size,requiredModules.length);
 for(const m of requiredModules){
  assert.equal(names.filter(n=>n===m).length,1,m);
  assert.equal(fs.existsSync(path.join(root,"integration",m+".cjs")),true);
 }
});
test("every actual Node source gate target exists and is intentional",()=>{
 assert.equal(new Set(testFiles).size,testFiles.length);
 for(const p of testFiles){
  assert.match(p,/^tests\/[a-z0-9-]+\.test\.mjs$/);
  assert.equal(fs.existsSync(path.join(root,p)),true,p);
 }
 assert.equal(testFiles.includes("tests/coop-pve-native-e2e-audit.test.mjs"),true);
});
test("real live acceptance is NOT_RUN, never silently certified by Node or server receipts",()=>{
 assert.equal(scenario.upstreamPin,PIN);
 assert.equal(scenario.releaseStatus,"NOT_VERIFIED");
 assert.equal(scenario.scenarios.length,16);
 assert.ok(scenario.scenarios.every(x=>x.status==="NOT_RUN"));
 assert.equal(new Set(scenario.scenarios.map(x=>x.id)).size,16);
 assert.ok(scenario.doNotTouch.includes("production character wallets"));
});
test("native full overlay gate refuses a live code directory without explicit disposable attestation",()=>{
 const old=process.env.EVEJS_PVE_DISPOSABLE_CHECKOUT;
 delete process.env.EVEJS_PVE_DISPOSABLE_CHECKOUT;
 try{assert.throws(()=>runner.gatePinned(root,"/not-a-disposable-server"),
  /EXPLICIT_DISPOSABLE_CHECKOUT_ATTESTATION_REQUIRED/)}
 finally{
  if(old===undefined)delete process.env.EVEJS_PVE_DISPOSABLE_CHECKOUT;
  else process.env.EVEJS_PVE_DISPOSABLE_CHECKOUT=old;
 }
});
test("CI pinned original gameplay limitations are explicit",()=>{
 const code=fs.readFileSync(path.join(root,"scripts/Run-Pve-Native-Gates.cjs"),"utf8");
 assert.match(code,/liveTwoClients:\{status:"NOT_RUN"/);
 assert.match(code,/walletsLpItemsStanding:\{status:"NOT_RUN"/);
 assert.match(code,/rareBossDrop:\{status:"NOT_RUN"/);
 assert.match(code,/serverRestartVerified|NO_LIVE_TWO_CLIENT_MISSION/);
 assert.match(code,/PINNED_ROUNDTRIP_NOT_BYTE_EXACT/);
 assert.match(code,/PINNED_OVERLAY_NOT_IDEMPOTENT/);
});
