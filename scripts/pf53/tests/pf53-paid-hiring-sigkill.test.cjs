'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const path=require('node:path');
const F=require('./fixture.cjs');
const fixtureFile=path.resolve(__dirname,'fixture.cjs');
const child=String.raw`
'use strict';
const F=require(process.argv[2]),{open,cmd,OWNER,EMPLOYER}=F;
const f=open(process.argv[1]);
const phase=process.argv[3];
if(phase.startsWith('BEFORE_COMMIT')){
 const original=f.gameStore.coopAtomicNativeRows.transact;
 let writes=0;const killAt=Number(phase.split('_').at(-1));
 f.gameStore.coopAtomicNativeRows.transact=(tables,callback)=>original(tables,tx=>callback({...tx,
  put(...args){tx.put(...args);if(++writes===killAt)process.kill(process.pid,'SIGKILL');}}));
 const r=f.bridge.hire(cmd());if(r.status!=='APPLIED')process.exit(22);
}else if(phase==='AFTER_COMMIT'){
 const r=f.bridge.hire(cmd());if(r.status!=='APPLIED')process.exit(23);
 process.kill(process.pid,'SIGKILL');
}else if(phase==='AFTER_ASSIGN'){
 let r=f.bridge.hire(cmd());if(r.status!=='APPLIED')process.exit(24);
 f.put('items','items',{'2001':{itemID:2001,shipID:2001,shipTypeID:606,typeID:606,
 ownerID:OWNER,locationID:600001,flagID:4,categoryID:6,singleton:1,stacksize:1,quantity:-1,spaceState:null}});
 const command={type:'RESERVE_HANGAR_SHIP',operationID:'pf53-ship-assign',pilotID:F.P,
 ownerCharacterID:OWNER,session:cmd().session,expectedRosterRevision:1,
 shipItemID:2001,stationID:600001,assignmentID:'pf53-assignment',expectedPilotRevision:0};
 r=f.hangar.execute(command);if(r.status!=='APPLIED')process.exit(25);
 process.kill(process.pid,'SIGKILL');
}else process.exit(21);
`;
function run(file,phase){return spawnSync(process.execPath,['-e',child,file,fixtureFile,phase],{timeout:12000,encoding:'utf8'})}
for(const n of [1,2,4,6]){
 test('real Node SIGKILL after '+n+' original SQLite writes, before COMMIT, rolls back all money and hire rows',()=>{
  const temp=F.tempDb();let f;try{
   f=F.open(temp.file);F.seed(f);f.close();f=null;
   const result=run(temp.file,'BEFORE_COMMIT_'+n);assert.equal(result.signal,'SIGKILL',JSON.stringify(result));
   f=F.open(temp.file);
   assert.equal(f.get('characters','characters')[String(F.OWNER)].balance,2500);
   assert.equal(f.get('corporationRuntime','corporations\u001f'+F.EMPLOYER).wallet.divisions['1000'].balance,800);
   assert.equal(f.get('corporationRuntime',F.pf52.REGISTRY_KEY),null);
   assert.equal(f.get('corporationRuntime',F.api.paidKey(F.OP)),null);
   assert.equal(f.bridge.hire(F.cmd()).status,'APPLIED');
   assert.equal(f.get('characters','characters')[String(F.OWNER)].balance,1050);
  }finally{f?.close();temp.cleanup()}
 });
}
test('real Node SIGKILL after original SQLite COMMIT but before response replays the same paid hire',()=>{
 const temp=F.tempDb();let f;try{
 f=F.open(temp.file);F.seed(f);f.close();f=null;
 const result=run(temp.file,'AFTER_COMMIT');assert.equal(result.signal,'SIGKILL',JSON.stringify(result));
 f=F.open(temp.file);
 assert.equal(f.get('characters','characters')[String(F.OWNER)].balance,1050);
 assert.equal(f.get('corporationRuntime','corporations\u001f'+F.EMPLOYER).wallet.divisions['1000'].balance,2250);
 assert.equal(f.bridge.hire(F.cmd()).status,'DUPLICATE');
 assert.equal(f.get('characters','characters')[String(F.OWNER)].walletJournal.length,2);
 }finally{f?.close();temp.cleanup()}
});
test('real Node SIGKILL after real paid hire and original hangar ship reservation keeps one native item and one debit',()=>{
 const temp=F.tempDb();let f;try{
 f=F.open(temp.file);F.seed(f);f.close();f=null;
 const result=run(temp.file,'AFTER_ASSIGN');assert.equal(result.signal,'SIGKILL',JSON.stringify(result));
 f=F.open(temp.file);
 assert.equal(f.get('characters','characters')[String(F.OWNER)].balance,1050);
 assert.equal(f.get('corporationRuntime',F.pf52.REGISTRY_KEY).ships['2001'].pilotID,F.P);
 assert.equal(f.get('items','items')['2001'].itemID,2001);
 assert.equal(f.bridge.hire(F.cmd()).status,'DUPLICATE');
 }finally{f?.close();temp.cleanup()}
});