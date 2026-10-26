import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
const require=createRequire(import.meta.url);
const {createOfflineAtomicInstaller}=require('../integration/coopNpcIndustryOfflineAtomic.cjs');
const OP='npc-manufacture:9e3123226b71e9fe';
const plan={ownerID:1000010,stationID:60000001,systemID:30000144,facilityID:60000001,
 blueprintItemID:91,blueprintTypeID:1111,productTypeID:215,runs:1,outputQuantity:100,
 materials:[{typeID:34,quantity:15},{typeID:35,quantity:5}]};
const quote={ownerID:plan.ownerID,blueprintID:plan.blueprintItemID,facilityID:plan.facilityID,
 productTypeID:plan.productTypeID,activityID:1,runs:1,cost:10.02,tax:1.11,totalCost:11.13,
 timeInSeconds:120,materials:plan.materials,outputs:[{typeID:plan.productTypeID,quantity:plan.outputQuantity}]};
const ROWS={
 'items':[
  ['91',{itemID:91,ownerID:plan.ownerID,locationID:plan.stationID,flagID:4,singleton:1,typeID:1111,categoryID:9,quantity:1}],
  ['92',{itemID:92,ownerID:plan.ownerID,locationID:plan.stationID,flagID:4,singleton:0,typeID:34,quantity:10,stacksize:10,customInfo:'coop-refinery:one'}],
  ['93',{itemID:93,ownerID:plan.ownerID,locationID:plan.stationID,flagID:4,singleton:0,typeID:34,quantity:10,stacksize:10,customInfo:'coop-refinery:two'}],
  ['94',{itemID:94,ownerID:plan.ownerID,locationID:plan.stationID,flagID:4,singleton:0,typeID:35,quantity:5,stacksize:5,customInfo:'coop-refinery:three'}],
  ['95',{itemID:95,ownerID:234234,locationID:plan.stationID,flagID:4,singleton:0,typeID:34,quantity:100}]
 ],
 'corporationRuntime':[['corporations\u001f1000010',{corporationID:1000010,wallet:{divisions:{'1000':{key:1000,balance:120.19,journal:[],transactions:[]}}}}]],
 'industryBlueprintState':[['records\u001f91',{itemID:91,typeID:1111,original:true,runsRemaining:-1,jobID:null}]],
 'industryJobs':[['_meta',{nextJobID:970000000000000,version:1}],['jobs',{}]]
};
function fixture(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'coop-industry-atomic-'));
 const db=new DatabaseSync(path.join(dir,'gamestore.sqlite'));
 for(const [table,rows] of Object.entries(ROWS)){
  db.exec(`CREATE TABLE "${table}" (key TEXT PRIMARY KEY, json TEXT NOT NULL)`);
  for(const [key,obj] of rows)db.prepare(`INSERT INTO "${table}" (key,json) VALUES (?,?)`).run(key,JSON.stringify(obj));
 }
 const read=(t,key)=>{let x=db.prepare(`SELECT json FROM "${t}" WHERE key=?`).get(key);return x?JSON.parse(x.json):null};
 const snapshot=()=>Object.fromEntries(Object.keys(ROWS).map(t=>[t,db.prepare(`SELECT key,json FROM "${t}" ORDER BY key`).all()]));
 const installer=(opts={})=>createOfflineAtomicInstaller({db,offlineExclusive:true,verifyNativeQuote:()=>true,verifyNativeOwner:()=>true,clock:()=>1761390000000,...opts});
 return {db,dbPath:path.join(dir,'gamestore.sqlite'),read,snapshot,installer,close(){db.close();fs.rmSync(dir,{recursive:true,force:true})}};
}
const withFixture=fn=>{let f=fixture();try{return fn(f)}finally{f.close()}};
test('one native SQLite transaction debits minerals and ISK and installs blueprint/job exactly once',()=>withFixture(f=>{
 let r=f.installer().installOnce(plan,quote,OP);assert.equal(r.status,'INSTALLED');
 assert.equal(r.jobID,970000000000000);assert.equal(f.read('items','92'),null);
 assert.equal(f.read('items','93').quantity,5);assert.equal(f.read('items','94'),null);
 assert.equal(f.read('items','95').quantity,100);
 assert.equal(f.read('items','91').locationID,2003);
 assert.equal(f.read('corporationRuntime','corporations\u001f1000010').wallet.divisions['1000'].balance,109.06);
 assert.equal(f.read('industryBlueprintState','records\u001f91').jobID,r.jobID);
 assert.equal(f.read('industryJobs','jobs\u001f'+r.jobID).coopOperationID,OP);
 assert.equal(f.read('industryJobs','_meta').nextJobID,r.jobID+1);
 let before=f.snapshot();let replay=f.installer().installOnce(plan,quote,OP);
 assert.equal(replay.status,'ALREADY_INSTALLED');assert.deepEqual(f.snapshot(),before);
 assert.equal(f.installer().getJobByOperation(OP).jobID,r.jobID);
}));
for(const faultAt of ['AFTER_BEGIN','AFTER_VALIDATION','AFTER_MATERIALS','AFTER_WALLET','BEFORE_COMMIT']){
 test(`SQLite rolls back ALL four native tables at ${faultAt}`,()=>withFixture(f=>{
  let before=f.snapshot();let r=f.installer({faultAt}).installOnce(plan,quote,OP);
  assert.equal(r.status,'BLOCKED');assert.deepEqual(f.snapshot(),before);
 }));
}
test('insufficient wallet rejects with no debit or job',()=>withFixture(f=>{
 let corp=f.read('corporationRuntime','corporations\u001f1000010');corp.wallet.divisions['1000'].balance=1;
 f.db.prepare('UPDATE corporationRuntime SET json=? WHERE key=?').run(JSON.stringify(corp),'corporations\u001f1000010');
 let before=f.snapshot();let r=f.installer().installOnce(plan,quote,OP);
 assert.match(r.error,/WALLET_INSUFFICIENT/);assert.deepEqual(f.snapshot(),before);
}));
test('missing actual mineral stack blocks before any ISK debit',()=>withFixture(f=>{
 f.db.prepare('DELETE FROM items WHERE key=?').run('93');let snap=f.snapshot();let r=f.installer().installOnce(plan,quote,OP);
 assert.match(r.error,/MINERALS/);assert.deepEqual(f.snapshot(),snap);
}));
test('invalid BPO, reusing blueprint with a different operation and foreign assets reject',()=>withFixture(f=>{
 const s=f.read('items','91');s.ownerID=876;
 f.db.prepare('UPDATE items SET json=? WHERE key=?').run(JSON.stringify(s),'91');
 assert.match(f.installer().installOnce(plan,quote,OP).error,/BLUEPRINT/);
}));
test('refuses missing offline exclusive grant or external verifier',()=>withFixture(f=>{
 assert.throws(()=>createOfflineAtomicInstaller({db:f.db}),/OFFLINE_EXCLUSIVE/);
 assert.throws(()=>createOfflineAtomicInstaller({db:f.db,offlineExclusive:true}),/OFFLINE_EXCLUSIVE/);
}));
test('untrusted quote mismatch cannot debit anything',()=>withFixture(f=>{
 const bad={...quote,totalCost:0};let snapshot=f.snapshot();assert.throws(()=>f.installer().installOnce(plan,bad,OP),/NATIVE_QUOTE_MISMATCH/);assert.deepEqual(f.snapshot(),snapshot);
}));
test('external quote or owner verifier reject without touching native state',()=>withFixture(f=>{
 const state=f.snapshot();assert.equal(f.installer({verifyNativeQuote:()=>false}).installOnce(plan,quote,OP).status,'UNVERIFIED_NATIVE_AUTHORITY');
 assert.equal(f.installer({verifyNativeOwner:()=>false}).installOnce(plan,quote,OP).status,'UNVERIFIED_NATIVE_AUTHORITY');
 assert.deepEqual(f.snapshot(),state);
}));
test('stale BPO jobs lock rejects operation; reopening DB sees native jobs',()=>withFixture(f=>{
 const bp=f.read('industryBlueprintState','records\u001f91');bp.jobID=400;
 f.db.prepare('UPDATE industryBlueprintState SET json=? WHERE key=?').run(JSON.stringify(bp),'records\u001f91');
 assert.match(f.installer().installOnce(plan,quote,OP).error,/BLUEPRINT/);
}));
test('concurrent second SQLite connection sees already installed operation',()=>withFixture(f=>{
 const file=f.dbPath;
 const first=f.installer().installOnce(plan,quote,OP);assert.equal(first.status,'INSTALLED');
 const db2=new DatabaseSync(file,{readOnly:false});
 try{const other=createOfflineAtomicInstaller({db:db2,offlineExclusive:true,verifyNativeQuote:()=>true,verifyNativeOwner:()=>true});
 const second=other.installOnce(plan,quote,OP);assert.equal(second.status,'ALREADY_INSTALLED');}
 finally{db2.close()}
}));

