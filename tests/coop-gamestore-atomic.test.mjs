import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";import os from "node:os";import path from "node:path";
import {DatabaseSync} from "node:sqlite";import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createSqliteAdapter,createGameStoreAdapter,reconcileObject}=require("../integration/coopGameStoreAtomic.cjs");
const SEP="\u001f",names=["items","characters","corporationRuntime","industryBlueprintState","industryJobs","identityState","npcEntities","npcModules","npcCargo"];
function fixture(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"coop-game-store-"));
 const db=new DatabaseSync(path.join(dir,"gamestore.sqlite"));
 for(const t of names)db.exec('CREATE TABLE "'+t+'"(key TEXT PRIMARY KEY,json TEXT NOT NULL)');
 const put=(t,k,v)=>db.prepare('INSERT INTO "'+t+'"(key,json) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET json=excluded.json').run(String(k),JSON.stringify(v));
 put("items","91",{itemID:91,ownerID:1001,locationID:500,quantity:1});
 put("items","92",{itemID:92,ownerID:1001,locationID:500,quantity:10});
 put("characters","701",{characterID:701,balance:100,balanceChange:0,walletJournal:[]});
 put("corporationRuntime","corporations"+SEP+"1001",{corporationID:1001,wallet:{divisions:{"1000":{balance:300}}}});
 put("industryBlueprintState","records"+SEP+"91",{itemID:91,original:true,jobID:null});
 put("industryJobs","_meta",{nextJobID:970000000000000});put("industryJobs","jobs",{});
 put("identityState","version",1);put("identityState","nextItemID",1990000200);
 put("npcEntities","entities"+SEP+"101",{entityID:101,ownerID:900,systemID:30000144});
 put("npcModules","modules"+SEP+"401",{moduleID:401,entityID:101,ownerID:900,typeID:123,flagID:27,categoryID:7});
 put("npcCargo","cargo",{"501":{cargoID:501,entityID:101,moduleID:401,ownerID:900,typeID:35,categoryID:8,quantity:5}});
 const load=t=>{const o={};for(const {key,json} of db.prepare('SELECT key,json FROM "'+t+'"').all()){
  const [a,b]=key.split(SEP),v=JSON.parse(json);
  if(b!==undefined&&({corporationRuntime:"corporations",industryBlueprintState:"records",industryJobs:"jobs",npcEntities:"entities",npcModules:"modules"})[t]===a)
   (o[a]??={})[b]=v;
  else o[key]=v;
 }return o;};
 let ambiguousCommit=false;
 const sqliteDb={exec(sql){db.exec(sql);if(sql==="COMMIT"&&ambiguousCommit)throw Error("SIMULATED_LOST_COMMIT_ACK");},
   prepare(sql){return db.prepare(sql);}};
 const sqliteStore={coopAtomicNativeRows:createSqliteAdapter(()=>sqliteDb),loadTableObject:load};
 const cache=Object.fromEntries(names.map(t=>[t,load(t)])),dirty=new Set(),fullDirty=new Set(),
  flushTimers={},inFlightFlushes=new Map(),transientPaths={},dirtyRowKeys={};
 const baselines={};
 const rebuildFlushBaselineFromDisk=t=>baselines[t]=new Map(db.prepare('SELECT key,json FROM "'+t+'"').all().map(r=>[r.key,r.json]));
 names.forEach(rebuildFlushBaselineFromDisk);
 const fatal=[],events=[],inventory={ids:[],rebuilds:0};
 let badFlush=false,badReload=false,badInvalidation=false;
 const bridge=createGameStoreAdapter({
  sqliteStore:{...sqliteStore,loadTableObject(t){if(badReload)throw Error("POSTCOMMIT_RELOAD");return load(t);}},
  ensureSqliteReady:()=>events.push("ready"),ensureCached:t=>!!cache[t],
  flushTableSync:t=>{events.push("flush:"+t);if(badFlush||inFlightFlushes.has(t))return {success:false};
   dirty.delete(t);delete flushTimers[t];return {success:true};},
  cache,dirty,flushTimers,inFlightFlushes,transientPaths,dirtyRowKeys,fullDirty,rebuildFlushBaselineFromDisk,
  invalidateNativeItems:mode=>{events.push("inventory:"+mode);if(mode==="probe")return true;
   if(badInvalidation)return false;inventory.ids=Object.keys(cache.items);inventory.rebuilds++;return true;},
  fatal:e=>fatal.push(e.message)
 });
 return {db,put,cache,bridge,sqliteStore,dirty,inFlightFlushes,transientPaths,baselines,events,inventory,fatal,
  setCommitFault:v=>ambiguousCommit=v,
  setBadFlush:v=>badFlush=v,setBadReload:v=>badReload=v,setBadInvalidation:v=>badInvalidation=v,
  snapshot:()=>Object.fromEntries(names.map(t=>[t,db.prepare('SELECT key,json FROM "'+t+'" ORDER BY key').all()])),
  close(){db.close();fs.rmSync(dir,{recursive:true,force:true})}};
}
function run(fn){const f=fixture(),prior=process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS;
 try{process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS="1";return fn(f);}
 finally{if(prior===undefined)delete process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS;
 else process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS=prior;f.close();}}
