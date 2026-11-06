'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {setup}=require('./fixture.cjs');
const {validCommand,validWitness,nativeSnapshot,createTerminalCustody}=require('../native/coopPersonalFleetTerminalCustody.cjs');
const run=(fn,options)=>{const f=setup(options);try{fn(f);}finally{f.close();}};
for(const mode of ['DOCK','LOSS']){
 const opts=mode==='DOCK'?{}:{command:{mode:'LOSS',wreckID:700}};
 test(mode+' complete one-shot cleanup, native reconcile, PF56/57 finalize and replay',()=>run(f=>{
  const a=f.create();assert.deepEqual(a.prepare(f.c),{status:'PREPARED',needsCleanup:true});
  assert.equal(a.prepare(f.c).phase,'PREPARED');
  assert.equal(a.finalize(f.c).status,'BLOCKED');
  assert.equal(a.issue(f.c).status,'NEEDS_RECONCILIATION');
  assert.equal(f.physical.calls,1);
  assert.equal(a.issue(f.c).status,'BLOCKED');
  assert.equal(a.reconcile(f.c).status,'NATIVE_CLEARED');
  assert.equal(a.reconcile(f.c).status,'NATIVE_CLEARED');
  assert.equal(a.finalize(f.c).reason,
   mode==='DOCK'?'PF60_PF56_DOCK_RECONCILE_NOT_COMMITTED':'PF60_PF57_LOSS_RECONCILE_NOT_COMMITTED');
  f.settle();assert.equal(a.finalize(f.c).status,'FINALIZED');
  assert.equal(a.finalize(f.c).status,'ALREADY_FINALIZED');
  assert.equal(a.inspect(f.c).status,'FINALIZED');
  assert.equal(f.read('corporationRuntime',f.LOCK+f.c.shipItemID),null);
  assert.equal(f.read('corporationRuntime',f.HANDOFF+f.c.assignmentID).status,'CONSUMED');
  assert.equal(f.read('corporationRuntime',f.terminalShipKey(f.c.shipItemID)).phase,'FINALIZED');
  assert.equal(f.physical.calls,1);
 },opts));
 test(mode+' already-cleared orphan can reconcile without a new native deletion',()=>run(f=>{
  f.physical.entity=null;f.physical.controller=null;
  const a=f.create();assert.equal(a.prepare(f.c).needsCleanup,false);
  assert.equal(a.issue(f.c).reason,'PF60_ALREADY_CLEARED_USE_RECONCILE');
  assert.equal(a.reconcile(f.c).status,'NATIVE_CLEARED');
  f.settle();assert.equal(a.finalize(f.c).status,'FINALIZED');
  assert.equal(f.physical.calls,0);
 },opts));
}
test('native deletion unknown after side effect never re-executes cleanup',()=>run(f=>{
 const a=f.create();assert.equal(a.prepare(f.c).status,'PREPARED');
 f.physical.failAfterSideEffect=true;
 assert.equal(a.issue(f.c).status,'OUTCOME_UNKNOWN');
 assert.equal(a.issue(f.c).status,'BLOCKED');
 assert.equal(f.physical.calls,1);
 assert.equal(a.reconcile(f.c).status,'NATIVE_CLEARED');
}));
test('no fabricated original ship or wallet mutation in lifecycle',()=>run(f=>{
 const prev=f.read('items','items');const a=f.create();
 a.prepare(f.c);a.issue(f.c);a.reconcile(f.c);f.settle();a.finalize(f.c);
 assert.deepEqual(f.read('items','items'),prev);
 assert.equal(f.read('characters','characters'),null);
}));
test('no automatic finalize before BOTH proof and PF56 release',()=>run(f=>{
 const a=f.create();a.prepare(f.c);a.issue(f.c);a.reconcile(f.c);
 const d=f.read('corporationRuntime',f.DEPLOY+f.c.assignmentID);
 f.put('corporationRuntime',f.DEPLOY+f.c.assignmentID,{...d,phase:'DOCKED'});
 assert.equal(a.finalize(f.c).reason,'PF60_PF56_DOCK_RECONCILE_NOT_COMMITTED');
 const r=f.read('corporationRuntime',f.RETURN+f.c.assignmentID);
 f.put('corporationRuntime',f.RETURN+f.c.assignmentID,{...r,phase:'DOCKED'});
 assert.equal(a.finalize(f.c).reason,'PF60_ORIGINAL_SHIP_OR_PILOT_STILL_RESERVED');
}));
test('missing/corrupt durable lock blocks every terminal step',()=>run(f=>{
 f.put('corporationRuntime',f.LOCK+f.c.shipItemID,null);
 assert.equal(f.create().prepare(f.c).reason,'PF60_ORIGINAL_HANDOFF_CUSTODY_CHANGED');
}));
test('native mixed controller identity blocks terminal before durable intent',()=>run(f=>{
 f.physical.controller.personalFleetAssignmentID='stolen';
 assert.equal(f.create().prepare(f.c).reason,'PF60_NATIVE_IDENTITY_UNVERIFIED');
 assert.equal(f.read('corporationRuntime',f.terminalKey(f.c.assignmentID)),null);
}));
test('original scene actor cannot be present at terminal prepare',()=>run(f=>{
 f.physical.sceneAbsent=false;
 assert.equal(f.create().prepare(f.c).reason,'PF60_NATIVE_IDENTITY_UNVERIFIED');
}));
test('original native stock modules/cargo cannot be silently discarded',()=>run(f=>{
 f.physical.cargo=[{cargoID:1}];
 assert.equal(f.create().prepare(f.c).reason,'PF60_NATIVE_IDENTITY_UNVERIFIED');
}));
test('physically incomplete native cleanup prevents reconciliation and lock release',()=>run(f=>{
 const a=f.create();a.prepare(f.c);
 f.physical.controller=null;
 assert.equal(a.reconcile(f.c).reason,'PF60_NATIVE_ROWS_OR_SCENE_STILL_PRESENT');
 assert.equal(f.read('corporationRuntime',f.LOCK+f.c.shipItemID).assignmentID,f.c.assignmentID);
}));
test('cannot use wrong owner, operation, generation, ship or assignment to replay',()=>run(f=>{
 const a=f.create();a.prepare(f.c);
 for(const change of [
  {operationID:'other'}, {assignmentID:'other'}, {ownerCharacterID:500},
  {generation:3}, {actorGeneration:4}, {shipItemID:990}, {typeID:507}
 ])assert.equal(a.issue({...f.c,...change}).status,'BLOCKED');
 assert.equal(f.physical.calls,0);
}));
test('terminal witness must originate in original native event and custody proof',()=>run(f=>{
 f.proof.originalDockReceiptPersisted=false;
 assert.equal(f.create().prepare(f.c).reason,'PF60_TERMINAL_NATIVE_WITNESS_UNVERIFIED');
}));
test('trusted terminal witness changing between prepare and issue forbids cleanup',()=>run(f=>{
 const a=f.create();a.prepare(f.c);
 f.proof.receiptHash='b'.repeat(64);
 assert.equal(a.issue(f.c).reason,'PF60_TERMINAL_WITNESS_CHANGED');
 assert.equal(f.physical.calls,0);
}));
test('authorization or writer fencing lost before durable intent prevents cleanup',()=>run(f=>{
 let a=f.create();f.flags.auth=false;
 assert.equal(a.prepare(f.c).status,'BLOCKED');f.flags.auth=true;
 a.prepare(f.c);f.flags.writers=false;
 assert.equal(a.issue(f.c).status,'BLOCKED');
 assert.equal(f.physical.calls,0);
}));
test('single-durable-winner operation prevents competing terminal command',()=>run(f=>{
 const a=f.create(),b=f.create();
 assert.equal(a.prepare(f.c).status,'PREPARED');
 assert.equal(b.prepare({...f.c,operationID:'other'}).reason,'PF60_ASSIGNMENT_ALREADY_CLAIMED');
 assert.equal(a.issue(f.c).status,'NEEDS_RECONCILIATION');
 assert.equal(f.physical.calls,1);
}));
test('reconcile after process restart uses durable original intent and no redispatch',()=>run(f=>{
 const a=f.create();a.prepare(f.c);a.issue(f.c);
 const b=f.create();assert.equal(b.issue(f.c).status,'BLOCKED');
 assert.equal(b.reconcile(f.c).status,'NATIVE_CLEARED');
 assert.equal(f.physical.calls,1);
}));
test('transaction rollback on thrown commit preserves state and denies executor',()=>run(f=>{
 const a=f.create(),old=f.root.coopAtomicNativeRows.transact;
 f.root.coopAtomicNativeRows.transact=function(t,callback){return old.call(this,t,tx=>{
   const x=callback(tx);if(x.status==='ISSUING')throw Error('crash before commit');return x;});};
 assert.equal(a.prepare(f.c).status,'PREPARED');
 assert.equal(a.issue(f.c).reason,'PF60_ISSUE_COMMIT_UNKNOWN_NO_RETRY');
 assert.equal(f.physical.calls,0);
 assert.equal(f.create().inspect(f.c).status,'PREPARED');
}));
test('a forged PF57 loss and wrong wreck cannot finalize without original evidence',()=>run(f=>{
 const a=f.create();a.prepare(f.c);a.issue(f.c);a.reconcile(f.c);
 f.settle();const d=f.read('corporationRuntime',f.RETURN+f.c.assignmentID);
 f.put('corporationRuntime',f.RETURN+f.c.assignmentID,{...d,phase:'DOCK_ISSUING'});
 assert.equal(a.finalize(f.c).status,'BLOCKED');
}));
test('strict constructors, validation and inspect unknown command',()=>run(f=>{
 assert.throws(()=>createTerminalCustody(),/AUTHORITIES_REQUIRED/);
 assert.equal(validCommand({...f.c,mode:'LOSS'}),false);
 assert.equal(validWitness({},f.c),false);
 assert.equal(nativeSnapshot({},f.c),null);
 assert.equal(f.create().inspect({assignmentID:''}).status,'BLOCKED');
}));
test('finalized DOCK ship may be reused only with a newer original generation',()=>{
 let tomb;run(f=>{const a=f.create();a.prepare(f.c);a.issue(f.c);a.reconcile(f.c);
  f.settle();a.finalize(f.c);tomb=f.read('corporationRuntime',f.terminalShipKey(f.c.shipItemID));});
 run(f=>{f.put('corporationRuntime',f.terminalShipKey(f.c.shipItemID),tomb);
  assert.equal(f.create().prepare(f.c).status,'PREPARED');
 },{command:{operationID:'terminal-2',assignmentID:'assignment-2',
  generation:3,actorGeneration:9}});
 run(f=>{f.put('corporationRuntime',f.terminalShipKey(f.c.shipItemID),tomb);
  assert.equal(f.create().prepare(f.c).reason,'PF60_SHIP_TERMINAL_ALREADY_RECORDED');
 },{command:{operationID:'terminal-2',assignmentID:'assignment-2',
  generation:2,actorGeneration:9}});
});
test('previous LOSS terminal tombstone must never authorize resurrection of ship',()=>{
 let tomb;run(f=>{const a=f.create();a.prepare(f.c);a.issue(f.c);a.reconcile(f.c);
  f.settle();a.finalize(f.c);tomb=f.read('corporationRuntime',f.terminalShipKey(f.c.shipItemID));},
  {command:{mode:'LOSS',wreckID:700}});
 run(f=>{f.put('corporationRuntime',f.terminalShipKey(f.c.shipItemID),tomb);
  assert.equal(f.create().prepare(f.c).reason,'PF60_SHIP_TERMINAL_ALREADY_RECORDED');
 },{command:{operationID:'terminal-2',assignmentID:'assignment-2',generation:3,actorGeneration:9}});
});
test('original owner mismatch in live native entity refuses cleanup even with correct PF markers',()=>run(f=>{
 f.physical.entity.ownerID=987;
 assert.equal(f.create().prepare(f.c).reason,'PF60_NATIVE_IDENTITY_UNVERIFIED');
}));
test('missing operationID, assignmentID and malformed pilot are never coerced to valid tokens',()=>run(f=>{
 const api=f.create();
 for(const field of ['operationID','assignmentID','pilotID']){
  const bad={...f.c};delete bad[field];
  assert.equal(validCommand(bad),false,field);
  assert.equal(api.prepare(bad).reason,'PF60_COMMAND_INVALID',field);
 }
 assert.equal(api.inspect({}).status,'BLOCKED');
}));
test('original GameStore rejects put(null) but PF60 finalization uses a durable delete',()=>run(f=>{
 const a=f.create(),atom=f.root.coopAtomicNativeRows;
 assert.throws(()=>atom.transact(['corporationRuntime'],tx=>
  tx.put('corporationRuntime','invalid-null',null)),/NATIVE_ROW_MUST_BE_OBJECT/);
 assert.equal(f.read('corporationRuntime','invalid-null'),null);
 a.prepare(f.c);a.issue(f.c);a.reconcile(f.c);f.settle();
 assert.equal(a.finalize(f.c).status,'FINALIZED');
 assert.equal(f.read('corporationRuntime',f.LOCK+f.c.shipItemID),null);
}));
