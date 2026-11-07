'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../native/coopPersonalFleetOriginalOrderExecutor.js'),'utf8');
function fixture(testBody){
 const F='coop-personal-fleet\u001f',T='corporationRuntime';
 const dep={phase:'ACTIVE',actorGeneration:9,systemID:30000142};
 const idx={ships:{'2301':{shipItemID:2301,ownerCharacterID:901,pilotID:'coop-pilot-123',generation:1,assignmentID:'asgn-1'}}};
 const data=new Map([[T+'|roster-index',idx],[T+'|'+F+'deploy-v1:asgn-1',dep]]);
 const tx={get:(t,k)=>data.get(t+'|'+k)??null};
 let on=true,fenced=true,poisoned=false,war='UNASSIGNED',actorOk=true,targetOk=true,receiptOK=true;
 const calls=[],arbiter={issue:()=>{},blocked:()=>false,snapshot:()=>({leases:[]}),retainWithNativeProof:()=>{},blocksForSystem:()=>new Set()};
 const capture={};
 const witness={verifyNativeActor:(row)=>actorOk&&row.shipItemID===2301&&row.actorGeneration===9,
  verifyTarget:()=>targetOk,verifyPersonalClaim:()=>actorOk,verifyOriginalControl:()=>actorOk};
 const nativeController={entityID:2301,systemID:30000142};
 const modules={
  '../gameStore':{coopAtomicNativeRows:{mode:'SERVER_INTERNAL_FLAGGED',transact:(tables,cb)=>{calls.push([...tables]);return cb(tx);},isPoisoned:()=>poisoned}},
  './runtime':{scenes:new Map([[30000142,{systemID:30000142,
    getEntityByID:id=>id===60000123?{kind:'station',entityID:60000123,itemID:60000123,position:{x:200,y:300,z:400},radius:270}:null}]])},
  './npc/npcRuntime':{follow:()=>{},stop:()=>{},issueOrder:()=>{},issueAttackOrder:()=>{},warpToEntity:()=>{},warpToPoint:()=>{}},
  './worldData':{getStationByID:id=>id===60000123?{stationID:id,solarSystemID:30000142,position:{x:200,y:300,z:400}}:null},
  './coopPersonalFleetNativeReturnExecutor':{createOriginalReturnExecutor:x=>{capture.returnSource=x;return {execute:row=>({success:true,kind:'REAL_RETURN_ADAPTER',ship:row.shipItemID})};}},
  './npc/npcRegistry':{getControllerByEntityID:id=>id===2301?
   nativeController:{entityID:id}},
  './coopPersonalFleetNativeOrders':{key:id=>F+'manual-order-v1:'+id,OP_INDEX:F+'manual-order-operations-v1',signature:r=>r.signature},
  './coopPersonalFleetHangarBridge':{REGISTRY_KEY:'roster-index',validateIndex:x=>x,validateRoster:x=>x},
  './coopNpcOrderBridge':{createOrderBridge:o=>{Object.assign(capture,{bridge:o});return {issue:()=>({success:true})};}},
  './coopPersonalFleetNpcRuntimeExecutor':{createNpcRuntimeExecutor:o=>{capture.executor=o;return {
   supports:()=>true,execute:row=>({success:true,row})};}},
 };
 const context={module:{exports:{}},require:n=>{if(!(n in modules))throw Error('MODULE_NOT_ORIGINAL '+n);return modules[n];},
  Map,Set,Array,Object,Number,process};
 vm.runInNewContext(source,context,{filename:'coopPersonalFleetOriginalOrderExecutor.js'});
 const api=context.module.exports;
 const options={sharedOriginalArbiter:arbiter,readOriginalWarShipClaim:()=>war,
  orderWitness:witness,orderReceipt:{recordAfterNativeEffect:()=>({success:receiptOK}),
   recordAfterNativeReturnEffect:()=>({success:receiptOK})},
  enabled:()=>on,allWritersFenced:()=>fenced};
 const create=()=>api.createOriginalOrderExecutor(options);
 const ctx={api,create,capture,options,data,idx,dep,calls,nativeController,
  setEnabled:x=>on=x,setFenced:x=>fenced=x,setPoisoned:x=>poisoned=x,
  setWar:x=>war=x,setActor:x=>actorOk=x,setTarget:x=>targetOk=x,
  setReceipt:x=>receiptOK=x};
 testBody(ctx);
}
test('reuses original shared arbiter, original runtime and canonical PF52 assignments',()=>fixture(f=>{
 const x=f.create();assert.equal(f.capture.bridge.arbiter,f.options.sharedOriginalArbiter);
 assert.equal(f.capture.bridge.warShipClaim({entityID:2301}),'UNASSIGNED');
 assert.equal(x.supports('FOLLOW'),true);assert.equal(x.supports('HOLD'),true);
 assert.equal(x.supports('ATTACK'),false);assert.equal(x.supports('WARP'),false);
 assert.equal(x.inspectAssignments()[0].entityID,2301);
 assert.equal(x.inspectAssignments()[0].pilotID,'coop-pilot-123');
 assert.equal(f.calls[0].includes('corporationRuntime'),true);
}));
test('original FOLLOW is executed through native original npcRuntime adapter',()=>fixture(f=>{
 const x=f.create();const row={action:'FOLLOW',shipItemID:2301};
 assert.equal(x.execute(row).success,true);
 assert.equal(f.capture.executor.npcRuntime.follow instanceof Function,true);
}));
test('ATTACK and WARP refuse first-play owner even if stock runtime supports',()=>fixture(f=>{
 const x=f.create();for(const action of ['ATTACK','WARP','DEFEND'])
  assert.equal(x.execute({action}).success,false);
}));
test('physical order owner stays OFF until native fences installed',()=>fixture(f=>{
 const x=f.create();f.setFenced(false);
 assert.equal(x.supports('FOLLOW'),false);assert.equal(x.inspectAssignments().length,0);
 assert.equal(x.execute({action:'HOLD'}).success,false);
}));
test('poisoned GameStore prevents commands and assignment visibility',()=>fixture(f=>{
 const x=f.create();f.setPoisoned(true);assert.equal(x.supports('HOLD'),false);
 assert.equal(x.inspectAssignments().length,0);
}));
test('unknown original WAR registry is not interpreted as UNASSIGNED',()=>fixture(f=>{
 f.create();f.setWar('UNKNOWN');assert.equal(f.capture.bridge.warShipClaim({entityID:2301}),'UNKNOWN');
 f.setWar('INVALID');assert.equal(f.capture.bridge.warShipClaim({entityID:2301}),'UNKNOWN');
}));
test('original WAR owner reservation passes through unchanged',()=>fixture(f=>{
 f.create();f.setWar('ASSIGNED');assert.equal(f.capture.bridge.warShipClaim({entityID:2301}),'ASSIGNED');
}));
test('missing ORIGINAL actor claim excludes assigned ship',()=>fixture(f=>{
 const x=f.create();f.setActor(false);assert.equal(x.inspectAssignments().length,0);
 assert.equal(f.capture.executor.verifyPersonalClaim({}),false);
}));
test('missing original deploy ACTIVE blocks shared arbiter assignment',()=>fixture(f=>{
 const x=f.create();f.dep.phase='ISSUING';assert.equal(x.inspectAssignments().length,0);
}));
test('one ambiguous duplicate ship ID fails closed',()=>fixture(f=>{
 const x=f.create();f.idx.ships['2302']={...f.idx.ships['2301'],shipItemID:2302};
 assert.equal(x.inspectAssignments().length,0);
}));
test('friendly target callback uses original transaction read of characters+items',()=>fixture(f=>{
 f.create();assert.equal(f.capture.executor.authorizeTarget({action:'FOLLOW'}),true);
 const last=f.calls.at(-1);assert.ok(last.includes('characters'));assert.ok(last.includes('items'));
}));
test('not verified friendly target is blocked by original source authority',()=>fixture(f=>{
 f.create();f.setTarget(false);
 assert.equal(f.capture.executor.authorizeTarget({action:'FOLLOW'}),false);
 assert.equal(f.capture.executor.authorizeTarget({action:'ATTACK'}),false);
}));
test('missing original shared arbiter cannot be replaced with local new one',()=>fixture(f=>{
 delete f.options.sharedOriginalArbiter;
 assert.throws(f.create,/ORIGINAL_SHARED_ORDER_RUNTIME_REQUIRED/);
}));
test('no WAR claim source means no original NPC order bridge',()=>fixture(f=>{
 delete f.options.readOriginalWarShipClaim;
 assert.throws(f.create,/ORIGINAL_SHARED_ORDER_RUNTIME_REQUIRED/);
}));
test('original order executor never writes native SQLite, spawns hulls, or creates a new arbiter',()=>{
 for(const bad of ['.put(','.upsertNative','createOrderArbiter','spawnNpcForSession','moveShipToSpace'])
  assert.ok(!source.includes(bad),bad);
});

