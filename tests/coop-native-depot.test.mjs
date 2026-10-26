import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
const require=createRequire(import.meta.url);
const {createDepot}=require("../integration/coopNativeDepot.cjs");
const {createEconomy}=require("../integration/coopVirtualEconomy.cjs");

test("real native ore delivered to depot changes system supply exactly once, including after restart",()=>{
 const dir=mkdtempSync(join(tmpdir(),"evejs-native-depot-"));
 try{
  const file=join(dir,"depot.json"),economyFile=join(dir,"virtual-economy.json"),clock=()=>1000000;
  const depot=createDepot({file,clock});
  const cargo={systemID:30000142,fleetID:9,deliveries:[
   {cargoID:777,haulerID:201,typeID:34,quantity:100},
   {cargoID:778,haulerID:201,typeID:35,quantity:60}
  ]};
  for(const item of cargo.deliveries){
   assert.equal(depot.prepare({systemID:cargo.systemID,fleetID:cargo.fleetID,item}).status,"PREPARED");
   assert.equal(depot.commit({systemID:cargo.systemID,fleetID:cargo.fleetID,item}).status,"COMMITTED");
  }
  assert.equal(depot.record(cargo).status,"UNVERIFIED_DIRECT_CREDIT_DISABLED");
  assert.equal(createDepot({file,clock}).snapshot().totals["30000142"],160);
  const economy=createEconomy({file:economyFile,clock});
  assert.equal(economy.syncNativeDeliveries(depot.snapshot().totals).quantity,160);
  assert.equal(economy.snapshot().systems["30000142"].goods,260);
  assert.equal(economy.syncNativeDeliveries(depot.snapshot().totals).quantity,0);
  const restored=createEconomy({file:economyFile,clock});
  assert.equal(restored.syncNativeDeliveries(createDepot({file,clock}).snapshot().totals).quantity,0);
  assert.equal(restored.snapshot().systems["30000142"].goods,260);
  const extra={cargoID:779,haulerID:201,typeID:34,quantity:20};
  assert.equal(depot.prepare({systemID:30000142,fleetID:9,item:extra}).status,"PREPARED");
  assert.equal(depot.commit({systemID:30000142,fleetID:9,item:extra}).status,"COMMITTED");
  assert.equal(restored.syncNativeDeliveries(depot.snapshot().totals).quantity,20);
  assert.equal(restored.snapshot().systems["30000142"].goods,280);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test("bad or repeated native cargo IDs cannot invent virtual goods",()=>{
 const dir=mkdtempSync(join(tmpdir(),"evejs-native-depot-"));
 try{
  const depot=createDepot({file:join(dir,"dep.json")});
  assert.equal(depot.record({systemID:30000142,fleetID:9,deliveries:[]}).status,
    "UNVERIFIED_DIRECT_CREDIT_DISABLED");
  for(const item of [
    {cargoID:-1,typeID:34,quantity:2,haulerID:201},
    {cargoID:777,typeID:34,quantity:-10,haulerID:201},
    {cargoID:778,typeID:34,quantity:1.5,haulerID:201}
  ]) assert.equal(depot.prepare({systemID:30000142,fleetID:9,item}).status,"INVALID");
  assert.deepEqual(depot.snapshot().totals,{});
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test("P0: directory fsync error after COMMITTED rename cannot erase durable cargo receipt",()=>{
 const file="/test/native-depot.json",files=new Map(),fds=new Map();
 let fd=0,failNextDirSync=false,writes=0;
 const fsApi={
  readFileSync(p){if(!files.has(p))throw Object.assign(Error("ENOENT"),{code:"ENOENT"});return files.get(p);},
  mkdirSync(){},
  openSync(p,mode){fds.set(++fd,{path:p,dir:mode==="r"});return fd;},
  writeFileSync(id,value){files.set(fds.get(id).path,String(value));},
  fsyncSync(id){
   if(fds.get(id).dir&&failNextDirSync){
    failNextDirSync=false;throw Object.assign(Error("EIO"),{code:"EIO"});
   }
  },
  closeSync(id){fds.delete(id);},
  renameSync(from,to){files.set(to,files.get(from));files.delete(from);writes++;},
  unlinkSync(p){files.delete(p);}
 };
 const request=id=>({systemID:30000142,fleetID:9,
  item:{cargoID:id,haulerID:201,typeID:34,quantity:100}});
 const depot=createDepot({file,fsApi,clock:()=>123});
 assert.equal(depot.prepare(request(777)).status,"PREPARED");
 failNextDirSync=true;
 assert.throws(()=>depot.commit(request(777)),/EIO/);
 const committed=JSON.parse(files.get(file));
 assert.equal(committed.receipts["777"].cargoID,777);
 assert.equal(committed.totals["30000142"],100);
 const writesBefore=writes;
 assert.equal(depot.prepare(request(778)).status,"DEPOT_PERSISTENCE_UNVERIFIED");
 assert.equal(depot.commit(request(777)).status,"DEPOT_PERSISTENCE_UNVERIFIED");
 assert.equal(writes,writesBefore,"no later call can overwrite the newer disk journal");
 assert.throws(()=>depot.snapshot(),/DEPOT_PERSISTENCE_UNVERIFIED/);
 assert.equal(depot.audit().status,"NEEDS_OPERATOR_REPAIR");
 assert.equal(depot.audit().reason,"DEPOT_PERSISTENCE_UNVERIFIED");
 const reopened=createDepot({file,fsApi,clock:()=>124});
 assert.equal(reopened.audit().status,"OK");
 assert.equal(reopened.prepare(request(777)).status,"ALREADY_COMMITTED");
 assert.equal(reopened.prepare(request(778)).status,"PREPARED");
 assert.equal(reopened.commit(request(778)).status,"COMMITTED");
 assert.equal(reopened.snapshot().totals["30000142"],200);
});

test("P0: post-rename PREPARED failure blocks stale in-memory state from dropping pending",()=>{
 const file="/test/depot-prepare.json",files=new Map(),fds=new Map();
 let fd=0,failNextDirSync=true,writes=0;
 const fsApi={
  readFileSync(p){if(!files.has(p))throw Object.assign(Error("ENOENT"),{code:"ENOENT"});return files.get(p);},
  mkdirSync(){},
  openSync(p,mode){fds.set(++fd,{path:p,dir:mode==="r"});return fd;},
  writeFileSync(id,value){files.set(fds.get(id).path,String(value));},
  fsyncSync(id){
   if(fds.get(id).dir&&failNextDirSync){
    failNextDirSync=false;throw Object.assign(Error("EIO"),{code:"EIO"});
   }
  },
  closeSync(id){fds.delete(id);},
  renameSync(a,b){files.set(b,files.get(a));files.delete(a);writes++;},
  unlinkSync(p){files.delete(p);}
 };
 const payload=id=>({systemID:30000142,fleetID:9,
  item:{cargoID:id,haulerID:201,typeID:34,quantity:100}});
 const depot=createDepot({file,fsApi,clock:()=>123});
 assert.throws(()=>depot.prepare(payload(777)),/EIO/);
 assert.equal(JSON.parse(files.get(file)).pending["777"].cargoID,777);
 const writesBefore=writes;
 assert.equal(depot.prepare(payload(778)).status,"DEPOT_PERSISTENCE_UNVERIFIED");
 assert.equal(depot.commit(payload(777)).status,"DEPOT_PERSISTENCE_UNVERIFIED");
 assert.equal(writes,writesBefore);
 const restored=createDepot({file,fsApi,clock:()=>124});
 assert.equal(restored.prepare(payload(777)).status,"PREPARED");
 assert.equal(restored.commit(payload(777)).status,"COMMITTED");
 assert.equal(restored.audit().status,"OK");
});
