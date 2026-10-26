#!/usr/bin/env node
// EX-03B7 — execute PRODUCTION NPC probe state machines against pinned
// nativeNpcStore + real sqlite-backed gameStore, with OS SIGKILL between phases.
// Requires a pinned checkout and its installed dependencies. The scene is
// deliberately a controlled native-shaped fixture, NOT a real two-client test.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
const require=createRequire(import.meta.url);
const self=fileURLToPath(import.meta.url);
const {createNativeNpcProbeFlight}=require("../integration/coopNativeNpcProbeFlight.cjs");
const {createNpcProbeHardware}=require("../integration/coopNpcProbeHardware.cjs");
const {createNativeNpcProbeSweep}=require("../integration/coopNativeNpcProbeSweep.cjs");
const {createNativeNpcProbeLifecycle}=require("../integration/coopNativeNpcProbeLifecycle.cjs");

const entityID=980000068001,ownerID=901,corporationID=700;
const systemID=30000142,moduleID=980100068001;
const cargoIDs=[980200068001,980200068002,980200068003,980200068004];
const launchNow=1000000;
function assertDisposableNativeStore(){
 const root=process.env.EVEJS_TEST_STORE_ROOT;
 const data=process.env.EVEJS_GAMESTORE_DATA_DIR;
 assert.equal(process.env.EVEJS_TEST_STORE_ISOLATED,"1",
  "EX03_DISPOSABLE_ISOLATION_FLAG_REQUIRED");
 assert(root&&data,"EX03_DISPOSABLE_DATA_ROOT_REQUIRED");
 const absoluteRoot=path.resolve(root),absoluteData=path.resolve(data);
 assert.equal(absoluteData,path.join(absoluteRoot,"data"),
  "EX03_MUST_USE_DEDICATED_DATA_CHILD");
 assert.equal(path.dirname(absoluteRoot),path.resolve(os.tmpdir()),
  "EX03_STORE_MUST_BE_CREATED_UNDER_OS_TEMPDIR");
 assert(path.basename(absoluteRoot).startsWith("evejs-ex03b7-"),
  "EX03_UNEXPECTED_TEST_ROOT_PREFIX");
 assert.equal(fs.realpathSync(absoluteRoot),absoluteRoot,
  "EX03_TEST_ROOT_SYMLINK_FORBIDDEN");
 assert.equal(fs.realpathSync(absoluteData),absoluteData,
  "EX03_TEST_DATA_SYMLINK_FORBIDDEN");
 const att=JSON.parse(fs.readFileSync(
  path.join(absoluteRoot,".evejs-test-store-attestation.json"),"utf8"));
 assert.equal(att.kind,"evejs-test-store");
 assert.equal(att.schemaVersion,1);
 assert.equal(att.createdBy,"server/tests/helpers/isolatedGameStore.js");
 assert.equal(path.resolve(att.storeRoot),absoluteRoot);
 assert.equal(path.resolve(att.dataDir),absoluteData);
}
function nativeModules(){
 assertDisposableNativeStore();
 const server=process.env.EVEJS_PINNED_SERVER;
 assert(server&&fs.existsSync(path.join(server,"src/gameStore/index.js")),
  "EX03B7_REQUIRES_PINNED_NATIVE_SERVER");
 const store=require(path.join(server,"src/gameStore/index.js"));
 const native=require(path.join(server,"src/space/npc/nativeNpcStore.js"));
 assert(store._sqliteTables.has("npcCargo"),"EX03B7_NPC_CARGO_NOT_SQLITE");
 assert.equal(path.resolve(store._dataDir),path.resolve(process.env.EVEJS_GAMESTORE_DATA_DIR));
 return {store,native};
}
function fixture(native,stage){
 const existing=native.listNativeCargoForEntity(entityID);
 const recall=stage==="recall-2"||stage==="recall-again-2";
 const recalledPosition=existing.find(x=>x.cargoID===cargoIDs[1])?.deployedProbe?.position;
 const ship={itemID:entityID,kind:"ship",nativeNpc:true,ownerID,
  corporationID,systemID,position:recall&&recalledPosition?
   {...recalledPosition}:{x:0,y:0,z:0}};
 const items=new Map([[entityID,ship]]);
 for(const row of existing){
  const p=row.deployedProbe;
  if(p?.status!=="IN_SPACE")continue;
  items.set(row.cargoID,{
   itemID:row.cargoID,kind:"probe",nativeNpcProbe:true,
   nativeNpcCargoID:row.cargoID,ownerID,typeID:row.typeID,systemID,
   position:{...p.position},targetPoint:{...p.position}
  });
 }
 const scene={systemID,getEntityByID:id=>items.get(id),
  spawnDynamicEntity:obj=>{
   if(items.has(obj.itemID))return {success:false};
   items.set(obj.itemID,obj);return {success:true};
  }};
 const assignments=[{entityID,systemID,pilotID:"coop-pilot-777"}];
 const deps={
  getNativeEntity:id=>native.getNativeEntity(id),
  getController:id=>native.getNativeController(id),
  listNativeCargoForEntity:id=>native.listNativeCargoForEntity(id),
  upsertNativeCargo:row=>native.upsertNativeCargo(row),
  listNativeModulesForEntity:id=>native.listNativeModulesForEntity(id),
  flushNpcCargo:()=>nativeModules().store.flushTableSync("npcCargo"),
  refreshNativeCargoProjection:(hull,id)=>{
   const snapshot=native.buildNativeCargoItems(id);
   if(!Array.isArray(snapshot))return false;
   hull.nativeCargoItems=snapshot.filter(x=>Number.isSafeInteger(x.quantity)&&x.quantity>0);
   return true;
  },
  relocateNativeProbe:({scene:current,row})=>{
   const probe=current.getEntityByID(row.cargoID);
   if(!probe||probe.nativeNpcCargoID!==row.cargoID)return {success:false};
   probe.position={...row.deployedProbe.position};
   probe.targetPoint={...row.deployedProbe.position};
   return {success:true};
  },
  clock:()=>stage.startsWith("expire")||stage==="verify"?
   launchNow+3600001:launchNow
 };
 const hardware=createNpcProbeHardware({...deps,
  getCompatibleProbeChargeTypeIDs:launcher=>launcher===17938?[30013]:[]
 });
 const flight=createNativeNpcProbeFlight({...deps,
  compatibleCharges:launcher=>launcher===17938?[30013]:[],
  resolveProbeRange:(_type,step)=>({rangeStep:step,scanRange:1e10}),
  buildProbeSceneEntity:(p,opts)=>({
   itemID:p.probeID,kind:"probe",ownerID:opts.ownerID,
   systemID:opts.systemID,typeID:p.typeID,
   position:{x:p.pos[0],y:p.pos[1],z:p.pos[2]}
  })
 });
 const sweep=createNativeNpcProbeSweep({...deps,cellSpacingMeters:2e10});
 const lifecycle=createNativeNpcProbeLifecycle({...deps,
  removeNativeProbe:(_sys,id)=>{items.delete(id);return {success:true}}});
 return {scene,ship,items,assignments,hardware,flight,sweep,lifecycle};
}
function child(stage){
 const {store,native}=nativeModules();
 if(stage==="seed"){
  assert.equal(native.listNativeCargoForEntity(entityID).length,0);
  for(const [table,record,method] of [
   ["npcEntities",{entityID,systemID,ownerID,corporationID,transient:false},"upsertNativeEntity"],
   ["npcModules",{moduleID,entityID,ownerID,typeID:17938,groupID:481,
    categoryID:7,flagID:11,moduleState:{online:true}},"upsertNativeModule"],
   ["npcRuntimeControllers",{entityID,systemID},"upsertNativeController"]]){
   const res=native[method](record);
   assert.equal(res.success,true,table+" "+JSON.stringify(res));
  }
  for(const cargoID of cargoIDs){
   const res=native.upsertNativeCargo({cargoID,entityID,ownerID,moduleID,
    typeID:30013,groupID:479,categoryID:8,quantity:1,singleton:false});
   assert.equal(res.success,true,JSON.stringify(res));
  }
  for(const table of ["npcEntities","npcModules","npcRuntimeControllers","npcCargo"])
   assert.equal(store.flushTableSync(table).success,true,table+"_FLUSH_FAILED");
 }else{
  const runtime=fixture(native,stage);
  const args={scene:runtime.scene,entityID,assignments:runtime.assignments};
  const sourceBefore=native.listNativeCargoForEntity(entityID);
  assert.equal(sourceBefore.length,4,"EXACTLY_FOUR_ORIGINAL_CARGO_ROWS");
  if(/^launch-[1-4]$/.test(stage)){
   const i=Number(stage.split("-")[1])-1;
   if(i===0){
    const ready=runtime.hardware.check(args);
    assert.equal(ready.status,"NATIVE_SCANNER_HARDWARE_READY",JSON.stringify(ready));
    assert.equal(ready.availableUnits,4);
   }
   assert.equal(sourceBefore.filter(r=>r.deployedProbe?.status==="IN_SPACE").length,i);
   const result=runtime.flight.tick(args);
   assert.equal(result.status,"NATIVE_PROBE_LAUNCHED",JSON.stringify(result));
   assert.equal(result.cargoID,cargoIDs[i]);
  }else if(stage==="sweep-1"){
   const result=runtime.sweep.tick(args);
   assert.equal(result.status,"SWEEP_ORIGINAL_PROBE_MOVED",JSON.stringify(result));
   assert.equal(result.originalCargoID,cargoIDs[0]);
  }else if(stage==="recall-2"){
   const result=runtime.lifecycle.tick({...args,requestRecall:true});
   assert.equal(result.status,"NPC_PROBE_RECALL_COMMITTED",JSON.stringify(result));
   assert.equal(result.cargoID,cargoIDs[1]);
  }else if(stage==="stow-2"||stage==="stow-again-2"){
   const result=runtime.lifecycle.tick(args);
   assert.equal(result.status,"NPC_PROBE_RETURNED",JSON.stringify(result));
   assert.equal(result.cargoID,cargoIDs[1]);
  }else if(stage==="relaunch-2"){
   const ready=runtime.hardware.check(args);
   assert.equal(ready.status,"NATIVE_SCANNER_HARDWARE_READY",JSON.stringify(ready));
   assert.equal(ready.availableUnits,1);
   assert.equal(sourceBefore[1]?.deployedProbe?.status,"STOWED");
   assert.equal(sourceBefore[1]?.quantity,1);
   const result=runtime.flight.tick(args);
   assert.equal(result.status,"NATIVE_PROBE_LAUNCHED",JSON.stringify(result));
   assert.equal(result.cargoID,cargoIDs[1],"NO_NEW_CARGO_ID_ON_RELAUNCH");
  }else if(stage==="recall-again-2"){
   const result=runtime.lifecycle.tick({...args,requestRecall:true});
   assert.equal(result.status,"NPC_PROBE_RECALL_COMMITTED",JSON.stringify(result));
   assert.equal(result.cargoID,cargoIDs[1]);
  }else if(stage==="expire-1"){
   const result=runtime.lifecycle.tick(args);
   assert.equal(result.status,"NPC_PROBE_EXPIRY_COMMITTED",JSON.stringify(result));
   assert.equal(result.cargoID,cargoIDs[0]);
  }else if(stage==="verify"){
   const rows=native.listNativeCargoForEntity(entityID);
   assert.deepEqual(rows.map(row=>row.cargoID),cargoIDs);
   assert.equal(rows[0].quantity,0);
   assert.equal(rows[0].deployedProbe.status,"EXPIRED");
   assert.equal(rows[0].deployedProbe.sweepStep,1);
   assert.equal(rows[1].quantity,1);
   assert.equal(rows[1].deployedProbe.status,"STOWED");
   assert.equal(rows[2].quantity,0);
   assert.equal(rows[2].deployedProbe.status,"IN_SPACE");
   assert.equal(rows[3].quantity,0);
   assert.equal(rows[3].deployedProbe.status,"IN_SPACE");
   assert.equal(store.flushTableSync("npcCargo").success,true);
   process.stdout.write("EX03B7_NATIVE_FEATURE_SQLITE_PASS\n");
   return;
  }else throw Error("UNKNOWN_STAGE_"+stage);
 }
 // No graceful flush path: success of the state-machine's own flush is
 // the only durability barrier before an intentional abrupt OS crash.
 process.kill(process.pid,"SIGKILL");
 throw Error("SIGKILL_FAILED");
}
function parent(){
 const server=process.env.EVEJS_PINNED_SERVER;
 assert(server&&fs.existsSync(path.join(server,"src/gameStore/index.js")),
  "EVEJS_PINNED_SERVER_REQUIRED");
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"evejs-ex03b7-"));
 const data=path.join(root,"data");fs.mkdirSync(data,{recursive:true});
 fs.writeFileSync(path.join(root,".evejs-test-store-attestation.json"),
  JSON.stringify({schemaVersion:1,kind:"evejs-test-store",
   createdBy:"server/tests/helpers/isolatedGameStore.js",
   storeRoot:root,dataDir:data}));
 const env={...process.env,EVEJS_TEST_STORE_ISOLATED:"1",
  EVEJS_TEST_STORE_ROOT:root,EVEJS_GAMESTORE_DATA_DIR:data,
  EVEJS_PINNED_SERVER:path.resolve(server)};
 try{
  const stages=["seed","launch-1","launch-2","launch-3","launch-4",
   "sweep-1","recall-2","stow-2","relaunch-2","recall-again-2",
   "stow-again-2","expire-1","verify"];
  for(const stage of stages){
   const r=spawnSync(process.execPath,[self,"--child",stage],{
    cwd:server,env,encoding:"utf8",timeout:30000,maxBuffer:2*1024*1024});
   if(stage==="verify"){
    assert.equal(r.status,0,stage+": "+r.stderr);
    assert.match(r.stdout,/EX03B7_NATIVE_FEATURE_SQLITE_PASS/);
   }else assert.equal(r.signal,"SIGKILL",
    stage+": expected SIGKILL, got "+r.signal+"/"+r.status+"\n"+r.stderr);
  }
  assert(fs.statSync(path.join(root,"gamestore.sqlite")).size>0);
  process.stdout.write("EX03B7 original NPC probe production state machines + pinned SQLite kill/restart PASS\n");
 }finally{fs.rmSync(root,{recursive:true,force:true})}
}
if(process.argv[2]==="--child")child(process.argv[3]);else parent();
