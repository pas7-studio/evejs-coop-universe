"use strict";
// Transactional, reversible overlay for the EXACT pinned EveJS checkout.
// Preflight and parse all changed sources before writing anything.
const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const {execFileSync}=require("node:child_process");
const PIN="c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f";
const names=["coopRuntimeProbe","coopNativeNpcDemo","coopCombatProbe","coopEncounterDirector",
"coopVirtualWorld","coopVirtualWorldRuntime","coopNpcMaterializer","coopIdentityRegistry",
"coopVirtualEconomy","coopNpcLossBridge","coopFactionDirector","coopFactionPatrolRuntime",
"coopPatrolOrders","coopNpcTopology","coopPatrolNavigator","coopNpcPresentation",
"coopSessionPresence","coopCivilianOrders","coopDuoPresence","coopDuoCoordinator"];
const specs=[
 {file:"server/src/services/_shared/sessionDisconnect.js",patches:[
  {anchor:"  persistCharacterLogoffState(session);",line:'  require("../../space/coopRuntimeProbe").observe("disconnect-after-persist", session, null);',after:true}
 ]},
 {file:"server/src/space/transitions.js",patches:[
  {anchor:"  const attachElapsedMs = Date.now() - attachStartedAtMs;",line:'  require("./coopRuntimeProbe").observe("space-login-attach", session, activeShip, { attached: Boolean(shipEntity) });',after:true},
  {anchor:"  const hydrationQueuedAtMs = Date.now();",line:'  require("./coopSessionPresence").schedule(session, activeShip, "login");',after:true},
  {anchor:"    queuePostSpaceAttachFittingHydration(session, moveResult.data.itemID, {",line:'    require("./coopSessionPresence").schedule(session, moveResult.data, "undock");'},
  {anchor:"  queuePostSpaceAttachFittingHydration(session, moveResult.data && moveResult.data.itemID, {",line:'  require("./coopSessionPresence").schedule(session, moveResult.data, "stargate");'}
 ]},
 {file:"server/src/network/tcp/index.js",patches:[
  {anchor:"      tidiAutoscaler.init();",line:'      try { require("../../space/coopVirtualWorldRuntime").start(); } catch (error) { console.warn("[CoopVirtualWorld] startup", error.message); }',after:true}
 ]},
 {file:"server/src/space/npc/nativeNpcWreckService.js",patches:[
  {anchor:"  try {\n    const dungeonUniverseSiteService = require(path.join(",line:'  try { require("../coopVirtualWorldRuntime").confirmedNativeNpcWreck(normalizedSystemID, entityID, wreckRecord.wreckID); } catch (_coopError) { /* optional integration */ }'},
  {anchor:"  try {\n    const dungeonUniverseSiteService = require(path.join(",line:'  try { require("../coopNativeNpcDemo").confirmedWreck(normalizedSystemID, entityID, wreckRecord.wreckID); } catch (_coopError) { /* optional co-op kill tracking */ }'}
 ]}
];
const oldLines=[
 '  require("../../space/coopRuntimeProbe").observe("disconnect-before-persist", session, null);',
 '  require("../../space/coopRuntimeProbe").observe("disconnect-after-persist", session, null);',
 '  require("./coopRuntimeProbe").observe("space-login-attach", session, activeShip, { attached: Boolean(shipEntity) });',
 '  require("./coopNativeNpcDemo").maybeSpawn(session, activeShip);',
 '  require("./coopVirtualWorldRuntime").observeSession(session, activeShip);',
 '  require("./coopSessionPresence").schedule(session, activeShip, "login");',
 '    require("./coopSessionPresence").schedule(session, moveResult.data, "undock");',
 '  require("./coopSessionPresence").schedule(session, moveResult.data, "stargate");',
 '      try { require("../../space/coopVirtualWorldRuntime").start(); } catch (error) { console.warn("[CoopVirtualWorld] startup", error.message); }',
 '  try { require("../coopVirtualWorldRuntime").confirmedNativeNpcWreck(normalizedSystemID, entityID, wreckRecord.wreckID); } catch (_coopError) { /* optional integration */ }',
 '  try { require("../coopNativeNpcDemo").confirmedWreck(normalizedSystemID, entityID, wreckRecord.wreckID); } catch (_coopError) { /* optional co-op kill tracking */ }'
];
const lootOld='  refreshNativeWreckRuntimeEntity(wreckRecord.systemID, wreckRecord.wreckID);';
const lootNew='  refreshNativeWreckRuntimeEntity(wreckRecord.systemID, wreckRecord.wreckID, { broadcast: true });';
function count(text,needle){return text.split(needle).length-1;}
function strip(source){
 return source.split("\n").filter(row=>!oldLines.includes(row.replace(/\r$/,""))).join("\n");
}
function transform(source,spec,remove){
 let text=strip(source);
 if(spec.file.endsWith("nativeNpcWreckService.js")){
  if(count(text,lootOld)+count(text,lootNew)!==1)throw Error("Ambiguous native wreck refresh");
  text=remove?text.replace(lootNew,lootOld):text.replace(lootOld,lootNew);
 }
 if(!remove)for(const patch of spec.patches){
  const eol=text.includes("\r\n")?"\r\n":"\n";
  const anchor=patch.anchor.replace(/\n/g,eol);
  if(count(text,anchor)!==1)throw Error("Unknown or duplicate source anchor: "+spec.file+" "+patch.anchor);
  text=text.replace(anchor,patch.after?anchor+eol+patch.line:patch.line+eol+anchor);
 }
 new vm.Script(text,{filename:spec.file});
 return text;
}
function run({codePath,remove=false,dryRun=false}){
 const project=path.resolve(__dirname,".."),code=path.resolve(codePath);
 if(!fs.existsSync(path.join(code,"compose.yaml")))throw Error("Missing EveJS compose.yaml: "+code);
 const sha=execFileSync("git",["-C",path.dirname(code),"rev-parse","HEAD"],{encoding:"utf8"}).trim();
 if(sha!==PIN)throw Error("Refusing incompatible EveJS version "+sha);
 const plan=[];
 for(const spec of specs){
  const file=path.join(code,spec.file),before=fs.readFileSync(file,"utf8");
  plan.push({file,before,after:transform(before,spec,remove)});
 }
 for(const name of names){
  const file=path.join(code,"server/src/space",name+".js");
  const src=path.join(project,"integration",name+".cjs");
  if(!remove){
   const after=fs.readFileSync(src,"utf8");
   new vm.Script(after,{filename:src});
   plan.push({file,before:fs.existsSync(file)?fs.readFileSync(file,"utf8"):null,after});
  }else if(fs.existsSync(file))plan.push({file,before:fs.readFileSync(file,"utf8"),after:null});
 }
 const changed=plan.filter(p=>p.before!==p.after);
 if(!dryRun){
  const done=[];
  try{
   for(const item of changed){
    if(item.after===null)fs.unlinkSync(item.file);
    else fs.writeFileSync(item.file,item.after,"utf8");
    done.push(item);
   }
  }catch(error){
   for(const item of done.reverse()){
    try{if(item.before===null)fs.unlinkSync(item.file);else fs.writeFileSync(item.file,item.before,"utf8");}
    catch(err){console.error("Source rollback failed:",item.file,err.message);}
   }
   throw error;
  }
 }
 return {status:dryRun?"DRY_RUN_OK":remove?"REMOVED":"INSTALLED",changed:changed.map(p=>path.relative(code,p.file))};
}
if(require.main===module){
 try{
  const args=process.argv.slice(2),at=args.indexOf("--code-path");
  if(at<0||!args[at+1])throw Error("Usage: node patch-evejs-coop.cjs --code-path <EveJS/Code> [--remove] [--dry-run]");
  console.log(JSON.stringify(run({codePath:args[at+1],remove:args.includes("--remove"),dryRun:args.includes("--dry-run")}),null,2));
 }catch(error){console.error("[COOP PATCH ERROR]",error.message);process.exitCode=1;}
}
module.exports={run,transform,strip,specs};
