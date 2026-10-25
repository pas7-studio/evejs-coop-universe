"use strict";
// Patch ONLY the exact pinned EveJS mining startup logic, without
// inventing fleets or altering its native spawn service.
function count(source,needle){return source.split(needle).length-1;}
function patchStartupRecovery(source,remove=false){
 let text=String(source);
  const start=text.indexOf("function handleSceneCreated(scene) {");
  const finish=text.indexOf("function deactivateMiningModulesForEntity(",start);
  if(start<0||finish<=start)throw Error("Unknown EveJS mining startup function");
  const eol=text.includes("\r\n")?"\r\n":"\n";
  let section=text.slice(start,finish);
  const oldGuard="  startupSceneSeedSet.add(startupKey);";
  const newGuard=[
   '  if (process.env.EVEJS_COOP_MINING_STARTUP_RETRY !== "1")',
   '    startupSceneSeedSet.add(startupKey);'
  ].join(eol);
  const oldLoop="  for (let index = 0; index < fleetCount; index += 1) {";
  const newLoop=[
   oldLoop,
   '    if (process.env.EVEJS_COOP_MINING_STARTUP_RETRY === "1" &&',
   '      getMiningFleetsForSystem(scene.systemID).some(f => f.source === "startup" &&',
   '        f.startupKey === String(scene.systemID) + ":" + String(index + 1))) continue;'
  ].join(eol);
  const oldFailure=[
   '    if (!spawnResult.success || !spawnResult.data) {',
   '      continue;',
   '    }'
  ].join(eol);
  const newFailure=[
   '    if (!spawnResult.success || !spawnResult.data) {',
   '      if (process.env.EVEJS_COOP_MINING_STARTUP_RETRY === "1")',
   '        try { require("../../space/coopRuntimeProbe").observe("living-native-mining-startup-slot",',
   '          null,{spaceState:{systemID:scene.systemID}},',
   '          {status:"FAILED",fleetSlot:index+1,error:String(spawnResult.errorMsg||"NATIVE_SPAWN_FAILED").slice(0,120)}); }',
   '        catch (_coopError) { console.warn("[CoopMiningRetry]",_coopError.message); }',
   '      continue;',
   '    }'
  ].join(eol);
  const oldTail=['    });','  }','}',''].join(eol);
  const newTail=[
   '    });',
   '    if (process.env.EVEJS_COOP_MINING_STARTUP_RETRY === "1")',
   '      try { require("../../space/coopRuntimeProbe").observe("living-native-mining-startup-slot",',
   '        null,{spaceState:{systemID:scene.systemID}},',
   '        {status:"SEEDED",fleetSlot:index+1,',
   '         miners:(spawnResult.data.minerEntityIDs||[]).length,',
   '         haulers:(spawnResult.data.haulerEntityIDs||[]).length}); }',
   '      catch (_coopError) { console.warn("[CoopMiningRetry]",_coopError.message); }',
   '  }',
   '  if (process.env.EVEJS_COOP_MINING_STARTUP_RETRY === "1" &&',
   '    Array.from({length:fleetCount},(_,i)=>String(scene.systemID)+":"+String(i+1)).every(key=>',
   '      getMiningFleetsForSystem(scene.systemID).some(f=>f.source==="startup" && f.startupKey===key)))',
   '    startupSceneSeedSet.add(startupKey);',
   '}',
   ''
  ].join(eol);
  // The patched text embeds the old guard/loop as substrings.
  // Distinguish complete states by unique multi-line markers instead
  // of double-counting anchors, rejecting any partially-applied patch.
  const patched=count(section,newGuard)===1&&count(section,newLoop)===1&&
   count(section,newTail)===1&&count(section,newFailure)===1;
  const clean=count(section,newGuard)===0&&count(section,newLoop)===0&&
   count(section,newTail)===0&&count(section,newFailure)===0&&
   count(section,oldGuard)===1&&count(section,oldLoop)===1&&
   count(section,oldTail)===1&&count(section,oldFailure)===1;
  if(!patched&&!clean)throw Error("Unexpected native mining startup recovery source");
  if(remove&&patched){
   section=section.replace(newGuard,oldGuard).replace(newLoop,oldLoop)
    .replace(newTail,oldTail).replace(newFailure,oldFailure);
  }else if(!remove&&clean){
   section=section.replace(oldGuard,newGuard).replace(oldLoop,newLoop)
    .replace(oldTail,newTail).replace(oldFailure,newFailure);
  }
  text=text.slice(0,start)+section+text.slice(finish);
 return text;
}
module.exports={patchStartupRecovery};
