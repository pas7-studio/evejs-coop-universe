import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";import os from "node:os";import path from "node:path";
import {DatabaseSync} from "node:sqlite";import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createSqliteAdapter}=require("../integration/coopGameStoreAtomic.cjs");
const {createScopedSqlFacade,createNpcIndustryScopedProof}=require("../integration/coopNpcIndustryGameStoreScope.cjs");
const {createNativeIndustryBindings}=require("../integration/coopNpcIndustryNativeBindings.cjs");
const OP="npc-manufacture:9e3123226b71e9fe",NOW=1761390000000,SEP="\u001f";
const ft=ms=>String(BigInt(ms)*10000n+116444736000000000n);
const plan={ownerID:1000010,stationID:60000001,facilityID:60000001,systemID:30000144,
 blueprintItemID:91,blueprintTypeID:1111,productTypeID:215,runs:1,outputQuantity:100,
 materials:[{typeID:34,quantity:15},{typeID:35,quantity:5}]};
const quote={ownerID:plan.ownerID,blueprintID:91,facilityID:plan.facilityID,productTypeID:215,
 activityID:1,runs:1,cost:10.02,tax:1.11,totalCost:11.13,timeInSeconds:120,
 materials:plan.materials,outputs:[{typeID:215,quantity:100}]};
