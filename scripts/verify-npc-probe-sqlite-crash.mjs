#!/usr/bin/env node
// EX-03B6: real pinned EveJS GameStore SQLite crash-window acceptance.
// Executed ONLY on a disposable freshly-created temporary data root.
// Parent starts actual child Node processes, SIGKILL immediately after
// successful synchronous npcCargo flush, and verifies source recovery on
// a new process with the original nativeNpcStore. No mock DB or refund.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
const require=createRequire(import.meta.url);
const self=fileURLToPath(import.meta.url);
const ids=[980200008001,980200008002],entityID=980000008001,ownerID=901,systemID=30000142;
function original(id){return {cargoID:id,entityID,ownerID,moduleID:980100008001,
 typeID:30013,groupID:479,categoryID:8,quantity:1,singleton:false};}
const flight=id=>({status:"IN_SPACE",probeID:id,entityID,ownerID,
 systemID,typeID:30013,launchedAtMs:1000000,
 position:{x:1000,y:0,z:1000},originPosition:{x:0,y:0,z:0},
 sweepStep:0,rangeStep:4,scanRange:1e10});
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
 assert(path.basename(absoluteRoot).startsWith("evejs-ex03b6-"),
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
function appModules(){
 assertDisposableNativeStore();
 const root=process.env.EVEJS_PINNED_SERVER;
 const data=process.env.EVEJS_GAMESTORE_DATA_DIR;
 assert(root&&data&&fs.existsSync(root)&&fs.existsSync(data),
  "PINNED_SERVER_AND_ISOLATED_STORE_REQUIRED");
 const gameStore=require(path.resolve(root,"src/gameStore/index.js"));
 const native=require(path.resolve(root,"src/space/npc/nativeNpcStore.js"));
 assert(gameStore._sqliteTables.has("npcCargo"),"NATIVE_NPC_CARGO_MUST_BE_SQLITE");
 assert.equal(path.resolve(gameStore._dataDir),path.resolve(data));
 assert.equal(path.dirname(gameStore._sqliteDbPath),path.dirname(data));
 gameStore.ensureTable("npcCargo");
 return {gameStore,native};
}
function snapshot(native){
 return new Map(native.listNativeCargoForEntity(entityID).map(x=>[x.cargoID,x]));
}
function mutateOne(native,store,id,mutate){
 const before=snapshot(native);
 const old=before.get(id);
 assert(old,"ORIGINAL_NPC_CARGO_ROW_MISSING");
 const updated=mutate({...old});
 assert.equal(updated.cargoID,id);
 assert.equal(updated.entityID,entityID);
 assert.equal(updated.ownerID,ownerID);
 const written=native.upsertNativeCargo(updated);
 assert.equal(written.success,true,JSON.stringify(written));
 const flushed=store.flushTableSync("npcCargo");
 assert.equal(flushed.success,true,JSON.stringify(flushed));
 return updated;
}
function child(stage){
 const {gameStore,native}=appModules();
 const rows=snapshot(native);
 if(stage==="prepare"){
  assert.equal(rows.size,0);
  for(const id of ids){
   const r=native.upsertNativeCargo(original(id));
   assert.equal(r.success,true,JSON.stringify(r));
  }
  assert.equal(gameStore.flushTableSync("npcCargo").success,true);
 }else if(stage==="launch-a"||stage==="launch-b"){
  const id=ids[stage==="launch-a"?0:1];
  assert.equal(rows.get(id)?.quantity,1);
  mutateOne(native,gameStore,id,row=>({...row,quantity:0,deployedProbe:flight(id)}));
 }else if(stage==="move-a"){
  assert.equal(rows.get(ids[0])?.deployedProbe?.status,"IN_SPACE");
  mutateOne(native,gameStore,ids[0],row=>({...row,deployedProbe:{
   ...row.deployedProbe,sweepStep:1,position:{x:2e10,y:0,z:3e10}}}));
 }else if(stage==="expire-a"){
  assert.equal(rows.get(ids[0])?.deployedProbe?.sweepStep,1);
  mutateOne(native,gameStore,ids[0],row=>({...row,deployedProbe:{
   ...row.deployedProbe,status:"EXPIRED",endedAtMs:1004000}}));
 }else if(stage==="recall-b"){
  assert.equal(rows.get(ids[1])?.quantity,0);
  mutateOne(native,gameStore,ids[1],row=>({...row,deployedProbe:{
   ...row.deployedProbe,status:"RECALLING",endedAtMs:1004000}}));
 }else if(stage==="stow-b"){
  assert.equal(rows.get(ids[1])?.quantity,0);
  assert.equal(rows.get(ids[1])?.deployedProbe?.status,"RECALLING");
  // The game runtime physically deletes the SAME original probe before
  // this stage. This driver tests storage durability only (no live scene).
  mutateOne(native,gameStore,ids[1],row=>({...row,quantity:1,
   deployedProbe:{...row.deployedProbe,status:"STOWED",recoveredAtMs:1005000}}));
 }else if(stage==="verify"){
  assert.equal(rows.size,2,"EXACTLY_TWO_ORIGINAL_CARGO_IDS");
  const a=rows.get(ids[0]),b=rows.get(ids[1]);
  assert(a&&b);assert.equal(a.quantity,0);
  assert.equal(a.deployedProbe.status,"EXPIRED");
  assert.equal(a.deployedProbe.sweepStep,1);
  assert.equal(a.deployedProbe.position.x,2e10);
  assert.equal(b.quantity,1);
  assert.equal(b.deployedProbe.status,"STOWED");
  assert.deepEqual([...rows.keys()].sort(),ids);
  assert.equal(gameStore.flushTableSync("npcCargo").success,true);
  process.stdout.write("EX03B6_SQLITE_REAL_SOURCE_VERIFY_PASS\n");
  return;
 }else throw Error("UNRECOGNIZED_STAGE");
 // Deliberately use SIGKILL rather than graceful exit to bypass all
 // GameStore beforeExit/exit/signal handlers. Original sync SQLite flush
 // must already be durable. Run this only inside ephemeral CI data.
 process.kill(process.pid,"SIGKILL");
 throw Error("SIGKILL_DID_NOT_TERMINATE");
}
function parent(){
 const pinned=process.env.EVEJS_PINNED_SERVER;
 assert(pinned&&fs.existsSync(path.resolve(pinned,"src/gameStore/index.js")),
  "EVEJS_PINNED_SERVER_MUST_POINT_TO_EXACT_CHECKOUT");
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),"evejs-ex03b6-sqlite-"));
 const data=path.join(temp,"data");fs.mkdirSync(data,{recursive:true});
 const env={...process.env,
  EVEJS_PINNED_SERVER:path.resolve(pinned),
  EVEJS_GAMESTORE_DATA_DIR:data,
  EVEJS_TEST_STORE_ROOT:temp,
  EVEJS_TEST_STORE_ISOLATED:"1",
  EVEJS_GAMESTORE_DIRTY_ROWS:"1"
 };
 // CI/Node --test attestation is set up explicitly to prevent opening an
 // unrelated developer store, even if this script is executed by node:test.
 const att={schemaVersion:1,kind:"evejs-test-store",
  createdBy:"server/tests/helpers/isolatedGameStore.js",
  storeRoot:temp,dataDir:data};
 fs.writeFileSync(path.join(temp,".evejs-test-store-attestation.json"),
  JSON.stringify(att),"utf8");
 try{
  for(const stage of ["prepare","launch-a","move-a","expire-a",
    "launch-b","recall-b","stow-b","verify"]){
   const r=spawnSync(process.execPath,[self,"--child",stage],{
    cwd:pinned,env,encoding:"utf8",timeout:25000,maxBuffer:1024*1024});
   if(stage==="verify"){
    assert.equal(r.status,0,stage+" "+r.stderr);
    assert.match(r.stdout,/EX03B6_SQLITE_REAL_SOURCE_VERIFY_PASS/);
   }else assert.equal(r.signal,"SIGKILL",
     "stage "+stage+" did not terminate via forced kill: "+r.status+" "+r.stderr);
  }
  assert(fs.statSync(path.join(temp,"gamestore.sqlite")).size>0,
   "SQLITE_DATABASE_MUST_EXIST");
  console.log("EX03B6 actual native SQLite durable SIGKILL/restart: PASS");
 }finally{
  fs.rmSync(temp,{recursive:true,force:true});
 }
}
if(process.argv[2]==="--child")child(process.argv[3]);else parent();
