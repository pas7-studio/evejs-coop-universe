"use strict";
// Overlay on top of the existing pinned miningNpcOperations native-haul patch.
// Installing/removing is byte-exact, including CRLF sources.
const fileName="server/src/services/mining/miningNpcOperations.js";
function patch(source,file,remove=false){
 if(file!==fileName)return source;
 const eol=source.includes("\r\n")?"\r\n":"\n";
 const once=(s,oldValue,newValue)=>{
  if(s.split(remove?newValue:oldValue).length!==2)throw Error("STATION_ARRIVAL_ANCHOR_DRIFT");
  return s.replace(remove?newValue:oldValue,remove?oldValue:newValue);
 };
 let text=source;
 const durableOld="    transient: true,";
 const durableNew='    transient: options.durableHauler === true ? false : true,';
 const wingA=text.indexOf("function spawnFleetWing(");
 const wingB=text.indexOf("function resolveSessionScene(",wingA);
 if(wingA<0||wingB<0)throw Error("STATION_WING_DRIFT");
 text=text.slice(0,wingA)+once(text.slice(wingA,wingB),durableOld,durableNew)+text.slice(wingB);
 const haulerCall='      originAnchor,'+eol+'      warpIn: false,';
 const haulerNew='      originAnchor,'+eol+'      durableHauler: process.env.EVEJS_COOP_NPC_STATION_DELIVERY === "1",'+eol+'      warpIn: false,';
 const spawnA=text.indexOf("function spawnMiningFleetInternal(");
 const spawnB=text.indexOf("function issueResponseOrders(",spawnA);
 if(spawnA<0||spawnB<0)throw Error("STATION_SPAWN_DRIFT");
 text=text.slice(0,spawnA)+once(text.slice(spawnA,spawnB),haulerCall,haulerNew)+text.slice(spawnB);
 const loadedA=text.indexOf('  if (fleetRecord.state === "loaded") {');
 const loadedB=text.indexOf('  if (fleetRecord.state === "haulereturn") {',loadedA);
 if(loadedA<0||loadedB<0)throw Error("STATION_LOADED_DRIFT");
 const loadedOld='    if (fleetRecord.originAnchor && fleetRecord.originAnchor.position) {';
 const loadedNew='    if (process.env.EVEJS_COOP_NPC_STATION_DELIVERY === "1") {'+eol+
 '      require("../../space/coopNativeStationArrival").routeFromHaul(scene, fleetRecord, npcService.runtime, now, ingressMs);'+eol+
 '    } else if (fleetRecord.originAnchor && fleetRecord.originAnchor.position) {';
 text=text.slice(0,loadedA)+once(text.slice(loadedA,loadedB),loadedOld,loadedNew)+text.slice(loadedB);
 const returnA=text.indexOf('  if (fleetRecord.state === "haulereturn") {');
 const returnB=text.indexOf('  if (fleetRecord.state !== "mining") {',returnA);
 if(returnA<0||returnB<0)throw Error("STATION_RETURN_DRIFT");
 const returnOld='    if (now >= toFiniteNumber(fleetRecord.haulerReturnAtMs, 0)) {';
 const returnNew='    if (process.env.EVEJS_COOP_NPC_STATION_DELIVERY === "1") {'+eol+
 '      const arrival = require("../../space/coopNativeStationArrival").checkReturn(scene, fleetRecord, now);'+eol+
 '      if (arrival.terminal === true) {'+eol+
 '        fleetRecord.state = "mining";'+eol+
 '        fleetRecord.haulerReturnAtMs = 0;'+eol+
 '      } else { fleetRecord.nextThinkAtMs = now + 1000; }'+eol+
 '    } else if (now >= toFiniteNumber(fleetRecord.haulerReturnAtMs, 0)) {';
 const unloadOld='      if (process.env.EVEJS_COOP_NATIVE_HAUL_CARGO === "1") require("../../space/coopNativeHaulCargo").unloadCargo(scene, fleetRecord);';
 const unloadNew='      if (process.env.EVEJS_COOP_NATIVE_HAUL_CARGO === "1" && process.env.EVEJS_COOP_NPC_STATION_DELIVERY !== "1") require("../../space/coopNativeHaulCargo").unloadCargo(scene, fleetRecord);';
 let segment=text.slice(returnA,returnB);
 // On remove reverse dependencies in reverse order.
 if(remove){segment=once(segment,unloadOld,unloadNew);segment=once(segment,returnOld,returnNew);}
 else{segment=once(segment,returnOld,returnNew);segment=once(segment,unloadOld,unloadNew);}
 return text.slice(0,returnA)+segment+text.slice(returnB);
}
module.exports={patch,fileName};