const tables=["items","corporationRuntime","industryBlueprintState","industryJobs","identityState"];
function fixture(opts={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"coop-032e-")),db=new DatabaseSync(path.join(dir,"gamestore.sqlite"));
 for(const t of tables)db.exec('CREATE TABLE "'+t+'"(key TEXT PRIMARY KEY,json TEXT NOT NULL)');
 const put=(t,k,v)=>db.prepare('INSERT INTO "'+t+'"(key,json) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET json=excluded.json').run(String(k),JSON.stringify(v));
 const read=(t,k)=>{const r=db.prepare('SELECT json FROM "'+t+'" WHERE key=?').get(String(k));return r?JSON.parse(r.json):null;};
 put("items","91",{itemID:91,typeID:1111,categoryID:9,ownerID:plan.ownerID,locationID:plan.stationID,flagID:4,singleton:1,quantity:1});
 for(const [id,typeID,qty] of [[92,34,10],[93,34,10],[94,35,5]])
  put("items",String(id),{itemID:id,typeID,ownerID:plan.ownerID,locationID:plan.stationID,flagID:4,singleton:0,quantity:qty,stacksize:qty});
 put("items","95",{itemID:95,typeID:34,ownerID:123456,locationID:plan.stationID,flagID:4,singleton:0,quantity:100,stacksize:100});
 put("corporationRuntime","corporations"+SEP+plan.ownerID,{corporationID:plan.ownerID,wallet:{divisions:{"1000":{balance:120.19,journal:[],transactions:[]}}}});
 put("industryBlueprintState","records"+SEP+"91",{itemID:91,typeID:1111,original:true,jobID:null});
 put("industryJobs","_meta",{nextJobID:970000000000000,version:1});
 put("identityState","version",1);put("identityState","nextItemID",1990000200);
 const writer=createSqliteAdapter(()=>db).claimTransactor();
 const gameStore={transact:(t,fn)=>writer.transact(t,fn).result,isPoisoned:()=>false};
 const proof=createNpcIndustryScopedProof({gameStore,verifyNativeQuote:()=>true,verifyNativeOwner:()=>true,
  verifyNativeOutput:()=>true,verifyNativeIdFloor:()=>true,
  buildNativeOutputItem:x=>({...x,stacksize:x.quantity,singleton:0,categoryID:8}),clock:()=>NOW,...opts});
 const snapshot=()=>Object.fromEntries(tables.map(t=>[t,db.prepare('SELECT key,json FROM "'+t+'" ORDER BY key').all()]));
 return {db,put,read,proof,snapshot,close(){db.close();fs.rmSync(dir,{recursive:true,force:true})}};
}
function withFixture(fn){
 const old1=process.env.EVEJS_COOP_NATIVE_NPC_TX_PROOF,old2=process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS,f=fixture();
 try{process.env.EVEJS_COOP_NATIVE_NPC_TX_PROOF="1";process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS="1";return fn(f)}
 finally{if(old1===undefined)delete process.env.EVEJS_COOP_NATIVE_NPC_TX_PROOF;else process.env.EVEJS_COOP_NATIVE_NPC_TX_PROOF=old1;
  if(old2===undefined)delete process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS;else process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS=old2;f.close()}
}
test("install through GameStore TX spends exact NPC assets once, preserving foreign property",()=>withFixture(f=>{
 const r=f.proof.installOnce(plan,quote,OP);assert.equal(r.status,"INSTALLED",JSON.stringify(r));
 assert.equal(f.read("items","92"),null);assert.equal(f.read("items","93").quantity,5);
 assert.equal(f.read("items","94"),null);assert.equal(f.read("items","95").quantity,100);
 assert.equal(f.read("items","91").locationID,2003);
 assert.equal(f.read("corporationRuntime","corporations"+SEP+plan.ownerID).wallet.divisions["1000"].balance,109.06);
 const snapshot=f.snapshot();assert.equal(f.proof.installOnce(plan,quote,OP).status,"ALREADY_INSTALLED");
 assert.deepEqual(f.snapshot(),snapshot);
}));
test("installed job must be genuinely READY and elapsed before delivery",()=>withFixture(f=>{
 const r=f.proof.installOnce(plan,quote,OP);assert.equal(r.status,"INSTALLED");
 const denied=f.proof.deliverOnce(OP);assert.match(denied.error,/JOB_NOT_NATIVE_READY/);
 const k="jobs"+SEP+r.jobID;
 f.put("industryJobs",k,{...f.read("industryJobs",k),status:3,endDate:ft(NOW-1000)});
 const done=f.proof.deliverOnce(OP);assert.equal(done.status,"DELIVERED",JSON.stringify(done));
 assert.equal(f.read("items",String(done.itemID)).customInfo,"coop-industry:v1:"+r.jobID);
 assert.equal(f.read("items","91").locationID,plan.stationID);
 assert.equal(f.read("industryBlueprintState","records"+SEP+"91").jobID,null);
 assert.equal(f.read("identityState","nextItemID"),done.itemID+1);
 const after=f.snapshot();assert.equal(f.proof.deliverOnce(OP).status,"ALREADY_DELIVERED");
 assert.deepEqual(f.snapshot(),after);
}));
test("fault after wallet debit cancels GameStore transaction, no hidden partial SQL",()=>withFixture(f=>{
 const bad=fixture({faultAt:"AFTER_WALLET"});
 try{const initial=bad.snapshot(),r=bad.proof.installOnce(plan,quote,OP);
  assert.equal(r.status,"BLOCKED");assert.match(r.error,/AFTER_WALLET/);
  assert.deepEqual(bad.snapshot(),initial);}finally{bad.close();}
}));
test("fault after output issuance cancels item grant and ID allocation",()=>withFixture(f=>{
 const bad=fixture({faultAt:"AFTER_OUTPUT"});
 try{const r=bad.proof.installOnce(plan,quote,OP);assert.equal(r.status,"INSTALLED");
  const k="jobs"+SEP+r.jobID;bad.put("industryJobs",k,{...bad.read("industryJobs",k),status:3,endDate:ft(NOW-1000)});
  const snapshot=bad.snapshot(),result=bad.proof.deliverOnce(OP);
  assert.match(result.error,/AFTER_OUTPUT/);assert.deepEqual(bad.snapshot(),snapshot);
 }finally{bad.close();}
}));
test("proof feature flags are both mandatory",()=>withFixture(f=>{
 const before=f.snapshot();delete process.env.EVEJS_COOP_NATIVE_NPC_TX_PROOF;
 assert.equal(f.proof.installOnce(plan,quote,OP).error,"NATIVE_NPC_SCOPE_PROOF_DISABLED");
 assert.equal(f.proof.deliverOnce(OP).error,"NATIVE_NPC_SCOPE_PROOF_DISABLED");
 assert.deepEqual(f.snapshot(),before);
}));
test("scope refuses SQL injection, extra tables, and broad industry LIKE scans",()=>{
 const rows=new Map([["91",{itemID:91}],["jobs"+SEP+"7",{jobID:7}]]);
 const tx={get:(t,k)=>rows.get(k)??null,scan:t=>[...rows].map(([key,value])=>({key,value})),
  put:(t,k,v)=>rows.set(k,v),del:(t,k)=>rows.delete(k)};
 const db=createScopedSqlFacade(tx);
 assert.throws(()=>db.prepare('SELECT json FROM "items" WHERE key=?'),/NOT_ACTIVE/);
 db.exec("BEGIN IMMEDIATE");
 assert.equal(db.prepare('SELECT json FROM "items" WHERE key=?').get("91").json,'{"itemID":91}');
 assert.equal(db.prepare('SELECT key,json FROM "industryJobs" WHERE key LIKE ?').all("jobs"+SEP+"%").length,1);
 db.prepare('INSERT INTO "items"(key,json) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET json=excluded.json').run("92",'{"itemID":92}');
 assert.equal(rows.get("92").itemID,92);
 db.prepare('DELETE FROM "items" WHERE key=?').run("92");
 assert.throws(()=>db.prepare("DROP TABLE items"),/REJECTED/);
 assert.throws(()=>db.prepare('SELECT json FROM "marketEscrow" WHERE key=?'),/REJECTED/);
 assert.throws(()=>db.prepare('SELECT key,json FROM "industryJobs" WHERE key LIKE ?').all("%"),/REJECTED/);
 const numeric=db.prepare('SELECT json FROM "items" WHERE key=?').get(91);assert.equal(numeric.json,'{"itemID":91}');
 assert.equal(db.prepare('SELECT json FROM "industryJobs" WHERE key LIKE ?').all("jobs"+SEP+"%").length,1);
 db.exec("COMMIT");assert.equal(db.phase(),"COMMIT_REQUESTED");
 assert.throws(()=>db.exec("COMMIT"),/REJECTED/);
});


