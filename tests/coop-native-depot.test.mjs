import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {mkdtempSync,rmSync,openSync,closeSync,unlinkSync} from "node:fs";
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

function depotSnapshotFixture(snapshot) {
 const file="/fault-journal/depot.json",files=new Map([[file,JSON.stringify(snapshot)]]);
 let fd=0,writes=0;
 const handles=new Map();
 const fsApi={
  readFileSync(p){
   if(!files.has(p))throw Object.assign(Error("ENOENT"),{code:"ENOENT"});
   return files.get(p);
  },
  mkdirSync(){},
  openSync(p,mode){handles.set(++fd,p);return fd;},
  writeFileSync(id,value){files.set(handles.get(id),String(value));},
  fsyncSync(){},closeSync(id){handles.delete(id);},
  renameSync(from,to){files.set(to,files.get(from));files.delete(from);writes++;},
  unlinkSync(p){files.delete(p);}
 };
 return {depot:createDepot({file,fsApi,clock:()=>123}),file,files,
  writes:()=>writes,fsApi};
}

test("P0: aliased persisted cargo receipt cannot receive original ore twice",()=>{
 const receipt={cargoID:777,typeID:34,quantity:100,haulerID:201,
  systemID:30000142,fleetID:9,at:123};
 const candidate={systemID:30000142,fleetID:9,
  item:{cargoID:777,typeID:34,quantity:100,haulerID:201}};
 for(const key of ["000777","+777","7.77e2"]){
  const {depot,files,file,writes}=depotSnapshotFixture({
   version:1,receipts:{[key]:receipt},pending:{},
   totals:{"30000142":100}
  });
  const original=files.get(file);
  assert.equal(depot.audit().status,"NEEDS_OPERATOR_REPAIR",key);
  assert.ok(depot.audit().invalid>0,key);
  assert.throws(()=>depot.snapshot(),/DEPOT_STATE_UNRECONCILED/,key);
  assert.equal(depot.prepare(candidate).status,"DEPOT_STATE_UNRECONCILED",key);
  assert.equal(depot.commit(candidate).status,"DEPOT_STATE_UNRECONCILED",key);
  assert.equal(writes(),0,key);
  assert.equal(files.get(file),original,key);
 }
});

test("P0: totals mismatch and duplicate canonical/aliased source cannot be repaired by appending credits",()=>{
 const receipt={cargoID:777,typeID:34,quantity:100,haulerID:201,
  systemID:30000142,fleetID:9};
 const candidate={systemID:30000142,fleetID:9,
  item:{cargoID:778,haulerID:201,typeID:34,quantity:50}};
 for(const [label,record] of [
  ["missing totals credit",{receipts:{"777":receipt},totals:{"30000142":0}}],
  ["duplicate original ID alias",{receipts:{"777":receipt,"000777":receipt},
   totals:{"30000142":200}}],
  ["malformed pending alias",{receipts:{},
   pending:{"000777":{...receipt}},totals:{}}]
 ]){
  const initial={version:1,pending:{},...record};
  const {depot,files,file,writes}=depotSnapshotFixture(initial);
  const original=files.get(file);
  assert.equal(depot.audit().status,"NEEDS_OPERATOR_REPAIR",label);
  assert.ok(depot.audit().invalid>0,label);
  assert.equal(depot.prepare(candidate).status,"DEPOT_STATE_UNRECONCILED",label);
  assert.equal(depot.commit(candidate).status,"DEPOT_STATE_UNRECONCILED",label);
  assert.throws(()=>depot.snapshot(),/DEPOT_STATE_UNRECONCILED/,label);
  assert.equal(writes(),0,label);
  assert.equal(files.get(file),original,label);
 }
});

test("P0: a valid pending native debit remains recoverable after depot reopen",()=>{
 const item={cargoID:777,typeID:34,quantity:100,haulerID:201,
  systemID:30000142,fleetID:9};
 const {depot,writes}=depotSnapshotFixture({
  version:1,receipts:{},totals:{},pending:{"777":{...item,at:123}}
 });
 assert.equal(depot.audit().status,"PENDING_CUSTODY_RECONCILIATION");
 const candidate={systemID:30000142,fleetID:9,item};
 assert.equal(depot.prepare(candidate).status,"PREPARED");
 assert.equal(depot.commit(candidate).status,"COMMITTED");
 assert.equal(depot.audit().status,"OK");
 assert.equal(depot.snapshot().totals["30000142"],100);
 assert.equal(writes(),1);
});

