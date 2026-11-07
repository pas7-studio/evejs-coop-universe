'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const F=require('./fixture.cjs');
const MOD=require.resolve('./fixture.cjs');
const {open,tempDb,command,SHIP}=F;
function killed(mode){
 const temp=tempDb();let f;
 try{
  f=open(temp.file);f.makeActive();
  f.put('npcEntities','pf55-saved-actor',f.shared.scene);
  f.close();f=null;
  const source=`'use strict';const F=require(${JSON.stringify(MOD)});
   const f=F.open(${JSON.stringify(temp.file)});
   f.shared.scene=f.get('npcEntities','pf55-saved-actor');
   const c=F.command();const die=()=>process.kill(process.pid,'SIGKILL');
   `+(
   mode==='after-issuing' ? `f.shared.onCommand=die;f.orders.issue(c);process.exit(71);`:
   mode==='between-puts' ? `f.shared.onTx=(tx,tables)=>{if(!tables.includes('items'))return;let writes=0;const orig=tx.put;tx.put=(...a)=>{orig(...a);if(++writes===1)die()}};f.orders.issue(c);process.exit(71);`:
   mode==='after-second-put' ? `f.shared.onTx=(tx,tables)=>{if(!tables.includes('items'))return;let writes=0;const orig=tx.put;tx.put=(...a)=>{orig(...a);if(++writes===2)die()}};f.orders.issue(c);process.exit(71);`:
   mode==='after-native-before-ack' ? `if(f.orders.issue(c).status!=='NEEDS_RECONCILIATION')process.exit(72);die();`:
   mode==='after-ack' ? `if(f.orders.issue(c).status!=='NEEDS_RECONCILIATION')process.exit(72);if(f.orders.reconcile(c).status!=='ACKED')process.exit(73);die();`:
   `process.exit(99);`);
  const res=spawnSync(process.execPath,['--disable-warning=ExperimentalWarning','-e',source],
   {encoding:'utf8',timeout:15000});
  assert.equal(res.signal,'SIGKILL',JSON.stringify({mode,status:res.status,stderr:res.stderr,stdout:res.stdout}));
  f=open(temp.file);f.shared.scene=f.get('npcEntities','pf55-saved-actor');
  return {f,temp};
 }catch(e){f?.close();temp.cleanup();throw e;}
}
function sigkillTest(label,mode,fn){test(label,{skip:process.platform==='win32'},()=>{
 const {f,temp}=killed(mode);
 try{fn(f)}finally{f.close();temp.cleanup()}
})}
const last=f=>f.get('corporationRuntime',F.pf55.key(SHIP));
const index=f=>f.get('corporationRuntime',F.pf55.OP_INDEX);
sigkillTest('SIGKILL after ISSUING before external native mutation keeps permanent no-reissue fence','after-issuing',f=>{
 assert.equal(last(f).phase,'ISSUING');
 assert.equal(index(f).operations[command().operationID].phase,'ISSUING');
 assert.equal(f.orders.issue(command()).reason,'PF55_ISSUING_RECONCILIATION_REQUIRED');
 assert.equal(f.shared.ordersIssued,0);
});
sigkillTest('SIGKILL after first SQLite put before COMMIT rolls back both operation and ledger','between-puts',f=>{
 assert.equal(last(f),null);assert.equal(index(f),null);
 assert.equal(f.orders.issue(command()).status,'NEEDS_RECONCILIATION');
 assert.equal(f.shared.ordersIssued,1);
});
sigkillTest('SIGKILL after second put before COMMIT rolls back both operation and ledger','after-second-put',f=>{
 assert.equal(last(f),null);assert.equal(index(f),null);
 assert.equal(f.orders.issue(command()).status,'NEEDS_RECONCILIATION');
});
sigkillTest('SIGKILL after original native acknowledgement before PF55 reconcile prevents duplicate command','after-native-before-ack',f=>{
 assert.equal(last(f).phase,'ISSUING');
 assert.ok(f.get('npcEntities','pf55-persisted-native-order:'+command().operationID));
 assert.equal(f.orders.issue(command()).reason,'PF55_ISSUING_RECONCILIATION_REQUIRED');
 assert.equal(f.orders.reconcile(command()).status,'ACKED');
 assert.equal(f.shared.ordersIssued,0);
});
sigkillTest('SIGKILL after ACK commit preserves one original operation ID permanently','after-ack',f=>{
 assert.equal(last(f).phase,'ACKED');
 assert.equal(index(f).operations[command().operationID].phase,'ACKED');
 assert.equal(f.orders.issue(command()).status,'DUPLICATE');
 assert.equal(f.shared.ordersIssued,0);
});