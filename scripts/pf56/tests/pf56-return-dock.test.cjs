'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const F=require('./fixture.cjs');
function setup(){const t=F.tempDb(),f=F.open(t.file);f.makeReady();return {t,f,c:F.command(),close(){f.close();t.cleanup()}};}
function run(fn){const x=setup();try{fn(x.f,x.c);}finally{x.close();}}

test('PF53 -> PF52 -> PF54 -> PF56 actual SQLite return, physical dock, original title and registry release',()=>run((f,c)=>{
 assert.equal(f.returnDock.requestReturn(c).status,'NEEDS_RECONCILIATION');
 assert.equal(f.shared.returnCalls,1);
 assert.equal(f.returnDock.confirmReturn(c).status,'RETURNING');
 assert.equal(f.returnDock.observeArrival(c).status,'ARRIVAL_OBSERVED');
 assert.equal(f.returnDock.requestDock(c).reason,'PF56_STATION_DWELL_NOT_COMPLETE');
 f.shared.clock+=2200;
 assert.equal(f.returnDock.requestDock(c).status,'NEEDS_RECONCILIATION');
 assert.equal(f.shared.dockCalls,1);
 assert.equal(f.returnDock.reconcileDock(c).status,'DOCKED');
 const items=f.get('items','items');assert.equal(items[String(F.SHIP)].itemID,F.SHIP);
 assert.equal(items[String(F.SHIP)].ownerID,F.OWNER);
 assert.equal(items[String(F.SHIP)].flagID,4);assert.equal(items[String(F.SHIP)].locationID,F.STATION);
 assert.equal(items[String(F.SHIP)].spaceState,null);
 const idx=f.get('corporationRuntime',F.pf52.REGISTRY_KEY),
  roster=f.get('corporationRuntime',F.pf52.ROSTER_PREFIX+F.OWNER);
 assert.equal(idx.ships[String(F.SHIP)],undefined);
 assert.equal(idx.generations[String(F.SHIP)],1);
 assert.equal(roster.pilots[F.PILOT].status,'CONTRACTED');
 assert.equal(roster.pilots[F.PILOT].shipItemID,null);
 const claims=f.get('corporationRuntime',f.pf56.CLAIMS);
 assert.equal(claims.claims[String(F.SHIP)],undefined);
 assert.equal(f.get('corporationRuntime',f.pf56.DEPLOY+F.ASSIGNMENT).phase,'DOCKED');
 assert.equal(f.returnDock.reconcileDock(c).status,'ALREADY_DOCKED');
 assert.equal(f.shared.dockCalls,1);
}));

test('return disabled gates, foreign session and poison fail closed',()=>run((f,c)=>{
 f.shared.enabled=false;assert.equal(f.returnDock.requestReturn(c).status,'DISABLED');
 f.shared.enabled=true;f.shared.writers=false;
 assert.equal(f.returnDock.requestReturn(c).reason,'PF56_GLOBAL_WRITERS_NOT_FENCED');
 f.shared.writers=true;f.shared.auth=false;
 assert.equal(f.returnDock.requestReturn(c).reason,'PF56_ACCESS_DENIED');
 f.shared.auth=true;
 assert.equal(f.returnDock.requestReturn({...c,session:{characterID:32,userid:55}}).reason,'PF56_INVALID_COMMAND');
}));

test('return cannot be sent without original active PF54, claim, reservation, item and native control',()=>run((f,c)=>{
 f.shared.flight=false;assert.equal(f.returnDock.requestReturn(c).reason,'PF56_ORIGINAL_NATIVE_FLIGHT_NOT_VERIFIED');
 f.shared.flight=true;f.shared.exclusive=false;
 assert.equal(f.returnDock.requestReturn(c).reason,'PF56_WAR_MINING_EXPLORATION_NOT_FENCED');
 f.shared.exclusive=true;
 f.put('corporationRuntime',f.pf56.DEPLOY+c.assignmentID,{...f.get('corporationRuntime',f.pf56.DEPLOY+c.assignmentID),actorGeneration:9});
 assert.equal(f.returnDock.requestReturn(c).reason,'PF56_PF54_ACTIVE_DEPLOYMENT_MISSING');
}));

