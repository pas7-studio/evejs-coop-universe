'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {setup,P}=require('./fixture.cjs');
function withDb(fn){const f=setup();try{fn(f);}finally{f.close();}}
function assertNoEffect(f){assert.equal(f.state.stockMoves,0);assert.equal(f.state.sceneRemovals,0);
 assert.equal(f.get('corporationRuntime',f.pf.attemptKey(f.c.assignmentID)),null);}
test('PF66 commits original durable one-shot before ItemStore dock and scoped scene removal',()=>withDb(f=>{
 const api=f.build();const result=api.execute(f.c);
 assert.equal(result.success,true,JSON.stringify(result));
 assert.equal(f.state.stockMoves,1);assert.equal(f.state.sceneRemovals,1);
 assert.equal(f.get('items','items')[f.c.shipItemID].flagID,4);
 assert.equal(f.state.nativeEntity.entityID,f.c.shipItemID);
 assert.equal(f.state.nativeController.entityID,f.c.shipItemID);
 const token=f.get('corporationRuntime',f.pf.attemptKey(f.c.assignmentID));
 assert.equal(token.status,'CONSUMED');assert.equal(token.signature,f.pf.signature(f.c));
 assert.equal(api.execute(f.c).errorMsg,'PF66_LOCAL_ALREADY_ATTEMPTED');
}));
test('PF66 refuses without exact DOCK_ISSUING and original ship in space',()=>withDb(f=>{
 const api=f.build();const bad={...f.c,phase:'DOCKED'};
 assert.equal(api.execute(bad).errorMsg,'PF66_DOCK_COMMAND_INVALID');assertNoEffect(f);
 const x=f.get('corporationRuntime',P+'return-dock-v1:'+f.c.assignmentID);
 f.put('corporationRuntime',P+'return-dock-v1:'+f.c.assignmentID,{...x,phase:'DOCKED'});
 assert.equal(api.execute(f.c).errorMsg,'PF66_DOCK_CUSTODY_NOT_PROVEN');assertNoEffect(f);
}));
test('PF66 forbids stale assignment, actor generation and ship id',()=>withDb(f=>{
 const api=f.build();for(const part of [{assignmentID:'other'}, {actorGeneration:100},
  {reservationGeneration:900},{shipItemID:1234},{pilotID:'coop-pilot-456'},
  {stationID:1234}])assert.equal(api.execute({...f.c,...part}).success,false);
 assertNoEffect(f);
}));
test('PF66 forbids duplicate pilot claim on another ship',()=>withDb(f=>{
 const cl=f.get('corporationRuntime',P+'actor-claims-v1');
 cl.claims[9000]={...cl.claims[f.c.shipItemID],pilotID:f.c.pilotID};
 f.put('corporationRuntime',P+'actor-claims-v1',cl);
 assert.equal(f.build().execute(f.c).errorMsg,'PF66_DOCK_CUSTODY_NOT_PROVEN');assertNoEffect(f);
}));
test('PF66 refuses corrupt manifest even when original row still exists',()=>withDb(f=>{
 const api=f.build();const bad={...f.c,manifest:{...f.c.manifest,cargoItemIDs:[1,1]}};
 assert.equal(api.execute(bad).errorMsg,'PF66_DOCK_COMMAND_INVALID');assertNoEffect(f);
}));
test('PF66 revoked writer, exclusive owner, arrival or feature flag denies before token',()=>withDb(f=>{
 const api=f.build();for(const flag of ['writers','exclusive','ready','enabled']){
  f.state[flag]=false;assert.equal(api.execute(f.c).success,false,flag);f.state[flag]=true;
 }assertNoEffect(f);
}));
test('PF66 missing or corrupt original handoff ship lock refuses effects',()=>withDb(f=>{
 f.put('corporationRuntime',P+'handoff-ship-v1:'+f.c.shipItemID,
  {assignmentID:'other',sourcePF54Hash:'f'.repeat(64)});
 assert.equal(f.build().execute(f.c).success,false);assertNoEffect(f);
}));
test('PF66 refuses when PF60 terminal already starts',()=>withDb(f=>{
 f.put('corporationRuntime',P+'terminal-v1:'+f.c.assignmentID,{phase:'PREPARED'});
 assert.equal(f.build().execute(f.c).success,false);assertNoEffect(f);
}));
test('PF66 cannot authorize native service before ItemStore dock, even with private capability',()=>withDb(f=>{
 const api=f.build(),auth=f.nativeNpcService.rawAuthorize();
 assert.equal(auth.authorize(f.c),false);
 assert.equal(f.nativeNpcService.detachScopedPersonalFleetDockSceneActor({row:f.c,capability:auth.capability}).success,false);
 assertNoEffect(f);
}));
test('PF66 commits token before original ItemStore writes',()=>withDb(f=>{
 const dock=f.originalItemStore.dockShipToLocation;
 f.originalItemStore.dockShipToLocation=(id,station)=>{
  const token=f.get('corporationRuntime',f.pf.attemptKey(f.c.assignmentID));
  assert.equal(token.status,'CONSUMED');return dock(id,station);
 };
 assert.equal(f.build().execute(f.c).success,true);
}));
test('PF66 stock move failure is irreversible, no automatic second dispatch',()=>withDb(f=>{
 f.state.failStock=true;const a=f.build();
 assert.equal(a.execute(f.c).errorMsg,'PF66_ORIGINAL_ITEMSTORE_DOCK_UNKNOWN');
 assert.equal(f.state.stockMoves,1);assert.equal(f.state.sceneRemovals,0);
 assert.equal(a.execute(f.c).errorMsg,'PF66_LOCAL_ALREADY_ATTEMPTED');
 assert.equal(f.get('corporationRuntime',f.pf.attemptKey(f.c.assignmentID)).status,'CONSUMED');
}));
test('PF66 scene removal uncertainty after ItemStore commit cannot auto-retry',()=>withDb(f=>{
 f.state.failScene=true;const a=f.build();
 assert.equal(a.execute(f.c).errorMsg,'PF66_NATIVE_DOCK_OUTCOME_UNKNOWN_NO_RETRY');
 assert.equal(f.state.stockMoves,1);assert.equal(f.state.sceneRemovals,1);
 assert.equal(a.execute(f.c).errorMsg,'PF66_LOCAL_ALREADY_ATTEMPTED');
 assert.equal(f.get('corporationRuntime',f.pf.attemptKey(f.c.assignmentID)).status,'CONSUMED');
}));
test('PF66 restart does not clear consumed durable token',()=>withDb(f=>{
 assert.equal(f.build().execute(f.c).success,true);
 // Native authority is per-process; a restarted executor would install in a fresh service.
 const first=f.nativeNpcService.installScopedPersonalFleetDockAuthority;
 f.nativeNpcService.installScopedPersonalFleetDockAuthority=()=>true;
 const second=f.build();
 assert.equal(second.execute(f.c).errorMsg,'PF66_DURABLE_ATTEMPT_ALREADY_CONSUMED');
 assert.equal(f.state.stockMoves,1);assert.equal(f.state.sceneRemovals,1);
 f.nativeNpcService.installScopedPersonalFleetDockAuthority=first;
}));
test('PF66 original Native Store unknown commit fails closed',()=>withDb(f=>{
 const raw=f.a.transact;f.a.transact=(tables,fn)=>{
  if(tables.includes('items')&&tables.includes('corporationRuntime'))throw Error('DB_UNKNOWN');
  return raw(tables,fn);
 };
 assert.equal(f.build().execute(f.c).errorMsg,'PF66_ATTEMPT_COMMIT_UNKNOWN_NO_RETRY');
 assertNoEffect(f);
}));
test('PF66 refuses false native authority install and no side effects',()=>withDb(f=>{
 f.nativeNpcService.installScopedPersonalFleetDockAuthority=()=>false;
 assert.throws(()=>f.build(),/INSTALL_UNCONFIRMED/);assertNoEffect(f);
}));
test('PF66 invalid ItemStore authority fails construction',()=>withDb(f=>{
 delete f.originalItemStore.dockShipToLocation;
 assert.throws(()=>f.build(),/AUTHORITIES_REQUIRED/);assertNoEffect(f);
}));

test('PF66 writer revoked immediately after durable commit prevents any stock move',()=>withDb(f=>{
 const transact=f.a.transact;
 f.a.transact=(tables,fn)=>{
  const out=transact(tables,fn);
  if(out==='COMMITTED')f.state.writers=false;
  return out;
 };
 const a=f.build();assert.equal(a.execute(f.c).errorMsg,'PF66_POST_COMMIT_GATE_REVOKED_NO_RETRY');
 assert.equal(f.state.stockMoves,0);assert.equal(f.state.sceneRemovals,0);
 assert.equal(f.get('corporationRuntime',f.pf.attemptKey(f.c.assignmentID)).status,'CONSUMED');
 assert.equal(a.execute(f.c).errorMsg,'PF66_LOCAL_ALREADY_ATTEMPTED');
}));