const tables=["items","corporationRuntime","industryBlueprintState","industryJobs"];
function install(tx){
 const ore=tx.get("items","92");ore.quantity-=5;tx.put("items","92",ore);
 const corp=tx.get("corporationRuntime","corporations"+SEP+"1001");corp.wallet.divisions["1000"].balance-=30;
 tx.put("corporationRuntime","corporations"+SEP+"1001",corp);
 const bpo=tx.get("industryBlueprintState","records"+SEP+"91");bpo.jobID=970000000000000;
 tx.put("industryBlueprintState","records"+SEP+"91",bpo);
 tx.put("industryJobs","jobs"+SEP+"970000000000000",{jobID:970000000000000,status:1});
 return "INSTALLED";
}
test("transaction commits four native SQLite tables and preserves cache references",()=>run(f=>{
 const items=f.cache.items,ore=items["92"],corp=f.cache.corporationRuntime.corporations["1001"];
 assert.equal(f.bridge.transact(tables,install),"INSTALLED");
 assert.equal(f.cache.items,items);assert.equal(f.cache.items["92"],ore);
 assert.equal(ore.quantity,5);assert.equal(corp.wallet.divisions["1000"].balance,270);
 assert.equal(f.cache.industryJobs.jobs["970000000000000"].status,1);
 assert.equal(f.baselines.items.get("92"),JSON.stringify(ore));assert.equal(f.inventory.rebuilds,1);
 assert.equal(f.bridge.supportsAtomicInstall,false);
}));
test("mutation error rolls back all tables",()=>run(f=>{
 const before=f.snapshot();assert.throws(()=>f.bridge.transact(tables,tx=>{
 tx.del("items","92");tx.put("industryJobs","jobs"+SEP+"123",{jobID:123});throw Error("TEST_ABORT");
 }),/TEST_ABORT/);assert.deepEqual(f.snapshot(),before);assert.equal(f.cache.items["92"].quantity,10);
}));
test("default-OFF gate forbids mutations",()=>run(f=>{
 delete process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS;const before=f.snapshot();
 assert.throws(()=>f.bridge.transact(tables,install),/ATOMIC_DISABLED/);assert.deepEqual(f.snapshot(),before);
}));
test("undeclared table is not writable",()=>run(f=>{
 const before=f.snapshot();assert.throws(()=>f.bridge.transact(["items"],tx=>tx.put("industryJobs","foo",{a:1})),/UNDECLARED_NATIVE_TABLE/);
 assert.deepEqual(f.snapshot(),before);
}));
test("invalid or duplicate table lists fail closed",()=>run(f=>{
 assert.throws(()=>f.bridge.transact(["items","items"],install),/ALLOWLIST/);
 assert.throws(()=>f.bridge.transact(["marketEscrow"],install),/ALLOWLIST/);
}));
test("reentrancy rejected and outer mutation rolled back",()=>run(f=>{
 const before=f.snapshot();assert.throws(()=>f.bridge.transact(["items"],tx=>{
 tx.del("items","92");f.bridge.transact(["items"],()=>{});
 }),/REENTRANT/);assert.deepEqual(f.snapshot(),before);
}));
test("async promise is forbidden and rolled back",()=>run(f=>{
 const before=f.snapshot();assert.throws(()=>f.bridge.transact(["items"],tx=>{
 tx.del("items","92");return Promise.resolve("bad");
 }),/ASYNC_NATIVE/);assert.deepEqual(f.snapshot(),before);
}));
test("unresolved worker flush blocks transaction",()=>run(f=>{
 const before=f.snapshot();f.inFlightFlushes.set("items",{operationId:1});
 assert.throws(()=>f.bridge.transact(tables,install),/NOT_QUIESCENT/);assert.deepEqual(f.snapshot(),before);
}));
test("failed flush blocks transaction",()=>run(f=>{
 f.setBadFlush(true);const before=f.snapshot();assert.throws(()=>f.bridge.transact(tables,install),/NOT_QUIESCENT/);
 assert.deepEqual(f.snapshot(),before);
}));
test("transient row guard prevents unsafe reload",()=>run(f=>{
 f.transientPaths.items=new Set(["/92"]);const before=f.snapshot();
 assert.throws(()=>f.bridge.transact(tables,install),/TRANSIENT_STATE_UNSAFE/);assert.deepEqual(f.snapshot(),before);
}));
test("scan, remove, native identity scalar and index refresh are atomic",()=>run(f=>{
 const old=f.cache.identityState;
 f.bridge.transact(["items","identityState"],tx=>{
 assert.equal(tx.scan("items").length,2);tx.del("items","92");
 tx.put("items","1990000200",{itemID:1990000200,quantity:5});
 tx.put("identityState","nextItemID",1990000201);
 });
 assert.equal(f.cache.identityState,old);assert.equal(f.cache.identityState.nextItemID,1990000201);
 assert.equal(f.cache.items["92"],undefined);assert.deepEqual(f.inventory.ids,["91","1990000200"]);
}));
test("invalid identity scalar fails without write",()=>run(f=>{
 const before=f.snapshot();assert.throws(()=>f.bridge.transact(["identityState"],tx=>
 tx.put("identityState","nextItemID",-1)),/ROW_MUST_BE_OBJECT/);assert.deepEqual(f.snapshot(),before);
}));
test("post-commit refresh error poisons bridge and triggers fatal handler",()=>run(f=>{
 f.setBadReload(true);assert.throws(()=>f.bridge.transact(tables,install),/COMMITTED_BUT_CACHE_UNSAFE/);
 assert.equal(f.fatal.length,1);assert.equal(f.bridge.isPoisoned(),true);
 assert.throws(()=>f.bridge.transact(tables,install),/POISONED/);
 assert.equal(JSON.parse(f.db.prepare('SELECT json FROM industryJobs WHERE key=?').get("jobs"+SEP+"970000000000000").json).status,1);
}));
test("post-commit index invalidation error poisons bridge",()=>run(f=>{
 f.setBadInvalidation(true);assert.throws(()=>f.bridge.transact(tables,install),/COMMITTED_BUT_CACHE_UNSAFE/);
 assert.equal(f.fatal.length,1);assert.equal(f.bridge.isPoisoned(),true);
}));
test("nested cache reconciliation preserves long-lived references",()=>{
 const root={a:[{x:1},{x:2}],b:{p:1,q:2}},arr=root.a;
 reconcileObject(root,{a:[{x:9}],b:{q:3}});
 assert.equal(root.a,arr);assert.deepEqual(root,{a:[{x:9}],b:{q:3}});
});

