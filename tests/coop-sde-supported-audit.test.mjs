import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const {audit, readJsonl, REQUIRED, parseArgs} = require('../scripts/coop-sde-supported-audit.cjs');
const fixtures = () => {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'chat37-sde-'));
 const sdeDir=path.join(root,'sde');fs.mkdirSync(sdeDir);
 const nativeItemsFile=path.join(root,'native-items.jsonl'),nativeDogmaFile=path.join(root,'native-dogma.jsonl');
 const data={
  types:[{_key:587,groupID:25,name:{en:'Rifter'},published:true,portionSize:1,marketGroupID:61,mass:1050000,volume:27289,graphicID:42},
   {_key:34,groupID:18,name:{en:'Tritanium'},published:true,portionSize:1,marketGroupID:20}],
  groups:[{_key:25,categoryID:6,published:true},{_key:18,categoryID:4,published:true}],
  categories:[{_key:6,name:{en:'Ship'}},{_key:4,name:{en:'Material'}}],
  marketGroups:[{_key:61,hasTypes:true,name:{en:'Frigates'},parentGroupID:20},{_key:20,hasTypes:true,name:{en:'Root'}}],
  typeDogma:[{_key:587,dogmaAttributes:[{attributeID:14,value:3}],dogmaEffects:[{effectID:12,isDefault:true}]}],
  dogmaAttributes:[{_key:14,name:'hiSlots'}],dogmaEffects:[{_key:12,name:'hiPower'}]
 };
 const items=[{typeID:587,groupID:25,categoryID:6,name:'Rifter',published:true,marketGroupID:61,mass:1050000,volume:27289,graphicID:42},
  {typeID:34,groupID:18,categoryID:4,name:'Tritanium',published:true,marketGroupID:20}];
 const dogma=[{_key:587,dogmaAttributes:[{attributeID:14,value:3}],dogmaEffects:[{effectID:12,isDefault:true}]}];
 const write=(file,rows)=>fs.writeFileSync(file,rows.map(x=>JSON.stringify(x)).join('\n')+'\n');
 const save=()=>{for(const name of REQUIRED)write(path.join(sdeDir,name+'.jsonl'),data[name]);write(nativeItemsFile,items);write(nativeDogmaFile,dogma)};
 save();return {root,sdeDir,nativeItemsFile,nativeDogmaFile,data,items,dogma,save,clear:()=>fs.rmSync(root,{recursive:true,force:true})};
};
const run=f=>audit(f);
test('complete supported item snapshots with actual dogma compare without granting new content',async()=>{
 const f=fixtures();try{let r=await run(f);assert.equal(r.status,'STATIC_DATA_MATCH_CLIENT_UNVERIFIED');assert.equal(r.snapshotTypeCount,2);assert.equal(r.dogmaCoverage.compared,1);assert.equal(r.mutations,0);assert.equal(r.authoritativeGameCompatibility,'NOT_ESTABLISHED');assert.equal(r.errors.count,0);assert.equal(r.differences.count,0)}finally{f.clear()}
});
test('missing native dogma cannot claim complete static compatibility',async()=>{
 const f=fixtures();try{let r=await audit({sdeDir:f.sdeDir,nativeItemsFile:f.nativeItemsFile});assert.equal(r.status,'BLOCKED_NATIVE_DOGMA_MISSING');assert.equal(r.dogmaCoverage.compared,0)}finally{f.clear()}
});
test('group/category mismatch cannot silently remap a client item',async()=>{
 const f=fixtures();try{f.data.groups[0].categoryID=4;f.save();let r=await run(f);assert.equal(r.status,'REVIEW_SDE_DRIFT');assert.ok(r.differences.examples.some(x=>x.code==='CATEGORY_CHANGED'))}finally{f.clear()}
});
test('market category drift is exposed with numeric IDs',async()=>{
 const f=fixtures();try{f.data.types[0].marketGroupID=20;f.save();let r=await run(f);assert.ok(r.differences.examples.some(x=>x.code==='MARKET_GROUP_CHANGED'&&x.typeID===587))}finally{f.clear()}
});
test('missing market group is an integrity blocker, not an automatic migration',async()=>{
 const f=fixtures();try{f.data.marketGroups.pop();f.save();let r=await run(f);assert.equal(r.status,'BLOCKED_DATA_INTEGRITY');assert.ok(r.errors.examples.some(x=>x.code==='MARKET_GROUP_MISSING'))}finally{f.clear()}
});
test('dogma attribute and effects differences are reported separately',async()=>{
 const f=fixtures();try{f.data.typeDogma[0].dogmaAttributes[0].value=4;f.data.typeDogma[0].dogmaEffects[0].isDefault=false;f.save();const r=await run(f);assert.ok(r.differences.examples.some(x=>x.code==='DOGMA_VALUE_CHANGED'));assert.ok(r.differences.examples.some(x=>x.code==='DOGMA_EFFECT_CHANGED'))}finally{f.clear()}
});
test('invalid dogma attribute reference rejects the dataset',async()=>{
 const f=fixtures();try{f.data.typeDogma[0].dogmaAttributes[0].attributeID=555;f.save();const r=await run(f);assert.equal(r.status,'BLOCKED_DATA_INTEGRITY');assert.ok(r.errors.examples.some(x=>x.code==='UNKNOWN_DOGMA_ATTRIBUTE'))}finally{f.clear()}
});
test('unpublished live type is not automatically granted by a stale pinned type',async()=>{
 const f=fixtures();try{f.data.types[0].published=false;f.save();const r=await run(f);assert.equal(r.status,'BLOCKED_DATA_INTEGRITY');assert.ok(r.errors.examples.some(x=>x.code==='PUBLISHED_ITEM_NO_LONGER_PUBLISHED'))}finally{f.clear()}
});
test('native type missing from new SDE never converts into a new typeID',async()=>{
 const f=fixtures();try{f.data.types.shift();f.save();const r=await run(f);assert.equal(r.status,'BLOCKED_DATA_INTEGRITY');assert.ok(r.errors.examples.some(x=>x.code==='TYPE_NOT_IN_2026_SDE'))}finally{f.clear()}
});
test('incomplete current SDE is never treated as a full valid comparison',async()=>{
 const f=fixtures();try{fs.rmSync(path.join(f.sdeDir,'typeDogma.jsonl'));const r=await run(f);assert.equal(r.status,'BLOCKED_MISSING_SDE_TABLES');assert.deepEqual(r.missingTables,['typeDogma'])}finally{f.clear()}
});
test('bad JSON, duplicate IDs, symlinks and malformed keys fail closed',async()=>{
 const f=fixtures();try{
  const filename=path.join(f.sdeDir,'types.jsonl');
  fs.appendFileSync(filename,JSON.stringify(f.data.types[0])+'\n');await assert.rejects(run(f),/DUPLICATE_KEY/);
  f.save();fs.appendFileSync(filename,'{bad\n');await assert.rejects(run(f),/BAD_JSONL/);
  f.save();f.data.types[0]._key='invalid';f.save();await assert.rejects(run(f),/INVALID_KEY/);
  f.data.types[0]._key=587;f.save();const target=path.join(f.root,'duplicate.jsonl');fs.renameSync(filename,target);fs.symlinkSync(target,filename);await assert.rejects(run(f),/UNSAFE_SDE_FILE/);
 }finally{f.clear()}
});
test('unknown argument and non-absolute paths are denied',async()=>{
 const f=fixtures();try{
  assert.throws(()=>parseArgs(['--start','x']),/UNKNOWN_OR_MISSING_CLI_ARGUMENT/);
  await assert.rejects(audit({sdeDir:'relative',nativeItemsFile:f.nativeItemsFile}),/ABSOLUTE_SDE_AND_NATIVE_PATHS_REQUIRED/);
 }finally{f.clear()}
});
test('orphaned parent market group is blocked even if item market group exists',async()=>{
 const f=fixtures();try{f.data.marketGroups[0].parentGroupID=999;f.save();const r=await run(f);assert.equal(r.status,'BLOCKED_DATA_INTEGRITY');assert.ok(r.errors.examples.some(x=>x.code==='MARKET_PARENT_MISSING'))}finally{f.clear()}
});
test('published native hull requiring dogma cannot pass with partial dogma snapshot',async()=>{
 const f=fixtures();try{f.dogma.length=0;f.save();const r=await run(f);assert.equal(r.status,'BLOCKED_DATA_INTEGRITY');assert.ok(r.errors.examples.some(x=>x.code==='NATIVE_DOGMA_SNAPSHOT_MISSING'))}finally{f.clear()}
});
test('zero SDE group keys permitted, while zero native typeID is rejected',async()=>{
 const f=fixtures();try{
  const filename=path.join(f.sdeDir,'groups.jsonl');fs.appendFileSync(filename,JSON.stringify({_key:0,categoryID:0,name:{en:'None'}})+'\n');
  const groups=await readJsonl(filename);assert.equal(groups.rows.has(0),true);
  const items=path.join(f.root,'zero-items.jsonl');fs.writeFileSync(items,JSON.stringify({typeID:0})+'\n');await assert.rejects(readJsonl(items,{idField:'typeID'}),/INVALID_KEY/);
 }finally{f.clear()}
});
