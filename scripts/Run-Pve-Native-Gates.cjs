"use strict";
// Chat 19+21: fail-closed source + pinned-overlay CI gate.
// This script NEVER starts game services, logs in clients or edits live data.
const fs=require("node:fs"),path=require("node:path");
const {spawnSync,execFileSync}=require("node:child_process");
const {PIN,names,specs,run,check}=require("./patch-evejs-coop.cjs");
const {testFiles,requiredModules}=require("./pve-native-gate-manifest.cjs");
function crash(message){throw Error("PVE_NATIVE_GATE: "+message)}
function cmd(file,args,{cwd=path.resolve(__dirname,".."),env=process.env}={}){
 const result=spawnSync(file,args,{cwd,env,encoding:"utf8",timeout:240000,windowsHide:true});
 if(result.stdout)process.stdout.write(result.stdout);
 if(result.stderr)process.stderr.write(result.stderr);
 if(result.error||result.status!==0)crash(file+" "+args.join(" ")+" failed "+String(result.error?.message||result.status));
}
function auditSources(root){
 const flat=new Set(names),unique=new Set(testFiles);
 if(flat.size!==names.length)crash("DUPLICATE_OVERLAY_MODULE");
 if(unique.size!==testFiles.length)crash("DUPLICATE_PVE_TEST");
 for(const module of requiredModules){
  if(!flat.has(module))crash("MISSING_OVERLAY_MODULE "+module);
  const source=path.join(root,"integration",module+".cjs");
  if(!fs.existsSync(source))crash("MISSING_MODULE_SOURCE "+source);
  cmd(process.execPath,["--check",source],{cwd:root});
 }
 for(const file of testFiles){
  const full=path.join(root,file);
  if(!fs.existsSync(full))crash("MISSING_REQUIRED_TEST "+file);
 }
 // Pinned source installer must remain declarative, not a second
 // native grant/RPC/state store.
 if(!PIN.match(/^[0-9a-f]{40}$/))crash("INVALID_UPSTREAM_PIN");
 if(!specs.length)crash("MISSING_NATIVE_SOURCE_PATCHES");
 const flagFile=JSON.parse(fs.readFileSync(path.join(root,"docs/coop-flags.json"),"utf8"));
 for(const f of [
  "EVEJS_COOP_PVE_SITE_DEFENSE","EVEJS_COOP_PVE_WAVE_REINFORCEMENTS",
  "EVEJS_COOP_PVE_OBJECTIVE_DOCTRINE","EVEJS_COOP_PVE_NATIVE_BOSSES",
  "EVEJS_COOP_PVE_BOSS_LOOT_PICKUP","EVEJS_COOP_PVE_BOSS_LOOT_FENCE",
  "EVEJS_COOP_PVE_BOSS_LOOT_PROFILE_AUDIT",
  "EVEJS_COOP_PVE_DUO_REWARD_GUARD",
  "EVEJS_COOP_PVE_DUO_REWARD_EVIDENCE",
  "EVEJS_COOP_PVE_DUO_REWARD_CUSTODY"
 ])if(flagFile.flags?.[f]!==1)crash("FLAG_NOT_DEFAULT_OFF "+f);
 return {status:"SOURCE_PRESENT",upstreamPin:PIN,moduleCount:requiredModules.length,
  testFiles:testFiles.length};
}
function gateSource(root){
 const initial=auditSources(root);
 // Execute actual Node22 node:test, never an in-process mock harness.
 cmd(process.execPath,["--test","--test-concurrency=1",...testFiles],{cwd:root,
  env:{...process.env,EVEJS_COOP_PVE_NATIVE_BOSSES:"0",
   EVEJS_COOP_PVE_SITE_DEFENSE:"0",
   EVEJS_COOP_PVE_DUO_REWARD_CUSTODY:"0"}});
 return {...initial,status:"NODE_TESTS_PASS"};
}
function gatePinned(root,nativeCode){
 // Never accept a manually chosen live or mixed-version server. The
 // disposable checkout name AND user opt-in are independently required.
 if(process.env.EVEJS_PVE_DISPOSABLE_CHECKOUT!=="1")
  crash("EXPLICIT_DISPOSABLE_CHECKOUT_ATTESTATION_REQUIRED");
 const code=fs.realpathSync(nativeCode),repo=path.dirname(code);
 if(path.basename(code)!=="Code"||path.basename(repo)!=="isolated-upstream"||
    !fs.existsSync(path.join(code,"compose.yaml")))
  crash("REFUSING_LIVE_OR_NONDISPOSABLE_EVEJS_ROOT");
 if(!fs.existsSync(path.join(repo,".git")))crash("MISSING_PINNED_NATIVE_GIT");
 const sha=execFileSync("git",["-C",repo,"rev-parse","HEAD"],{encoding:"utf8"}).trim();
 if(sha!==PIN)crash("UNPINNED_NATIVE_SHA");
 const before=execFileSync("git",["-C",repo,"status","--porcelain","--untracked-files=all"],{encoding:"utf8"});
 if(before.trim())crash("DISPOSABLE_NATIVE_REPO_NOT_CLEAN");
 let installed=false;
 try{
  // First, original authored content must provide at least one NPC
  // profile linked to the real overseer rule. Catalog-only rules are
  // never presented as a playable boss drop.
  const catalog=require("./audit-pve-native-loot-catalog.cjs").inspectCode(code);
  process.stdout.write("[PVE_NATIVE_CATALOG] "+JSON.stringify(catalog)+"\n");
  if(catalog.status!=="SOURCE_AUTHORED_BOSS_TABLE_LINK_PRESENT")
   crash("ORIGINAL_NATIVE_BOSS_RARE_TABLE_UNBOUND: "+catalog.status);
  const dry=run({codePath:code,dryRun:true});
  if(dry.status!=="DRY_RUN_OK")crash("PINNED_DRY_RUN_FAILED");
  const applied=run({codePath:code});
  if(applied.status!=="INSTALLED")crash("PINNED_INSTALL_FAILED");
  installed=true;
  const audit=check({codePath:code});
  if(audit.status!=="OVERLAY_OK")crash("PINNED_OVERLAY_DRIFT "+JSON.stringify(audit.problems.slice(0,3)));
  const again=run({codePath:code});
  if(again.changed.length)crash("PINNED_OVERLAY_NOT_IDEMPOTENT "+again.changed.slice(0,5));
  // Native server source contract tests that inspect the real
  // installed server, without a running game or client.
  cmd(process.execPath,["--test","tests/coop-pve-native-pinned.test.mjs",
   "tests/coop-overlay-reapply-idempotent.test.mjs"],{cwd:root,
   env:{...process.env,EVEJS_CODE_PATH:code,EVEJS_COOP_CODE_PATH:code}});
 }finally{
  if(installed){
   const undone=run({codePath:code,remove:true});
   if(undone.status!=="REMOVED")crash("PINNED_REMOVE_FAILED");
  }
 }
 const after=execFileSync("git",["-C",repo,"status","--porcelain","--untracked-files=all"],{encoding:"utf8"});
 if(after!==before)crash("PINNED_ROUNDTRIP_NOT_BYTE_EXACT "+after.slice(0,600));
 return {status:"PINNED_INSTALL_REAPPLY_REMOVE_PASS",pin:PIN,
  nativeTests:"SERVER_SOURCE_ONLY_NO_GAME_CLIENTS"};
}
function main(args=process.argv.slice(2)){
 const root=path.resolve(__dirname,".."),flag=args.indexOf("--upstream-code");
 if(flag!==-1&&!args[flag+1])crash("MISSING_UPSTREAM_CODE_PATH");
 if(args.some((x,i)=>x!=="--source"&&x!=="--pinned-only"&&
    x!=="--upstream-code"&&(i===0||args[i-1]!=="--upstream-code")))
  crash("UNKNOWN_OPTION");
 if(args.includes("--pinned-only")&&flag<0)
  crash("PINNED_ONLY_REQUIRES_DISPOSABLE_PATH");
 const result={source:args.includes("--pinned-only")?
  {status:"NOT_RUN",reason:"SEPARATE_CI_NODE_SOURCE_JOB"}:
  gateSource(root),pinned:flag<0?
  {status:"NOT_RUN",reason:"NO_DISPOSABLE_PINNED_UPSTREAM"}:
  gatePinned(root,args[flag+1]),
  liveTwoClients:{status:"NOT_RUN",reason:"NO_CONNECTED_GAME_CLIENT_SESSION"},
  walletsLpItemsStanding:{status:"NOT_RUN",reason:"NO_LIVE_TWO_CLIENT_MISSION"},
  rareBossDrop:{status:"NOT_RUN",reason:"NO_LIVE_AUTHORED_BOSS"},
  rust:{status:"NOT_RUN",reason:"OUTSIDE_THIS_NODE_SOURCE_GATE"}};
 process.stdout.write("[PVE_NATIVE_GATE] "+JSON.stringify(result)+"\n");
 return result;
}
if(require.main===module){
 try{main()}catch(error){
  console.error("[PVE_NATIVE_GATE] FAIL",error.message);
  process.exitCode=1;
 }
}
module.exports={auditSources,gateSource,gatePinned,main};