test('native physical success with failed original durable receipt remains UNKNOWN and is never reported as success',()=>fixture(f=>{
 f.setReceipt(false);const a=f.create().execute({action:'FOLLOW',shipItemID:2301});
 assert.equal(a.success,false);assert.match(a.errorMsg,/UNKNOWN_NO_RETRY/);
}));
test('missing source-owned receipt is a hard physical executor constructor failure',()=>fixture(f=>{
 delete f.options.orderReceipt;assert.throws(f.create,/ORIGINAL_SHARED_ORDER_RUNTIME_REQUIRED/);
}));

test('PF56 original return uses the SAME original shared order bridge as PF55',()=>fixture(f=>{
 const x=f.create();assert.equal(f.capture.returnSource.orderBridge,f.capture.executor.orderBridge);
 const row={shipItemID:2301,systemID:30000142,stationID:60000123,actorGeneration:9};
 assert.equal(x.executeNativeReturn(row).data?.durability,
  'ORIGINAL_NPC_ENTITIES_AND_PF56_RETURN_RECEIPT_COMMITTED');
}));
test('PF56 source return geometry requires both original SDE station and loaded scene ball',()=>fixture(f=>{
 const x=f.create();let p=f.capture.returnSource.getCanonicalStation(60000123);
 assert.equal(p.radius,270);assert.deepEqual({...p.position},{x:200,y:300,z:400});
 assert.equal(f.capture.returnSource.getCanonicalStation(60000124),null);
}));
test('PF56 stationless return may not issue a warp without original ID and generation',()=>fixture(f=>{
 const x=f.create();assert.equal(x.executeNativeReturn({shipItemID:2301,stationID:0,systemID:30000142,actorGeneration:9}).success,false);
}));
test('PF56 stock native return is gated by same shared owner fencing',()=>fixture(f=>{
 const x=f.create();f.setFenced(false);
 assert.equal(x.executeNativeReturn({shipItemID:2301,systemID:30000142,stationID:60000123,actorGeneration:9}).success,false);
}));
test('PF56 original native return bridge must exist at startup',()=>fixture(f=>{
 // A compiler change that removed return bridge construction cannot become success.
 assert.equal(typeof f.create().executeNativeReturn,'function');
 assert.equal(typeof f.capture.returnSource.npcRuntime.warpToPoint,'function');
}));

