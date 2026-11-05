'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const {openFixture,tempDb,hire,reserve,seed,REGISTRY_KEY,session}=require('./fixture.cjs');
const path=require('node:path');
const fixtureFile=path.resolve(__dirname,'fixture.cjs');
const script=String.raw`
'use strict';
const {openFixture,hire,reserve,seed}=require(process.argv[2]);
const f=openFixture(process.argv[1]);
const phase=process.argv[3];
if(phase==='DURING_TX'){
 seed(f);
 const bridge=require('node:module').createRequire(process.argv[2])('../native/coopPersonalFleetHangarBridge.cjs');
 const b=bridge.createPersonalFleetHangarBridge({...f.options,verifyPaidHire:()=>{
  // Process death INSIDE original BEGIN IMMEDIATE before two row COMMIT.
  process.kill(process.pid,'SIGKILL');
 }});
 b.execute(hire());
}else if(phase==='DURING_FIRST_WRITE'){
 seed(f);
 const original=f.gameStore.coopAtomicNativeRows.transact;
 f.gameStore.coopAtomicNativeRows.transact=(tables,fn)=>original(tables,tx=>{
  const proxy={...tx,put(table,key,value){
   tx.put(table,key,value);
   process.kill(process.pid,'SIGKILL');
  }};
  return fn(proxy);
 });
 f.bridge.execute(hire());
}else if(phase==='AFTER_HIRE'){
 seed(f); const r=f.bridge.execute(hire()); if(r.status!=='APPLIED')process.exit(32);
 process.kill(process.pid,'SIGKILL');
}else if(phase==='AFTER_RESERVE'){
 seed(f);
 let r=f.bridge.execute(hire());if(r.status!=='APPLIED')process.exit(33);
 r=f.bridge.execute(reserve());if(r.status!=='APPLIED')process.exit(34);
 process.kill(process.pid,'SIGKILL');
}else{process.exit(50);}
`;
function invoke(file,phase){return spawnSync(process.execPath,['-e',script,file,fixtureFile,phase],{encoding:'utf8',timeout:10000})}
test('SIGKILL before COMMIT rolls back entire native enrollment, receipt remains available',()=>{
 const t=tempDb();try{
  const r=invoke(t.file,'DURING_TX');assert.equal(r.signal,'SIGKILL',JSON.stringify(r));
  const f=openFixture(t.file);try{assert.equal(f.get('corporationRuntime',REGISTRY_KEY),null);assert.equal(f.get('corporationRuntime','coop-personal-fleet\u001fhangar-roster-v1:9'),null);assert.equal(f.get('corporationRuntime','paidHire:contract-1').nativeStatus,'PAID');assert.equal(f.bridge.execute(hire()).status,'APPLIED');}finally{f.close()}
 }finally{t.cleanup()}
});
test('SIGKILL after hire COMMIT gives duplicate receipt not second hire',()=>{
 const t=tempDb();try{
  const r=invoke(t.file,'AFTER_HIRE');assert.equal(r.signal,'SIGKILL',JSON.stringify(r));
  const f=openFixture(t.file);try{assert.equal(f.get('corporationRuntime',REGISTRY_KEY).pilots['coop-pilot-123'].contractID,'contract-1');assert.equal(f.bridge.execute(hire()).status,'DUPLICATE');assert.equal(f.bridge.inspect({session:session(),ownerCharacterID:9}).roster.revision,1);}finally{f.close()}
 }finally{t.cleanup()}
});
test('SIGKILL after stock ItemStore reservation COMMIT keeps one original ship and one reservation',()=>{
 const t=tempDb();try{
  const r=invoke(t.file,'AFTER_RESERVE');assert.equal(r.signal,'SIGKILL',JSON.stringify(r));
  const f=openFixture(t.file);try{const ix=f.get('corporationRuntime',REGISTRY_KEY);assert.equal(Object.keys(ix.ships).length,1);assert.equal(ix.ships['1001'].generation,1);assert.equal(f.get('items','items')['1001'].itemID,1001);assert.equal(f.bridge.execute(reserve()).status,'DUPLICATE');assert.equal(f.bridge.inspect({session:session(),ownerCharacterID:9}).roster.revision,2);}finally{f.close()}
 }finally{t.cleanup()}
});

test('SIGKILL after first SQLite row write but before second row and COMMIT rolls back both',()=>{
 const t=tempDb();try{
  const r=invoke(t.file,'DURING_FIRST_WRITE');assert.equal(r.signal,'SIGKILL',JSON.stringify(r));
  const f=openFixture(t.file);try{
   assert.equal(f.get('corporationRuntime',REGISTRY_KEY),null);
   assert.equal(f.get('corporationRuntime','coop-personal-fleet\u001fhangar-roster-v1:9'),null);
   assert.equal(f.bridge.execute(hire()).status,'APPLIED');
  }finally{f.close()}
 }finally{t.cleanup()}
});