test('second operation cannot use a BPO already consumed by first operation',()=>withFixture(f=>{
 let one=f.installer().installOnce(plan,quote,OP);assert.equal(one.status,'INSTALLED');
 const after=f.snapshot();let two=f.installer().installOnce(plan,quote,'npc-manufacture:second_id');
 assert.match(two.error,/BLUEPRINT_INVALID_OR_BUSY/);assert.deepEqual(f.snapshot(),after);
}));
test('same operation ID but a changed quote is a conflict, not a free replay',()=>withFixture(f=>{
 let one=f.installer().installOnce(plan,quote,OP);assert.equal(one.status,'INSTALLED');
 const after=f.snapshot();const changed={...quote,cost:10.03,tax:1.11,totalCost:11.14};
 let two=f.installer().installOnce(plan,changed,OP);assert.match(two.error,/OPERATION_IDENTITY_CONFLICT/);
 assert.deepEqual(f.snapshot(),after);
}));
test('quoted output must exactly match native source production quantity',()=>withFixture(f=>{
 let bad={...quote,outputs:[{typeID:215,quantity:500}]};
 assert.throws(()=>f.installer().installOnce(plan,bad,OP),/QUOTED_PRODUCT_MISMATCH/);
}));
test('native item row with mismatched itemID refuses install',()=>withFixture(f=>{
 const x=f.read('items','92');x.itemID=999;f.db.prepare('UPDATE items SET json=? WHERE key=?').run(JSON.stringify(x),'92');
 let snap=f.snapshot();assert.match(f.installer().installOnce(plan,quote,OP).error,/NATIVE_ITEM_KEY_MISMATCH/);
 assert.deepEqual(f.snapshot(),snap);
}));


