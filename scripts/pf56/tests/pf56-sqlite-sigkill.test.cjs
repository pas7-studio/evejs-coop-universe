'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const path=require('node:path');
const F=require('./fixture.cjs');
const fixture=path.join(__dirname,'fixture.cjs');
const sigkillTest=process.platform==='win32'?test.skip:test;
function withCrash(scenario,fn){
 const t=F.tempDb();
 try{
  const program=`'use strict';const F=require(${JSON.stringify(fixture)});
   const f=F.open(${JSON.stringify(t.file)});f.makeReady();const c=F.command();
   const die=()=>process.kill(process.pid,'SIGKILL');
   switch(${JSON.stringify(scenario)}){
   case 'return-intent-before-native':f.shared.returnCallback=die;f.returnDock.requestReturn(c);break;
   case 'return-native-persisted':f.shared.returnCallback=(row)=>{
     f.put('npcEntities','pf56-return:'+row.operationID,F.returnProof(row));die();};
     f.returnDock.requestReturn(c);break;
   case 'return-uncommitted':f.shared.onTx=tx=>{
     const original=tx.put.bind(tx);tx.put=(...a)=>{original(...a);die();};};
     f.returnDock.requestReturn(c);break;
   case 'dock-intent-before-native':f.progressToReturning();f.returnDock.observeArrival(c);
     f.shared.clock+=2400;f.shared.dockCallback=die;f.returnDock.requestDock(c);break;
   case 'dock-original-item-persisted':f.progressToDockIntent();die();break;
   case 'dock-uncommitted-release':f.progressToDockIntent();f.shared.onTx=tx=>{
     const original=tx.put.bind(tx);let writes=0;tx.put=(...a)=>{
      original(...a);if(++writes===2)die();};};f.returnDock.reconcileDock(c);break;
   case 'dock-released-then-crash':f.progressToDockIntent();
     if(f.returnDock.reconcileDock(c).status!=='DOCKED')throw Error('DOCK_FAILED');die();break;
   default:throw Error('INVALID_SCENARIO');
   }process.exit(3);`;
  const p=spawnSync(process.execPath,['-e',program],{encoding:'utf8',timeout:15000});
  assert.equal(p.signal,'SIGKILL',p.stderr||p.stdout||scenario);
  const f=F.open(t.file),c=F.command();
  try{fn(f,c);}finally{f.close();}
 }finally{t.cleanup();}
}

sigkillTest('SIGKILL after return intent: persisted ISSUING, no automatic second warp',()=>withCrash('return-intent-before-native',(f,c)=>{
 const row=f.get('corporationRuntime',f.pf56.key(c.assignmentID));
 assert.equal(row.phase,'RETURN_ISSUING');
 assert.equal(row.returnDispatchCount,1);
 assert.equal(f.returnDock.requestReturn(c).status,'NEEDS_RECONCILIATION');
 assert.equal(f.get('items','items')[String(F.SHIP)].flagID,0);
}));

sigkillTest('SIGKILL after original native Return persistence: independently reconcilable without repeat warp',()=>withCrash('return-native-persisted',(f,c)=>{
 assert.equal(f.get('corporationRuntime',f.pf56.key(c.assignmentID)).phase,'RETURN_ISSUING');
 assert.equal(f.returnDock.confirmReturn(c).status,'RETURNING');
 assert.equal(f.get('corporationRuntime',f.pf56.key(c.assignmentID)).phase,'RETURNING');
}));

sigkillTest('SIGKILL mid-return SQLite BEGIN IMMEDIATE: no partial admission or ISK/item changes',()=>withCrash('return-uncommitted',(f,c)=>{
 assert.equal(f.get('corporationRuntime',f.pf56.key(c.assignmentID)),null);
 assert.equal(f.get('corporationRuntime',f.pf56.OPS),null);
 assert.equal(f.get('items','items')[String(F.SHIP)].flagID,0);
}));

sigkillTest('SIGKILL after durable DOCK_ISSUING before physical handoff: no automatic retry',()=>withCrash('dock-intent-before-native',(f,c)=>{
 const row=f.get('corporationRuntime',f.pf56.key(c.assignmentID));
 assert.equal(row.phase,'DOCK_ISSUING');assert.equal(row.dockDispatchCount,1);
 assert.equal(f.returnDock.requestDock(c).reason,'PF56_DOCK_REQUIRES_ARRIVAL');
 assert.equal(f.get('items','items')[String(F.SHIP)].flagID,0);
}));

sigkillTest('SIGKILL after original ItemStore dock but before claim release: recovery releases exactly once',()=>withCrash('dock-original-item-persisted',(f,c)=>{
 assert.equal(f.get('items','items')[String(F.SHIP)].flagID,4);
 assert.ok(f.get('corporationRuntime',f.pf56.CLAIMS).claims[String(F.SHIP)]);
 assert.equal(f.returnDock.reconcileDock(c).status,'DOCKED');
 assert.equal(f.returnDock.reconcileDock(c).status,'ALREADY_DOCKED');
 assert.equal(f.get('corporationRuntime',f.pf56.CLAIMS).claims[String(F.SHIP)],undefined);
}));

sigkillTest('SIGKILL mid-final claim, roster & PF54 release: SQLite rollback preserves all',()=>withCrash('dock-uncommitted-release',(f,c)=>{
 assert.equal(f.get('corporationRuntime',f.pf56.key(c.assignmentID)).phase,'DOCK_ISSUING');
 assert.equal(f.get('corporationRuntime',f.pf56.DEPLOY+c.assignmentID).phase,'ACTIVE');
 assert.ok(f.get('corporationRuntime',F.pf52.REGISTRY_KEY).ships[String(F.SHIP)]);
 assert.ok(f.get('corporationRuntime',f.pf56.CLAIMS).claims[String(F.SHIP)]);
 assert.equal(f.returnDock.reconcileDock(c).status,'DOCKED');
}));

sigkillTest('SIGKILL after full commit: exact original ship and receipts survive reopen',()=>withCrash('dock-released-then-crash',(f,c)=>{
 assert.equal(f.get('corporationRuntime',f.pf56.key(c.assignmentID)).phase,'DOCKED');
 assert.equal(f.get('corporationRuntime',f.pf56.DEPLOY+c.assignmentID).phase,'DOCKED');
 assert.equal(f.get('items','items')[String(F.SHIP)].ownerID,F.OWNER);
 assert.equal(f.get('items','items')[String(F.SHIP)].itemID,F.SHIP);
 assert.equal(f.returnDock.reconcileDock(c).status,'ALREADY_DOCKED');
}));
