'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const {setup}=require('./fixture.cjs');
for(const when of ['after-commit','during-scene']){
 test('PF66 real SQLite WAL FULL SIGKILL '+when+' blocks a second ItemStore/scene attempt',()=>{
  if(process.platform==='win32')return;
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pf66-crash-'));
  try{
   const p=spawnSync(process.execPath,[path.join(__dirname,'pf66-sigkill-worker.cjs'),dir,when],
    {encoding:'utf8',timeout:20000});
   assert.equal(p.signal,'SIGKILL',String(p.error||p.stderr||p.status));
   const f=setup({dir,noSeed:true});
   try{
    const token=f.get('corporationRuntime',f.pf.attemptKey(f.c.assignmentID));
    assert.equal(token?.status,'CONSUMED');
    assert.equal(token?.shipItemID,f.c.shipItemID);
    if(when==='after-commit')assert.equal(f.get('items','items')[f.c.shipItemID].flagID,0);
    else {
     assert.equal(f.get('items','items')[f.c.shipItemID].flagID,4);
     const scenePermit=f.get('corporationRuntime',f.pf.sceneAttemptKey(f.c.assignmentID));
     assert.equal(scenePermit?.status,'CONSUMED');
     assert.equal(scenePermit?.shipItemID,f.c.shipItemID);
    }
    const a=f.build();
    assert.equal(a.execute(f.c).errorMsg,'PF66_DURABLE_ATTEMPT_ALREADY_CONSUMED');
    assert.equal(f.state.stockMoves,0);assert.equal(f.state.sceneRemovals,0);
   }finally{f.close();}
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
 });
}
