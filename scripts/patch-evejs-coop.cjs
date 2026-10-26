"use strict";
// Transactional, reversible overlay for the EXACT pinned EveJS checkout.
// Preflight and parse all changed sources before writing anything.
const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const {execFileSync}=require("node:child_process");
const {PIN,names,ORE_PATCH_PATHS,STRUCTURE_PATCH_PATHS,SOCIAL_PATCH_PATHS,specs,oldLines,lootOld,lootNew,slimBroadcastOld,slimBroadcastNew}=require("./overlay-spec.cjs");

function count(text,needle){return text.split(needle).length-1;}
function strip(source){
 return source.split("\n").filter(row=>!oldLines.includes(row.replace(/\r$/,""))).join("\n");
}
function transform(source,spec,remove){
 let text=strip(source);
 if(spec.file==="server/src/services/industry/industryManagerService.js")
  text=require("./coop-player-industry-native-patch.cjs").patch(text,spec.file,remove);
 // Undo late Chat 25/32/39 hooks BEFORE the existing itemStore and
 // other native transforms so ownership/export adjacency remains unchanged.
 if(remove){
  for(const [helper,targets] of [
   ["./coop-social-native-guards-patch.cjs",SOCIAL_PATCH_PATHS],
   ["./coop-structure-alliance-guard-patch.cjs",STRUCTURE_PATCH_PATHS],
   ["./coop-player-ore-atomic-patch.cjs",ORE_PATCH_PATHS]
  ])if(targets.has(spec.file))text=require(helper).patch(text,spec.file,true);
 }
 if(spec.file==="server/src/services/exploration/wormholes/wormholeMgrService.js")
  text=require("./coop-wormhole-jump-fence-patch.cjs").patch(text,spec.file,remove);
 if(spec.file==="server/src/space/transitions.js")
  text=require("./coop-pochven-conduit-patch.cjs").patch(text,spec.file,remove);
 if(spec.file==="server/src/services/exploration/scanMgrService.js" ||
    spec.file==="server/src/services/ship/beyonceService.js")
  text=require("./coop-native-exploration-patch.cjs").patch(text,spec.file,remove);
 if(spec.file==="server/src/services/market/marketProxyService.js")
  text=require("./coop-market-catalog-patch.cjs").patch(text,spec.file,remove);
 if(spec.file==="server/src/services/market/marketProxyService.js") {
  if(remove) {
   text=require("./coop-npc-corporate-buy-patch.cjs").patch(text,{remove:true});
   text=require("./coop-npc-market-buy-safety-patch.cjs").patch(text,{remove:true});
  } else {
   text=require("./coop-npc-market-buy-safety-patch.cjs").patch(text,{remove:false});
   text=require("./coop-npc-corporate-buy-patch.cjs").patch(text,{remove:false});
  }
 }
 if(spec.file==="server/src/services/market/marketProxyService.js") {
  if(remove) {
   text=require("./coop-player-market-buy-refund-patch.cjs").patch(text,{remove:true});
   text=require("./coop-player-market-buy-settlement-patch.cjs").patch(text,{remove:true});
   text=require("./coop-player-market-buy-reserve-patch.cjs").patch(text,{remove:true});
   text=require("./coop-player-market-atomic-patch.cjs").patch(text,{remove:true});
   text=require("./coop-player-market-rust-claim-patch.cjs").patch(text,{remove:true});
   text=require("./coop-player-market-settlement-patch.cjs").patch(text,{remove:true});
   text=require("./coop-player-market-fill-patch.cjs").patch(text,{remove:true});
   text=require("./coop-market-sell-custody-patch.cjs").patch(text,{remove:true});
   text=require("./coop-market-cancel-custody-patch.cjs").patch(text,{remove:true});
  } else {
   text=require("./coop-market-cancel-custody-patch.cjs").patch(text,{remove:false});
   text=require("./coop-market-sell-custody-patch.cjs").patch(text,{remove:false});
   text=require("./coop-player-market-fill-patch.cjs").patch(text,{remove:false});
   text=require("./coop-player-market-settlement-patch.cjs").patch(text,{remove:false});
   text=require("./coop-player-market-rust-claim-patch.cjs").patch(text,{remove:false});
   text=require("./coop-player-market-atomic-patch.cjs").patch(text,{remove:false});
   text=require("./coop-player-market-buy-reserve-patch.cjs").patch(text,{remove:false});
   text=require("./coop-player-market-buy-settlement-patch.cjs").patch(text,{remove:false});
   text=require("./coop-player-market-buy-refund-patch.cjs").patch(text,{remove:false});
  }
 }
 if(spec.file==="server/src/space/runtime.js")
  text=require("./coop-native-npc-fire-debit-patch.cjs").patch(text,{remove});
 if(spec.file==="server/src/space/movement/warp/movementWarpState.js")
  text=require("./coop-escort-native-motion-patch.cjs").patch(text,{remove});
 if(spec.file==="server/src/space/npc/nativeNpcService.js")
  text=require("./coop-escort-ingress-materialize-patch.cjs").patch(text,{remove});
 if(spec.file==="server/src/services/inventory/itemStore.js" || spec.file==="server/src/services/trade/tradeMgrService.js")
  text=require("./coop-atomic-trade-patch.cjs").patch(text,spec.file,remove);
 if(spec.file==="server/src/services/inventory/itemStore.js" || spec.file==="server/src/services/trade/tradeMgrService.js")
  text=require("./coop-native-trade-custody-patch.cjs").patch(text,spec.file,remove);
 if(spec.file==="server/src/services/inventory/itemStore.js"&&!remove)
  text=require("./coop-native-refinery-item-patch.cjs").patch(text,spec.file,false);
 if(spec.file==="server/src/services/inventory/itemStore.js")
  text=require("./coop-native-warehouse-item-patch.cjs").patch(text,spec.file,remove);
 if(spec.file==="server/src/services/inventory/itemStore.js"&&remove)
  text=require("./coop-native-refinery-item-patch.cjs").patch(text,spec.file,true);
 if(spec.file.endsWith("nativeNpcStore.js")){
  // Persistent IDs must never reuse an ID handed out earlier in the
  // current process for a transient NPC fleet. Both allocation paths
  // must advance the common in-memory high-water mark.
  const eol=text.includes("\r\n")?"\r\n":"\n";
  const before=[
   '  const nextID = Math.max(',
   '    toPositiveInt(root && root[counterKey], 0),',
   '    toPositiveInt(ROOT[tableName] && ROOT[tableName][counterKey], 0),',
   '  );'
  ].join(eol);
  const after=[
   '  const nextID = Math.max(',
   '    toPositiveInt(root && root[counterKey], 0),',
   '    toPositiveInt(ROOT[tableName] && ROOT[tableName][counterKey], 0),',
   '    Number.isSafeInteger(transientCounters[tableName]) ? transientCounters[tableName] : 0,',
   '  );'
  ].join(eol);
  const originalReturn=[
   '  return {',
   '    success: true,',
   '    data: nextID,',
   '  };'
  ].join(eol);
  const fixedReturn=[
   '  if (Number.isSafeInteger(transientCounters[tableName]))',
   '    transientCounters[tableName] = Math.max(transientCounters[tableName], nextID + 1);',
   ...originalReturn.split(eol)
  ].join(eol);
  if(count(text,before)+count(text,after)!==1||
     count(text,originalReturn)!==1||count(text,fixedReturn)>1)
   throw Error("Unrecognized native NPC mixed persistent/transient ID allocator");
  text=remove?text.replace(after,before):text.replace(before,after);
  if(remove){
   if(count(text,fixedReturn)===1)text=text.replace(fixedReturn,originalReturn);
  }else if(count(text,fixedReturn)===0){
   text=text.replace(originalReturn,fixedReturn);
  }
 }
 if(spec.file.endsWith("nativeNpcWreckService.js")){
  if(count(text,lootOld)+count(text,lootNew)!==1)throw Error("Ambiguous native wreck refresh");
  text=remove?text.replace(lootNew,lootOld):text.replace(lootOld,lootNew);
  // The old method does not exist on the pinned SolarSystemScene.
  // A thrown exception here can happen after a loot item has been granted.
  if(count(text,slimBroadcastOld)+count(text,slimBroadcastNew)!==1)
   throw Error("Ambiguous native wreck client slim-item broadcast");
  text=remove?text.replace(slimBroadcastNew,slimBroadcastOld):
   text.replace(slimBroadcastOld,slimBroadcastNew);
 }
 // The station-arrival layer rewrites the haulereturn block below, so it is
 // stripped first whenever it is present. Without this, re-running install on
 // an already patched checkout fails with "Unexpected EveJS NPC haul arrival
 // location" instead of being a no-op (it is re-applied further down).
 if(spec.file.endsWith("miningNpcOperations.js")&&
    text.includes('require("../../space/coopNativeStationArrival")'))
  text=require("./coop-native-station-arrival-patch.cjs").patch(text,spec.file,true);
 // Detach ALIFE-09 stable-ID shim before ALIFE-08 validates its pinned bootCall.
 if(spec.file.endsWith("miningNpcOperations.js")&&
    text.includes('coopDurableFleetID:Number(scene.systemID)*32+Number(slot),'))
  text=require("./coop-native-mining-stable-fleet-id-patch.cjs").patch(text,true);
 if(spec.file.endsWith("miningNpcOperations.js")){
  // Replace the vanilla "miner ore disappears during hauling" path with
  // a real native cargo reparent to a live hauler ship. Keep fallback.
  const oldTransfer='    hauledVolumeM3 += clearNpcMiningCargo(entity);';
  const newTransfer='    hauledVolumeM3 += process.env.EVEJS_COOP_NATIVE_HAUL_CARGO === "1" ? require("../../space/coopNativeHaulCargo").transferCargo(scene, fleetRecord, entity) : clearNpcMiningCargo(entity);';
  const oldArrival='      fleetRecord.state = "mining";';
  const newArrival='      if (process.env.EVEJS_COOP_NATIVE_HAUL_CARGO === "1") require("../../space/coopNativeHaulCargo").unloadCargo(scene, fleetRecord);'+(text.includes("\r\n")?"\r\n":"\n")+oldArrival;
  if(count(text,oldTransfer)+count(text,newTransfer)!==1)throw Error("Unexpected EveJS NPC haul transfer location");
  text=remove?text.replace(newTransfer,oldTransfer):text.replace(oldTransfer,newTransfer);
  const oldBlock='  if (fleetRecord.state === "haulereturn") {'+(text.includes("\r\n")?"\r\n":"\n")+'    if (now >= toFiniteNumber(fleetRecord.haulerReturnAtMs, 0)) {'+(text.includes("\r\n")?"\r\n":"\n")+oldArrival;
  const newBlock=oldBlock.replace(oldArrival,newArrival);
  if(count(text,oldBlock)+count(text,newBlock)!==1)throw Error("Unexpected EveJS NPC haul arrival location");
  text=remove?text.replace(newBlock,oldBlock):text.replace(oldBlock,newBlock);

  const eol=text.includes("\r\n")?"\r\n":"\n";
  const loadedMarker='  const ingressDurationMs = Math.max(';
  const completeFn='function completeHaulCycle(scene, fleetRecord, now) {';
  const loadedBlock=[
    '  if (process.env.EVEJS_COOP_NATIVE_HAUL_CARGO === "1") {',
    '    fleetRecord.state = "loaded";',
    '    fleetRecord.loadedUntilMs = now + Math.max(30000, Math.min(240000, Number(process.env.EVEJS_COOP_HAULER_HOLD_MS || 120000)));',
    '    fleetRecord.lastHauledVolumeM3 = hauledVolumeM3;',
    '    fleetRecord.lastHauledAtMs = now;',
    '    fleetRecord.nextThinkAtMs = fleetRecord.loadedUntilMs;',
    '    return;',
    '  }',
    ''
  ].join(eol);
  const loadedHandler=[
    '  if (fleetRecord.state === "loaded") {',
    '    if (now < toFiniteNumber(fleetRecord.loadedUntilMs, 0)) return;',
    '    const ingressMs = Math.max(250, toFiniteNumber(config.miningNpcWarpIngressDurationMs, DEFAULT_MINING_WARP_INGRESS_DURATION_MS));',
    '    if (fleetRecord.originAnchor && fleetRecord.originAnchor.position) {',
    '      for (const entityID of fleetRecord.haulerEntityIDs || []) {',
    '        npcService.runtime.warpToPoint(entityID, fleetRecord.originAnchor.position, {',
    '          forceImmediateStart: true, broadcastWarpStartToVisibleSessions: true,',
    '          visibilitySuppressMs: 250, ingressDurationMs: ingressMs',
    '        });',
    '      }',
    '    }',
    '    fleetRecord.haulerNextArrivalAtMs = now + getHaulerRepeatDelayMs();',
    '    fleetRecord.state = "haulereturn";',
    '    fleetRecord.haulerReturnAtMs = now + ingressMs;',
    '    fleetRecord.nextThinkAtMs = fleetRecord.haulerReturnAtMs;',
    '    return;',
    '  }',
    ''
  ].join(eol);
  if(remove){
    if(count(text,loadedBlock)===1)text=text.replace(loadedBlock,'');
    else if(count(text,loadedBlock)!==0)throw Error("Unexpected native hauler hold patch state");
    if(count(text,loadedHandler)===1)text=text.replace(loadedHandler,'');
    else if(count(text,loadedHandler)!==0)throw Error("Unexpected native hauler loaded handler state");
  }else{
    if(count(text,loadedBlock)===0){
      const pos=text.indexOf(completeFn),at=pos<0?-1:text.indexOf(loadedMarker,pos);
      if(pos<0||at<0)throw Error("Missing native hauler departure anchor");
      text=text.slice(0,at)+loadedBlock+text.slice(at);
    }
    if(count(text,loadedHandler)===0){
      const gate='  if (fleetRecord.state === "haulereturn") {';
      if(count(text,gate)!==1)throw Error("Unknown native hauler return state");
      text=text.replace(gate,loadedHandler+gate);
    }
  }
 }
 if(spec.file.endsWith("miningNpcOperations.js")&&remove)
  text=require("./coop-native-mining-durable-patch.cjs").patch(text,true);
 if(spec.file.endsWith("miningNpcOperations.js"))
  text=require("./coop-mining-startup-recovery-patch.cjs").patchStartupRecovery(text,remove);
 if(spec.file.endsWith("miningNpcOperations.js")&&!remove){
  text=require("./coop-native-mining-durable-patch.cjs").patch(text,false);
  text=require("./coop-native-mining-stable-fleet-id-patch.cjs").patch(text,false);
 }
 if(spec.file==="server/src/services/mining/miningRuntime.js" || spec.file==="server/src/services/mining/miningRuntimeState.js"){
  if(remove){
   text=require("./coop-native-mining-atomic-source-patch.cjs").patch(text,spec.file,true);
   text=require("./coop-native-mining-cycle-conservation-patch.cjs").patch(text,spec.file,true);
  }else{
   text=require("./coop-native-mining-cycle-conservation-patch.cjs").patch(text,spec.file,false);
   text=require("./coop-native-mining-atomic-source-patch.cjs").patch(text,spec.file,false);
  }
 }
 // ALIFE-05: existing native stock mining writer; store-before-hull commit when opt-in.
 if(spec.file.endsWith("miningNpcOperations.js"))
  text=require("./coop-native-mining-cargo-integrity-patch.cjs").patchMiningCargo(text,remove);
 if(spec.file.endsWith("agent/agentMissionRuntime.js")||spec.file.endsWith("agent/missionRuntimeState.js")||spec.file.endsWith("dungeon/dungeonUniverseSiteService.js"))
  text=require("./coop-fleet-mission-native-patch.cjs").patch(text,spec.file,remove);
 if(spec.file==="server/src/services/agent/agentMissionRuntime.js")
  text=require("./coop-fleet-mission-join-patch.cjs").patch(text,spec.file,remove);
 if(spec.file.endsWith("industry/industryParityHelpers.js"))
  text=require("./coop-industry-time-patch.cjs").patch(text,spec.file,remove);
 if(spec.file==="server/index.js" || spec.file==="server/src/services/machoNet/machoNetService.js" ||
    spec.file==="server/src/services/contracts/contractRuntimeState.js")
  text=require("./coop-native-contract-routing-patch.cjs").patch(text,spec.file,remove);
  // CH23/30/37 reconciliation: original contractProxy remains the sole owner of
  // native item/ISK mutations; optional file-journal guard is default OFF.
  if(spec.file==="server/src/services/_other/contractProxyService.js")
   text=require("./coop-native-contract-mutation-fence-patch.cjs").patch(text,spec.file,remove);
 if(spec.file==="server/src/services/evermarks/lpStoreMgrService.js")
  text=require("./coop-native-lp-standing-patch.cjs").patch(text,spec.file,remove);
 if(spec.file.endsWith("/space/combat/killmailTracker.js")){
  // Install order: existing player damage patch, THEN native war
  // structure killmail witness. Remove in the exact inverse order.
  if(remove){
   text=require("./coop-war-structure-killmail-patch.cjs").patch(text,{remove:true});
   text=require("./coop-player-damage-native-patch.cjs").patch(text,{remove:true});
  }else{
   text=require("./coop-player-damage-native-patch.cjs").patch(text,{remove:false});
   text=require("./coop-war-structure-killmail-patch.cjs").patch(text,{remove:false});
  }
 }
 // CH31: native corporate custody/role fences; default OFF, reversible.
 if(["industry/industryAccess.js","inventory/invBrokerService.js",
     "corporation/corpRegistryRuntime.js","corporation/corpMemberActionState.js",
     "corporation/officeManagerService.js"].some(p=>spec.file==="server/src/services/"+p))
  text=require("./coop-player-corporation-access-patch.cjs").patch(text,spec.file,remove);
 // CH38: source-only native NPE hooks; never bypass the stock tutorial state.
 if(spec.file==="server/src/services/npe/airNpeService.js"||
    spec.file==="server/src/services/npe/nesIntroService.js"||
    spec.file==="server/src/services/account/tutorialSvcService.js"||
    spec.file==="server/src/services/character/achievementTrackerMgrService.js")
   text=require("./coop-npe-native-state-patch.cjs").patch(text,spec.file,remove);
 if(spec.file==="server/src/services/agent/agentMgrService.js"){
  // Remove job hooks first, then existing dialogue patch. Install in reverse.
  if(remove){
   text=require("./coop-faction-war-agent-patch.cjs").patch(text,{remove:true});
   text=require("./coop-native-job-agent-patch.cjs").patch(text,{remove:true});
   text=require("./coop-agent-dialogue-patch.cjs").patch(text,{remove:true});
  }else{
   text=require("./coop-agent-dialogue-patch.cjs").patch(text,{remove:false});
   text=require("./coop-native-job-agent-patch.cjs").patch(text,{remove:false});
   text=require("./coop-faction-war-agent-patch.cjs").patch(text,{remove:false});
  }
 }
 if(spec.file==="server/src/space/npc/nativeNpcWreckService.js")
  text=require("./coop-salvage-death-native-patch.cjs").patch(text,remove);
 if(!remove)for(const patch of spec.patches){
  const eol=text.includes("\r\n")?"\r\n":"\n";
  const anchor=patch.anchor.replace(/\n/g,eol);
  if(count(text,anchor)!==1)throw Error("Unknown or duplicate source anchor: "+spec.file+" "+patch.anchor);
  text=text.replace(anchor,patch.after?anchor+eol+patch.line:patch.line+eol+anchor);
 }
 if(spec.file.endsWith("miningNpcOperations.js")&&!remove)
  text=require("./coop-native-station-arrival-patch.cjs").patch(text,spec.file,false);
 if(spec.file==="server/src/gameStore/index.js"||spec.file==="server/src/gameStore/sqliteStore.js"||spec.file==="server/src/services/inventory/itemStore.js")
  text=require("./coop-gamestore-atomic-patch.cjs").patch(text,spec.file,remove);
 if(spec.file==="server/src/gameStore/index.js")
  text=require("./coop-npc-market-fills-table-patch.cjs").patch(text,spec.file,remove);
 if(spec.file==="server/src/gameStore/index.js")
  text=require("./coop-player-market-fills-table-patch.cjs").patch(text,spec.file,remove);
 if(spec.file==="server/src/services/character/characterState.js"||spec.file==="server/src/services/corporation/corporationRuntimeState.js")
  text=require("./coop-npc-account-cache-patch.cjs").patch(text,spec.file,remove);
 // Apply opt-in hooks LAST, inside the single transactional installer.
 if(!remove){
  for(const [helper,targets] of [
   ["./coop-player-ore-atomic-patch.cjs",ORE_PATCH_PATHS],
   ["./coop-structure-alliance-guard-patch.cjs",STRUCTURE_PATCH_PATHS],
   ["./coop-social-native-guards-patch.cjs",SOCIAL_PATCH_PATHS]
  ])if(targets.has(spec.file))text=require(helper).patch(text,spec.file,false);
 }
 new vm.Script(text,{filename:spec.file});
 return text;
}
// All sources are preflighted before the first write. Restore the failed
// item too: writeFileSync may have already truncated its destination.
function executePlan(changed,ops=fs){
 const attempted=[];
 try{
  for(const item of changed){
   attempted.push(item);
   if(item.after===null)ops.unlinkSync(item.file);
   else ops.writeFileSync(item.file,item.after,"utf8");
  }
 }catch(error){
  const rollbackFailures=[];
  for(const item of attempted.reverse()){
   try{
    if(item.before===null){if(ops.existsSync(item.file))ops.unlinkSync(item.file);}
    else ops.writeFileSync(item.file,item.before,"utf8");
   }catch(rollbackError){
    rollbackFailures.push(item.file);
    console.error("Source rollback failed:",item.file,rollbackError.message);
   }
  }
  if(rollbackFailures.length)
   throw Error("Overlay rollback incomplete: "+rollbackFailures.join(", "),{cause:error});
  throw error;
 }
}
function run({codePath,remove=false,dryRun=false}){
 const project=path.resolve(__dirname,".."),code=path.resolve(codePath);
 if(!fs.existsSync(path.join(code,"compose.yaml")))throw Error("Missing EveJS compose.yaml: "+code);
 const sha=execFileSync("git",["-C",path.dirname(code),"rev-parse","HEAD"],{encoding:"utf8"}).trim();
 if(sha!==PIN)throw Error("Refusing incompatible EveJS version "+sha);
 const plan=[];
 for(const spec of specs){
  const file=path.join(code,spec.file),before=fs.readFileSync(file,"utf8");
  const sourceState=classifyFile(before,spec,code);
  if(sourceState!=="PRISTINE"&&sourceState!=="PATCHED")
   throw Error("Refusing to modify drifted native source: "+spec.file+" ("+sourceState+")");
  plan.push({file,before,after:transform(before,spec,remove)});
 }
 for(const name of names){
  const file=path.join(code,"server/src/space",name+".js");
  const src=path.join(project,"integration",name+".cjs");
  if(!remove){
   const after=fs.readFileSync(src,"utf8");
   new vm.Script(after,{filename:src});
   plan.push({file,before:fs.existsSync(file)?fs.readFileSync(file,"utf8"):null,after});
  }else if(fs.existsSync(file)){
   const before=fs.readFileSync(file,"utf8");
   if(before!==fs.readFileSync(src,"utf8"))
    throw Error("Refusing to remove drifted overlay module: "+name);
   plan.push({file,before,after:null});
  }
 }
 const changed=plan.filter(p=>p.before!==p.after);
 if(!dryRun)executePlan(changed);
 return {status:dryRun?"DRY_RUN_OK":remove?"REMOVED":"INSTALLED",changed:changed.map(p=>path.relative(code,p.file))};
}
function l1CoveredFiles(){
 // L1 runs before this overlay: a file that legitimately differs from the pinned
 // commit because a pinned patch changed it is our baseline, not drift. The
 // applier refuses any sha256 or pin mismatch, so the patch content itself is
 // verified before this overlay is ever installed.
 if(l1CoveredFiles.cache)return l1CoveredFiles.cache;
 const covered=new Set();
 try{
  const manifest=JSON.parse(fs.readFileSync(
   path.join(__dirname,"..","patches","upstream","MANIFEST.json"),"utf8"));
  for(const entry of manifest.patches||[])
   for(const file of entry.files||[])covered.add(file);
 }catch(_error){/* no manifest: no L1 files to allow */}
 l1CoveredFiles.cache=covered;
 return covered;
}