test('missing stock original ship rejects and does not dispatch',()=>run((f,c)=>{
 const root=f.get('items','items');root[F.SHIP].ownerID=987;f.put('items','items',root);
 assert.equal(f.returnDock.requestReturn(c).reason,'PF56_ORIGINAL_SHIP_NOT_IN_SPACE');
 assert.equal(f.shared.returnCalls,0);
}));

test('missing or unsettled PF55 order blocks return',()=>run((f,c)=>{
 f.put('corporationRuntime',f.pf56.LAST_ORDER+c.shipItemID,{phase:'ISSUING'});
 assert.equal(f.returnDock.requestReturn(c).reason,'PF56_PREVIOUS_NATIVE_ORDER_UNRESOLVED');
 f.put('corporationRuntime',f.pf56.LAST_ORDER+c.shipItemID,{phase:'ACKED'});
 assert.equal(f.returnDock.requestReturn(c).status,'NEEDS_RECONCILIATION');
}));

test('second return request never redispatches even after native negative ACK',()=>run((f,c)=>{
 f.shared.returnIssued=false;
 assert.equal(f.returnDock.requestReturn(c).status,'NEEDS_RECONCILIATION');
 assert.equal(f.returnDock.requestReturn(c).status,'NEEDS_RECONCILIATION');
 assert.equal(f.shared.returnCalls,1);
 assert.equal(f.returnDock.confirmReturn(c).reason,'PF56_ORIGINAL_RETURN_ORDER_NOT_PERSISTED');
}));

test('throwing native return freezes one durable intent, no retry',()=>run((f,c)=>{
 f.shared.returnCallback=()=>{throw Error('native crash');};
 assert.equal(f.returnDock.requestReturn(c).nativeAck,'UNKNOWN');
 assert.equal(f.returnDock.requestReturn(c).phase,'RETURN_ISSUING');
 assert.equal(f.shared.returnCalls,1);
}));

test('replayed operation ID with changed payload fails closed',()=>run((f,c)=>{
 f.returnDock.requestReturn(c);
 assert.equal(f.returnDock.requestReturn({...c,stationID:c.stationID+1}).reason,'PF56_ASSIGNMENT_RETURN_ALREADY_EXISTS');
}));

test('forged and absent native return ACK cannot authorize RETURNING',()=>run((f,c)=>{
 f.returnDock.requestReturn(c);f.shared.nativeReturnProof=false;
 assert.equal(f.returnDock.confirmReturn(c).reason,'PF56_ORIGINAL_RETURN_ORDER_NOT_PERSISTED');
 f.shared.nativeReturnProof=true;
 f.put('npcEntities','pf56-return:'+c.operationID,{...f.returnProof({
  operationID:c.operationID,signature:f.get('corporationRuntime',f.pf56.key(c.assignmentID)).signature,
  assignmentID:c.assignmentID,ownerCharacterID:c.ownerCharacterID,pilotID:c.pilotID,
  shipItemID:c.shipItemID,actorGeneration:c.actorGeneration,
  stationID:c.stationID,systemID:c.systemID}),returnOrderPersisted:false});
 assert.equal(f.returnDock.confirmReturn(c).reason,'PF56_ORIGINAL_RETURN_ORDER_NOT_PERSISTED');
}));

test('cannot observe arrival without persistent ACK',()=>run((f,c)=>{
 f.returnDock.requestReturn(c);
 assert.equal(f.returnDock.observeArrival(c).reason,'PF56_ARRIVAL_PHASE_INVALID');
}));