test('PF56 canonical original station ball uses itemID when entityID is absent',()=>fixture(f=>{
 f.create();const s=f.capture.returnSource.getCanonicalStation(60000123);
 assert.equal(s?.stationID,60000123);
}));

test('PF95 real native ATTACK uses original shared arbiter, stock issueAttackOrder, then durable receipt',()=>fixture(f=>{
 const calls=[];
 f.options.combatAuthority={verify:()=>true};
 f.options.combatReceipt={recordAfterEffect:row=>{calls.push(['receipt',row.action]);return {success:true};}};
 const owner=f.create();
 f.capture.executor.orderBridge.issue=cmd=>{calls.push(['arbiter',cmd.owner,cmd.action]);return cmd.execute();};
 f.capture.executor.npcRuntime.issueAttackOrder=(id,target,opts)=>{
  calls.push(['attack',id,target,opts]);return {success:true};};
 const row={action:'ATTACK',shipItemID:2301,systemID:30000142,actorGeneration:9,targetEntityID:3333};
 assert.equal(owner.supports('ATTACK'),true);
 assert.equal(owner.execute(row).success,true);
 assert.equal(calls.length,3);
 assert.equal(calls[0][1],'PERSONAL_FLEET');
 assert.equal(calls[1][0],'attack');assert.equal(calls[1][2],3333);
 assert.equal(calls[1][3].allowPodKill,false);
 assert.equal(calls[2][0],'receipt');
}));
test('PF95 native GUARD physically follows owner with weapons disabled',()=>fixture(f=>{
 const calls=[];
 f.options.combatAuthority={verify:()=>true};
 f.options.combatReceipt={recordAfterEffect:row=>{calls.push('receipt');return {success:true};}};
 const owner=f.create();
 f.capture.executor.orderBridge.issue=c=>c.execute();
 f.capture.executor.npcRuntime.follow=(id,target,range)=>{
  calls.push(['follow',id,target,range]);return {success:true};};
 f.capture.executor.npcRuntime.issueOrder=(id,order)=>{
  calls.push(['manual',id,order]);return {success:true};};
 const row={action:'DEFEND',shipItemID:2301,systemID:30000142,actorGeneration:9,
  targetEntityID:3003,followRangeMeters:2500};
 assert.equal(owner.supports('DEFEND'),true);
 assert.equal(owner.execute(row).success,true);
 assert.equal(calls[0][0],'manual');
 assert.equal(calls[0][2].allowWeapons,false);
 assert.equal(calls[0][2].type,'follow');
 assert.equal(calls[1][0],'follow');
 assert.equal(calls[2],'receipt');
}));
test('PF95 native combat cannot be reported ACKED when source receipt fails',()=>fixture(f=>{
 f.options.combatAuthority={verify:()=>true};
 f.options.combatReceipt={recordAfterEffect:()=>({success:false})};
 const owner=f.create();f.capture.executor.orderBridge.issue=c=>c.execute();
 f.capture.executor.npcRuntime.issueAttackOrder=()=>({success:true});
 const r=owner.execute({action:'ATTACK',shipItemID:2301,systemID:30000142,actorGeneration:9,targetEntityID:3333});
 assert.equal(r.success,false);
 assert.match(r.errorMsg,/UNKNOWN_NO_RETRY/);
}));

