#!/usr/bin/env node
// EX-03B19. Actual pinned EveJS original GameStore SQLite and ItemStore,
// OS SIGKILL after native NPC wreck stage and after same-ID player pickup.
// Never point this at real game data: demands attested disposable root.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
const require=createRequire(import.meta.url);
const self=fileURLToPath(import.meta.url);
const id=730000000812,shipID=980000000812,wreckID=980300000812,
 corpID=700,playerID=802,playerShipID=880000000812;
const tag="coop-npc-expedition:v1:container:620000000812:ship:"+shipID+":corp:"+corpID;
function original(){
 const root=process.env.EVEJS_TEST_STORE_ROOT,data=process.env.EVEJS_GAMESTORE_DATA_DIR;
 assert.equal(process.env.EVEJS_TEST_STORE_ISOLATED,"1");
 assert(root&&data&&process.env.EVEJS_PINNED_SERVER);
 const rp=path.resolve(root),dp=path.resolve(data);
 assert.equal(path.dirname(rp),path.resolve(os.tmpdir()));
 assert(path.basename(rp).startsWith("evejs-ex03b19-"));
 assert.equal(dp,path.join(rp,"data"));
 assert.equal(fs.realpathSync(rp),rp);
 assert.equal(fs.realpathSync(dp),dp);
 const proof=JSON.parse(fs.readFileSync(path.join(rp,
  ".evejs-test-store-attestation.json"),"utf8"));
 assert.deepEqual(proof,{schemaVersion:1,kind:"evejs-test-store",
  createdBy:"server/tests/helpers/isolatedGameStore.js",
  storeRoot:rp,dataDir:dp});
 const server=path.resolve(process.env.EVEJS_PINNED_SERVER);
 const gameStore=require(path.join(server,"src/gameStore/index.js"));
 const items=require(path.join(server,"src/services/inventory/itemStore.js"));
 const npcStore=require(path.join(server,"src/space/npc/nativeNpcStore.js"));
 const {createNpcExpeditionWreckCustody}=require(
  "../integration/coopNpcExpeditionWreckCustody.cjs");
 assert.equal(path.resolve(gameStore._dataDir),dp);
 assert(gameStore._sqliteTables.has("items"));
 assert(gameStore._sqliteTables.has("npcWrecks"));
 return {gameStore,items,npcStore,
  custody:()=>createNpcExpeditionWreckCustody({items,npcStore,gameStore})};
}
function child(stage){
 const {gameStore,items,npcStore,custody}=original();
 const get=()=>items.findItemById(id);
 if(stage==="seed"){
  items.ensureMigrated();
  assert.equal(get(),null);
  const item={itemID:id,typeID:34,ownerID:corpID,locationID:shipID,
   flagID:5,quantity:3,stacksize:3,singleton:0,customInfo:tag};
  const player={itemID:playerShipID,typeID:587,ownerID:playerID,
   locationID:600000001,flagID:4,quantity:-1,stacksize:1,singleton:1};
  assert.equal(gameStore.write("items","/"+id,item).success,true);
  assert.equal(gameStore.write("items","/"+playerShipID,player).success,true);
  assert.equal(gameStore.flushTableSync("items").success,true);
  const write=npcStore.upsertNativeWreck({wreckID,sourceEntityID:shipID,
   systemID:30000142,corporationID:999,coopNpcExpeditionSourceCorpID:corpID,
   ownerID:999,
   transient:false,typeID:26520,createdAtMs:1,expiresAtMs:10000000});
  assert.equal(write.success,true,JSON.stringify(write));
  assert.equal(gameStore.flushTableSync("npcWrecks").success,true);
 }else if(stage==="intent"){
  // Reproduce the durable post-intent/pre-ItemStore-move crash window with
  // the REAL pinned itemStore and ORIGINAL npcWrecks SQLite store.
  const marker=tag+":wreck:"+wreckID;
  assert.equal(gameStore.flushTableSync("npcWrecks").success,true);
  assert.equal(get().customInfo,tag);
  const marked=items.updateInventoryItem(id,item=>({...item,customInfo:marker}));
  assert.equal(marked.success,true,JSON.stringify(marked));
  assert.equal(gameStore.flushTableSync("items").success,true);
  assert.equal(get().locationID,shipID);
 }else if(stage==="recover"){
  const forbidden=custody().reconcile({wreckID,shipID,corporationID:corpID});
  assert.equal(forbidden.success,false);
  assert.equal(forbidden.errorMsg,"EX03_WRECK_OPERATOR_APPROVAL_REQUIRED");
  const recovered=custody().reconcile({wreckID,shipID,corporationID:corpID,
   operatorApproved:true});
  assert.equal(recovered.success,true,JSON.stringify(recovered));
  assert.equal(recovered.status,"ORIGINAL_WRECK_CUSTODY_RECOVERED");
  assert.equal(recovered.movedCount,1);
  assert.deepEqual(recovered.itemIDs,[id]);
  const replay=custody().reconcile({wreckID,shipID,corporationID:corpID,
   operatorApproved:true});
  assert.equal(replay.success,true);
  assert.equal(replay.movedCount,0,"repeat does not replay original item transfer");
 }else if(stage==="stage"){
  const receipt=custody().stage({wreckID,shipID,corporationID:corpID});
  assert.equal(receipt.status,"ORIGINAL_ITEMSTORE_LOOT_IN_WRECK",
   JSON.stringify(receipt));
  assert.equal(get().itemID,id);
  assert.equal(get().locationID,wreckID);
  assert.equal(get().ownerID,corpID);
  assert.equal(gameStore.flushTableSync("items").success,true);
 }else if(stage==="witness"){
  const bridge=custody(),row=get();
  assert.equal(row.locationID,wreckID);
  assert.equal(bridge.list({wreckID}).length,1);
  assert.equal(bridge.list({wreckID})[0].itemID,id);
  assert.equal(bridge.canDestroy(wreckID),false);
  assert.equal(items.listContainerItems(null,shipID,5).length,0);
  assert.equal(items.listContainerItems(null,wreckID,4).length,1);
 }else if(stage==="claim"){
  const result=custody().claim({characterID:playerID,wreckID,itemID:id,
   destinationLocationID:playerShipID,destinationFlagID:items.ITEM_FLAGS.CARGO_HOLD,
   quantity:3});
  assert.equal(result.success,true,JSON.stringify(result));
  assert.equal(get().itemID,id);
  assert.equal(get().ownerID,playerID);
  assert.equal(get().locationID,playerShipID);
  assert.equal(gameStore.flushTableSync("items").success,true);
 }else if(stage==="verify"){
  const row=get(),bridge=custody();
  assert(row);
  assert.equal(row.itemID,id);
  assert.equal(row.typeID,34);
  assert.equal(row.quantity,3);
  assert.equal(row.stacksize,3);
  assert.equal(row.ownerID,playerID);
  assert.equal(row.locationID,playerShipID);
  assert.equal(row.flagID,items.ITEM_FLAGS.CARGO_HOLD);
  assert.equal(row.customInfo,tag+":wreck:"+wreckID);
  assert.equal(bridge.canDestroy(wreckID),true);
  assert.equal(bridge.list({wreckID}).length,0);
  assert.equal(items.listContainerItems(null,shipID).length,0);
  assert.equal(items.listContainerItems(null,wreckID).length,0);
  assert.deepEqual(items.listContainerItems(playerID,playerShipID).map(x=>x.itemID),[id]);
  assert.equal(gameStore.flushTableSync("items").success,true);
  process.stdout.write("EX03B19_NATIVE_WRECK_ITEMSTORE_SQLITE_SIGKILL_PASS\n");
  return;
 }else throw Error("EX03B19_UNKNOWN_STAGE:"+stage);
 process.kill(process.pid,"SIGKILL");
 throw Error("EX03B19_SIGKILL_NOT_EXECUTED");
}
function parent(){
 const server=process.env.EVEJS_PINNED_SERVER;
 assert(server&&fs.existsSync(path.join(server,"src/gameStore/index.js")),
  "EX03B19_ORIGINAL_PINNED_SERVER_REQUIRED");
 const scenarios=[["seed","stage","witness","claim","verify"],
  ["seed","intent","recover","witness","claim","verify"]];
 for(const stages of scenarios){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"evejs-ex03b19-"));
 const data=path.join(root,"data");fs.mkdirSync(data);
 fs.writeFileSync(path.join(root,".evejs-test-store-attestation.json"),
  JSON.stringify({schemaVersion:1,kind:"evejs-test-store",
   createdBy:"server/tests/helpers/isolatedGameStore.js",storeRoot:root,dataDir:data}));
 const env={...process.env,EVEJS_TEST_STORE_ISOLATED:"1",
  EVEJS_TEST_STORE_ROOT:root,EVEJS_GAMESTORE_DATA_DIR:data,
  EVEJS_PINNED_SERVER:path.resolve(server)};
 try{
  for(const stage of stages){
   const r=spawnSync(process.execPath,[self,"--child",stage],
    {cwd:server,env,encoding:"utf8",timeout:45000,maxBuffer:2*1024*1024});
   if(stage==="verify"){
    assert.equal(r.status,0,stage+": "+r.stderr);
    assert.match(r.stdout,/EX03B19_NATIVE_WRECK_ITEMSTORE_SQLITE_SIGKILL_PASS/);
   }else assert.equal(r.signal,"SIGKILL",stage+": "+r.stderr);
  }
  process.stdout.write("EX03B19 ORIGINAL NPC WRECK ITEMSTORE SQLITE PASS\n");
 }finally{fs.rmSync(root,{recursive:true,force:true})}
 }
}
if(process.argv[2]==="--child")child(process.argv[3]);else parent();
