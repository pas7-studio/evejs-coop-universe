'use strict';
/**
 * PF88: test actual patched native Code/server/index.js startup ordering.
 * This source is extracted from the physically staged isolated WORK entry,
 * executed in a VM with an inert fake TCP function; never starts EveJS.
 */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {execFileSync}=require('node:child_process');
const candidate=process.env.PF88_NATIVE_WORKTREE;
if(!candidate||!path.isAbsolute(candidate))
 throw Error('PF88_NATIVE_WORKTREE_ABSOLUTE_PATH_REQUIRED');
const root=fs.realpathSync(candidate);
if(root.split(path.sep).some(s=>/^(play|prod|production)$/i.test(s)))
 throw Error('PF88_PLAY_PATH_FORBIDDEN');
if(!fs.statSync(path.join(root,'.git')).isFile())
 throw Error('PF88_LINKED_WORKTREE_REQUIRED');
const branch=execFileSync('git',['-C',root,'branch','--show-current'],
 {encoding:'utf8'}).trim();
if(!branch.startsWith('work/'))throw Error('PF88_WORK_BRANCH_REQUIRED');
const entry=fs.readFileSync(path.join(root,'Code/server/index.js'),'utf8');
const marker='// PF88 source-owned native Personal Fleet startup, opt-in ONLY.';
const tcp='startTCPServer(serviceManager);';
const i=entry.indexOf(marker),j=entry.indexOf(tcp,i+1);
if(i<0||j<i||entry.indexOf(marker,i+1)>=0||
   entry.indexOf(tcp,j+1)>=0)
 throw Error('PF88_ORIGINAL_STOCK_ENTRY_PATCH_NOT_UNIQUE');
const snippet=entry.slice(i,j+tcp.length);
const mock=(flags,{throwStartup=false}={})=>{
 const calls=[];
 const serviceManager=Object.freeze({});
 const env=Object.freeze({...flags});
 const context={process:{env},serviceManager,
  require:id=>{
   calls.push('require');
   assert.equal(id,'./src/space/coopPersonalFleetOriginalWorkStarter');
   return {bootstrapOriginalWorkFromServer(){
    calls.push('bootstrap');
    if(throwStartup)throw Error('PF88_NATIVE_WRITERS_NOT_FENCED');
    return Object.freeze({status:'ORIGINAL_WORK_READY'});
   }};
  },startTCPServer:arg=>{
   assert.strictEqual(arg,serviceManager);
   calls.push('tcp');
  }};
 let error=null;
 try{vm.runInNewContext(snippet,context,{timeout:1500});}
 catch(e){error=e;}
 return {calls,error};
};
test('PF88 original TCP starts normally without importing Personal Fleet when OFF',()=>{
 const r=mock({});
 assert.deepEqual(r.calls,['tcp']);assert.equal(r.error,null);
});
test('PF88 opt-in native flag installs bootstrap synchronously before TCP',()=>{
 const r=mock({EVEJS_COOP_PERSONAL_FLEET_NATIVE:'1'});
 assert.deepEqual(r.calls,['require','bootstrap','tcp']);
 assert.equal(r.error,null);
});
test('PF88 opt-in chat flag alone still requires original source bootstrap',()=>{
 const r=mock({EVEJS_COOP_PERSONAL_FLEET_CHAT:'1'});
 assert.deepEqual(r.calls,['require','bootstrap','tcp']);
 assert.equal(r.error,null);
});
test('PF88 startup failure aborts original TCP listen and denies fake ready',()=>{
 const r=mock({EVEJS_COOP_PERSONAL_FLEET_NATIVE:'1'},{throwStartup:true});
 assert.match(String(r.error),/WRITERS_NOT_FENCED/);
 assert.deepEqual(r.calls,['require','bootstrap']);
});