test("P0: invalid depot index containers cannot become mutable live journals",()=>{
 const receipt={cargoID:777,typeID:34,quantity:100,haulerID:201,
  systemID:30000142,fleetID:9};
 for(const [name,record] of [
  ["receipts array",{version:1,receipts:[receipt],totals:{},pending:{}}],
  ["totals array",{version:1,receipts:{"777":receipt},totals:[],pending:{}}],
  ["pending array",{version:1,receipts:{},totals:{},pending:[receipt]}]
 ]){
  const f=depotSnapshotFixture({version:1,receipts:{},totals:{},pending:{}});
  f.files.set(f.file,JSON.stringify(record));
  assert.throws(()=>createDepot({file:f.file,fsApi:f.fsApi}),/bad depot state/,name);
  assert.equal(f.writes(),0,name);
 }
});

test("P0: stale second native depot instance cannot erase first original receipt",()=>{
 const dir=mkdtempSync(join(tmpdir(),"evejs-depot-cross-instance-"));
 try{
  const file=join(dir,"depot.json"),fresh=createDepot({file,clock:()=>101}),
   stale=createDepot({file,clock:()=>102});
  const arg=id=>({systemID:30000144,fleetID:77,
   item:{cargoID:id,haulerID:9001,typeID:34,quantity:100}});
  assert.equal(fresh.prepare(arg(777)).status,"PREPARED");
  assert.equal(fresh.commit(arg(777)).status,"COMMITTED");
  assert.equal(fresh.snapshot().totals["30000144"],100);
  assert.throws(()=>stale.prepare(arg(778)),/DEPOT_CONCURRENT_JOURNAL_DRIFT/);
  assert.equal(stale.prepare(arg(778)).status,"DEPOT_PERSISTENCE_UNVERIFIED");
  assert.equal(stale.commit(arg(778)).status,"DEPOT_PERSISTENCE_UNVERIFIED");
  assert.throws(()=>stale.snapshot(),/DEPOT_PERSISTENCE_UNVERIFIED/);
  assert.equal(stale.audit().status,"NEEDS_OPERATOR_REPAIR");
  const recovered=createDepot({file,clock:()=>103});
  assert.equal(recovered.audit().status,"OK");
  assert.equal(recovered.snapshot().receipts["777"].cargoID,777);
  assert.equal(recovered.snapshot().totals["30000144"],100);
  assert.equal(recovered.prepare(arg(777)).status,"ALREADY_COMMITTED");
  assert.equal(recovered.prepare(arg(778)).status,"PREPARED");
  assert.equal(recovered.commit(arg(778)).status,"COMMITTED");
  assert.equal(createDepot({file}).snapshot().totals["30000144"],200);
 }finally{rmSync(dir,{recursive:true,force:true})}
});

test("P0: an active or crash-abandoned depot lock blocks writes until operator inspection",()=>{
 const dir=mkdtempSync(join(tmpdir(),"evejs-depot-writer-lock-"));
 try{
  const file=join(dir,"depot.json"),lock=file+".lock",depot=createDepot({file});
  const arg={systemID:30000144,fleetID:77,
   item:{cargoID:777,haulerID:9001,typeID:34,quantity:100}};
  const fd=openSync(lock,"wx");
  closeSync(fd);
  try{
   assert.throws(()=>depot.prepare(arg),error=>error?.code==="EEXIST");
   assert.equal(depot.prepare(arg).status,"DEPOT_PERSISTENCE_UNVERIFIED");
   assert.equal(depot.audit().status,"NEEDS_OPERATOR_REPAIR");
   assert.throws(()=>depot.snapshot(),/DEPOT_PERSISTENCE_UNVERIFIED/);
  }finally{unlinkSync(lock)}
  const recovered=createDepot({file});
  assert.equal(recovered.prepare(arg).status,"PREPARED");
  assert.equal(recovered.commit(arg).status,"COMMITTED");
  assert.equal(createDepot({file}).snapshot().totals["30000144"],100);
 }finally{rmSync(dir,{recursive:true,force:true})}
});
