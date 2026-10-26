import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {DatabaseSync} from "node:sqlite";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const isolate=require("../integration/coopNativeCargoTransientIsolation.cjs");
const {createSqliteAdapter,createGameStoreAdapter}=require("../integration/coopGameStoreAtomic.cjs");
const cargoID=980200000009,transientID=980200000010,otherTransientID=980200000011;
const source={cargoID,entityID:980000000101,ownerID:1000035,typeID:34,categoryID:25,quantity:37,moduleID:0,transient:false};
const ghost=id=>({cargoID:id,entityID:980000000401,ownerID:1000035,typeID:34,categoryID:25,quantity:2,moduleID:0,transient:true});
const copy=v=>JSON.parse(JSON.stringify(v));
function fixture(t){
 const flags=["EVEJS_COOP_NATIVE_ATOMIC_ROWS","EVEJS_COOP_NATIVE_HAUL_TRANSFER_ATOMIC","EVEJS_COOP_NATIVE_CARGO_TRANSIENT_ISOLATION"];
 const prev=Object.fromEntries(flags.map(k=>[k,process.env[k]]));
 flags.forEach(k=>process.env[k]="1");
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"evejs-alife11-mixed-"));
 const db=new DatabaseSync(path.join(dir,"gamestore.sqlite"));
 db.exec('PRAGMA journal_mode=WAL; CREATE TABLE "npcCargo" (key TEXT PRIMARY KEY,json TEXT NOT NULL); CREATE TABLE "npcEntities" (key TEXT PRIMARY KEY,json TEXT NOT NULL)');
 const put=(table,key,value)=>db.prepare('INSERT INTO "'+table+'"(key,json) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET json=excluded.json').run(key,JSON.stringify(value));
 put("npcCargo","cargo",{[cargoID]:copy(source)});
 put("npcCargo","nextCargoID",980200000100);
 const load=(table="npcCargo")=>Object.fromEntries(db.prepare('SELECT key,json FROM "'+table+'"').all().map(row=>[row.key,JSON.parse(row.json)]));
 const cache={npcCargo:load(),npcEntities:load("npcEntities")};
 cache.npcCargo.cargo[transientID]=ghost(transientID);
 const transientPaths={npcCargo:new Set(["/cargo/"+transientID])};
 const dirty=new Set(),fullDirty=new Set(),dirtyRowKeys={},flushTimers={},inFlightFlushes=new Map();
 let fatal=0,reloadError=false,writerBusy=false;
 const store={coopAtomicNativeRows:createSqliteAdapter(()=>db),loadTableObject:table=>{
  if(reloadError)throw Error("SIMULATED_POSTCOMMIT_RELOAD_ERROR");
  return load(table);
 }};
 const bridge=createGameStoreAdapter({sqliteStore:store,ensureSqliteReady:()=>{},
  ensureCached:table=>Boolean(cache[table]),
  flushTableSync:table=>{if(writerBusy||inFlightFlushes.has(table))return{success:false};
   dirty.delete(table);delete flushTimers[table];return{success:true};},
  cache,dirty,flushTimers,inFlightFlushes,transientPaths,dirtyRowKeys,fullDirty,
  rebuildFlushBaselineFromDisk:()=>{},invalidateNativeItems:()=>true,
  fatal:()=>fatal++});
 t.after(()=>{db.close();fs.rmSync(dir,{recursive:true,force:true});
  for(const [key,v] of Object.entries(prev)){
   if(v===undefined)delete process.env[key];else process.env[key]=v;
  }});
 const change=(callback)=>bridge.transact(["npcCargo"],tx=>{
  const root=tx.get("npcCargo","cargo");
  assert.equal(root[String(transientID)],undefined);
  root[String(cargoID)]={...root[String(cargoID)],entityID:980000000102,coopHaulFleetID:30000142*32+1};
  callback?.(tx,root);
  tx.put("npcCargo","cargo",root);
  tx.put("npcCargo","coopNativeHaulTransfer:"+cargoID,{cargoID,status:"COMMITTED"});
  return cargoID;
 });
 return {db,cache,transientPaths,bridge,load,change,put,
  source:()=>cache.npcCargo.cargo[String(cargoID)],disk:()=>load().cargo,
  transient:()=>cache.npcCargo.cargo[String(transientID)],
  fatal:()=>fatal,setReload:v=>reloadError=v,setWorkerBusy:v=>writerBusy=v,inFlightFlushes,
  addTransient(id){cache.npcCargo.cargo[id]=ghost(id);transientPaths.npcCargo.add("/cargo/"+id);}
 };
}
test("WAL/FULL commit preserves transient cache cargo but NEVER persists it",t=>{
 const f=fixture(t),before=copy(f.transient()),originalCache=f.cache.npcCargo.cargo;
 assert.equal(f.change(),cargoID);
 assert.equal(f.db.prepare("PRAGMA synchronous").get().synchronous,2);
 assert.equal(f.source().entityID,980000000102);
 assert.equal(f.cache.npcCargo.cargo,originalCache);
 assert.deepEqual(f.transient(),before);
 assert.equal(f.disk()[transientID],undefined);
 assert.equal(f.load()["coopNativeHaulTransfer:"+cargoID].status,"COMMITTED");
 assert.equal(f.transientPaths.npcCargo.size,1);
});
test("disk-reopened state has only durable ore and one witness",t=>{
 const f=fixture(t);f.change();
 assert.equal(f.load().cargo[String(transientID)],undefined);
 assert.equal(f.load().cargo[String(cargoID)].entityID,980000000102);
 assert.equal(Object.keys(f.load().cargo).length,1);
});
test("two independent transient ships stay in cache but not SQLite",t=>{
 const f=fixture(t);f.addTransient(otherTransientID);
 assert.equal(f.change(),cargoID);
 assert.deepEqual(Object.keys(f.cache.npcCargo.cargo).sort(),[String(cargoID),String(transientID),String(otherTransientID)].sort());
 assert.deepEqual(Object.keys(f.disk()),[String(cargoID)]);
 assert.equal(f.transientPaths.npcCargo.size,2);
});
test("SQL transaction cannot persist ephemeral row even when explicitly requested",t=>{
 const f=fixture(t),before=f.load();
 assert.throws(()=>f.bridge.transact(["npcCargo"],tx=>{
  const root=tx.get("npcCargo","cargo");root[transientID]=ghost(transientID);
  tx.put("npcCargo","cargo",root);
 }),/ALIFE11_TRANSIENT_CARGO_SQL_WRITE_FORBIDDEN/);
 assert.deepEqual(f.load(),before);
 assert.equal(f.bridge.isPoisoned(),false);
});
test("SQL cannot delete whole cargo root with transient entries active",t=>{
 const f=fixture(t),before=f.load();
 assert.throws(()=>f.bridge.transact(["npcCargo"],tx=>tx.del("npcCargo","cargo")),/ALIFE11_TRANSIENT_CARGO_SQL_WRITE_FORBIDDEN/);
 assert.deepEqual(f.load(),before);
});
test("only canonical /cargo/ID paths are accepted",t=>{
 const f=fixture(t);
 for(const value of ["/cargo","/","/cargo/not-an-id","/cargo/0002","/cargo/123/a"]){
  f.transientPaths.npcCargo=new Set([value]);
  assert.throws(()=>f.change(),/ALIFE11_TRANSIENT_PATH_NOT_ROW_SCOPED/);
 }
 assert.equal(f.source().entityID,980000000101);
});
test("an ephemeral ID present on disk is never overwritten or hidden",t=>{
 const f=fixture(t);f.put("npcCargo","cargo",{...f.disk(),[transientID]:ghost(transientID)});
 assert.throws(()=>f.change(),/ALIFE11_TRANSIENT_ROW_MISSING_OR_ALREADY_DURABLE/);
 assert.equal(f.source().entityID,980000000101);
});
test("transient row without original transient marker fails closed",t=>{
 const f=fixture(t);f.transient().transient=false;
 assert.throws(()=>f.change(),/ALIFE11_TRANSIENT_ROW_CUSTODY_UNPROVEN/);
});
test("unflushed persistent cache data never gets silently overwritten",t=>{
 const f=fixture(t);f.source().quantity=9999;
 assert.throws(()=>f.change(),/ALIFE11_CACHE_AND_SQLITE_DURABLE_PREIMAGE_CONFLICT/);
 assert.equal(f.disk()[cargoID].quantity,37);
});
test("disabled flag retains original safe global transient block",t=>{
 const f=fixture(t);delete process.env.EVEJS_COOP_NATIVE_CARGO_TRANSIENT_ISOLATION;
 assert.throws(()=>f.change(),/NATIVE_TRANSIENT_STATE_UNSAFE/);
});
test("mixed isolation never grants access to additional SQLite tables",t=>{
 const f=fixture(t);
 assert.throws(()=>f.bridge.transact(["npcCargo","npcEntities"],()=>{}),/NATIVE_TRANSIENT_STATE_UNSAFE/);
});
test("unfinished async worker blocks original cargo transaction",t=>{
 const f=fixture(t);f.inFlightFlushes.set("npcCargo",{operationId:99});
 assert.throws(()=>f.change(),/PERSISTENCE_NOT_QUIESCENT/);
});
test("failed persistence flush blocks original cargo transaction",t=>{
 const f=fixture(t);f.setWorkerBusy(true);
 assert.throws(()=>f.change(),/PERSISTENCE_NOT_QUIESCENT/);
 assert.equal(f.load()["coopNativeHaulTransfer:"+cargoID],undefined);
});
test("SQLite failure after cargo update rolls back witness AND reparent",t=>{
 const f=fixture(t),before=copy(f.disk());
 f.db.exec("CREATE TRIGGER deny_haul BEFORE INSERT ON npcCargo WHEN NEW.key LIKE 'coopNativeHaulTransfer:%' BEGIN SELECT RAISE(ABORT,'blocked'); END");
 assert.throws(()=>f.change(),/blocked/);
 assert.deepEqual(f.disk(),before);
 assert.equal(f.transient().entityID,980000000401);
 assert.equal(f.bridge.isPoisoned(),false);
});
test("postcommit cache reload error poisons the only authoritative writer",t=>{
 const f=fixture(t);
 // Arming the reload error before the call would fail the pre-image read instead,
 // which is a pre-commit failure and must stay a plain error (nothing persisted).
 // The poison path is only reachable when the read breaks AFTER the SQL COMMIT.
 assert.throws(()=>f.change(()=>f.setReload(true)),/NATIVE_GAMESTORE_COMMITTED_BUT_CACHE_UNSAFE/);
 assert.equal(f.bridge.isPoisoned(),true);
 assert.equal(f.fatal(),1);
 assert.throws(()=>f.change(),/NATIVE_GAMESTORE_POISONED/);
});
test("an orphan transient path cannot be mistaken for persistent cargo",t=>{
 const f=fixture(t);f.transientPaths.npcCargo.add("/cargo/980200000019");
 assert.throws(()=>f.change(),/ALIFE11_TRANSIENT_ROW_MISSING_OR_ALREADY_DURABLE/);
});
test("durable original native cargo ID allocator remains unchanged",t=>{
 const f=fixture(t),before=f.cache.npcCargo.nextCargoID;
 assert.equal(f.change(),cargoID);
 assert.equal(f.cache.npcCargo.nextCargoID,before);
 assert.equal(f.load().nextCargoID,before);
});
test("pure transient shadow rehydration never copies into durable source",()=>{
 const live={cargo:{"3":{cargoID:3,ownerID:1,entityID:9,typeID:34,quantity:2,transient:true},
  "4":{cargoID:4,ownerID:1,entityID:2,typeID:34,quantity:8,transient:false}},nextCargoID:500};
 const durable={cargo:{"4":copy(live.cargo["4"])},nextCargoID:500};
 const witness=isolate.capture({paths:new Set(["/cargo/3"]),live,durable});
 const result=isolate.rehydrate({persisted:{...durable,cargo:{"4":{...durable.cargo["4"],quantity:7}}},
  live,paths:new Set(["/cargo/3"]),witness});
 assert.equal(result.cargo["3"].quantity,2);
 assert.equal(result.cargo["4"].quantity,7);
 assert.equal(durable.cargo["3"],undefined);
});