test("ambiguous COMMIT after durable write poisons runtime and never serves a stale cache",()=>run(f=>{
 f.setCommitFault(true);
 assert.throws(()=>f.bridge.transact(tables,install),/COMMITTED_BUT_CACHE_UNSAFE/);
 assert.deepEqual(f.fatal,["NATIVE_SQLITE_COMMIT_OUTCOME_UNKNOWN"]);
 assert.equal(f.bridge.isPoisoned(),true);
 assert.equal(JSON.parse(f.db.prepare('SELECT json FROM "items" WHERE key=?').get("92").json).quantity,5);
 assert.equal(f.cache.items["92"].quantity,10);
 assert.throws(()=>f.bridge.transact(tables,install),/POISONED/);
}));
test("GameStore claims SQLite writer exactly once; direct bypass is refused",()=>run(f=>{
 assert.throws(()=>f.sqliteStore.coopAtomicNativeRows.claimTransactor(),/WRITER_ALREADY_CLAIMED/);
}));
test("SQLite writer refuses mutations with atomic feature disabled",()=>run(f=>{
 const direct=createSqliteAdapter(()=>f.db).claimTransactor(),before=f.snapshot();
 delete process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS;
 assert.throws(()=>direct.transact(["items"],tx=>tx.del("items","92")),/NATIVE_SQLITE_ATOMIC_DISABLED/);
 assert.deepEqual(f.snapshot(),before);
}));

