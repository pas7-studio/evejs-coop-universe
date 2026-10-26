"use strict";
// Reversible pinned upstream source patch. Only startup mining fleets opt in.
const durableWing=[
 '    transient: options.coopDurableNative === true && process.env.EVEJS_COOP_NATIVE_MINING_FLEET_DURABLE === "1" ? false : true,',
 '    operatorKind: options.coopDurableNative === true && process.env.EVEJS_COOP_NATIVE_MINING_FLEET_DURABLE === "1"',
 '      ? "coop-mining-" + systemID + "-" + options.coopSlotIndex + "-" + options.coopRole : null,',
].join("\n");
const originalWing='    transient: true,';
const minerFrom='    profileQuery: resolvedMinerQuery,\n    preferredTargetID: 0,';
const minerTo='    profileQuery: resolvedMinerQuery,\n    coopDurableNative: options.coopDurableNative === true,\n    coopSlotIndex: options.coopSlotIndex,\n    coopRole: "miner",\n    preferredTargetID: 0,';
const haulerFrom='      profileQuery: resolvedHaulerQuery,\n      preferredTargetID: 0,';
const haulerTo='      profileQuery: resolvedHaulerQuery,\n      coopDurableNative: options.coopDurableNative === true,\n      coopSlotIndex: options.coopSlotIndex,\n      coopRole: "hauler",\n      preferredTargetID: 0,';
const bootFrom='  const startupKey = '+String.fromCharCode(96)+
 '$'+'{toInt(scene.systemID, 0)}:$'+'{resolveStartupFleetCount()}'+String.fromCharCode(96)+';';
const bootCall=[
 '  // COOP_ALIFE08_DURABLE_NATIVE_MINING_STARTUP',
 '  if (process.env.EVEJS_COOP_NATIVE_MINING_FLEET_DURABLE === "1") {',
 '    return require("../../space/coopNativeMiningFleetDurable").start({',
 '      scene, fleetCount:resolveStartupFleetCount(),',
 '      ensureState:()=>ensureSceneMiningState(scene),',
 '      getFleets:()=>getMiningFleetsForSystem(scene.systemID),',
 '      spawn:(slot,wing={})=>spawnMiningFleetInternal(scene,{',
 '        systemID:scene.systemID, centerTarget:buildSpawnTarget(scene),',
 '        preferredTargetID:0, coopDurableNative:true,coopSlotIndex:slot,',
 '        minerAmount:wing.miners!==undefined?Math.max(0,toInt(wing.miners,0)):Math.max(1,toInt(config.miningNpcStartupFleetMinerCount,config.miningNpcFleetDefaultCount||DEFAULT_MINING_FLEET_COUNT)),',
 '        minerQuery:String(require("../../space/coopFleetComposition").query("miner",{gameStore:require("../gameStore")})||String(config.miningNpcStartupFleetProfileOrPool||config.miningNpcFleetProfileOrPool||"")),',
 '        haulerAmount:wing.haulers!==undefined?Math.max(0,toInt(wing.haulers,0)):Math.max(0,toInt(config.miningNpcStartupFleetHaulerCount,config.miningNpcHaulerDefaultCount||DEFAULT_MINING_HAULER_COUNT)),',
 '        haulerQuery:String(require("../../space/coopFleetComposition").query("hauler",{gameStore:require("../gameStore")})||String(config.miningNpcStartupHaulerProfileOrPool||config.miningNpcHaulerProfileOrPool||"")),',
 '      }),',
 '      register:(slot,spawnResult)=>createMiningFleetRecord({',
 '        source:"startup",startupKey:String(scene.systemID)+":"+String(slot),',
 '        systemID:scene.systemID,targetShipID:0,',
 '        minerEntityIDs:spawnResult.minerEntityIDs,',
 '        haulerEntityIDs:spawnResult.haulerEntityIDs,',
 '        originAnchor:spawnResult.originAnchor,',
 '      }),',
 '    });',
 '  }',
].join("\n");
function changeOnce(text,a,b){
 if(text.split(a).length!==2)throw Error("ALIFE08_PINNED_NATIVE_ANCHOR_MISMATCH:"+a.slice(0,64));
 return text.replace(a,b);
}
function patch(source,remove=false){
 const eol=String(source).includes("\r\n")?"\r\n":"\n";
 const n=x=>x.replace(/\n/g,eol);
 let text=String(source);
 const first=n("function spawnFleetWing(systemID, centerTarget, options = {}) {");
 if(!text.includes(first))throw Error("ALIFE08_NATIVE_SPAWN_ENTRYPOINT_MISSING");
 // Target only the spawnFleetWing function, never any other transient:true.
 const targetStart=text.indexOf(first);
 const targetEnd=text.indexOf(n("function resolveSessionScene("),targetStart);
 if(targetEnd<0)throw Error("ALIFE08_NATIVE_SPAWN_BOUNDARY_UNKNOWN");
 let wing=text.slice(targetStart,targetEnd);
 const replacement=n(durableWing);
 const installed=wing.includes(replacement);
 const bootstrap=text.includes(n(bootCall));
 if(installed!==bootstrap || (installed && (!text.includes(n(minerTo)) || !text.includes(n(haulerTo)))))
  throw Error("ALIFE08_PARTIAL_INSTALL");
 if(remove&&!installed)return text;
 if(!remove&&installed)return text;
 if(remove){
  text=changeOnce(text,n(bootCall)+eol,"");
  text=changeOnce(text,n(minerTo),n(minerFrom));
  text=changeOnce(text,n(haulerTo),n(haulerFrom));
  text=changeOnce(text,replacement,n(originalWing));
 }else{
  wing=changeOnce(wing,n(originalWing),replacement);
  text=text.slice(0,targetStart)+wing+text.slice(targetEnd);
  text=changeOnce(text,n(minerFrom),n(minerTo));
  text=changeOnce(text,n(haulerFrom),n(haulerTo));
  text=changeOnce(text,n(bootFrom),n(bootCall)+eol+n(bootFrom));
 }
 return text;
}
module.exports={patch};
