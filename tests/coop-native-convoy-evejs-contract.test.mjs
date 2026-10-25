import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {specs,transform}=require("../scripts/patch-evejs-coop.cjs");
const {createRenewal}=require("../integration/coopNativeConvoyRenewal.cjs");

test("exact pinned EveJS native startup hook is reversible and renews after actual 30m convoy loss",t=>{
 const codePath=process.env.EVEJS_COOP_CODE_PATH;
 if(!codePath){
  t.skip("Set EVEJS_COOP_CODE_PATH to the verified pinned EveJS Code checkout");
  return;
 }
 const file=path.join(codePath,"server/src/services/mining/miningNpcOperations.js");
 const native=fs.readFileSync(file,"utf8");
 const spec=specs.find(s=>s.file==="server/src/services/mining/miningNpcOperations.js");
 assert.ok(spec);
 const patched=transform(native,spec,false);
 new vm.Script(patched);
 assert.equal(transform(patched,spec,false),patched);
 assert.equal(transform(patched,spec,true),native);
 const start=patched.indexOf("function handleSceneCreated(scene) {");
 const finish=patched.indexOf("function deactivateMiningModulesForEntity(",start);
 assert.ok(start>=0&&finish>start);
 const source=patched.slice(start,finish)+";return handleSceneCreated;";
 let now=1000000,nextID=5000;
 const nativeShips=new Map(),fleets=[],calls=[];
 const systemID=30000144,seeded=new Set();
 const scene={systemID,staticEntities:[{kind:"asteroidBelt",itemID:99}],
  getEntityByID:id=>nativeShips.get(id)||null};
 const renewal=createRenewal({clock:()=>now,cooldownMs:1800000,
  retryMs:600000,dailyCap:4});
 const environment={env:{EVEJS_COOP_CONVOY_RENEWAL:"1",
  EVEJS_COOP_MINING_STARTUP_RETRY:"1"}};
 const config={miningNpcStartupEnabled:true,
  miningNpcStartupSystemIDs:String(systemID),
  miningNpcStartupFleetCount:1,
  miningNpcStartupFleetMinerCount:2,
  miningNpcStartupFleetHaulerCount:1,
  miningNpcFleetDefaultCount:2,miningNpcHaulerDefaultCount:1};
 const factory=new Function("require","process","config","parseSystemIdList",
  "toInt","startupSceneSeedSet","resolveStartupFleetCount",
  "ensureSceneMiningState","buildSpawnTarget","spawnMiningFleetInternal",
  "createMiningFleetRecord","getMiningFleetsForSystem",source);
 const nativeStart=factory(
  id=>id==="../../space/coopNativeConvoyRenewal"?
   {inspect:params=>renewal.inspect(params)}:
   id==="../../space/coopRuntimeProbe"?{observe(){}}:(()=>{throw Error(id)})(),
  environment,config,raw=>String(raw).split(",").map(Number),
  x=>Number(x)||0,seeded,()=>1,()=>{},()=>({position:{x:1,y:2,z:3}}),
  ()=>{
   const ids=[++nextID,++nextID,++nextID];
   for(const id of ids)nativeShips.set(id,{itemID:id,kind:"ship",nativeNpc:true});
   calls.push({at:now,ids});
   return {success:true,data:{minerEntityIDs:ids.slice(0,2),
    haulerEntityIDs:[ids[2]],minerSpawnResult:{data:{}},
    haulerSpawnResult:{data:{}}}};
  },
  row=>{fleets.push(row);return row},
  ()=>fleets
 );
 // First native bootstrap uses the actual upstream spawn path exactly once.
 nativeStart(scene);nativeStart(scene);
 assert.equal(calls.length,1);
 assert.equal(fleets[0].source,"startup");
 const destroyed=fleets.shift();
 for(const id of [...destroyed.minerEntityIDs,...destroyed.haulerEntityIDs])
  nativeShips.delete(id);
 nativeStart(scene);now+=1800000-1;nativeStart(scene);
 assert.equal(calls.length,1,"A real loss must not immediately respawn");
 now+=1;nativeStart(scene);
 assert.equal(calls.length,2);
 assert.equal(calls[1].at-calls[0].at,1800000);
 assert.equal(fleets.length,1);
 assert.equal(fleets[0].startupKey,systemID+":1");
 nativeStart(scene);
 assert.equal(calls.length,2,"An active renewed convoy must never duplicate");
});
