import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createScopedSqlFacade}=require("../integration/coopNpcIndustryGameStoreScope.cjs");
const SEP="\u001f";
function fixture(){
 const map=new Map([["91",{itemID:91}],["jobs"+SEP+"7",{jobID:7}],["_meta",{nextJobID:8}]]);
 const tx={get:(t,k)=>map.get(k)??null,scan:t=>[...map].map(([key,value])=>({key,value})),
  put:(t,k,v)=>map.set(k,v),del:(t,k)=>map.delete(k)};
 return {db:createScopedSqlFacade(tx),map};
}
test("native scoped SQL requires a restricted GameStore tx",()=>{
 assert.throws(()=>createScopedSqlFacade({}),/GAMESTORE_TRANSACTION_REQUIRED/);
});
test("refuses reads before BEGIN",()=>{
 const {db}=fixture();assert.throws(()=>db.prepare('SELECT key,json FROM "items"'),/NOT_ACTIVE/);
});
test("only BEGIN IMMEDIATE is admitted",()=>{
 const {db}=fixture();assert.throws(()=>db.exec("BEGIN"),/CONTROL_REJECTED/);
 db.exec("BEGIN IMMEDIATE");assert.equal(db.phase(),"ACTIVE");
});
test("read native JSON row and flat allocator-style scalar",()=>{
 const {db}=fixture();db.exec("BEGIN IMMEDIATE");
 assert.equal(db.prepare('SELECT json FROM "items" WHERE key=?').get("91").json,'{"itemID":91}');
 assert.equal(db.prepare('SELECT json FROM "identityState" WHERE key=?').get("_meta").json,'{"nextJobID":8}');
});
test("industry LIKE can only list jobs keyspace",()=>{
 const {db}=fixture();db.exec("BEGIN IMMEDIATE");
 assert.equal(db.prepare('SELECT key,json FROM "industryJobs" WHERE key LIKE ?').all("jobs"+SEP+"%").length,1);
 assert.throws(()=>db.prepare('SELECT key,json FROM "industryJobs" WHERE key LIKE ?').all("%"),/PATTERN_REJECTED/);
});
test("both native UPSERT syntaxes work",()=>{
 const {db,map}=fixture();db.exec("BEGIN IMMEDIATE");
 db.prepare('INSERT INTO "items"(key,json) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET json=excluded.json').run("93",'{"itemID":93}');
 db.prepare('INSERT INTO "items" (key,json) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET json=excluded.json').run("94",'{"itemID":94}');
 assert.equal(map.get("93").itemID,93);assert.equal(map.get("94").itemID,94);
});
test("deletes selected inventory row",()=>{
 const {db,map}=fixture();db.exec("BEGIN IMMEDIATE");
 db.prepare('DELETE FROM "items" WHERE key=?').run("91");assert.equal(map.has("91"),false);
});
test("refuses SQL injection and non-manufacturing tables",()=>{
 const {db}=fixture();db.exec("BEGIN IMMEDIATE");
 assert.throws(()=>db.prepare("DROP TABLE items"),/STATEMENT_REJECTED/);
 assert.throws(()=>db.prepare('SELECT json FROM "marketEscrow" WHERE key=?'),/TABLE_REJECTED/);
});
test("commit is terminal and cannot be repeated",()=>{
 const {db}=fixture();db.exec("BEGIN IMMEDIATE");db.exec("COMMIT");
 assert.equal(db.phase(),"COMMIT_REQUESTED");
 assert.throws(()=>db.exec("COMMIT"),/CONTROL_REJECTED/);
 assert.throws(()=>db.prepare('SELECT key,json FROM "items"'),/NOT_ACTIVE/);
});
test("rollback is terminal and cannot restart a scoped transaction",()=>{
 const {db}=fixture();db.exec("BEGIN IMMEDIATE");db.exec("ROLLBACK");
 assert.equal(db.phase(),"ROLLED_BACK");assert.throws(()=>db.exec("BEGIN IMMEDIATE"),/CONTROL_REJECTED/);
});