test('physical station proof must be canonical, stationary and not warping',()=>run((f,c)=>{
 f.progressToReturning();
 for(const bad of [
  {warpInactive:false},{shipStopped:false},{stationDockAccess:false},
  {noDuplicatePhysicalEntity:false},{nativeControllerPresent:false},
  {stationID:F.STATION+1},{entityID:F.SHIP+1},
  {shipPosition:{x:9e6,y:0,z:0}},{shipRadius:-1},{sceneEpoch:'../tmp'}]){
   f.shared.arrivalOverride=f.arrival(f.get('corporationRuntime',f.pf56.key(c.assignmentID)),bad);
   assert.equal(f.returnDock.observeArrival(c).reason,'PF56_PHYSICAL_STATION_ARRIVAL_NOT_VERIFIED',JSON.stringify(bad));
  }
}));

test('dwell must be 2000ms; new native scene epoch restarts dwell',()=>run((f,c)=>{
 f.progressToReturning();assert.equal(f.returnDock.observeArrival(c).dwellMs,0);
 f.shared.clock+=2500;f.shared.arrivalSceneEpoch='boot-2';
 assert.equal(f.returnDock.observeArrival(c).dwellMs,0);
 assert.equal(f.returnDock.requestDock(c).reason,'PF56_STATION_DWELL_NOT_COMPLETE');
 f.shared.clock+=2100;
 assert.equal(f.returnDock.requestDock(c).status,'NEEDS_RECONCILIATION');
}));

test('unknown dock result permanently prevents redispatch',()=>run((f,c)=>{
 f.progressToReturning();f.returnDock.observeArrival(c);f.shared.clock+=2200;
 f.shared.dockCallback=()=>{throw Error('unknown');};
 assert.equal(f.returnDock.requestDock(c).nativeAck,'UNKNOWN');
 assert.equal(f.returnDock.requestDock(c).reason,'PF56_DOCK_REQUIRES_ARRIVAL');
 assert.equal(f.shared.dockCalls,1);
 assert.equal(f.returnDock.reconcileDock(c).reason,'PF56_ORIGINAL_SHIP_NOT_IN_HANGAR');
}));

test('cannot dock if manifest source missing or original cargo duplicate',()=>run((f,c)=>{
 f.progressToReturning();f.returnDock.observeArrival(c);f.shared.clock+=2300;
 f.shared.manifestOverride={...f.manifest,cargoItemIDs:[24,24]};
 assert.equal(f.returnDock.requestDock(c).reason,'PF56_CARGO_AND_FITTING_MANIFEST_UNVERIFIED');
 assert.equal(f.shared.dockCalls,0);
}));

test('docking crash-safe recognition requires ORIGINAL stock item, not invented receipt',()=>run((f,c)=>{
 f.progressToDockIntent();
 const item=f.get('items','items');item[F.SHIP].ownerID=55;f.put('items','items',item);
 assert.equal(f.returnDock.reconcileDock(c).reason,'PF56_ORIGINAL_SHIP_NOT_IN_HANGAR');
 assert.equal(f.shared.dockCalls,1);
}));

test('docking is blocked when original controller native receipt not independently persisted',()=>run((f,c)=>{
 f.progressToDockIntent();f.shared.nativeDockProof=false;
 assert.equal(f.returnDock.reconcileDock(c).reason,'PF56_NATIVE_DOCK_COMPLETION_NOT_PROVEN');
 const claim=f.get('corporationRuntime',f.pf56.CLAIMS);
 assert.ok(claim.claims[String(F.SHIP)]);
}));

test('forged lost cargo receipt blocks releasing pilot and claims',()=>run((f,c)=>{
 f.progressToDockIntent();
 f.shared.manifestOverride={...f.manifest,cargoHash:'d'.repeat(64)};
 assert.equal(f.returnDock.reconcileDock(c).reason,'PF56_CARGO_OR_FITTING_CUSTODY_CHANGED');
 const ix=f.get('corporationRuntime',F.pf52.REGISTRY_KEY);
 assert.ok(ix.ships[String(F.SHIP)]);
}));

