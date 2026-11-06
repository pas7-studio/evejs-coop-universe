'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const os=require('node:os'),path=require('node:path'),fs=require('node:fs');
const {spawnSync}=require('node:child_process');
const {setup}=require('../../pf60/tests/fixture.cjs');
const {createScopedNativeCleanup,attemptKey}=require('../native/coopPersonalFleetScopedNativeCleanup.cjs');
for(const when of ['after-commit','during-native-write']){
 test('PF64 SQLite SIGKILL '+when+' is durable, never redispatched after restart',()=>{
  if(process.platform==='win32')return; // Windows runner excludes SIGKILL checks
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pf64-crash-'));
  try{
   const child=spawnSync(process.execPath,[path.join(__dirname,'pf64-sigkill-worker.cjs'),dir,when],
    {encoding:'utf8',timeout:20000});
   assert.equal(child.signal,'SIGKILL',String(child.stderr||child.error||child.status));
   const f=setup({dir,noSeed:true});
   try{
    const token=f.read('corporationRuntime',attemptKey(f.c.assignmentID));
    assert.equal(token?.status,'CONSUMED');
    assert.equal(token?.shipItemID,f.c.shipItemID);
    let authority,invoked=0;
    const store={PF61_SCOPED_ORIGINAL_NATIVE_CLEANUP_V1:true,
     installScopedOriginalTerminalCleanupAuthority:o=>{authority=o;return true;},
     removeScopedPersonalFleetTerminalNativeRows:()=>{invoked++;return {success:true};}};
    const api=createScopedNativeCleanup({nativeStore:store,gameStore:f.root,enabled:()=>true,
     allWritersFenced:()=>true,verifyOriginalSceneVacant:()=>true,
     verifyExclusiveOwnership:()=>true,verifyOriginalTerminalWitness:()=>structuredClone(f.proof)});
    assert.equal(api.execute(f.c).errorMsg,'PF64_DURABLE_NATIVE_ATTEMPT_ALREADY_CONSUMED');
    assert.equal(invoked,0);
   }finally{f.close();}
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
 });
}