test("a cargo-only SQLite write without a matching immutable receipt is rolled back",t=>{
 const f=fixture(t),before=f.load();
 assert.throws(()=>f.bridge.transact(["npcCargo"],tx=>{
  const cargo=tx.get("npcCargo","cargo");
  cargo[String(cargoID)].quantity--;
  tx.put("npcCargo","cargo",cargo);
 }),/ALIFE11_INCOMPLETE_NATIVE_HAUL_WRITE_SET/);
 assert.deepEqual(f.load(),before);
});
test("a receipt-only write without source cargo reparent is rolled back",t=>{
 const f=fixture(t),before=f.load();
 assert.throws(()=>f.bridge.transact(["npcCargo"],tx=>{
  tx.put("npcCargo","coopNativeHaulTransfer:"+cargoID,{cargoID,status:"COMMITTED"});
 }),/ALIFE11_INCOMPLETE_NATIVE_HAUL_WRITE_SET/);
 assert.deepEqual(f.load(),before);
});
test("transient cargo can never receive a synthetic durable receipt",t=>{
 const f=fixture(t),before=f.load();
 assert.throws(()=>f.bridge.transact(["npcCargo"],tx=>{
  tx.put("npcCargo","coopNativeHaulTransfer:"+transientID,
   {cargoID:transientID,status:"COMMITTED"});
 }),/ALIFE11_UNEXPECTED_MIXED_CARGO_SQL_RECEIPT/);
 assert.deepEqual(f.load(),before);
});
test("no actor can mutate the native cargo ID allocator during mixed haul commit",t=>{
 const f=fixture(t),before=f.load();
 assert.throws(()=>f.bridge.transact(["npcCargo"],tx=>{
  tx.put("npcCargo","nextCargoID",{nextCargoID:42});
 }),/ALIFE11_UNEXPECTED_MIXED_CARGO_SQL_RECEIPT/);
 assert.deepEqual(f.load(),before);
});
test("two receipts for one cargo movement fail as an incomplete/duplicate write set",t=>{
 const f=fixture(t),before=f.load();
 assert.throws(()=>f.bridge.transact(["npcCargo"],tx=>{
  tx.put("npcCargo","coopNativeHaulTransfer:"+cargoID,{cargoID,status:"COMMITTED"});
  tx.put("npcCargo","coopNativeHaulTransfer:980200000099",
   {cargoID:980200000099,status:"COMMITTED"});
 }),/ALIFE11_UNEXPECTED_MIXED_CARGO_SQL_RECEIPT/);
 assert.deepEqual(f.load(),before);
});
test("transient row changed during commit poisons authoritative cache rather than losing cargo",t=>{
 const f=fixture(t);
 assert.throws(()=>f.change(()=>{f.transient().quantity+=1}),
  /NATIVE_GAMESTORE_COMMITTED_BUT_CACHE_UNSAFE/);
 assert.equal(f.fatal(),1);
 assert.equal(f.bridge.isPoisoned(),true);
 assert.equal(f.load()["coopNativeHaulTransfer:"+cargoID].status,"COMMITTED");
});
test("transient path additions during commit poison owner after SQLite commit",t=>{
 const f=fixture(t);
 assert.throws(()=>f.change(()=>f.transientPaths.npcCargo.add("/cargo/980200000019")),
  /NATIVE_GAMESTORE_COMMITTED_BUT_CACHE_UNSAFE/);
 assert.equal(f.fatal(),1);
 assert.equal(f.bridge.isPoisoned(),true);
});
