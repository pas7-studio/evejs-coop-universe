'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const F=require('./fixture.cjs');
const {open,tempDb,command,SHIP,ASSIGNMENT,claimsPolicy}=F;
const MOD=require.resolve('./fixture.cjs');
const originalItem=f=>f.get('items','items')[String(SHIP)];
const deployment=f=>f.get('corporationRuntime',F.pf54.key(ASSIGNMENT));
function runKilled(mode){
 const temp=tempDb();let db;
 try{
  db=open(temp.file);db.seed();db.onboard();db.close();db=null;
  const source=`'use strict';\nconst F=require(${JSON.stringify(MOD)});\nconst f=F.open(${JSON.stringify(temp.file)});\nconst c=F.command();\nconst die=()=>process.kill(process.pid,'SIGKILL');\n`+
   (mode==='post-prepare'?`if(f.bridge.prepare(c).status!=='PREPARED')process.exit(91);die();`:
   mode==='pre-executor'?`if(f.bridge.prepare(c).status!=='PREPARED')process.exit(91);f.shared.onHandoff=die;f.bridge.dispatch(c);process.exit(90);`:
   mode==='partial-uncommitted'?`if(f.bridge.prepare(c).status!=='PREPARED')process.exit(91);f.shared.onHandoff=()=>{f.gameStore.coopAtomicNativeRows.transact(['items'],tx=>{const root=tx.get('items','items');root[String(F.SHIP)].flagID=0;tx.put('items','items',root);die();});};f.bridge.dispatch(c);process.exit(90);`:
   mode==='physical-commit'?`if(f.bridge.prepare(c).status!=='PREPARED')process.exit(91);f.shared.onHandoff=row=>{f.gameStore.coopAtomicNativeRows.transact(['items','npcEntities'],tx=>{const root=tx.get('items','items');root[String(F.SHIP)]={...root[String(F.SHIP)],flagID:0,locationID:row.systemID,spaceState:{systemID:row.systemID,position:{x:5,y:6,z:7}}};tx.put('items','items',root);tx.put('npcEntities','pf54-native-actor-proof',{shipItemID:row.shipItemID,entityID:row.shipItemID,controllerEntityID:row.shipItemID,pilotID:row.pilotID,ownerCharacterID:row.ownerCharacterID,assignmentID:row.assignmentID,generation:row.generation,systemID:row.systemID,alive:true,noDuplicatePhysicalEntity:true,fittingHash:row.fittingHash,cargoHash:row.cargoHash});});die();};f.bridge.dispatch(c);process.exit(90);`:
   mode==='post-active'?`if(f.bridge.prepare(c).status!=='PREPARED')process.exit(91);if(f.bridge.dispatch(c).status!=='AWAITING_NATIVE_RECONCILIATION')process.exit(92);if(f.bridge.reconcile(c).status!=='ACTIVE')process.exit(93);die();`:
   `process.exit(95);`);
  const res=spawnSync(process.execPath,['--disable-warning=ExperimentalWarning','-e',source],{encoding:'utf8',timeout:15000});
  assert.equal(res.signal,'SIGKILL',JSON.stringify({mode,status:res.status,stdout:res.stdout,stderr:res.stderr}));
  db=open(temp.file);return {db,temp};
 }catch(e){db?.close();temp.cleanup();throw e;}
}
function caseTest(name,mode,verify){test(name,()=>{
 const {db,temp}=runKilled(mode);try{verify(db)}finally{db.close();temp.cleanup()}
})}
caseTest('SIGKILL after PREPARED persists original hangar ship and no actor', 'post-prepare', f=>{
 assert.equal(deployment(f).phase,'PREPARED');assert.equal(originalItem(f).flagID,4);
 assert.equal(f.get('corporationRuntime',claimsPolicy.KEY),null);
 assert.equal(f.bridge.dispatch(command()).status,'AWAITING_NATIVE_RECONCILIATION');
 assert.equal(f.shared.spawnCount,1);
});
caseTest('SIGKILL after ISSUING but before original executor stays single-flight', 'pre-executor', f=>{
 assert.equal(deployment(f).phase,'ISSUING');assert.equal(deployment(f).dispatchCount,1);
 assert.equal(originalItem(f).flagID,4);
 assert.equal(f.bridge.dispatch(command()).reason,'PF54_DISPATCH_REQUIRES_RECONCILIATION');
 assert.equal(f.shared.spawnCount,0);
 assert.equal(f.bridge.reconcile(command()).reason,'PF54_ORIGINAL_ITEM_NOT_IN_SPACE');
});
caseTest('SIGKILL after item put but before COMMIT rolls item back and keeps dispatch intent', 'partial-uncommitted', f=>{
 assert.equal(deployment(f).phase,'ISSUING');assert.equal(originalItem(f).flagID,4);
 assert.equal(f.bridge.dispatch(command()).reason,'PF54_DISPATCH_REQUIRES_RECONCILIATION');
 assert.equal(f.get('corporationRuntime',claimsPolicy.KEY),null);
});
caseTest('SIGKILL after original physical commit before PF54 reconciliation can reconcile without new spawn', 'physical-commit', f=>{
 assert.equal(deployment(f).phase,'ISSUING');assert.equal(originalItem(f).flagID,0);
 const proof=f.get('npcEntities','pf54-native-actor-proof');assert.equal(proof.entityID,SHIP);
 assert.equal(f.bridge.dispatch(command()).reason,'PF54_DISPATCH_REQUIRES_RECONCILIATION');
 f.shared.scene=proof;
 const result=f.bridge.reconcile(command());assert.equal(result.status,'ACTIVE');
 assert.equal(f.shared.spawnCount,0);
 assert.equal(f.get('corporationRuntime',claimsPolicy.KEY).claims[String(SHIP)].pilotID,F.PILOT);
});
caseTest('SIGKILL after ACTIVE+claim COMMIT returns ALREADY_ACTIVE without second claim', 'post-active', f=>{
 assert.equal(deployment(f).phase,'ACTIVE');
 assert.equal(f.get('corporationRuntime',claimsPolicy.KEY).claims[String(SHIP)].entityID,SHIP);
 assert.equal(f.bridge.reconcile(command()).status,'ALREADY_ACTIVE');
 assert.equal(f.bridge.dispatch(command()).reason,'PF54_DISPATCH_REQUIRES_RECONCILIATION');
 assert.equal(f.shared.spawnCount,0);
});