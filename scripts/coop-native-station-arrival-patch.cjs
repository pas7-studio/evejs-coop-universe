"use strict";
// Overlay on top of the existing pinned miningNpcOperations native-haul patch.
// Installing/removing is byte-exact, including CRLF sources.
const fileName="server/src/services/mining/miningNpcOperations.js";
function patch(source,file,remove=false){
 if(file!==fileName)return source;
 const eol=source.includes("\r\n")?"\r\n":"\n";
 const once=(s,oldValue,newValue,label="anchor",soft=false)=>{
  const needle=remove?newValue:oldValue;
  const hits=s.split(needle).length-1;
  // The durable-fleet patch owns the spawn transient flag now, so an absent
  // anchor there is a legitimate hand-off, not drift. Every other anchor stays
  // strict: naming it turns an opaque drift into an actionable message.
  if(hits!==1){
   if(soft&&hits===0)return s;
   throw Error("STATION_ARRIVAL_ANCHOR_DRIFT:"+label+":"+hits);
  }
  return s.replace(needle,remove?oldValue:newValue);
 };
 let text=source;
 const durableOld="    transient: true,";
 const durableNew='    transient: options.durableHauler === true ? false : true,';
 // ALIFE-08 owns persistent startup miners and haulers. Preserve its native
 // branch and add physical station-hauler durability as a separate OR gate.
 // On removal restore ALIFE-08's expression byte-exact, not vanilla transient.
 const alife08Old='    transient: options.coopDurableNative === true && process.env.EVEJS_COOP_NATIVE_MINING_FLEET_DURABLE === "1" ? false : true,';
 const alife08New='    transient: options.durableHauler === true || (options.coopDurableNative === true && process.env.EVEJS_COOP_NATIVE_MINING_FLEET_DURABLE === "1") ? false : true,';
 const wingA=text.indexOf("function spawnFleetWing(");
 const wingB=text.indexOf("function resolveSessionScene(",wingA);
 if(wingA<0||wingB<0)throw Error("STATION_WING_DRIFT");
 const wing=text.slice(wingA,wingB);
 const withAlife08=remove?wing.includes(alife08New):wing.includes(alife08Old);
 const from=withAlife08?alife08Old:durableOld;
 const to=withAlife08?alife08New:durableNew;
 // Never fall back to vanilla when the coexisting patch is partially applied.
 if(remove&&wing.includes(alife08Old)&&!withAlife08)
   throw Error("STATION_ALIFE08_COEXISTENCE_TORN");
 if(!remove&&wing.includes(alife08New))
   throw Error("STATION_ALIFE08_COEXISTENCE_TORN");
 text=text.slice(0,wingA)+once(wing,from,to)+text.slice(wingB);
 const haulerCall='      originAnchor,'+eol+'      warpIn: false,';
 const haulerNew='      originAnchor,'+eol+'      durableHauler: process.env.EVEJS_COOP_NPC_STATION_DELIVERY === "1",'+eol+'      warpIn: false,';
 const spawnA=text.indexOf("function spawnMiningFleetInternal(");
 const spawnB=text.indexOf("function issueResponseOrders(",spawnA);
 if(spawnA<0||spawnB<0)throw Error("STATION_SPAWN_DRIFT");
 text=text.slice(0,spawnA)+once(text.slice(spawnA,spawnB),haulerCall,haulerNew,"hauler")+text.slice(spawnB);
 const loadedA=text.indexOf('  if (fleetRecord.state === "loaded") {');
 const loadedB=text.indexOf('  if (fleetRecord.state === "haulereturn") {',loadedA);
 if(loadedA<0||loadedB<0)throw Error("STATION_LOADED_DRIFT");
 const loadedOld='    if (fleetRecord.originAnchor && fleetRecord.originAnchor.position) {';
 const loadedNew='    if (process.env.EVEJS_COOP_NPC_STATION_DELIVERY === "1") {'+eol+
 '      require("../../space/coopNativeStationArrival").routeFromHaul(scene, fleetRecord, npcService.runtime, now, ingressMs);'+eol+
 '      // A station trip is a PHYSICAL trip. Falling straight through to the'+eol+
 '      // native return-home transition made the fleet enter "haulereturn" with'+eol+
 '      // no active trip, where checkReturn could only report ROUTE_NOT_STARTED'+eol+
 '      // forever: the ore was never delivered and the fleet never mined again.'+eol+
 '      const settled = require("../../space/coopNativeStationArrival").checkReturn(scene, fleetRecord, now);'+eol+
 '      const delivered = settled.terminal === true && (settled.status === "DELIVERED" || settled.status === "NO_CARGO");'+eol+
 '      if (!delivered) { fleetRecord.nextThinkAtMs = now + 1000; return; }'+eol+
 '      require("../../space/coopRuntimeProbe").observe("living-native-haul-delivered", null, { spaceState: { systemID: scene.systemID } }, { fleetID: toInt(fleetRecord.fleetID, 0), status: String((settled && settled.status) || ""), stationID: toInt(settled && settled.stationID, 0) });'+eol+
 '      fleetRecord.haulerNextArrivalAtMs = now + getHaulerRepeatDelayMs();'+eol+
 '      fleetRecord.state = "mining";'+eol+
 '      fleetRecord.haulerReturnAtMs = 0;'+eol+
 '      fleetRecord.nextThinkAtMs = now + 1000;'+eol+
 '      return;'+eol+
 '    } else if (fleetRecord.originAnchor && fleetRecord.originAnchor.position) {';
 text=text.slice(0,loadedA)+once(text.slice(loadedA,loadedB),loadedOld,loadedNew,"loaded")+text.slice(loadedB);
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
 if(remove){segment=once(segment,unloadOld,unloadNew,"unload");segment=once(segment,returnOld,returnNew,"return");}
 else{segment=once(segment,returnOld,returnNew,"return");segment=once(segment,unloadOld,unloadNew,"unload");}
 return text.slice(0,returnA)+segment+text.slice(returnB);
}
module.exports={patch,fileName};