test('revoke writer gate or auth inside transaction before commit fails closed',()=>run((f,c)=>{
 f.shared.onTx=()=>{f.shared.writers=false;};
 assert.equal(f.returnDock.requestReturn(c).reason,'PF56_NATIVE_GATE_REVOKED');
 assert.equal(f.shared.returnCalls,0);
 f.shared.onTx=null;f.shared.writers=true;
 f.shared.onTx=()=>{f.shared.auth=false;};
 assert.equal(f.returnDock.requestReturn(c).reason,'PF56_ACCESS_REVOKED');
 assert.equal(f.shared.returnCalls,0);
}));

test('reconcile atomic failure rolls back claim, roster, index and deployment together',()=>run((f,c)=>{
 f.progressToDockIntent();f.shared.failAfterPut=2;
 assert.equal(f.returnDock.reconcileDock(c).reason,'PF56_ATOMIC_COMMIT_OR_READ_UNCERTAIN');
 const ix=f.get('corporationRuntime',F.pf52.REGISTRY_KEY);
 assert.ok(ix.ships[String(F.SHIP)]);
 assert.equal(f.get('corporationRuntime',f.pf56.DEPLOY+c.assignmentID).phase,'ACTIVE');
 assert.ok(f.get('corporationRuntime',f.pf56.CLAIMS).claims[String(F.SHIP)]);
 f.shared.failAfterPut=null;
 assert.equal(f.returnDock.reconcileDock(c).status,'DOCKED');
}));

test('once docked, no duplicate return and former PF actor cannot command',()=>run((f,c)=>{
 f.progressToDockIntent();assert.equal(f.returnDock.reconcileDock(c).status,'DOCKED');
 assert.equal(f.returnDock.requestReturn(c).status,'NEEDS_RECONCILIATION');
 assert.equal(f.shared.returnCalls,1);
 assert.ok(!f.get('corporationRuntime',f.pf56.CLAIMS).claims[String(F.SHIP)]);
}));

test('two snapshots are insufficient: interrupted native continuous dwell fails closed',()=>run((f,c)=>{
 f.progressToReturning();f.returnDock.observeArrival(c);f.shared.clock+=2400;
 f.shared.canDwell=false;
 assert.equal(f.returnDock.requestDock(c).reason,'PF56_CONTINUOUS_NATIVE_STATION_DWELL_UNVERIFIED');
 assert.equal(f.shared.dockCalls,0);
}));

test('dwell without original persisted per-tick monitor fails closed',()=>run((f,c)=>{
 f.progressToReturning();f.returnDock.observeArrival(c);f.shared.clock+=2400;
 f.shared.dwellPersisted=false;
 assert.equal(f.returnDock.requestDock(c).reason,'PF56_CONTINUOUS_NATIVE_STATION_DWELL_UNVERIFIED');
}));

test('return operation IDs too long to create safe release receipt are refused at admission',()=>run((f,c)=>{
 assert.equal(f.returnDock.requestReturn({...c,operationID:'X'.repeat(116)}).reason,'PF56_INVALID_COMMAND');
}));

test('unrelated invalid durable operation index cannot be hidden by a new valid request',()=>run((f,c)=>{
 f.put('corporationRuntime',f.pf56.OPS,{version:1,operations:{'another-operation':{signature:'oops',assignmentID:'x',phase:'DOCKED'}}});
 assert.equal(f.returnDock.requestReturn(c).reason,'PF56_OPERATION_INDEX_CORRUPT_OR_FULL');
}));

test('stock hangar alias shipID mismatch cannot release actor claim',()=>run((f,c)=>{
 f.progressToDockIntent();const root=f.get('items','items');
 root[F.SHIP].shipID=999;
 f.put('items','items',root);
 assert.equal(f.returnDock.reconcileDock(c).reason,'PF56_ORIGINAL_SHIP_NOT_IN_HANGAR');
}));