function classifyFile(text,spec,code){
 const l1=false;
 try{
  const pristine=transform(text,spec,true);
  if(pristine!==text)return transform(pristine,spec,false)===text?"PATCHED":"DRIFTED";
  transform(text,spec,false);
  return spec.patches.some(p=>text.includes(p.line))?"DRIFTED":"PRISTINE";
 }catch(_error){
  if(l1CoveredFiles().has(spec.file))return "PRISTINE";
  // Chained patch modules legitimately refuse to REMOVE a hook that a pristine
  // file never had. Falling back to git HEAD tells the truth: a file identical
  // to HEAD is pristine, and a HEAD that our patches reproduce exactly is
  // patched. Only a real mismatch is drift.
  try{
   const repoRoot=path.dirname(code);
   const rel=path.relative(repoRoot,code).split(path.sep).join("/");
   const head=execFileSync("git",["-C",repoRoot,"show",
    "HEAD:"+(rel?rel+"/":"")+spec.file],
    {encoding:"utf8",maxBuffer:64*1024*1024});
   if(head===text)return "PRISTINE";
   try{if(transform(head,spec,false)===text)return "PATCHED";}catch(_readd){}
   return "DRIFTED";
  }catch(_head){return "ANCHOR_MISMATCH";}
 }
}
function check({codePath}){
 const project=path.resolve(__dirname,".."),code=path.resolve(codePath);
 if(!fs.existsSync(path.join(code,"compose.yaml")))throw Error("Missing EveJS compose.yaml: "+code);
 let sha="UNKNOWN";
 try{sha=execFileSync("git",["-C",path.dirname(code),"rev-parse","HEAD"],{encoding:"utf8"}).trim();}catch(_error){}
 const problems=[],files=[],modules=[];
 for(const spec of specs){
  const file=path.join(code,spec.file);
  const state=fs.existsSync(file)?classifyFile(fs.readFileSync(file,"utf8"),spec,code):"MISSING";
  files.push({file:spec.file,state});
  if(state!=="PRISTINE"&&state!=="PATCHED")problems.push({target:spec.file,kind:"native-source",state});
 }
 for(const name of names){
  const deployed=path.join(code,"server/src/space",name+".js");
  const source=path.join(project,"integration",name+".cjs");
  const state=!fs.existsSync(source)?"SOURCE_MISSING":!fs.existsSync(deployed)?"MISSING":
   fs.readFileSync(deployed,"utf8")===fs.readFileSync(source,"utf8")?"CURRENT":"STALE";
  modules.push({name,state});
  if(state!=="CURRENT")problems.push({target:"server/src/space/"+name+".js",kind:"overlay-module",state});
 }
 const pinMatches=sha===PIN;
 const counts={pristine:0,patched:0,drifted:0,anchorMismatch:0,missing:0,moduleCurrent:0,moduleStale:0,moduleMissing:0};
 for(const item of files){
  if(item.state==="PRISTINE")counts.pristine++;
  else if(item.state==="PATCHED")counts.patched++;
  else if(item.state==="DRIFTED")counts.drifted++;
  else if(item.state==="ANCHOR_MISMATCH")counts.anchorMismatch++;
  else counts.missing++;
 }
 for(const item of modules){
  if(item.state==="CURRENT")counts.moduleCurrent++;
  else if(item.state==="STALE")counts.moduleStale++;
  else counts.moduleMissing++;
 }
 const status=!pinMatches?"WRONG_PIN":problems.length?"OVERLAY_DRIFT":"OVERLAY_OK";
 return {status,pin:PIN,sha,pinMatches,counts,problems,files,modules};
}
if(require.main===module){
 try{
  const args=process.argv.slice(2),at=args.indexOf("--code-path");
  if(at<0||!args[at+1])throw Error("Usage: node patch-evejs-coop.cjs --code-path <EveJS/Code> [--remove] [--dry-run|--check]");
  const result=args.includes("--check")?check({codePath:args[at+1]}):run({codePath:args[at+1],remove:args.includes("--remove"),dryRun:args.includes("--dry-run")});
  if(args.includes("--check")){
   const {files:_files,modules:_modules,...summary}=result;
   console.log(JSON.stringify({...summary,problems:result.problems},null,2));
   if(result.status!=="OVERLAY_OK")process.exitCode=2;
  }else console.log(JSON.stringify(result,null,2));
 }catch(error){console.error("[COOP PATCH ERROR]",error.message);process.exitCode=1;}
}
module.exports={run,check,executePlan,classifyFile,transform,strip,specs,names,PIN};
