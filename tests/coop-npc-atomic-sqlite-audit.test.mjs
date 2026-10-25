import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createRequire} from "node:module";
import {DatabaseSync} from "node:sqlite";
const require=createRequire(import.meta.url);
const {auditBankSqlite}=require("../scripts/audit-npc-atomic-sqlite.cjs");
function fixture(fn){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"coop-npc-sqlite-audit-"));
 const dir=path.join(root,"bank-ships"),sqlitePath=path.join(root,"native.sqlite");
 fs.mkdirSync(dir);
 const db=new DatabaseSync(sqlitePath);
 db.exec('CREATE TABLE npcCargo (key TEXT PRIMARY KEY,json TEXT NOT NULL)');
 const fence=(entityID,modules)=>db.prepare(
  'INSERT INTO npcCargo(key,json) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET json=excluded.json')
   .run("coopAmmoCycles_"+entityID,JSON.stringify({version:1,entityID,modules}));
 const receipt=(entityID,phase,boundaryMs,modules)=>fs.writeFileSync(
  path.join(dir,String(entityID)+".json"),
  JSON.stringify({version:1,phase,entityID,boundaryMs,modules,nonce:"test"}));
 const audit=(opts={})=>auditBankSqlite({root,sqlitePath,...opts});
 try{return fn({root,dir,sqlitePath,db,fence,receipt,audit});}
 finally{db.close();fs.rmSync(root,{recursive:true,force:true});}
}
test("read-only bank/SQLite audit attests a matching full native COMMITTED bank",()=>{
 fixture(f=>{
  f.fence(101,{"401":1000,"402":1000});
  f.receipt(101,"COMMITTED",1000,[401,402]);
  const report=f.audit();
  assert.equal(report.status,"CLEAN");
  assert.equal(report.counts.MATCH_COMMITTED,1);
  assert.equal(report.entries[0].modulesMatched,2);
 });
});
test("PREPARED plus exclusive lock with committed SQLite fences requires operator review",()=>{
 fixture(f=>{
  f.fence(101,{"401":1000,"402":1000});
  f.receipt(101,"PREPARED",1000,[401,402]);
  fs.writeFileSync(path.join(f.dir,"101.json.lock"),"test");
  const report=f.audit();
  assert.equal(report.clean,false);
  assert.equal(report.counts.NEEDS_RECONCILIATION,1);
  assert.equal(fs.existsSync(path.join(f.dir,"101.json.lock")),true);
 });
});
test("missing filesystem journal does not hide durable native SQLite replay fence",()=>{
 fixture(f=>{
  f.fence(101,{"401":1000});
  assert.equal(f.audit().counts.NATIVE_FENCE_WITHOUT_JOURNAL,1);
 });
});
test("file COMMITTED without SQLite fence never passes audit",()=>{
 fixture(f=>{
  f.receipt(101,"COMMITTED",1000,[401]);
  assert.equal(f.audit().counts.JOURNAL_WITHOUT_NATIVE_FENCE,1);
 });
});
test("older SQLite cycle boundary is a COMMIT mismatch, not a successful bank",()=>{
 fixture(f=>{
  f.fence(101,{"401":999,"402":1000});
  f.receipt(101,"COMMITTED",1000,[401,402]);
  const result=f.audit();
  assert.equal(result.counts.COMMIT_MISMATCH,1);
  assert.equal(result.entries[0].modulesMatched,1);
 });
});
test("audit never modifies SQLite rows, bank receipts, or unresolved lockfiles",()=>{
 fixture(f=>{
  f.fence(101,{"401":1000});
  f.receipt(101,"PREPARED",1000,[401]);
  const receiptPath=path.join(f.dir,"101.json");
  const lockPath=receiptPath+".lock";
  fs.writeFileSync(lockPath,"pending");
  const beforeReceipt=fs.readFileSync(receiptPath);
  const beforeLock=fs.readFileSync(lockPath);
  const beforeSqlite=f.db.prepare('SELECT key,json FROM npcCargo ORDER BY key').all();
  assert.equal(f.audit().clean,false);
  assert.deepEqual(fs.readFileSync(receiptPath),beforeReceipt);
  assert.deepEqual(fs.readFileSync(lockPath),beforeLock);
  assert.deepEqual(f.db.prepare('SELECT key,json FROM npcCargo ORDER BY key').all(),beforeSqlite);
 });
});
test("unexpected bank files are reported as unsafe",()=>{
 fixture(f=>{
  f.fence(101,{"401":1000});f.receipt(101,"COMMITTED",1000,[401]);
  fs.writeFileSync(path.join(f.dir,"stray-suspicious-file"),"ignored");
  const report=f.audit();
  assert.equal(report.clean,false);
  assert.ok(report.warnings.some(s=>s.includes("UNKNOWN_FILE")));
 });
});

