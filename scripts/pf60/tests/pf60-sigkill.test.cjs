'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const path=require('node:path'),fs=require('node:fs'),os=require('node:os');
const {setup}=require('./fixture.cjs');
const child=path.join(__dirname,'pf60-sigkill-worker.cjs');
const linux=process.platform==='linux';
function scenario(kind){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pf60-kill-'));
 try {
  const r=spawnSync(process.execPath,[child,dir,kind],{timeout:20000});
  assert.equal(r.signal,'SIGKILL',r.stderr?.toString());
  const f=setup({dir,noSeed:true});
  try{return {f,r,dir};}catch(e){f.close();throw e;}
 }catch(e){fs.rmSync(dir,{recursive:true,force:true});throw e;}
}
for(const [kind,expected] of [
 ['PREPARE_BEFORE_COMMIT',null],['PREPARE_AFTER_COMMIT','PREPARED'],
 ['ISSUE_BEFORE_COMMIT','PREPARED'],['ISSUE_AFTER_COMMIT','ISSUING'],
 ['FINALIZE_BEFORE_COMMIT','NATIVE_CLEARED'],['FINALIZE_AFTER_COMMIT','FINALIZED']
]){
 test(kind+' real SQLite SIGKILL restores only committed terminal state',{skip:!linux},()=>{
  const {f,dir}=scenario(kind);
  try{
   const row=f.read('corporationRuntime',f.terminalKey(f.c.assignmentID));
   assert.equal(row?.phase||null,expected);
   const lock=f.read('corporationRuntime',f.LOCK+f.c.shipItemID);
   assert.equal(lock===null,expected==='FINALIZED');
   if(expected==='ISSUING'){
    assert.equal(f.create().issue(f.c).status,'BLOCKED');
    assert.equal(f.physical.calls,0);
   }
   if(expected==='FINALIZED'){
    assert.equal(f.create().finalize(f.c).status,'ALREADY_FINALIZED');
    assert.equal(f.read('corporationRuntime',f.terminalShipKey(f.c.shipItemID)).phase,'FINALIZED');
   }
  }finally{f.close();fs.rmSync(dir,{recursive:true,force:true});}
 });
}
