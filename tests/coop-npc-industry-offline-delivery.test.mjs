import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
const require=createRequire(import.meta.url);
const {createOfflineAtomicDelivery}=require('../integration/coopNpcIndustryOfflineDelivery.cjs');
const SEP='\u001f';
const OP='npc-manufacture:9e3123226b71e9fe';
const NOW=1761390000000;
const filetime=ms=>String(BigInt(ms)*10000n+116444736000000000n);
const job={activityID:1,jobID:970000000000000,ownerID:1000010,stationID:60000001,facilityID:60000001,
 blueprintID:91,blueprintTypeID:1111,blueprintCopy:false,blueprintLocationID:60000001,
 blueprintLocationFlagID:4,productTypeID:215,status:3,runs:1,outputLocationID:60000001,
 outputFlagID:4,endDate:filetime(NOW-1000),coopOperationID:OP,
 coopQuoteSignature:JSON.stringify({ownerID:1000010,blueprintID:91,facilityID:60000001,
  productTypeID:215,activityID:1,runs:1,outputs:[{typeID:215,quantity:100}]})};
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'coop-atomic-delivery-'));
 const db=new DatabaseSync(path.join(root,'gamestore.sqlite'));
 for(const name of ['items','industryJobs','industryBlueprintState','identityState'])
  db.exec(`CREATE TABLE "${name}"(key TEXT PRIMARY KEY,json TEXT NOT NULL)`);
 const put=(table,key,value)=>db.prepare(`INSERT INTO "${table}"(key,json) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET json=excluded.json`).run(String(key),JSON.stringify(value));
 const read=(table,key)=>{const rec=db.prepare(`SELECT json FROM "${table}" WHERE key=?`).get(String(key));return rec?JSON.parse(rec.json):null};
 put('items','91',{itemID:91,typeID:1111,ownerID:1000010,locationID:2003,flagID:4,
  categoryID:9,singleton:1,quantity:1});
 put('items','1990000050',{itemID:1990000050,typeID:34,ownerID:1000010,locationID:60000001,
  flagID:4,categoryID:4,singleton:0,quantity:10,stacksize:10});
 put('items','2990000060',{itemID:2990000060,typeID:215,ownerID:23232,locationID:60000001,
  flagID:4,categoryID:8,singleton:0,quantity:20,stacksize:20});
 put('industryJobs',`jobs${SEP}${job.jobID}`,job);
 put('industryJobs','_meta',{nextJobID:job.jobID+1});
 put('industryBlueprintState',`records${SEP}91`,{itemID:91,typeID:1111,original:true,jobID:job.jobID});
 put('identityState','version',1);put('identityState','nextItemID',2990000061);
 const snapshot=()=>Object.fromEntries(['items','industryJobs','industryBlueprintState','identityState']
  .map(t=>[t,db.prepare(`SELECT key,json FROM "${t}" ORDER BY key`).all()]));
 const delivery=(overrides={})=>createOfflineAtomicDelivery({db,offlineExclusive:true,
  verifyNativeOutput:()=>true,verifyNativeOwner:()=>true,verifyNativeIdFloor:()=>true,
  buildNativeOutputItem:({itemID,typeID,ownerID,locationID,flagID,quantity})=>({itemID,typeID,ownerID,
   locationID,flagID,quantity,stacksize:quantity,singleton:0,categoryID:8}),clock:()=>NOW,...overrides});
 return {db,put,read,snapshot,delivery,close(){db.close();fs.rmSync(root,{recursive:true,force:true})}};
}
const withFixture=fn=>{const f=fixture();try{return fn(f)}finally{f.close()}};
test('one READY job delivers one native stack, restores BPO, advances shared identityState and is replay safe',()=>withFixture(f=>{
 const r=f.delivery().deliverOnce(OP);assert.equal(r.status,'DELIVERED');assert.equal(r.itemID,2990000061);
 assert.equal(f.read('items',r.itemID).ownerID,job.ownerID);
 assert.equal(f.read('items',r.itemID).customInfo,`coop-industry:v1:${job.jobID}`);
 assert.equal(f.read('items','91').locationID,job.stationID);
 assert.equal(f.read('industryBlueprintState',`records${SEP}91`).jobID,null);
 assert.equal(f.read('industryJobs',`jobs${SEP}${job.jobID}`).status,4);
 assert.equal(f.read('identityState','nextItemID'),r.itemID+1);
 const after=f.snapshot();assert.equal(f.delivery().deliverOnce(OP).status,'ALREADY_DELIVERED');
 assert.deepEqual(f.snapshot(),after);
}));
for(const faultAt of ['AFTER_BEGIN','AFTER_VALIDATION','AFTER_OUTPUT','AFTER_IDENTITY','AFTER_BLUEPRINT','BEFORE_COMMIT']){
 test(`fault ${faultAt} rolls back all native rows byte-for-byte`,()=>withFixture(f=>{
  const before=f.snapshot(),r=f.delivery({faultAt}).deliverOnce(OP);
  assert.match(r.error,/TEST_FAULT/);assert.deepEqual(f.snapshot(),before);
 }));
}
for(const [name,change,match] of [
 ['job INSTALLED not ready',f=>f.put('industryJobs',`jobs${SEP}${job.jobID}`,{...job,status:1}),/JOB_NOT_NATIVE_READY/],
 ['endDate in future',f=>f.put('industryJobs',`jobs${SEP}${job.jobID}`,{...job,endDate:filetime(NOW+1)}),/END_DATE_NOT_REACHED/],
 ['wrong blueprint custody',f=>f.put('items','91',{...f.read('items','91'),ownerID:333}),/BLUEPRINT_CUSTODY/],
 ['foreign job output station',f=>f.put('industryJobs',`jobs${SEP}${job.jobID}`,{...job,outputLocationID:123}),/JOB_IDENTITY/],
 ['altered quote output',f=>f.put('industryJobs',`jobs${SEP}${job.jobID}`,{...job,coopQuoteSignature:JSON.stringify({...JSON.parse(job.coopQuoteSignature),outputs:[{typeID:215,quantity:0}]})}),/OUTPUT_AUTHORITY/],
 ['corrupt item row key',f=>f.put('items','4000000000',{...f.read('items','91'),itemID:90000}),/ITEM_KEY_MISMATCH/],
 ['invalid shared allocator',f=>f.put('identityState','nextItemID',5),/ITEM_SEQUENCE_MISSING/]
])test(`${name} blocks without output or partial mutation`,()=>withFixture(f=>{
 change(f);const before=f.snapshot(),r=f.delivery().deliverOnce(OP);
 assert.match(r.error,match);assert.deepEqual(f.snapshot(),before);
}));
test('untrusted metadata builder and absent trusted verifier fail closed',()=>withFixture(f=>{
 const before=f.snapshot();const r=f.delivery({buildNativeOutputItem:()=>({itemID:5,quantity:100})}).deliverOnce(OP);
 assert.match(r.error,/INVALID_NATIVE_OUTPUT_ITEM/);assert.deepEqual(f.snapshot(),before);
 assert.throws(()=>createOfflineAtomicDelivery({db:f.db,offlineExclusive:true}),/VERIFIED_NATIVE/);
}));
test('global allocator vetoes a native ID that would collide with another namespace',()=>withFixture(f=>{
 const before=f.snapshot();const r=f.delivery({verifyNativeIdFloor:()=>false}).deliverOnce(OP);
 assert.match(r.error,/NATIVE_ITEM_ID_NOT_SAFE/);assert.deepEqual(f.snapshot(),before);
}));
test('duplicate coopOperationID jobs fail closed, never choose arbitrary job',()=>withFixture(f=>{
 f.put('industryJobs',`jobs${SEP}970000000000001`,{...job,jobID:970000000000001});
 const before=f.snapshot();const r=f.delivery().deliverOnce(OP);
 assert.match(r.error,/DUPLICATE_OPERATION_JOBS/);assert.deepEqual(f.snapshot(),before);
}));
test('receipt corruption after already delivered refuses replay',()=>withFixture(f=>{
 assert.equal(f.delivery().deliverOnce(OP).status,'DELIVERED');
 const j=f.read('industryJobs',`jobs${SEP}${job.jobID}`);j.coopDelivery.itemID=3000000000;
 f.put('industryJobs',`jobs${SEP}${job.jobID}`,j);
 const before=f.snapshot(),r=f.delivery().deliverOnce(OP);
 assert.match(r.error,/DELIVERY_RECEIPT_CORRUPT/);assert.deepEqual(f.snapshot(),before);
}));
test('unauthorized owner and unverified canonical output both refuse settlement',()=>withFixture(f=>{
 const before=f.snapshot();assert.match(f.delivery({verifyNativeOwner:()=>false}).deliverOnce(OP).error,/OUTPUT_AUTHORITY/);
 assert.match(f.delivery({verifyNativeOutput:()=>false}).deliverOnce(OP).error,/OUTPUT_AUTHORITY/);
 assert.deepEqual(f.snapshot(),before);
}));
