'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),
 crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const {inspectOriginalWriterHooks,ORIGINAL}=require('../inspect-original-writer-hooks.cjs');
const blob=t=>crypto.createHash('sha1').update('blob '+Buffer.byteLength(t)+'\0')
 .update(t).digest('hex');
function fixture(callback){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'pf88-native-audit-'));
 try{
  const rel='Code/server/src/services/inventory/itemStore.js';
  const name=path.join(root,rel);
  fs.mkdirSync(path.dirname(name),{recursive:true});
  const base='function updateInventoryItem(itemID) { return itemID; }\n';
  fs.writeFileSync(name,base);
  const source={role:'STOCK_INVENTORY',path:rel,sha:blob(base),
   anchors:['function updateInventoryItem(']};
  return callback({root,name,base,source});
 }finally{fs.rmSync(root,{recursive:true,force:true});}
}
test('PF88 pins six real source authority surfaces for owner review',()=>{
 assert.equal(ORIGINAL.length,6);
 assert.equal(new Set(ORIGINAL.map(s=>s.path)).size,6);
 for(const role of ['STOCK_INVENTORY','STOCK_CHARACTER','NATIVE_MINING',
                     'DURABLE_MINING_RECOVERY','NATIVE_WAR','NATIVE_EXPLORATION'])
  assert.ok(ORIGINAL.some(s=>s.role===role));
});
test('PF88 unchanged original source accurately reports absent reciprocal hooks',()=>fixture(f=>{
 const report=inspectOriginalWriterHooks({forkRoot:f.root,sources:[f.source]});
 assert.equal(report.status,'BLOCKED_FOR_ACTIVATION');
 assert.equal(report.results[0].status,'RECIPROCAL_HOOK_NOT_INSTALLED');
 assert.equal(report.featureEnabled,false);
 assert.equal(report.releaseAuthority,false);
 assert.ok(report.blockers.includes('PF88_TWO_CLIENT_GAMEPLAY_NOT_RUN'));
}));
test('PF88 source drift fails closed before accepting hook text',()=>fixture(f=>{
 fs.writeFileSync(f.name,f.base+'// changed without re-pinning\n');
 const result=inspectOriginalWriterHooks({forkRoot:f.root,sources:[f.source]});
 assert.equal(result.results[0].status,'SOURCE_PIN_DRIFT');
}));
test('PF88 fake marker comment is not accepted as an executable hook',()=>fixture(f=>{
 const body=f.base+'// PF88_RECIPROCAL_ORIGINAL_WRITER_HOOK_V1\n';
 fs.writeFileSync(f.name,body);
 const result=inspectOriginalWriterHooks({forkRoot:f.root,
  sources:[{...f.source,sha:blob(body)}]});
 assert.equal(result.results[0].status,'RECIPROCAL_HOOK_NOT_INSTALLED');
}));
test('PF88 even a syntactically plausible source hook is NEVER release authority',()=>fixture(f=>{
 const body=f.base+'// PF88_RECIPROCAL_ORIGINAL_WRITER_HOOK_V1\n'+
  'const mark = writer.checkForeignWriterWithinTransaction({tx, writer:"PLAYER"});\n';
 fs.writeFileSync(f.name,body);
 const report=inspectOriginalWriterHooks({forkRoot:f.root,
  sources:[{...f.source,sha:blob(body)}]});
 assert.equal(report.results[0].status,'CANDIDATE_HOOK_NOT_PROVEN');
 assert.equal(report.status,'BLOCKED_FOR_ACTIVATION');
 assert.equal(report.releaseAuthority,false);
}));
test('PF88 absent source and invalid pins block',()=>fixture(f=>{
 fs.rmSync(f.name);
 assert.equal(inspectOriginalWriterHooks({forkRoot:f.root,sources:[f.source]})
  .results[0].status,'MISSING_OR_UNREADABLE');
 assert.throws(()=>inspectOriginalWriterHooks({forkRoot:f.root,sources:[{
  ...f.source,path:'../../dangerous'}]}),/PF88_SOURCE_PIN_MANIFEST_INVALID/);
}));
test('PF88 live PLAY root is explicitly rejected even for a read-only audit',()=>fixture(f=>{
 const play=path.join(f.root,'PLAY');fs.mkdirSync(play);
 assert.throws(()=>inspectOriginalWriterHooks({forkRoot:play,sources:[]}),
  /PF88_LIVE_OR_DEPLOYMENT_ROOT_FORBIDDEN/);
}));
test('PF88 CLI report uses nonzero exit 2, never an activation-success exit',()=>fixture(f=>{
 const script=path.join(__dirname,'../inspect-original-writer-hooks.cjs');
 const run=spawnSync(process.execPath,[script,'--fork-root',f.root],
  {encoding:'utf8',timeout:10000});
 assert.equal(run.status,2);
 const report=JSON.parse(run.stdout);
 assert.equal(report.releaseAuthority,false);
 assert.equal(report.status,'BLOCKED_FOR_ACTIVATION');
}));
