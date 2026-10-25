import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";import os from "node:os";import path from "node:path";
import {DatabaseSync} from "node:sqlite";import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createSqliteAdapter}=require("../integration/coopGameStoreAtomic.cjs");
const {createNpcIndustryScopedProof}=require("../integration/coopNpcIndustryGameStoreScope.cjs");
const {createNpcIndustryReadyProof}=require("../integration/coopNpcIndustryReady.cjs");
const SEP="\u001f",OP="npc-manufacture:9e3123226b71e9fe",NOW=1761390000000,FINISH=NOW+120000;
const plan={ownerID:1000010,stationID:60000001,facilityID:60000001,systemID:30000144,
 blueprintItemID:91,blueprintTypeID:1111,productTypeID:215,runs:1,outputQuantity:100,
 materials:[{typeID:34,quantity:15},{typeID:35,quantity:5}]};
const quote={ownerID:plan.ownerID,blueprintID:91,facilityID:plan.facilityID,productTypeID:215,activityID:1,
 runs:1,cost:10.02,tax:1.11,totalCost:11.13,timeInSeconds:120,materials:plan.materials,
 outputs:[{typeID:215,quantity:100}]};
const tables=["items","corporationRuntime","industryBlueprintState","industryJobs","identityState"];
function fixture(overrides={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"coop-032f-ready-"));
 const db=new DatabaseSync(path.join(dir,"gamestore.sqlite"));
 for(const t of tables)db.exec('CREATE TABLE "'+t+'"(key TEXT PRIMARY KEY,json TEXT NOT NULL)');
 const put=(t,k,v)=>db.prepare('INSERT INTO "'+t+'"(key,json) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET json=excluded.json').run(String(k),JSON.stringify(v));
 const read=(t,k)=>{const r=db.prepare('SELECT json FROM "'+t+'" WHERE key=?').get(String(k));return r?JSON.parse(r.json):null;};
 put("items","91",{itemID:91,typeID:1111,categoryID:9,ownerID:plan.ownerID,locationID:plan.stationID,flagID:4,singleton:1,quantity:1});
 for(const [id,typeID,qty] of [[92,34,10],[93,34,10],[94,35,5]])
  put("items",String(id),{itemID:id,typeID,ownerID:plan.ownerID,locationID:plan.stationID,flagID:4,singleton:0,quantity:qty,stacksize:qty});
 put("corporationRuntime","corporations"+SEP+plan.ownerID,{corporationID:plan.ownerID,wallet:{divisions:{"1000":{balance:120.19,journal:[],transactions:[]}}}});
 put("industryBlueprintState","records"+SEP+"91",{itemID:91,typeID:1111,original:true,jobID:null});
 put("industryJobs","_meta",{nextJobID:970000000000000,version:1});
 put("identityState","version",1);put("identityState","nextItemID",1990000200);
 const writer=createSqliteAdapter(()=>db).claimTransactor(),gameStore={
  transact:(t,fn)=>writer.transact(t,fn).result,isPoisoned:()=>false
 };
 let now=NOW;
 const owners=(overrides.verifyNativeOwner||(()=>true)),outputs=(overrides.verifyNativeOutput||(()=>true));
 const clock=()=>now;
 const industry=createNpcIndustryScopedProof({gameStore,verifyNativeQuote:()=>true,
  verifyNativeOwner:owners,verifyNativeOutput:outputs,verifyNativeIdFloor:()=>true,
  buildNativeOutputItem:x=>({...x,categoryID:8,singleton:0,stacksize:x.quantity}),clock});
 const ready=createNpcIndustryReadyProof({gameStore,verifyNativeOwner:owners,verifyNativeOutput:outputs,clock});
 const snapshot=()=>Object.fromEntries(tables.map(t=>[t,db.prepare('SELECT key,json FROM "'+t+'" ORDER BY key').all()]));
 const install=()=>{const r=industry.installOnce(plan,quote,OP);assert.equal(r.status,"INSTALLED",JSON.stringify(r));return r};
 return {dir,db,read,put,industry,ready,install,snapshot,setNow:x=>now=x,close(){db.close();fs.rmSync(dir,{recursive:true,force:true})}};
}
function withFixture(fn,overrides){
 const f=fixture(overrides),a=process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS,p=process.env.EVEJS_COOP_NATIVE_NPC_TX_PROOF;
 try{process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS="1";process.env.EVEJS_COOP_NATIVE_NPC_TX_PROOF="1";return fn(f)}
 finally{if(a===undefined)delete process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS;else process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS=a;
 if(p===undefined)delete process.env.EVEJS_COOP_NATIVE_NPC_TX_PROOF;else process.env.EVEJS_COOP_NATIVE_NPC_TX_PROOF=p;f.close()}
}
test("real native INSTALLED state remains INSTALLED before endDate; no early output",()=>withFixture(f=>{
 const r=f.install(),before=f.snapshot();
 assert.match(f.ready.markReadyOnce(OP).error,/NOT_YET_READY/);
 assert.deepEqual(f.snapshot(),before);
 assert.match(f.industry.deliverOnce(OP).error,/NOT_NATIVE_READY/);
 assert.equal(f.read("industryJobs","jobs"+SEP+r.jobID).status,1);
}));
test("native elapsed endDate persists READY then exactly-once output/BPO delivery",()=>withFixture(f=>{
 const r=f.install();f.setNow(FINISH);
 const ready=f.ready.markReadyOnce(OP);assert.equal(ready.status,"READY",JSON.stringify(ready));
 const first=f.snapshot(),replayed=f.ready.markReadyOnce(OP);
 assert.equal(replayed.status,"ALREADY_READY");assert.deepEqual(f.snapshot(),first);
 const job=f.read("industryJobs","jobs"+SEP+r.jobID);
 assert.equal(job.status,3);assert.equal(job.endDate,job.startDate==="0"?"impossible":String(BigInt(job.startDate)+1200000000n));
 const out=f.industry.deliverOnce(OP);assert.equal(out.status,"DELIVERED",JSON.stringify(out));
 assert.equal(f.read("items",String(out.itemID)).ownerID,plan.ownerID);
 assert.equal(f.read("items","91").locationID,plan.stationID);
 assert.equal(f.read("industryBlueprintState","records"+SEP+"91").jobID,null);
 assert.equal(f.industry.deliverOnce(OP).status,"ALREADY_DELIVERED");
 assert.match(f.ready.markReadyOnce(OP).error,/NATIVE_READY_BLUEPRINT_CUSTODY_INVALID|STATUS_NOT_INSTALLED/);
}));
test("exact expiry instant is READY, even without a second elapsed tick",()=>withFixture(f=>{
 f.install();f.setNow(FINISH);
 assert.equal(f.ready.markReadyOnce(OP).status,"READY");
}));
test("installed BPO ownership mismatch blocks readiness",()=>withFixture(f=>{
 f.install();f.setNow(FINISH);
 const item=f.read("items","91");f.put("items","91",{...item,ownerID:9000000});
 const snap=f.snapshot();assert.match(f.ready.markReadyOnce(OP).error,/BLUEPRINT_CUSTODY_INVALID/);
 assert.deepEqual(f.snapshot(),snap);
}));
test("blueprint state disagreement blocks readiness",()=>withFixture(f=>{
 f.install();f.setNow(FINISH);
 const state=f.read("industryBlueprintState","records"+SEP+"91");
 f.put("industryBlueprintState","records"+SEP+"91",{...state,jobID:1});
 const snap=f.snapshot();assert.match(f.ready.markReadyOnce(OP).error,/BLUEPRINT_CUSTODY_INVALID/);
 assert.deepEqual(f.snapshot(),snap);
}));
test("tampered job deadline cannot advance READY even if it is in the past",()=>withFixture(f=>{
 const r=f.install();f.setNow(FINISH);
 const key="jobs"+SEP+r.jobID;
 const j=f.read("industryJobs",key);f.put("industryJobs",key,{...j,endDate:String(BigInt(j.startDate)+10000000n)});
 const snap=f.snapshot();assert.match(f.ready.markReadyOnce(OP).error,/AUTHORITY_REJECTED/);
 assert.deepEqual(f.snapshot(),snap);
}));
test("paused, cancelled and completed statuses refuse readiness",()=>withFixture(f=>{
 const r=f.install(),key="jobs"+SEP+r.jobID;f.setNow(FINISH);
 for(const change of [{pauseDate:"133000000000000000"},{status:2},{status:4}]){
  const j=f.read("industryJobs",key);f.put("industryJobs",key,{...j,...change});
  const snap=f.snapshot();assert.equal(f.ready.markReadyOnce(OP).status,"BLOCKED");
  assert.deepEqual(f.snapshot(),snap);
  f.put("industryJobs",key,j);
 }
}));
test("duplicate operation identity cannot select one job arbitrarily",()=>withFixture(f=>{
 const r=f.install(),j=f.read("industryJobs","jobs"+SEP+r.jobID);
 f.put("industryJobs","jobs"+SEP+(r.jobID+1),{...j,jobID:r.jobID+1});
 f.setNow(FINISH);const snap=f.snapshot();
 assert.match(f.ready.markReadyOnce(OP).error,/DUPLICATE_OPERATION_JOBS/);
 assert.deepEqual(f.snapshot(),snap);
}));
test("external native output or owner authority can veto readiness",()=>withFixture(f=>{
 f.install();f.setNow(FINISH);
 const row=f.snapshot(),other=createNpcIndustryReadyProof({
  gameStore:{transact:(t,fn)=>{const writer=createSqliteAdapter(()=>f.db).claimTransactor();return writer.transact(t,fn).result;}},
  verifyNativeOwner:()=>false,verifyNativeOutput:()=>true,clock:()=>FINISH});
 assert.match(other.markReadyOnce(OP).error,/AUTHORITY_REJECTED/);assert.deepEqual(f.snapshot(),row);
}));
test("missing flag or invalid operation ID refuses changes",()=>withFixture(f=>{
 f.install();f.setNow(FINISH);const before=f.snapshot();
 delete process.env.EVEJS_COOP_NATIVE_NPC_TX_PROOF;
 assert.equal(f.ready.markReadyOnce(OP).error,"NATIVE_NPC_SCOPE_PROOF_DISABLED");
 process.env.EVEJS_COOP_NATIVE_NPC_TX_PROOF="1";
 assert.equal(f.ready.markReadyOnce("npc-manufacture:a").error,"INVALID_OPERATION_ID");
 assert.deepEqual(f.snapshot(),before);
}));
