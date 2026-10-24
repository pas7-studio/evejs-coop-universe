import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {shouldTrackNativeScene,nativeMiningStartupPolicy}=
 require("../integration/coopHeadlessScenePolicy.cjs");
const scene={systemID:30000144,staticEntities:[{kind:"station",itemID:1}],
 getEntityByID:()=>null};
test("headless native static scene remains eligible for reconcile even with zero NPC links",()=>{
 assert.equal(shouldTrackNativeScene({systemID:30000144,scene,realWaypointCount:3}),true);
 assert.equal(shouldTrackNativeScene({systemID:30000144,scene,realWaypointCount:0}),false);
});
test("never treat wrong solar system, phantom scene or static-less stub as native world",()=>{
 assert.equal(shouldTrackNativeScene({systemID:30000142,scene,realWaypointCount:3}),false);
 assert.equal(shouldTrackNativeScene({systemID:30000144,
  scene:{systemID:30000144,staticEntities:[]},realWaypointCount:3}),false);
 assert.equal(shouldTrackNativeScene({systemID:30000144,
  scene:{...scene,staticEntities:null},realWaypointCount:3}),false);
});
test("actual Perimeter starter fleet config allows system with real belts",()=>{
 const p=nativeMiningStartupPolicy({systemID:30000144,sdeBelts:3,sceneBelts:3,
  environment:{EVEJS_MINING_NPC_STARTUP_ENABLED:"true",
   EVEJS_MINING_NPC_STARTUP_SYSTEM_IDS:"30000144"}});
 assert.equal(p.status,"MINING_STARTUP_ELIGIBLE");
 assert.equal(p.configuredForSystem,true);
});
test("Jita cannot spawn a fake starter mining fleet outside selected system",()=>{
 const p=nativeMiningStartupPolicy({systemID:30000142,sdeBelts:0,sceneBelts:0,
  environment:{EVEJS_MINING_NPC_STARTUP_ENABLED:"true",
   EVEJS_MINING_NPC_STARTUP_SYSTEM_IDS:"30000144"}});
 assert.equal(p.status,"NATIVE_MINING_STARTUP_EXCLUDES_SYSTEM");
 assert.equal(p.configuredForSystem,false);
});
test("real Perimeter belts without startup config provide actionable blocker",()=>{
 const noStart=nativeMiningStartupPolicy({systemID:30000144,sdeBelts:3,sceneBelts:3,
  environment:{EVEJS_MINING_NPC_STARTUP_ENABLED:"false",
   EVEJS_MINING_NPC_STARTUP_SYSTEM_IDS:"30000144"}});
 assert.equal(noStart.status,"NATIVE_MINING_STARTUP_DISABLED");
 const noScene=nativeMiningStartupPolicy({systemID:30000144,sdeBelts:3,sceneBelts:0,
  environment:{EVEJS_MINING_NPC_STARTUP_ENABLED:"true",
   EVEJS_MINING_NPC_STARTUP_SYSTEM_IDS:"30000144"}});
 assert.equal(noScene.status,"SYSTEM_SDE_BELTS_NOT_IN_SCENE");
});
test("unset startup system selection means upstream's all-system default, never invented fleet proof",()=>{
 const p=nativeMiningStartupPolicy({systemID:30000144,sdeBelts:3,sceneBelts:3,
  environment:{EVEJS_MINING_NPC_STARTUP_ENABLED:"1"}});
 assert.equal(p.startupSystemSelection,"DEFAULT");
 assert.equal(p.status,"MINING_STARTUP_ELIGIBLE");
});
