'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawnSync}=require('node:child_process');
const {setup,F}=require('./fixture.cjs');
const fixed=path.resolve(__dirname,'fixture.cjs');
const stages=['after-pf54-issuing','before-original-move','after-original-item-commit',
 'before-native-adoption','after-native-adoption'];
for(const stage of stages){
 test('PF58 Linux SIGKILL '+stage+' leaves durable non-retry fence',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pf58-sigkill-')),file=path.join(dir,'native.sqlite');
  try{
   const script=`const {setup,F}=require(${JSON.stringify(fixed)});const f=setup(${JSON.stringify(file)});
      f.prepare();
      const kill=()=>process.kill(process.pid,'SIGKILL');
      if(${JSON.stringify(stage)}==='after-pf54-issuing')f.shared.onHandoff=kill;
      if(${JSON.stringify(stage)}==='before-original-move')f.state.beforeMove=kill;
      if(${JSON.stringify(stage)}==='after-original-item-commit')f.state.afterMove=kill;
      if(${JSON.stringify(stage)}==='before-native-adoption')f.state.beforeAdopt=kill;
      if(${JSON.stringify(stage)}==='after-native-adoption')f.state.afterAdopt=kill;
      f.pending();process.exit(19);`;
   const run=spawnSync(process.execPath,['-e',script],{encoding:'utf8',timeout:30000});
   assert.equal(run.signal,'SIGKILL',JSON.stringify(run.stderr));
   const reopen=setup(file);
   try{
    const row=reopen.get('corporationRuntime',F.pf54.key(F.ASSIGNMENT));
    assert.equal(row.phase,'ISSUING');
    const permit=reopen.handoff.inspect({assignmentID:F.ASSIGNMENT});
    assert.equal(permit.status,stage==='after-pf54-issuing'?'NOT_FOUND':'CONSUMED');
    const stock=reopen.get('items','items')[F.SHIP];assert.equal(stock.itemID,F.SHIP);
    assert.equal(stock.flagID,
     ['after-pf54-issuing','before-original-move'].includes(stage)?4:0);
    const extra=reopen.pending();assert.equal(extra.status,'BLOCKED');
    assert.equal(reopen.state.attempts,0);
    assert.equal(Object.keys(reopen.get('items','items')).length,1);
   }finally{reopen.close();}
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
 });
}
test('PF58 rollback after first of two original permit rows leaves no partial reservation',()=>{
 const temp=F.tempDb();try{
  const f=setup(temp.file);try{
   f.prepare();const orig=f.shared.onHandoff;
   f.shared.onHandoff=row=>{f.shared.failAfterPut=1;return orig(row);};
   const first=f.pending();assert.equal(first.executorStatus,'UNVERIFIED');
   assert.equal(f.handoff.inspect({assignmentID:F.ASSIGNMENT}).status,'NOT_FOUND');
   assert.equal(f.get('corporationRuntime',F.pf54.key(F.ASSIGNMENT)).phase,'ISSUING');
   assert.equal(f.get('items','items')[F.SHIP].flagID,4);
   assert.equal(f.state.attempts,0);
  }finally{f.close();}
 }finally{temp.cleanup();}
});
