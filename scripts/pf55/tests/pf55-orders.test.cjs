'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const F=require('./fixture.cjs');
const {open,tempDb,command,SHIP,OWNER,TARGET,proof}=F;
function withDb(fn,{active=true}={}){
 const tmp=tempDb();let f;
 try{f=open(tmp.file);if(active)f.makeActive();else f.seed();return fn(f)}
 finally{f?.close();tmp.cleanup()}
}
function row(f){return f.get('corporationRuntime',F.pf55.key(SHIP))}
function operations(f){return f.get('corporationRuntime',F.pf55.OP_INDEX)}
function issued(f,c=command()){return f.orders.issue(c)}
function ack(f,c=command()){
 assert.equal(issued(f,c).status,'NEEDS_RECONCILIATION');
 return f.orders.reconcile(c);
}
test('PF53 paid hire -> PF52 hangar -> PF54 original native ACTOR -> PF55 durable FOLLOW order ACK',()=>withDb(f=>{
 const res=issued(f);assert.equal(res.status,'NEEDS_RECONCILIATION');
 assert.equal(res.nativeAck,'REPORTED_SUCCESS');assert.equal(f.shared.ordersIssued,1);
 assert.equal(row(f).phase,'ISSUING');assert.equal(operations(f).operations[command().operationID].phase,'ISSUING');
 assert.equal(f.orders.reconcile(command()).status,'ACKED');
 assert.equal(row(f).phase,'ACKED');assert.equal(operations(f).operations[command().operationID].phase,'ACKED');
 assert.equal(f.get('characters','characters')[String(OWNER)].balance,3500);
 assert.equal(f.get('items','items')[String(SHIP)].itemID,SHIP);
 assert.equal(f.orders.inspect({session:F.session,ownerCharacterID:OWNER,shipItemID:SHIP}).action,'FOLLOW');
}));
test('default OFF blocks without transactions or native calls',()=>withDb(f=>{
 f.shared.enabled=false;assert.equal(issued(f).status,'DISABLED');assert.equal(row(f),null);assert.equal(f.shared.ordersIssued,0);
}));
test('missing global writers blocks',()=>withDb(f=>{
 f.shared.writers=false;assert.equal(issued(f).reason,'PF55_GLOBAL_WRITERS_NOT_FENCED');assert.equal(f.shared.ordersIssued,0);
}));
test('authorization revoked fails closed',()=>withDb(f=>{
 f.shared.auth=false;assert.equal(issued(f).reason,'PF55_ACCESS_DENIED');assert.equal(row(f),null);
}));
test('authorization revoked inside transaction fails closed',()=>withDb(f=>{
 let n=0;const fn=f.orders;
 // Access authority normally reads true; injected exclusive check can revoke it during the transaction.
 f.shared.exclusive=false;assert.equal(fn.issue(command()).reason,'PF55_MINING_WAR_EXPLORATION_CONFLICT');
 assert.equal(row(f),null);assert.equal(n,0);
}));
test('before PF54 ACTIVE there is no right to issue',()=>withDb(f=>{
 assert.equal(issued(f).reason,'PF55_DEPLOY_OR_CLAIM_UNAVAILABLE');assert.equal(row(f),null);
},{active:false}));
test('stale actor generation denied',()=>withDb(f=>{
 assert.equal(issued(f,command({actorGeneration:3})).reason,'PF55_DEPLOYMENT_NOT_ACTIVE_FOR_SHIP');
}));
test('stale actor claim denied even if deployment ACTIVE',()=>withDb(f=>{
 const cl=f.get('corporationRuntime',F.claimsPolicy.KEY);cl.claims[String(SHIP)].pilotID='coop-pilot-888';
 f.put('corporationRuntime',F.claimsPolicy.KEY,cl);
 assert.equal(issued(f).reason,'PF55_ACTOR_CLAIM_NOT_PROVEN');
}));
test('original item must still be physical in space',()=>withDb(f=>{
 const s=f.get('items','items');s[String(SHIP)].flagID=4;f.put('items','items',s);
 assert.equal(issued(f).reason,'PF55_ORIGINAL_SHIP_NOT_IN_SPACE');
}));
test('original item ID not replaceable',()=>withDb(f=>{
 const s=f.get('items','items');s[String(SHIP)].itemID+=1;f.put('items','items',s);
 assert.equal(issued(f).reason,'PF55_ORIGINAL_SHIP_NOT_IN_SPACE');
}));
test('foreign ship owner rejected',()=>withDb(f=>{
 const s=f.get('items','items');s[String(SHIP)].ownerID=1;f.put('items','items',s);
 assert.equal(issued(f).reason,'PF55_ORIGINAL_SHIP_NOT_IN_SPACE');
}));
test('original actor unavailable rejects',()=>withDb(f=>{
 f.shared.native=false;assert.equal(issued(f).reason,'PF55_NATIVE_ACTOR_UNVERIFIED');
}));
test('native controller ownership unavailable rejects',()=>withDb(f=>{
 f.shared.controlAllowed=false;assert.equal(issued(f).reason,'PF55_NATIVE_CONTROL_UNVERIFIED');
}));
test('unknown target denied',()=>withDb(f=>{
 f.shared.targetAllowed=false;assert.equal(issued(f).reason,'PF55_TARGET_UNVERIFIED');
}));
test('HOLD may be issued without target',()=>withDb(f=>{
 const c=command({action:'HOLD',operationID:'pf55-hold-1'});
 assert.equal(c.targetEntityID,null);assert.equal(ack(f,c).status,'ACKED');
}));
test('ATTACK must have validated target',()=>withDb(f=>{
 const c=command({action:'ATTACK',operationID:'pf55-attack-1'});
 assert.equal(ack(f,c).status,'ACKED');
}));
test('WARP must have validated target',()=>withDb(f=>{
 const c=command({action:'WARP',operationID:'pf55-warp-1'});
 assert.equal(ack(f,c).status,'ACKED');
}));
test('DEFEND fails preflight rather than reserving an ISSUING slot if combat policy is not wired',()=>withDb(f=>{
 const c=command({action:'DEFEND',operationID:'pf55-defend-1'});
 assert.equal(issued(f,c).reason,'PF55_NATIVE_ACTION_NOT_WIRED');
 assert.equal(row(f),null);assert.equal(f.shared.ordersIssued,0);
}));
test('DEFEND may be issued only with a separately wired native defensive policy',()=>withDb(f=>{
 f.shared.defendReady=true;
 const c=command({action:'DEFEND',operationID:'pf55-defend-1'});
 assert.equal(ack(f,c).status,'ACKED');
}));
test('unavailable native action fails before durable intent',()=>withDb(f=>{
 f.shared.actionReady=false;
 assert.equal(issued(f).reason,'PF55_NATIVE_ACTION_NOT_WIRED');
 assert.equal(row(f),null);
}));
test('same command retry while ISSUING never calls native twice',()=>withDb(f=>{
 assert.equal(issued(f).status,'NEEDS_RECONCILIATION');
 assert.equal(issued(f).reason,'PF55_ISSUING_RECONCILIATION_REQUIRED');
 assert.equal(f.shared.ordersIssued,1);
}));
test('new command cannot overtake unknown ISSUING',()=>withDb(f=>{
 issued(f);const c=command({operationID:'pf55-next-1',action:'HOLD',targetEntityID:null,followRangeMeters:undefined});
 assert.equal(issued(f,c).reason,'PF55_PREVIOUS_ORDER_OUTCOME_UNKNOWN');
 assert.equal(f.shared.ordersIssued,1);
}));
test('same command retry after ACK is idempotent',()=>withDb(f=>{
 assert.equal(ack(f).status,'ACKED');
 assert.equal(issued(f).status,'DUPLICATE');assert.equal(f.shared.ordersIssued,1);
}));
test('reusing same operation ID with different command is rejected',()=>withDb(f=>{
 assert.equal(ack(f).status,'ACKED');
 const c=command({action:'HOLD',targetEntityID:null,followRangeMeters:undefined});
 assert.equal(issued(f,c).reason,'PF55_OPERATION_ID_REUSED');
 assert.equal(f.shared.ordersIssued,1);
}));
test('second order after ACK allowed with new operation ID',()=>withDb(f=>{
 assert.equal(ack(f).status,'ACKED');
 const c=command({operationID:'pf55-second-1',action:'HOLD',targetEntityID:null,followRangeMeters:undefined});
 assert.equal(ack(f,c).status,'ACKED');assert.equal(f.shared.ordersIssued,2);
}));
test('unknown native acknowledgement leaves sticky ISSUING',()=>withDb(f=>{
 f.shared.orderAllowed=false;
 assert.equal(issued(f).nativeAck,'NOT_PROVEN');
 assert.equal(row(f).phase,'ISSUING');
 assert.equal(issued(f).reason,'PF55_ISSUING_RECONCILIATION_REQUIRED');
}));
test('native executor throw leaves sticky ISSUING',()=>withDb(f=>{
 f.shared.onCommand=()=>{throw Error('UNKNOWN_NATIVE_COMMIT');};
 assert.equal(issued(f).nativeAck,'UNKNOWN');assert.equal(row(f).phase,'ISSUING');
}));
test('native executor thenable does not authorize success',()=>withDb(f=>{
 f.shared.onCommand=()=>Promise.resolve({success:true});
 assert.equal(issued(f).reason,'PF55_ASYNC_NATIVE_ORDER_FORBIDDEN');
 assert.equal(row(f).phase,'ISSUING');
}));
test('native success:true alone is insufficient for ACK',()=>withDb(f=>{
 f.shared.onCommand=()=>({success:true});
 assert.equal(issued(f).status,'NEEDS_RECONCILIATION');
 assert.equal(f.orders.reconcile(command()).reason,'PF55_ORIGINAL_NATIVE_ORDER_NOT_PERSISTED');
 assert.equal(row(f).phase,'ISSUING');
}));
test('wrong proof operation ID is rejected',()=>withDb(f=>{
 issued(f);f.shared.onOrderVerify=r=>({...proof(r),operationID:'wrong-operation'});
 assert.equal(f.orders.reconcile(command()).reason,'PF55_ORIGINAL_NATIVE_ORDER_NOT_PERSISTED');
}));
test('proof must be original persisted controller evidence',()=>withDb(f=>{
 issued(f);f.shared.onOrderVerify=r=>({...proof(r),controllerPersisted:false});
 assert.equal(f.orders.reconcile(command()).reason,'PF55_ORIGINAL_NATIVE_ORDER_NOT_PERSISTED');
}));
test('proof foreign controller rejected',()=>withDb(f=>{
 issued(f);f.shared.onOrderVerify=r=>({...proof(r),controllerEntityID:SHIP+1});
 assert.equal(f.orders.reconcile(command()).reason,'PF55_ORIGINAL_NATIVE_ORDER_NOT_PERSISTED');
}));
test('reconcile with mismatched command cannot mutate record',()=>withDb(f=>{
 issued(f);const c=command({action:'ATTACK'});
 assert.equal(f.orders.reconcile(c).reason,'PF55_RECONCILE_FOREIGN_OR_STALE');
 assert.equal(row(f).phase,'ISSUING');
}));
test('ACK proof survives repeat reconciliation',()=>withDb(f=>{
 assert.equal(ack(f).status,'ACKED');
 assert.equal(f.orders.reconcile(command()).status,'ALREADY_ACKED');
}));
test('transaction exception rolls back both ledger and global op index',()=>withDb(f=>{
 f.shared.failAfterPut=1;
 assert.equal(issued(f).reason,'PF55_DURABLE_ISSUE_COMMIT_UNKNOWN');
 assert.equal(row(f),null);assert.equal(operations(f),null);assert.equal(f.shared.ordersIssued,0);
}));
test('transaction exception after second put also rolls back',()=>withDb(f=>{
 f.shared.failAfterPut=2;
 assert.equal(issued(f).reason,'PF55_DURABLE_ISSUE_COMMIT_UNKNOWN');
 assert.equal(row(f),null);assert.equal(operations(f),null);
}));
test('corrupt op index blocks any native order',()=>withDb(f=>{
 f.put('corporationRuntime',F.pf55.OP_INDEX,{version:99,operations:{}});
 assert.equal(issued(f).reason,'PF55_DURABLE_ISSUE_COMMIT_UNKNOWN');
 assert.equal(f.shared.ordersIssued,0);
}));
test('reconcile disabled or revoked never ACKs',()=>withDb(f=>{
 issued(f);f.shared.writers=false;
 assert.equal(f.orders.reconcile(command()).reason,'PF55_GLOBAL_WRITERS_NOT_FENCED');
 assert.equal(row(f).phase,'ISSUING');
}));
test('inspect refuses foreign owner',()=>withDb(f=>{
 issued(f);const out=f.orders.inspect({session:{characterID:123,userid:55},ownerCharacterID:OWNER,shipItemID:SHIP});
 assert.equal(out.reason,'PF55_ACCESS_DENIED');
}));
test('bad action, missing target and illegal range fail before tx',()=>withDb(f=>{
 for(const c of [command({action:'SELF_DESTRUCT'}),command({targetEntityID:null}),
  command({followRangeMeters:-1}),command({targetEntityID:SHIP}),
  command({action:'HOLD',targetEntityID:TARGET,followRangeMeters:undefined}),
  command({action:'ATTACK',followRangeMeters:12})])
  assert.equal(issued(f,c).reason,'PF55_COMMAND_INVALID');
 assert.equal(row(f),null);
}));
test('access revoked between preflight and BEGIN IMMEDIATE blocks and leaves no row',()=>withDb(f=>{
 f.shared.onTx=(tx,tables)=>{if(tables.includes('items'))f.shared.auth=false;};
 assert.equal(issued(f).reason,'PF55_ACCESS_REVOKED');
 assert.equal(row(f),null);assert.equal(f.shared.ordersIssued,0);
}));
test('writer integration gate revoked after preflight blocks native and ledger',()=>withDb(f=>{
 f.shared.onTx=(tx,tables)=>{if(tables.includes('items'))f.shared.writers=false;};
 assert.equal(issued(f).reason,'PF55_AUTHORITIES_REVOKED');
 assert.equal(row(f),null);assert.equal(f.shared.ordersIssued,0);
}));
test('second foreign actor using same pilot corrupts claims and fails closed',()=>withDb(f=>{
 const cl=f.get('corporationRuntime',F.claimsPolicy.KEY);
 cl.generations['7009']=1;
 cl.claims['7009']={entityID:7009,pilotID:F.PILOT,
  ownerCharacterID:OWNER,systemID:F.SYSTEM,assignmentID:'other',generation:1,ownerType:'PERSONAL_FLEET'};
 f.put('corporationRuntime',F.claimsPolicy.KEY,cl);
 assert.equal(issued(f).reason,'PF55_ACTOR_CLAIM_NOT_PROVEN');
 assert.equal(row(f),null);
}));
test('invalid unrelated global actor entry fails closed',()=>withDb(f=>{
 const cl=f.get('corporationRuntime',F.claimsPolicy.KEY);
 cl.claims['7009']={entityID:7009,pilotID:'coop-pilot-701',ownerCharacterID:OWNER,
  systemID:F.SYSTEM,assignmentID:'other',generation:0,ownerType:'PERSONAL_FLEET'};
 f.put('corporationRuntime',F.claimsPolicy.KEY,cl);
 assert.equal(issued(f).reason,'PF55_ACTOR_CLAIM_NOT_PROVEN');
}));