test("malformed authoritative SQLite replay fence aborts audit fail-closed",()=>{
 fixture(f=>{
  f.db.prepare('INSERT INTO npcCargo(key,json) VALUES(?,?)').run(
   "coopAmmoCycles_101",JSON.stringify({version:1,entityID:101,modules:{"401":"not-a-number"}}));
  f.receipt(101,"COMMITTED",1000,[401]);
  assert.throws(f.audit,/INVALID_NATIVE_FENCE/);
 });
});

test("PREPARED with no native SQLite fence is unresolved, not permission to retry",()=>{
 fixture(f=>{
  f.receipt(101,"PREPARED",1000,[401,402]);
  const report=f.audit();
  assert.equal(report.counts.NEEDS_RECONCILIATION,1);
  assert.equal(report.entries[0].sqliteFencePresent,false);
  assert.equal(report.entries[0].modulesMatched,0);
  assert.equal(fs.existsSync(path.join(f.dir,"101.json")),true);
 });
});

test("strict outcome audit reports COMMITTED bank without native fire outcome",()=>{
 fixture(f=>{
  f.fence(101,{"401":1000});f.receipt(101,"COMMITTED",1000,[401]);
  assert.equal(f.audit().status,"CLEAN","legacy audit remains backward compatible");
  const report=f.audit({requireOutcome:true});
  assert.equal(report.clean,false);
  assert.equal(report.counts.MISSING_FIRE_OUTCOME,1);
  assert.equal(report.entries[0].outcomeKind,null);
 });
});
test("strict outcome audit accepts recorded turret miss without refund",()=>{
 fixture(f=>{
  f.fence(101,{"401":1000});f.receipt(101,"COMMITTED",1000,[401]);
  const p=path.join(f.dir,"101.json"),v=JSON.parse(fs.readFileSync(p,"utf8"));
  v.outcome={version:1,kind:"TURRET_RESOLVED",boundaryMs:1000,hit:false,observedAtMs:2000};
  fs.writeFileSync(p,JSON.stringify(v));
  assert.equal(f.audit({requireOutcome:true}).status,"CLEAN");
 });
});
test("strict outcome audit reports failed missile spawn even with valid cargo debit",()=>{
 fixture(f=>{
  f.fence(101,{"401":1000});f.receipt(101,"COMMITTED",1000,[401]);
  const p=path.join(f.dir,"101.json"),v=JSON.parse(fs.readFileSync(p,"utf8"));
  v.outcome={version:1,kind:"MISSILE_LAUNCH_FAILED",boundaryMs:1000,observedAtMs:2000};
  fs.writeFileSync(p,JSON.stringify(v));
  const a=f.audit({requireOutcome:true});
  assert.equal(a.counts.FAILED_FIRE_OUTCOME,1);
  assert.equal(a.entries[0].outcomeKind,"MISSILE_LAUNCH_FAILED");
 });
});
test("strict outcome audit rejects forged boundary or missile entity metadata",()=>{
 fixture(f=>{
  f.fence(101,{"401":1000});f.receipt(101,"COMMITTED",1000,[401]);
  const p=path.join(f.dir,"101.json"),v=JSON.parse(fs.readFileSync(p,"utf8"));
  v.outcome={version:1,kind:"MISSILE_LAUNCHED",boundaryMs:1001,
   missileID:0,observedAtMs:2000};
  fs.writeFileSync(p,JSON.stringify(v));
  const report=f.audit({requireOutcome:true});
  assert.equal(report.clean,false);
  assert.equal(report.counts.CORRUPT_NEEDS_REVIEW,1);
 });
});
