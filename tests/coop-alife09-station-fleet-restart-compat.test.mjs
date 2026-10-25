import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {patch:station,fileName}=require("../scripts/coop-native-station-arrival-patch.cjs");
const {patch:stable}=require("../scripts/coop-native-mining-stable-fleet-id-patch.cjs");
const {fleetIDForSlot}=require("../integration/coopNativeMiningFleetDurable.cjs");

function stationFixture(eol="\n"){
 return [
  "function spawnFleetWing(systemID, centerTarget, options = {}) {",
  "  const sharedSpawnOptions = {",
  "    transient: options.coopDurableNative === true && process.env.EVEJS_COOP_NATIVE_MINING_FLEET_DURABLE === \"1\" ? false : true,",
  "    operatorKind: options.coopDurableNative === true && process.env.EVEJS_COOP_NATIVE_MINING_FLEET_DURABLE === \"1\"",
  "      ? \"coop-mining-\" + systemID + \"-\" + options.coopSlotIndex + \"-\" + options.coopRole : null,",
  "  };",
  "}",
  "function resolveSessionScene(session) {}",
  "function spawnMiningFleetInternal(scene,options={}) {",
  " const haulerSpawnResult=spawnFleetWing(systemID,originAnchor,{",
  "      originAnchor,",
  "      warpIn: false,",
  " });",
  "}",
  "function issueResponseOrders() {}",
  "function tickMiningFleet(scene,fleetRecord,now,hooks){",
  "  if (fleetRecord.state === \"loaded\") {",
  "    const ingressMs = 1000;",
  "    if (fleetRecord.originAnchor && fleetRecord.originAnchor.position) {",
  "    }",
  "  }",
  "  if (fleetRecord.state === \"haulereturn\") {",
  "    if (now >= toFiniteNumber(fleetRecord.haulerReturnAtMs, 0)) {",
  "      if (process.env.EVEJS_COOP_NATIVE_HAUL_CARGO === \"1\") require(\"../../space/coopNativeHaulCargo\").unloadCargo(scene, fleetRecord);",
  "      fleetRecord.state = \"mining\";",
  "    }",
  "    return;",
  "  }",
  "  if (fleetRecord.state !== \"mining\") {",
  "  }",
  "}",
 ].join(eol);
}
for(const lineEnding of ["LF","CRLF"]){
 test("ALIFE-08 + physical station overlay "+lineEnding+" round-trips",()=>{
  const before=stationFixture(lineEnding==="LF"?"\n":"\r\n");
  const after=station(before,fileName,false);
  assert.match(after,/options\.durableHauler === true \|\| \(options\.coopDurableNative/);
  assert.match(after,/routeFromHaul/);
  assert.match(after,/checkReturn/);
  assert.equal(station(after,fileName,true),before);
  new Function(after);
 });
}
test("station delivery is durable independently of ALIFE-08, preserving normal NPC spawn",()=>{
 const before=stationFixture();
 const after=station(before,fileName);
 assert.match(after,/transient: options\.durableHauler === true \|\|/);
 assert.match(after,/EVEJS_COOP_NATIVE_MINING_FLEET_DURABLE === "1"/);
 assert.ok(after.includes('operatorKind: options.coopDurableNative === true'));
});
test("station overlay refuses half-applied ALIFE-08 source",()=>{
 const before=stationFixture().replace("    transient: options.coopDurableNative === true && process.env.EVEJS_COOP_NATIVE_MINING_FLEET_DURABLE === \"1\" ? false : true,",
  "    transient: options.durableHauler === true || (options.coopDurableNative === true && process.env.EVEJS_COOP_NATIVE_MINING_FLEET_DURABLE === \"1\") ? false : true,");
 assert.throws(()=>station(before,fileName,false),/STATION_ALIFE08_COEXISTENCE_TORN/);
});
const backtick=String.fromCharCode(96);
function fleetFixture(eol="\n"){
 return [
  "function createMiningFleetRecord(options = {}) {",
  " const fleetRecord = {",
  "    fleetID: nextMiningFleetID++,",
  "    source: String(options.source || \"gm\"),",
  " };",
  " return fleetRecord;",
  "}",
  "function handleSceneCreated(scene) {",
  "  // COOP_ALIFE08_DURABLE_NATIVE_MINING_STARTUP",
  "  if (process.env.EVEJS_COOP_NATIVE_MINING_FLEET_DURABLE === \"1\") {",
  "    return require(\"../../space/coopNativeMiningFleetDurable\").start({",
  "      register:(slot,spawnResult)=>createMiningFleetRecord({",
  "        source:\"startup\",startupKey:String(scene.systemID)+\":\"+String(slot),",
  "      }),",
  "    });",
  "  }",
  "}",
 ].join(eol);
}
for(const ending of ["LF","CRLF"]){
 test("stable startup native fleetID "+ending+" exact reverse and no duplicate registration",()=>{
  const before=fleetFixture(ending==="LF"?"\n":"\r\n");
  const after=stable(before);
  assert.match(after,/coopStableFleetID/);
  assert.match(after,/ALIFE09_NATIVE_FLEET_ID_COLLISION/);
  assert.match(after,/coopDurableFleetID:Number\(scene\.systemID\)\*32\+Number\(slot\)/);
  assert.equal(stable(after),after);
  assert.equal(stable(after,true),before);
  new Function(after);
 });
}
test("native fleetIDs deterministic, independent by system and fleet slot",()=>{
 const a=fleetIDForSlot(30000142,1);
 const b=fleetIDForSlot(30000142,2);
 const c=fleetIDForSlot(30000143,1);
 assert.ok(a>0&&a!==b&&a!==c&&b!==c);
 assert.equal(fleetIDForSlot(30000142,1),a);
 assert.equal(fleetIDForSlot(30000142,0),0);
 assert.equal(fleetIDForSlot(30000142,17),0);
});
