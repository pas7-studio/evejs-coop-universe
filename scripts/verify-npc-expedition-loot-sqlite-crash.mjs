#!/usr/bin/env node
// EX-03B17: pinned ORIGINAL gameStore SQLite + ORIGINAL itemStore,
// real OS SIGKILL between EACH durable original ItemStore custody transition.
// Disposable attested store only. No production database or live client access.
// This test verifies same itemID: original dungeon container -> NPC ship ->
// corporate station hangar. It does NOT substitute for a 2-client live E2E.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
const require=createRequire(import.meta.url);
const self=fileURLToPath(import.meta.url);
const itemID=9900000000321,sourceContainerID=6200000000321,
 npcShipID=9800000000321,corpID=700,stationID=6000000321;
const marker="coop-npc-expedition:v1:container:"+sourceContainerID+
 ":ship:"+npcShipID+":corp:"+corpID;
function attest(){
 const root=process.env.EVEJS_TEST_STORE_ROOT;
 const data=process.env.EVEJS_GAMESTORE_DATA_DIR;
 assert.equal(process.env.EVEJS_TEST_STORE_ISOLATED,"1",
  "EX03B17_DISPOSABLE_TEST_FLAG_REQUIRED");
 assert(root&&data,"EX03B17_TEST_PATHS_MISSING");
 const rp=path.resolve(root),dp=path.resolve(data);
 assert.equal(path.dirname(rp),path.resolve(os.tmpdir()));
 assert(path.basename(rp).startsWith("evejs-ex03b17-"));
 assert.equal(dp,path.join(rp,"data"));
 assert.equal(fs.realpathSync(rp),rp);
 assert.equal(fs.realpathSync(dp),dp);
 const proof=JSON.parse(fs.readFileSync(
  path.join(rp,".evejs-test-store-attestation.json"),"utf8"));
 assert.equal(proof.kind,"evejs-test-store");
 assert.equal(proof.schemaVersion,1);
 assert.equal(proof.createdBy,"server/tests/helpers/isolatedGameStore.js");
 assert.equal(path.resolve(proof.storeRoot),rp);
 assert.equal(path.resolve(proof.dataDir),dp);
}
function originalModules(){
 attest();
 const server=process.env.EVEJS_PINNED_SERVER;
 assert(server&&fs.existsSync(path.join(server,"src/gameStore/index.js")));
 const store=require(path.join(server,"src/gameStore/index.js"));
 const items=require(path.join(server,"src/services/inventory/itemStore.js"));
 assert.equal(path.resolve(store._dataDir),
  path.resolve(process.env.EVEJS_GAMESTORE_DATA_DIR));
 assert(store._sqliteTables.has("items"),"EX03B17_ITEMS_MUST_BE_NATIVE_SQLITE");
 assert.equal(typeof items.updateInventoryItem,"function");
 assert.equal(typeof items.transferItemToOwnerLocation,"function");
 return {store,items};
}
function child(stage){
 const {store,items}=originalModules();
 const lookup=()=>items.findItemById(itemID);
 if(stage==="seed"){
  items.ensureMigrated();
  assert.equal(lookup(),null);
  // Disposable source fixture only, with original native item metadata.
  const row={itemID,typeID:34,ownerID:1,locationID:sourceContainerID,
   flagID:items.ITEM_FLAGS.CARGO_HOLD,quantity:3,stacksize:3,
   singleton:0,customInfo:""};
  assert.equal(store.write("items","/"+itemID,row).success,true);
  assert.equal(store.flushTableSync("items").success,true);
 }else if(stage==="intent"){
  assert.equal(lookup().ownerID,1);
  assert.equal(lookup().locationID,sourceContainerID);
  const written=items.updateInventoryItem(itemID,x=>({...x,customInfo:marker}));
  assert.equal(written.success,true,JSON.stringify(written));
  assert.equal(lookup().customInfo,marker,
   "Original ItemStore byID index must agree with receipt BEFORE crash");
  assert.equal(store.flushTableSync("items").success,true);
 }else if(stage==="ship"){
  const before=lookup();assert.equal(before.customInfo,marker);
  assert.equal(before.itemID,itemID);
  const result=items.transferItemToOwnerLocation(
   itemID,corpID,npcShipID,items.ITEM_FLAGS.CARGO_HOLD);
  assert.equal(result.success,true,JSON.stringify(result));
  assert.equal(store.flushTableSync("items").success,true);
  const after=lookup();
  assert.equal(after.itemID,itemID);
  assert.equal(after.locationID,npcShipID);
  assert.equal(after.ownerID,corpID);
  assert.equal(after.customInfo,marker);
 }else if(stage==="warehouse"){
  const before=lookup();
  assert.equal(before.itemID,itemID);
  assert.equal(before.locationID,npcShipID);
  assert.equal(before.customInfo,marker);
  const result=items.moveItemToLocation(itemID,stationID,items.ITEM_FLAGS.HANGAR);
  assert.equal(result.success,true,JSON.stringify(result));
  assert.equal(store.flushTableSync("items").success,true);
  assert.equal(lookup().locationID,stationID);
 }else if(stage==="verify"){
  const after=lookup();
  assert(after,"EX03B17_ORIGINAL_ITEM_LOST");
  assert.equal(after.itemID,itemID);
  assert.equal(after.typeID,34);
  assert.equal(after.quantity,3);
  assert.equal(after.stacksize,3);
  assert.equal(after.singleton,0);
  assert.equal(after.ownerID,corpID);
  assert.equal(after.locationID,stationID);
  assert.equal(after.flagID,items.ITEM_FLAGS.HANGAR);
  assert.equal(after.customInfo,marker);
  assert.equal(items.listContainerItems(null,sourceContainerID).length,0);
  assert.equal(items.listContainerItems(null,npcShipID).length,0);
  assert.deepEqual(items.listContainerItems(corpID,stationID).map(x=>x.itemID),
   [itemID]);
  assert.equal(store.flushTableSync("items").success,true);
  process.stdout.write("EX03B17_NATIVE_SQLITE_ITEMSTORE_ORIGINAL_ID_PASS\n");
  return;
 }else throw Error("EX03B17_UNKNOWN_STAGE:"+stage);
 // Only native ItemStore's explicit flush may survive this abrupt process kill.
 process.kill(process.pid,"SIGKILL");
 throw Error("EX03B17_OS_KILL_DID_NOT_HAPPEN");
}
function parent(){
 const server=process.env.EVEJS_PINNED_SERVER;
 assert(server&&fs.existsSync(path.join(server,"src/gameStore/index.js")),
  "EX03B17_EXACT_PINNED_SERVER_REQUIRED");
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"evejs-ex03b17-"));
 const data=path.join(root,"data");fs.mkdirSync(data);
 fs.writeFileSync(path.join(root,".evejs-test-store-attestation.json"),
  JSON.stringify({schemaVersion:1,kind:"evejs-test-store",
   createdBy:"server/tests/helpers/isolatedGameStore.js",storeRoot:root,dataDir:data}));
 const env={...process.env,EVEJS_TEST_STORE_ISOLATED:"1",
  EVEJS_TEST_STORE_ROOT:root,EVEJS_GAMESTORE_DATA_DIR:data,
  EVEJS_PINNED_SERVER:path.resolve(server)};
 try{
  for(const stage of ["seed","intent","ship","warehouse","verify"]){
   const result=spawnSync(process.execPath,[self,"--child",stage],{
    cwd:server,env,encoding:"utf8",timeout:30000,maxBuffer:2*1024*1024});
   if(stage==="verify"){
    assert.equal(result.status,0,result.stderr);
    assert.match(result.stdout,/EX03B17_NATIVE_SQLITE_ITEMSTORE_ORIGINAL_ID_PASS/);
   }else assert.equal(result.signal,"SIGKILL",stage+": "+result.stderr);
  }
  process.stdout.write("EX03B17 original pinned GameStore SQLite / ItemStore SIGKILL PASS\n");
 }finally{fs.rmSync(root,{recursive:true,force:true})}
}
if(process.argv[2]==="--child")child(process.argv[3]);else parent();