test('PF95 GUARD never moves a ship if native weapon disarm fails',()=>fixture(f=>{
 const calls=[];
 f.options.combatAuthority={verify:()=>true};
 f.options.combatReceipt={recordAfterEffect:()=>{calls.push('receipt');return {success:true};}};
 const owner=f.create();
 f.capture.executor.orderBridge.issue=c=>c.execute();
 f.capture.executor.npcRuntime.issueOrder=()=>({success:false,errorMsg:'DISARM_FAILED'});
 f.capture.executor.npcRuntime.follow=()=>{calls.push('moved');return {success:true};};
 const row={action:'DEFEND',shipItemID:2301,systemID:30000142,actorGeneration:9,
  targetEntityID:3003,followRangeMeters:2500};
 assert.equal(owner.execute(row).success,false);
 assert.deepEqual(calls,[]);
}));

test('PF96 direct combat resumption requires original ACKED operation and receipt',()=>fixture(f=>{
 f.options.combatAuthority={verify:()=>true};
 f.options.combatReceipt={recordAfterEffect:()=>({success:true}),
  verifyPersisted:()=>({orderApplied:true})};
 const x=f.create();
 const row={phase:'ACKED',action:'ATTACK',operationID:'op1',
  signature:'a'.repeat(64),shipItemID:2301,systemID:30000142,
  targetEntityID:3333,actorGeneration:9};
 assert.equal(x.resumeCommitted(row).success,false);
 assert.equal(x.resumeCommitted(row).errorMsg,'PF96_ORIGINAL_ACKED_COMBAT_SOURCE_NOT_PROVEN');
}));

test('PF96 source bridge callback demands real ACKED DEFEND plus physical source proof',()=>fixture(f=>{
 f.options.combatAuthority={verify:()=>true};
 f.options.combatReceipt={recordAfterEffect:()=>({success:true}),
  verifyPersisted:()=>({orderApplied:true})};
 const x=f.create(),link={entityID:2301,systemID:30000142,
  pilotID:'coop-pilot-123'};
 assert.equal(typeof f.capture.bridge.personalFleetRecoveryProof,'function');
 assert.equal(f.capture.bridge.personalFleetRecoveryProof(link),false);
 const row={version:1,phase:'ACKED',action:'DEFEND',operationID:'guard-op-1',
  signature:'a'.repeat(64),shipItemID:2301,systemID:30000142,
  ownerCharacterID:901,actorGeneration:9,pilotID:link.pilotID,
  assignmentID:'asgn-1',targetEntityID:3003,followRangeMeters:2500};
 const T='corporationRuntime',F='coop-personal-fleet\u001f';
 f.data.set(T+'|'+F+'manual-order-v1:2301',row);
 f.data.set(T+'|'+F+'manual-order-operations-v1',{
  operations:{[row.operationID]:{phase:'ACKED',signature:row.signature}}});
 Object.assign(f.nativeController,{personalFleetOriginal:true,
  personalFleetAssignmentID:row.assignmentID,
  personalFleetPilotID:row.pilotID,manualOrder:null});
 const scene=f.capture.bridge.sceneForSystem(row.systemID);
 const originalGet=scene.getEntityByID;
 scene.getEntityByID=id=>id===2301?
  {kind:'ship',itemID:2301,nativeNpc:true,ownerID:901,mode:'FOLLOW',
   targetEntityID:3003}:originalGet(id);
 assert.equal(f.capture.bridge.personalFleetRecoveryProof(link),true);
 row.action='ATTACK';
 assert.equal(f.capture.bridge.personalFleetRecoveryProof(link),false);
 row.action='DEFEND';
 f.nativeController.manualOrder={type:'attack',targetID:8888,allowWeapons:true};
 assert.equal(f.capture.bridge.personalFleetRecoveryProof(link),false);
}));