test("read-only NPC industry debit witness rejects sub-cent or nonnumeric journal evidence",()=>{
 const jobID=970000000000000,ownerID=1000010;
 const job={jobID,ownerID,coopOperationID:OP,totalCost:11.13,blueprintID:91};
 const row={transactionID:jobID,entryTypeID:10,ownerID1:ownerID,
  referenceID:jobID,accountKey:1000,amount:-11.13,balance:108.87};
 const native={read:(table,key)=>{
  if(table==="industryJobs"&&key==="/jobs")
   return {success:true,data:{[String(jobID)]:job}};
  if(table==="corporationRuntime"&&key==="/corporations/"+ownerID)
   return {success:true,data:{corporationID:ownerID,wallet:{
    divisions:{"1000":{transactions:[row]}}}}};
  throw Error("UNEXPECTED_READ:"+table+":"+key);
 },coopAtomicNativeRows:{transact:()=>{throw Error("NO_WRITES")}}};
 const binding=createNativeIndustryBindings({gameStore:native,
  itemStore:{findItemById:()=>null},resolveCanonicalQuote:()=>null,
  verifyNativeQuote:()=>true,verifyNativeOwner:()=>true,
  verifyNativeOutput:()=>true,verifyNativeIdFloor:()=>true,
  buildNativeOutputItem:()=>null});
 assert.equal(binding.getIndustryDebit(jobID).amountCents,1113);
 for(const [type,change,restore] of [
  ["subcent-debit",()=>row.amount=-11.134,()=>row.amount=-11.13],
  ["string-debit",()=>row.amount="-11.13",()=>row.amount=-11.13],
  ["subcent-wallet",()=>row.balance=108.874,()=>row.balance=108.87],
  ["string-wallet",()=>row.balance="108.87",()=>row.balance=108.87],
  ["subcent-quote",()=>job.totalCost=11.134,()=>job.totalCost=11.13]
 ]){
  change();
  assert.throws(()=>binding.getIndustryDebit(jobID),/NATIVE_INDUSTRY_DEBIT_MISMATCH/,type);
  restore();
  assert.equal(binding.getIndustryDebit(jobID).amountCents,1113,type);
 }
});
