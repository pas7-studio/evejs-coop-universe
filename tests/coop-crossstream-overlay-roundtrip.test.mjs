import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import {fileURLToPath} from "node:url";
import {createRequire} from "node:module";

const here=path.dirname(fileURLToPath(import.meta.url));
const project=path.resolve(here,"..");
const require=createRequire(import.meta.url);
const {specs,transform}=require("../scripts/patch-evejs-coop.cjs");
const installer=fs.readFileSync(path.join(project,"scripts/patch-evejs-coop.cjs"),"utf8");

test("single native overlay has all cross-stream modules and no missing source files",()=>{
 const match=installer.match(/const names=\[([\s\S]*?)\];/);
 assert.ok(match,"Installer module list must be declared");
 const names=JSON.parse("["+match[1]+"]");
 assert.equal(names.length,new Set(names).size,"Duplicate deployed overlay modules");
 for(const name of names)
  assert.ok(fs.existsSync(path.join(project,"integration",name+".cjs")),"Missing module: "+name);
 assert.equal(specs.length,new Set(specs.map(s=>s.file)).size,"Duplicate upstream source patches");
 const essential=["coopPlayerCombatWitness","coopNativeLpStandings","coopFleetDungeonCredit",
  "coopNativeRaids","coopWorldSignals","coopSystemIntel","coopNativeLootPickupEvidence"];
 for(const name of essential)assert.ok(names.includes(name),"Missing cross-stream runtime module: "+name);
 for(const file of ["server/src/space/combat/killmailTracker.js",
  "server/src/services/evermarks/lpStoreMgrService.js",
  "server/src/services/agent/agentMissionRuntime.js",
  "server/src/services/ship/beyonceService.js"])
  assert.ok(specs.some(s=>s.file===file),"Missing native source hook: "+file);
});

test("all pinned native source hooks apply twice, parse and reverse byte-for-byte",t=>{
 const native=process.env.EVEJS_COOP_CODE_PATH;
 if(!native){t.skip("Set EVEJS_COOP_CODE_PATH to pinned EveJS Code checkout");return;}
 assert.ok(fs.existsSync(path.join(native,"compose.yaml")),"Not a real EveJS Code checkout");
 for(const spec of specs){
  const file=path.join(native,spec.file);
  assert.ok(fs.existsSync(file),"Missing pinned native file: "+spec.file);
  const onDisk=fs.readFileSync(file,"utf8");
  const pristine=transform(onDisk,spec,true);
  const patched=transform(pristine,spec,false);
  assert.equal(transform(patched,spec,false),patched,spec.file+" must be idempotent");
  assert.equal(transform(patched,spec,true),pristine,spec.file+" must fully rollback");
  assert.ok(onDisk===pristine||onDisk===patched,spec.file+" unrecognized existing source");
  new vm.Script(patched,{filename:spec.file});
 }
});

test("native overlay remains opt-in and local-only; manual verifier covers cross-stream regression",()=>{
 const deploy=fs.readFileSync(path.join(project,"scripts/Deploy-Coop-RuntimeProbe.ps1"),"utf8");
 assert.match(deploy,/if \(\$EnableNativeCoopContracts\) \{/);
 assert.match(deploy,/if \(\$EnableNativeLpStandings\) \{/);
 assert.match(deploy,/EVEJS_COOP_PLAYER_DAMAGE_EVIDENCE: '1'/);
 const verifier=fs.readFileSync(path.join(project,"scripts/Verify-Local-Coop.ps1"),"utf8");
 for(const name of ["coop-duo-contribution-report","coop-pve-chain",
   "coop-native-contracts-lp-integration","coop-native-lp-standings",
   "coop-crossstream-overlay-roundtrip"])
  assert.ok(verifier.includes("tests/"+name+".test.mjs"),"Unregistered local regression: "+name);
 assert.ok(!fs.existsSync(path.join(project,".github","workflows")),
  "Owner prohibited remote GitHub CI for this game");
});
