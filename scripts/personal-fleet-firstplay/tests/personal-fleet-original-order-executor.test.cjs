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
 const modules={
  '../gameStore':{coopAtomicNativeRows:{mode:'SERVER_INTERNAL_FLAGGED',transact:(tables,cb)=>{calls.push([...tables]);return cb(tx);},isPoisoned:()=>poisoned}},
  './runtime':{scenes:new Map([[30000142,{systemID:30000142}]])},
  './npc/npcRuntime':{follow:()=>{},stop:()=>{},issueOrder:()=>{},issueAttackOrder:()=>{},warpToEntity:()=>{}},
  './npc/npcRegistry':{getControllerByEntityID:id=>({entityID:id})},
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
  orderWitness:witness,orderReceipt:{recordAfterNativeEffect:()=>({success:receiptOK})},
  enabled:()=>on,allWritersFenced:()=>fenced};
 const create=()=>api.createOriginalOrderExecutor(options);
 const ctx={api,create,capture,options,data,idx,dep,calls,
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
