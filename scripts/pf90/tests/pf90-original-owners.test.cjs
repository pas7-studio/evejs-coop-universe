'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),
 crypto=require('node:crypto'),vm=require('node:vm');
const {inspectOriginalOwners,PINNED}=require('../inspect-original-owner-writes.cjs');
const blob=s=>crypto.createHash('sha1').update('blob '+Buffer.byteLength(s)+'\0')
 .update(s).digest('hex');
function fixture(cb){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'pf90-owner-audit-'));
 try{
  const file=path.join(root,'Code/server/src/services/inventory/itemStore.js');
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const original='function readItems() { if(itemsTableCache) return itemsTableCache; return null; }\n';
  fs.writeFileSync(file,original);
  const pin={role:'STOCK_ITEMS_OWNER',path:'Code/server/src/services/inventory/itemStore.js',
   blob:blob(original),anchors:['function readItems(']};
  return cb({root,file,original,pin});
 }finally{fs.rmSync(root,{recursive:true,force:true});}
}
test('PF90 original inventory, character and GameStore ownership sources are source-pinned',()=>{
 assert.equal(PINNED.length,5);
 assert.equal(new Set(PINNED.map(x=>x.path)).size,5);
 for(const role of ['STOCK_ITEMS_OWNER','STOCK_CHARACTERS_OWNER',
  'GAMESTORE_CACHE_AND_FLUSH','GAMESTORE_OWNER_REPOSITORY','GAMESTORE_NATIVE_ATOMIC'])
  assert.ok(PINNED.some(f=>f.role===role),role);
});
test('PF90 audit has no success or release authority even when old stock source matches',()=>fixture(f=>{
 const out=inspectOriginalOwners({forkRoot:f.root,files:[f.pin]});
 assert.equal(out.status,'BLOCKED_FOR_ACTIVATION');
 assert.equal(out.releaseAuthority,false);
 assert.equal(out.featureEnabled,false);
 assert.equal(out.ownerPaths[0].status,'OWNER_HOOK_ABSENT');
}));
test('PF90 changed or missing original owner source cannot pass audit',()=>fixture(f=>{
 fs.appendFileSync(f.file,'// modified\n');
 assert.equal(inspectOriginalOwners({forkRoot:f.root,files:[f.pin]})
  .ownerPaths[0].status,'SOURCE_PIN_DRIFT');
 fs.rmSync(f.file);
 assert.equal(inspectOriginalOwners({forkRoot:f.root,files:[f.pin]})
  .ownerPaths[0].status,'SOURCE_MISSING_OR_UNREADABLE');
}));
test('PF90 injected source comment marker is never an accepted runtime attestation',()=>fixture(f=>{
 const changed=f.original+'// PF90_STOCK_OWNER_SNAPSHOT_ATOMIC_V1\n';
 fs.writeFileSync(f.file,changed);
 const report=inspectOriginalOwners({forkRoot:f.root,
  files:[{...f.pin,blob:blob(changed)}]});
 assert.equal(report.ownerPaths[0].status,'UNVERIFIED_OWNER_HOOK_CANDIDATE');
 assert.equal(report.releaseAuthority,false);
}));
test('PF90 source inspection rejects PLAY path before accessing original files',()=>fixture(f=>{
 const play=path.join(f.root,'PLAY');fs.mkdirSync(play);
 assert.throws(()=>inspectOriginalOwners({forkRoot:play,files:[]}),
  /PF90_LIVE_ROOT_NOT_ALLOWED/);
}));
test('PF90 source inspection refuses traversal in source manifests',()=>fixture(f=>{
 assert.throws(()=>inspectOriginalOwners({forkRoot:f.root,files:[{
  ...f.pin,path:'Code/server/src/../../../etc/passwd'}]}),
  /PF90_OWNER_SOURCE_MANIFEST_INVALID/);
}));
function nativeRoot(){
 const root=process.env.PF90_NATIVE_WORKTREE;
 if(!root)return null;
 assert.ok(path.isAbsolute(root),'PF90_NATIVE_WORKTREE must be absolute');
 return root;
}
function extract(source,name){
 const marker='function '+name+'(';
 const start=source.indexOf(marker);
 assert.ok(start>=0,'PF90_MISSING_ORIGINAL_SOURCE_FUNCTION:'+name);
 // A default parameter may contain braces (e.g. options = {}), so
 // find the actual body opener AFTER the function parameter list.
 const signatureEnd=source.indexOf(') {',start);
 assert.ok(signatureEnd>start,'PF90_ORIGINAL_FUNCTION_SIGNATURE_DRIFT:'+name);
 const brace=signatureEnd+2;
 let depth=0,end=-1;
 for(let i=brace;i<source.length;i++){
  if(source[i]==='{')depth++;
  else if(source[i]==='}'&&--depth===0){end=i+1;break;}
 }
 assert.ok(end>start,'PF90_UNCLOSED_ORIGINAL_FUNCTION:'+name);
 return source.slice(start,end);
}
test('PF90 reproduces stock ItemStore cache alias after a failed original write',t=>{
 const root=nativeRoot();
 if(!root){t.skip('PF90_NATIVE_WORKTREE not supplied: native source NOT tested');return;}
 const report=inspectOriginalOwners({forkRoot:root});
 assert.ok(report.ownerPaths.every(f=>f.status==='OWNER_HOOK_ABSENT'),
  'PF90_SOURCE_PIN_DRIFT: review exact native owner changes before this test');
 const stock=fs.readFileSync(path.join(root,
  'Code/server/src/services/inventory/itemStore.js'),'utf8');
 const read=extract(stock,'readItems'),write=extract(stock,'writeItems');
 const context={repo:{read:()=>({success:true,data:{'2001':{
  itemID:2001,ownerID:9001,locationID:600001}}}),write:()=>({success:false,
   errorMsg:'SIMULATED_DB_REFUSAL'})},
  ITEMS_TABLE:'items',itemsTableCache:null,
  itemIndexesCache:null,itemIndexesDirty:true,itemMutationVersion:0};
 vm.createContext(context);
 vm.runInContext(read+'\n'+write+'\nthis.original={readItems,writeItems};',context);
 const item=context.original.readItems();
 item['2001'].ownerID=9002;
 assert.equal(context.original.writeItems(item),false);
 assert.equal(context.original.readItems()['2001'].ownerID,9002,
  'Original shared cache was already modified when persistence refused');
});
test('PF90 original character ship write is a separate owner repo write, not an atomic handoff',t=>{
 const root=nativeRoot();
 if(!root){t.skip('PF90_NATIVE_WORKTREE not supplied: native source NOT tested');return;}
 const file=fs.readFileSync(path.join(root,
  'Code/server/src/services/character/characterState.js'),'utf8');
 const fn=extract(file,'writeCharacterRecord');
 assert.match(fn,/repo\.write\(CHARACTERS_TABLE,/);
 assert.doesNotMatch(fn,/coopAtomicNativeRows\.transact/);
});