test('reconcile refuses unrelated corrupted global durable operation entries',()=>run((f,c)=>{
 f.progressToDockIntent();
 const ix=f.get('corporationRuntime',f.pf56.OPS);
 ix.operations.bad={signature:'not-a-hash',assignmentID:'other',phase:'DOCKED'};
 f.put('corporationRuntime',f.pf56.OPS,ix);
 assert.equal(f.returnDock.reconcileDock(c).reason,'PF56_RECONCILE_FOREIGN_OR_UNCERTAIN');
}));

test('PF84 server-only continuation completes after player disconnect without a new warp or dock',()=>run((f,c)=>{
 // Never mutate the shared F.session fixture used by subsequent tests.
 c={...c,session:{...c.session,socket:{...c.session.socket}}};
 const requested=f.returnDock.requestReturn(c);
 assert.equal(requested.status,'NEEDS_RECONCILIATION');
 const durable=f.get('corporationRuntime',f.pf56.key(c.assignmentID));
 assert.equal(durable.requestedByAccountID,c.session.userid);
 c.session.socket.destroyed=true;
 assert.equal(f.returnDock.advanceServer(durable).status,'RETURNING');
 assert.equal(f.returnDock.advanceServer(durable).status,'ARRIVAL_OBSERVED');
 assert.equal(f.returnDock.advanceServer(durable).reason,'PF56_STATION_DWELL_NOT_COMPLETE');
 f.shared.clock+=2100;
 assert.equal(f.returnDock.advanceServer(durable).status,'NEEDS_RECONCILIATION');
 assert.equal(f.shared.dockCalls,1);
 assert.equal(f.returnDock.advanceServer(durable).status,'DOCKED');
 assert.equal(f.returnDock.advanceServer(durable).status,'ALREADY_DOCKED');
 assert.equal(f.shared.returnCalls,1);
 assert.equal(f.shared.dockCalls,1);
 const item=f.get('items','items')[String(c.shipItemID)];
 assert.equal(item.itemID,c.shipItemID);
 assert.equal(item.flagID,4);
}));

test('PF84 denies offline initiation, forged generations and owner-account transfer',()=>run((f,c)=>{
 const forged={...c,signature:f.pf56.signature(c)};
 assert.equal(f.returnDock.advanceServer(forged).reason,'PF56_SERVER_RETURN_DURABLE_INTENT_UNVERIFIED');
 assert.equal(f.shared.returnCalls,0);
 f.returnDock.requestReturn(c);
 const durable=f.get('corporationRuntime',f.pf56.key(c.assignmentID));
 assert.equal(f.returnDock.advanceServer({...durable,actorGeneration:durable.actorGeneration+1}).reason,
  'PF56_SERVER_RETURN_DURABLE_INTENT_UNVERIFIED');
 const owner=f.get('characters',String(c.ownerCharacterID));
 f.put('characters',String(c.ownerCharacterID),{...owner,accountId:c.session.userid+1});
 assert.equal(f.returnDock.advanceServer(durable).reason,'PF56_SERVER_RETURN_OWNER_REVOKED');
 assert.equal(f.shared.dockCalls,0);
}));

test('PF84 unknown return or unknown dock effect is never reissued by server ticks',()=>run((f,c)=>{
 // Never mutate the shared F.session fixture used by subsequent tests.
 c={...c,session:{...c.session,socket:{...c.session.socket}}};
 f.shared.returnIssued=false;
 f.returnDock.requestReturn(c);
 const durable=f.get('corporationRuntime',f.pf56.key(c.assignmentID));
 c.session.socket.destroyed=true;
 assert.equal(f.returnDock.advanceServer(durable).reason,'PF56_ORIGINAL_RETURN_ORDER_NOT_PERSISTED');
 assert.equal(f.returnDock.advanceServer(durable).reason,'PF56_ORIGINAL_RETURN_ORDER_NOT_PERSISTED');
 assert.equal(f.shared.returnCalls,1);
 assert.equal(f.shared.dockCalls,0);
}));
