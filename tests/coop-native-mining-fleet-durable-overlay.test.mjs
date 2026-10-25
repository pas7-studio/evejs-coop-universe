import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {patch}=require("../scripts/coop-native-mining-durable-patch.cjs");
const startupExpression=String.fromCharCode(96)+String.fromCharCode(36)+
 "{toInt(scene.systemID, 0)}:"+String.fromCharCode(36)+"{resolveStartupFleetCount()}"+
 String.fromCharCode(96);
const source=[
 "function spawnFleetWing(systemID, centerTarget, options = {}) {",
 "  const sharedSpawnOptions = {",
 "    transient: true,",
 "    broadcast: false,",
 "  };",
 "}",
 "function resolveSessionScene(session) { return session; }",
 "function spawnMiningFleetInternal(scene, options = {}) {",
 "  const resolvedMinerQuery='ore';",
 "  const resolvedHaulerQuery='haul';",
 "  const minerSpawnResult=spawnFleetWing(1,null,{",
 "    profileQuery: resolvedMinerQuery,",
 "    preferredTargetID: 0,",
 "  });",
 "  const haulerSpawnResult=spawnFleetWing(1,null,{",
 "      profileQuery: resolvedHaulerQuery,",
 "      preferredTargetID: 0,",
 "  });",
 "}",
 "function handleSceneCreated(scene) {",
 "  const startupKey = "+startupExpression+";",
 "}",
].join("\n")+"\n";
for(const newline of ["LF","CRLF"]){
 test("pinned durable miner/hauler source patch "+newline+" reverts byte-exact",()=>{
  const original=newline==="LF"?source:source.replace(/\n/g,"\r\n");
  const patched=patch(original);
  assert.notEqual(patched,original);
  assert.equal(patch(patched),patched);
  assert.equal(patch(patched,true),original);
  new Function(patched);
 });
}
test("only durable startup receives persistent spawn and a native operator marker",()=>{
 const result=patch(source);
 assert.match(result,/options\.coopDurableNative === true/);
 assert.match(result,/process\.env\.EVEJS_COOP_NATIVE_MINING_FLEET_DURABLE === "1"/);
 assert.match(result,/coop-mining-/);
 assert.match(result,/coopRole: "miner"/);
 assert.match(result,/coopRole: "hauler"/);
 assert.match(result,/coopNativeMiningFleetDurable/);
});
test("partial source patch fails rather than silently keeping hybrid state",()=>{
 const full=patch(source).replace('coopRole: "hauler"','coopRole: "bad"');
 assert.throws(()=>patch(full,true),/ALIFE08_PARTIAL_INSTALL/);
});
test("original fleet spawn stays transient unless BOTH startup flag and durable option",()=>{
 const result=patch(source);
 assert.match(result,/transient: options\.coopDurableNative === true && process\.env\.EVEJS_COOP_NATIVE_MINING_FLEET_DURABLE === "1" \? false : true/);
});