test('sub-cent native NPC corporate balance never changes when installing real production',()=>withFixture(f=>{
 const corp=f.read('corporationRuntime','corporations\u001f1000010');
 corp.wallet.divisions['1000'].balance=120.004;
 f.db.prepare('UPDATE corporationRuntime SET json=? WHERE key=?')
  .run(JSON.stringify(corp),'corporations\u001f1000010');
 const before=f.snapshot(),r=f.installer().installOnce(plan,quote,OP);
 assert.equal(r.status,'BLOCKED');
 assert.match(r.error,/CORPORATE_WALLET_MISSING/);
 assert.deepEqual(f.snapshot(),before);
 assert.equal(f.read('industryJobs','jobs\u001f970000000000000'),null);
}));
test('sub-cent native production quote is rejected before any original inventory debit',()=>withFixture(f=>{
 const bad={...quote,cost:10.024,totalCost:11.134};
 const before=f.snapshot();
 assert.throws(()=>f.installer().installOnce(plan,bad,OP),/NATIVE_QUOTE_MISMATCH/);
 assert.deepEqual(f.snapshot(),before);
}));
test('one-cent mismatch between production cost, tax and total is not paid silently',()=>withFixture(f=>{
 const bad={...quote,totalCost:11.14};
 const before=f.snapshot();
 assert.throws(()=>f.installer().installOnce(plan,bad,OP),/NATIVE_QUOTE_MISMATCH/);
 assert.deepEqual(f.snapshot(),before);
}));
test('physical mineral stacksize mismatch cannot be spent as a valid original item',()=>withFixture(f=>{
 const item=f.read('items','92');item.stacksize=4;
 f.db.prepare('UPDATE items SET json=? WHERE key=?').run(JSON.stringify(item),'92');
 const before=f.snapshot(),result=f.installer().installOnce(plan,quote,OP);
 assert.equal(result.status,'BLOCKED');
 assert.match(result.error,/INSUFFICIENT_NATIVE_MINERALS/);
 assert.deepEqual(f.snapshot(),before);
}));
test('non-numeric wallet and quote strings are not accepted as native currency amounts',()=>withFixture(f=>{
 const bad={...quote,totalCost:'11.13'};
 assert.throws(()=>f.installer().installOnce(plan,bad,OP),/NATIVE_QUOTE_MISMATCH/);
 const corp=f.read('corporationRuntime','corporations\u001f1000010');
 corp.wallet.divisions['1000'].balance='120.19';
 f.db.prepare('UPDATE corporationRuntime SET json=? WHERE key=?')
  .run(JSON.stringify(corp),'corporations\u001f1000010');
 const before=f.snapshot(),r=f.installer().installOnce(plan,quote,OP);
 assert.match(r.error,/CORPORATE_WALLET_MISSING/);
 assert.deepEqual(f.snapshot(),before);
}));