test("character cache record reference changes after native GameStore wallet commit",()=>run(f=>{
 const table=f.cache.characters,oldRecord=table["701"];
 const memo={rawRecord:oldRecord,normalized:{balance:oldRecord.balance}};
 assert.equal(memo.rawRecord,table["701"]);
 f.bridge.transact(["characters"],tx=>{
   const row=tx.get("characters","701");row.balance+=250;
   tx.put("characters","701",row);
 });
 assert.equal(f.cache.characters,table);
 assert.notEqual(table["701"],oldRecord);
 assert.equal(table["701"].balance,350);
 assert.notEqual(memo.rawRecord,table["701"]);
 assert.equal(f.db.prepare('SELECT json FROM "characters" WHERE key=?').get("701").json.includes('"balance":350'),true);
}));

test("native npcCargo and replay fence commit together with authoritative NPC identity rows",()=>run(f=>{
 const oldCargo=f.cache.npcCargo.cargo;
 assert.equal(f.bridge.transact(["npcEntities","npcModules","npcCargo"],tx=>{
  const entity=tx.get("npcEntities","entities"+SEP+"101");
  const module=tx.get("npcModules","modules"+SEP+"401");
  const root=tx.get("npcCargo","cargo");
  assert.equal(entity.ownerID,900);assert.equal(module.entityID,entity.entityID);
  assert.equal(root["501"].quantity,5);
  tx.put("npcCargo","cargo",{...root,"501":{...root["501"],quantity:4}});
  tx.put("npcCargo","coopAmmoCycles_101",{version:1,entityID:101,modules:{"401":1000}});
  return "BANK_COMMITTED";
 }),"BANK_COMMITTED");
 assert.equal(f.cache.npcCargo.cargo,oldCargo);
 assert.equal(f.cache.npcCargo.cargo["501"].quantity,4);
 assert.equal(f.cache.npcCargo.coopAmmoCycles_101.modules["401"],1000);
 const before=f.snapshot();
 assert.throws(()=>f.bridge.transact(["npcCargo"],tx=>{
  tx.put("npcCargo","cargo",{"501":{cargoID:501,quantity:3}});
  throw Error("SIMULATED_SECOND_BARREL_INVALID");
 }),/SIMULATED_SECOND_BARREL_INVALID/);
 assert.deepEqual(f.snapshot(),before);
 assert.equal(f.cache.npcCargo.cargo["501"].quantity,4);
}));
