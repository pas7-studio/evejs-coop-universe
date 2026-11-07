'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const file=path.join(__dirname,'../native/coopPersonalFleetOriginalWorkBootstrap.js');
const source=fs.readFileSync(file,'utf8');
const hooksList=['verifyOriginalWriterHooks','allWritersFenced','allWalletWritersFenced',
 'verifyShipAvailable',
 'verifyRelease','verifyOriginalEquipment','verifyOriginalDeploymentAuthority',
 'verifyExclusiveOwnership','verifyOriginalActor','independentOriginalActorWitness',
 'originalStationUndockPoint','originalOwnershipWitness',
 'verifyNativeFlight','verifyOriginalManifest',
 'verifyFinalOriginalManifest',
 'verifyOriginalDockedPlayerSession','readOriginalWarShipClaim',
 'verifyNativeWreckLoss','verifyWreckAssetCustody','verifyNoCompetingOrders'];
function fixture(cb){
 const flags=['EVEJS_COOP_PERSONAL_FLEET_NATIVE','EVEJS_COOP_PERSONAL_FLEET_CHAT','EVEJS_COOP_NATIVE_ATOMIC_ROWS',
  'EVEJS_COOP_PERSONAL_FLEET_ENTITY_ISOLATION'];
 const prior=flags.map(k=>[k,process.env[k]]);for(const k of flags)process.env[k]='1';
 const events=[];const supplied={};const hooks={source:'ORIGINAL_EVEJS_PERSONAL_FLEET_BOOT_OWNER_V1',
   claimsPolicy:{KEY:'coop-personal-fleet\u001factor-claims-v1',validate:x=>x,empty:()=>({})},
   sharedOriginalNpcOrderArbiter:{issue:()=>{},blocked:()=>false,snapshot:()=>({leases:[]}),
      retainWithNativeProof:()=>{},blocksForSystem:()=>new Set()}};
 for(const name of hooksList)hooks[name]=()=>true;
 let broken='',originalPoisoned=false;
 const gameStore={coopAtomicNativeRows:{mode:'SERVER_INTERNAL_FLAGGED',transact:()=>{},isPoisoned:()=>originalPoisoned}};
 const deps={
  './coopPersonalFleetOriginalSourceBindings':{createOriginalSourceBindings(){events.push('source');
   return {gameStore,access:{isOwner:()=>false},resolveOwnerCorporation:()=>1,
    resolveOriginalDockContext:()=>null,resolveOriginalFollowTarget:()=>null,
    verifyServerReturnOwner:()=>false};}},
  './coopPersonalFleetOriginalDurableOrderAck':{createOriginalDurableOrderAck(args){events.push('order-ack');
   if(broken==='order-ack')throw Error('DURABLE_ACK_ORIGINAL_SOURCE_MISSING');
   assert.equal(args.enabled(),false);
   return {recordAfterNativeEffect:()=>({success:false}),verifyPersistedNativeOrder:()=>null,
    recordAfterNativeReturnEffect:()=>({success:false}),verifyPersistedNativeReturn:()=>null};}},
  './coopPersonalFleetOriginalOrderExecutor':{createOriginalOrderExecutor(args){events.push('physical-order');
   assert.equal(typeof args.orderReceipt.recordAfterNativeEffect,'function');
   assert.equal(args.sharedOriginalArbiter,hooks.sharedOriginalNpcOrderArbiter);
   assert.equal(args.enabled(),false);
   if(broken==='physical-order')throw Error('SHARED_ARBITER_NOT_INSTALLED');
   return {execute:()=>({success:false}),supports:()=>false,
    executeNativeReturn:()=>({success:false})};}},
  './coopPersonalFleetOriginalSalaryTerms':{createOriginalSalaryTerms(args){
   assert.equal(args.enabled(),false);
   assert.equal(Array.isArray(args.authoredPolicies),true);
   return {readOriginalHire:()=>null,resolveNativeSalary:()=>null,
    verifyOriginalNpcService:()=>false,verifyNativeEmployer:()=>false,
    verifyNativePilotReleased:()=>false,verifyDismissalSettlement:()=>false};}},
  './coopPersonalFleetContractLifecycle':{createPersonalFleetContractLifecycle(args){
   assert.equal(args.enabled(),false);
   assert.equal(typeof args.resolveNativeSalary,'function');
   assert.equal(typeof args.notifyOriginalWallet,'function');
   assert.equal(typeof args.verifyNativeWreckLoss,'function');
   assert.equal(typeof args.serverPayrollCapability,'symbol');
   return {salary:()=>({status:'DISABLED'}),salaryServer:()=>({status:'DISABLED'}),dismiss:()=>({status:'DISABLED'}),
    loss:()=>({status:'DISABLED'}),inspect:()=>({status:'DISABLED'})};}},
  './coopPersonalFleetOriginalPayrollScheduler':{createOriginalPayrollScheduler(args){
   assert.equal(args.enabled(),false);
   assert.equal(typeof args.serverPayrollCapability,'symbol');
   assert.equal(typeof args.lifecycle.salaryServer,'function');
   return {tick:()=>({status:'PAYROLL_RECONCILED',due:0,applied:0})};}},
  './coopPersonalFleetOriginalPhysicalRecovery':{createOriginalPhysicalRecovery(args){
   assert.equal(args.enabled(),false);
   return {recover:()=>({status:'RECOVERY_OFF'})};}},
  './coopPersonalFleetOriginalStationTickDriver':{createOriginalStationTickDriver(args){
   events.push('station-tick-source');
   assert.equal(typeof args.stationDwell.sample,'function');
   assert.equal(typeof args.advanceReturn,'function');
   assert.equal(typeof args.recoverPhysical,'function');
   assert.equal(typeof args.settlePayroll,'function');
   assert.equal(args.enabled(),false);
   if(broken==='station-tick-source')throw Error('PF56_NATIVE_STATION_TICK_SOURCE_MISSING');
   return {start(){events.push('station-tick-start');
     assert.equal(events.at(-2),'chat');
     if(broken==='station-tick-start')throw Error('PF56_NATIVE_STATION_TIMER_START_FAILED');
     return true;},
    stop(){return true;},tick(){return {status:'BLOCKED'};},
    getStatus(){return {started:true,active:true};}};}},
  './coopPersonalFleetOriginalStationDwell':{createOriginalStationDwell(args){
   events.push('station-dwell');assert.equal(args.enabled(),false);
   if(broken==='station-dwell')throw Error('PF56_ORIGINAL_STATION_MONITOR_MISSING');
   return {sample:()=>({status:'BLOCKED'}),verifyStationArrival:()=>null,
     verifyContinuousDwell:()=>null,verifyOriginalDockReady:()=>false};}},
  './coopPersonalFleetOriginalOrderWitness':{createOriginalOrderWitness(){events.push('order-witness');
   if(broken==='order-witness')throw Error('ORIGINAL_ORDER_SOURCE_UNAVAILABLE');
   return {verifyNativeActor:()=>false,verifyOriginalControl:()=>false,verifyTarget:()=>false};}},
  './coopPersonalFleetOriginalWalletAuthority':{createOriginalWalletAuthority(){events.push('wallet');
   if(broken==='wallet')throw Error('PF_WALLET_SOURCE_MISSING');
   return {originalTransactionID:()=>150000001,verifyJournalID:()=>true,
    notifyOriginalWallet:()=>true,notifyOriginalSalaryWallet:()=>true};}},
  './coopPersonalFleetOriginalOfferAuthority':{createSourceBoundOriginalOfferAuthority(args){
   assert.equal(args.authoredSalaryPolicies,authoredSalaryPolicies);
   events.push('offers');return {
   resolveNativeOffer:()=>null,verifyOriginalNpcPilot:()=>false,verifyNativeEmployer:()=>false,
   listNativeOffers:()=>[],lookupNativeOffer:()=>null,verifyHiredPilotHull:()=>false,
   resolvePaidNativeProfile:()=>null};}},
  './coopPersonalFleetWorkCommandOwner':{createOriginalWorkCommandOwner(args){events.push('owner');
   assert.equal(typeof args.pf57.dismiss,'function');
   assert.equal(typeof args.pf57.salary,'function');
   assert.equal(args.enabled(),false);return {source:'ORIGINAL_EVEJS_PERSONAL_FLEET_OWNER_V1',enabled:args.enabled};}},
  './coopPersonalFleetChatGateway':{installServerAuthority(provider){events.push('chat');
   assert.equal(provider.enabled(),false);return broken==='chat'?false:true;}},
  './coopPersonalFleetHangarBridge':{readStockHangar:()=>{},createPersonalFleetHangarBridge(args){events.push('hangar');
   assert.equal(args.enabled(),false);return {execute:()=>{},inspect:()=>{}};}},
  './coopPersonalFleetPaidHiring':{createPersonalFleetPaidHiring(args){events.push('paid');
   assert.equal(args.enabled(),false);return {hire:()=>{}};}},
  './coopPersonalFleetOriginalDeployment':{createOriginalDeploymentBridge(args){events.push('deploy');
   assert.equal(args.enabled(),false);if(broken==='deploy')throw Error('NATIVE_NO_WRITER');
   return {prepare:()=>{},dispatch:()=>{},reconcile:()=>{},inspect:()=>{}};}},
  './coopPersonalFleetNativeOrders':{createPersonalFleetNativeOrders(args){events.push('orders');
   assert.equal(typeof args.verifyPersistedNativeOrder,'function');
   assert.equal(args.enabled(),false);assert.equal(args.verifyNativeActor(),false);
   assert.equal(args.verifyOriginalControl(),false);assert.equal(args.verifyTarget(),false);
   return {issue:()=>{},reconcile:()=>{},inspect:()=>{}};}},
  './coopPersonalFleetScopedDock':{createScopedDock(args){events.push('scoped-dock');
   assert.equal(typeof args.verifyOriginalDockReady,'function');
   assert.equal(args.originalItemStore,stockItemStore);
   assert.equal(args.enabled(),false);
   if(broken==='scoped-dock')throw Error('PF66_SCOPED_SOURCE_UNAVAILABLE');
   return {execute:()=>({success:false})};}},
  './coopPersonalFleetOriginalTerminalDockSources':{createOriginalTerminalDockSources(args){
   events.push('terminal-sources');
   assert.equal(args.enabled(),false);
   assert.equal(args.verifyFinalOriginalManifest,fakeFinalManifest);
   if(broken==='terminal-sources')throw Error('PF60_ORIGINAL_DOCK_SOURCE_MISSING');
   return {authenticateCommand:()=>false,verifyOriginalSceneVacant:()=>false,
     readNativeIdentity:()=>null,verifyOriginalTerminalWitness:()=>null};}},
  './coopPersonalFleetScopedNativeCleanup':{createScopedNativeCleanup(args){
   events.push('scoped-cleanup');
   assert.equal(args.nativeStore,deps['./npc/nativeNpcStore']);
   assert.equal(typeof args.verifyOriginalSceneVacant,'function');
   if(broken==='scoped-cleanup')throw Error('PF61_ORIGINAL_CLEANUP_MISSING');
   return {execute:()=>({success:false})};}},
  './coopPersonalFleetTerminalCustody':{createTerminalCustody(args){
   events.push('terminal-custody');
   assert.equal(typeof args.authenticateCommand,'function');
   assert.equal(typeof args.executeScopedNativeCleanup,'function');
   if(broken==='terminal-custody')throw Error('PF60_CUSTODY_SOURCE_MISSING');
   return {prepare:()=>{},issue:()=>{},reconcile:()=>{},finalize:()=>{},inspect:()=>{}};}},
  './coopPersonalFleetOriginalDockCoordinator':{createOriginalDockCoordinator(args){
   events.push('dock-coordinator');
   assert.equal(typeof args.scopedDock.execute,'function');
   assert.equal(typeof args.terminalCustody.reconcile,'function');
   if(broken==='dock-coordinator')throw Error('PF60_DOCK_COORDINATOR_MISSING');
   return {execute:()=>({success:false}),reconcileNativeCleanup:()=>({status:'BLOCKED'}),
    finalizeAfterPf56Dock:()=>({status:'BLOCKED'})};}},
  './coopPersonalFleetOriginalDockCompletionWitness':{createOriginalDockCompletionWitness(args){
   events.push('dock-witness');assert.equal(args.enabled(),false);
   assert.equal(args.verifyFinalOriginalManifest,fakeFinalManifest);
   if(broken==='dock-witness')throw Error('PF56_DOCK_COMPLETION_SOURCE_UNAVAILABLE');
   return {verifyOriginalDockReceipt:()=>null};}},
  './coopPersonalFleetReturnDock':{createPersonalFleetReturnDock(args){events.push('return');
   assert.equal(args.enabled(),false);
   assert.equal(typeof args.verifyOriginalReturnOrder,'function');
   assert.notEqual(args.verifyOriginalReturnOrder,hooks.verifyOriginalReturnOrder);
   assert.equal(typeof args.verifyOriginalDockReceipt,'function');
   assert.equal(typeof args.verifyServerReturnOwner,'function');
   assert.equal(typeof args.verifyStationArrival,'function');
   assert.equal(typeof args.verifyContinuousDwell,'function');
   assert.equal(typeof args.executeNativeReturn,'function');
   assert.notEqual(args.executeNativeReturn,hooks.executeNativeReturn);
   assert.equal(typeof args.executeNativeDock,'function');
   assert.notEqual(args.executeNativeDock,hooks.executeNativeDock);
   return {requestReturn:()=>{},inspect:()=>{},advanceServer:()=>({status:'BLOCKED'})};}},
  './coopPersonalFleetNativeBootstrap':{createSourceBoundNativeBootstrap(args){events.push('PF58');
   assert.equal(args.enabled(),false);assert.equal(args.atomicOriginalTransfer,true);
   assert.equal(args.originalItemStore,stockItemStore);
   if(broken==='PF58')throw Error('PF58_BINDING_FENCED');
   return {executeOriginalHandoff:()=>{}};}},
  '../services/inventory/itemStore':{findItemById:()=>null,moveShipToSpace:()=>false,dockShipToLocation:()=>false},
  './npc/nativeNpcStore':{getNativeEntity:()=>null,
   PF61_SCOPED_ORIGINAL_NATIVE_CLEANUP_V1:true,
   installScopedOriginalTerminalCleanupAuthority:()=>true,
   removeScopedPersonalFleetTerminalNativeRows:()=>({success:false})},
  './npc/nativeNpcService':{PF58_ORIGINAL_ITEMSTORE_BRIDGE_V1:true,
   PF66_SCOPED_DOCK_SCENE_DETACH_V1:true},
  './npc/npcRegistry':{getControllerByEntityID:()=>null},
  '../services/chat/sessionRegistry':{getSessions:()=>[]},
  './runtime':{scenes:new Map()}
 };
 const fakeFinalManifest=hooks.verifyFinalOriginalManifest;
 const stockItemStore=deps['../services/inventory/itemStore'];
 const ctx={module:{exports:{}},require:name=>{if(!(name in deps))throw Error('UNKNOWN_DEPENDENCY:'+name);
   return deps[name];},process,Date,console,Object,Array,Number,Set};
 vm.runInNewContext(source,ctx,{filename:file});const api=ctx.module.exports;
 try{cb({api,hooks,events,deps,setBroken:x=>broken=x,poison:()=>originalPoisoned=true});}
 finally{for(const [k,v] of prior){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
}
const authoredCatalog=[{npcCharacterID:1001,employerCorpID:1002,profileID:'real-profile',shipTypeID:600,amountCents:100}];
const authoredSalaryPolicies=[{npcCharacterID:1001,employerCorpID:1002,profileID:'real-profile',shipTypeID:600,salaryCents:25,periodMs:86400000}];
const call=(f)=>f.api.createOriginalWorkBootstrap({originalHooks:f.hooks,authoredCatalog,authoredSalaryPolicies});
test('composition builds original source owners and publishes chat LAST',()=>fixture(f=>{
 const b=call(f);assert.equal(b.status,'INSTALLED_WORK_SOURCE_BOUND');
 assert.equal(b.getOperationalStatus().ready,true);
 assert.deepEqual(f.events,['source','wallet','offers','paid','hangar','deploy','order-witness','order-ack','physical-order','station-dwell','orders','scoped-dock','terminal-sources','scoped-cleanup','terminal-custody','dock-coordinator','dock-witness','return','station-tick-source','owner','PF58','chat','station-tick-start']);
}));
test('flags OFF after install prevent action even after previously ready',()=>fixture(f=>{
 const b=call(f);delete process.env.EVEJS_COOP_PERSONAL_FLEET_CHAT;
 assert.equal(b.getOperationalStatus().ready,false);
}));
test('original reciprocal writer revocation kills ready gate',()=>fixture(f=>{
 const b=call(f);f.hooks.allWritersFenced=()=>false;
 assert.equal(b.mayEnable(),false);
}));
test('native failure before PF58 never publishes chat',()=>fixture(f=>{
 f.setBroken('deploy');assert.throws(()=>call(f),/NATIVE_NO_WRITER/);
 assert.deepEqual(f.events,['source','wallet','offers','paid','hangar','deploy']);
}));
test('PF58 source-binding failure never publishes chat',()=>fixture(f=>{
 f.setBroken('PF58');assert.throws(()=>call(f),/PF58_BINDING_FENCED/);
 assert.equal(f.events.includes('chat'),false);
}));
test('chat already installed rejects native-ready claim',()=>fixture(f=>{
 f.setBroken('chat');assert.throws(()=>call(f),/CHAT_AUTHORITY_ALREADY_INSTALLED/);
 assert.equal(f.events.at(-1),'chat');
}));
test('cannot re-bootstrap the same process after successful install',()=>fixture(f=>{
 call(f);assert.throws(()=>call(f),/ALREADY_BOOTED/);
}));
test('refuse empty fabricated operator catalog',()=>fixture(f=>{
 assert.throws(()=>f.api.createOriginalWorkBootstrap({originalHooks:f.hooks,authoredCatalog:[]}),/CATALOG_EMPTY/);
 assert.equal(f.events.length,0);
}));
test('missing original engine hooks block before imports or publication',()=>fixture(f=>{
 delete f.hooks.verifyOriginalManifest;assert.throws(()=>call(f),/BOOT_HOOKS_REQUIRED/);
 assert.equal(f.events.length,0);
}));
test('caller cannot substitute forged gameStore module',()=>fixture(f=>{
 f.hooks.gameStore={};assert.throws(()=>call(f),/MODULE_OVERRIDE_FORBIDDEN/);
 assert.equal(f.events.length,0);
}));
test('caller cannot substitute forged itemStore/sessionRegistry',()=>fixture(f=>{
 f.hooks.sessionRegistry={};assert.throws(()=>call(f),/MODULE_OVERRIDE_FORBIDDEN/);
 assert.equal(f.events.length,0);
}));
test('original writer attestation required BEFORE module creation',()=>fixture(f=>{
 f.hooks.verifyOriginalWriterHooks=()=>false;
 assert.throws(()=>call(f),/WRITER_HOOKS_NOT_INSTALLED/);
 assert.deepEqual(f.events,['source']);
}));
test('original poisoned SQLite refuses to expose game commands',()=>fixture(f=>{
 f.poison();assert.throws(()=>call(f),/STOCK_NATIVE_BRIDGE_MISSING/);
 assert.deepEqual(f.events,['source']);
}));
test('stock NPC service must be source-patched before composition',()=>fixture(f=>{
 delete f.deps['./npc/nativeNpcService'].PF58_ORIGINAL_ITEMSTORE_BRIDGE_V1;
 assert.throws(()=>call(f),/STOCK_NATIVE_BRIDGE_MISSING/);
 assert.deepEqual(f.events,['source']);
}));
test('all PF58 sources have ORIGINAL native stock singletons',()=>fixture(f=>{
 const b=call(f);assert.ok(b.originalHandoff);
}));
test('native hook catalogue keys are exact and complete',()=>fixture(f=>{
 assert.equal(f.api.HOOKS.length,hooksList.length);
 for(const name of hooksList)assert.ok([...f.api.HOOKS].includes(name));
}));

test('failed source install is sticky and cannot double-publish PF58',()=>fixture(f=>{
 f.setBroken('chat');assert.throws(()=>call(f),/CHAT_AUTHORITY_ALREADY_INSTALLED/);
 const count=f.events.length;
 assert.throws(()=>call(f),/ALREADY_BOOTED_OR_FAILED_STICKY/);
 assert.equal(f.events.length,count);
}));

test('original wallet adapter fails before PF53/PF58/partial chat install',()=>fixture(f=>{
 f.setBroken('wallet');assert.throws(()=>call(f),/PF_WALLET_SOURCE_MISSING/);
 assert.deepEqual(f.events,['source','wallet']);
 assert.throws(()=>call(f),/ALREADY_BOOTED_OR_FAILED_STICKY/);
}));

test('native PF55 physical order source failure is sticky before original PF58',()=>fixture(f=>{
 f.setBroken('order-witness');assert.throws(()=>call(f),/ORIGINAL_ORDER_SOURCE_UNAVAILABLE/);
 assert.equal(f.events.includes('PF58'),false);
 assert.equal(f.events.includes('chat'),false);
 assert.throws(()=>call(f),/ALREADY_BOOTED_OR_FAILED_STICKY/);
}));
test('PF55 physical source authority functions are NOT operator-supplied',()=>fixture(f=>{
 f.hooks.verifyNativeActor=()=>true;f.hooks.verifyTarget=()=>true;
 f.hooks.verifyOriginalControl=()=>true;
 assert.equal(call(f).status,'INSTALLED_WORK_SOURCE_BOUND');
 // Their presence on hooks is ignored; tests above assert the source-bound
 // mock's false values are still handed to the real PF55 constructor.
}));

test('real original physical order bridge not configured fails before PF58/chat',()=>fixture(f=>{
 f.setBroken('physical-order');assert.throws(()=>call(f),/SHARED_ARBITER_NOT_INSTALLED/);
 assert.equal(f.events.includes('PF58'),false);assert.equal(f.events.includes('chat'),false);
}));
test('missing source-owned shared arbiter is a hard startup error',()=>fixture(f=>{
 delete f.hooks.sharedOriginalNpcOrderArbiter;
 assert.throws(()=>call(f),/ORIGINAL_BOOT_HOOKS_REQUIRED/);
 assert.equal(f.events.length,0);
}));

test('PF55 durable post-effect proof must be source-owned and cannot be forged by originalHooks',()=>fixture(f=>{
 f.hooks.verifyPersistedNativeOrder=()=>({orderApplied:true});
 assert.equal(call(f).status,'INSTALLED_WORK_SOURCE_BOUND');
 assert.ok(f.events.indexOf('order-ack')>f.events.indexOf('order-witness'));
 assert.ok(f.events.indexOf('order-ack')<f.events.indexOf('orders'));
}));
test('missing native PF55 durable source fails sticky without publishing /pf',()=>fixture(f=>{
 f.setBroken('order-ack');assert.throws(()=>call(f),/DURABLE_ACK_ORIGINAL_SOURCE_MISSING/);
 assert.equal(f.events.includes('chat'),false);
 assert.throws(()=>call(f),/ALREADY_BOOTED_OR_FAILED_STICKY/);
}));

test('PF66 original source failure blocks /pf and remains fail-sticky',()=>fixture(f=>{
 f.setBroken('scoped-dock');assert.throws(()=>call(f),/PF66_SCOPED_SOURCE_UNAVAILABLE/);
 assert.equal(f.events.includes('return'),false);
 assert.equal(f.events.includes('PF58'),false);
 assert.throws(()=>call(f),/ALREADY_BOOTED_OR_FAILED_STICKY/);
}));
test('PF56 original independent dock readback failure blocks /pf',()=>fixture(f=>{
 f.setBroken('dock-witness');assert.throws(()=>call(f),/PF56_DOCK_COMPLETION_SOURCE_UNAVAILABLE/);
 assert.equal(f.events.includes('return'),false);
 assert.equal(f.events.includes('chat'),false);
}));
test('PF66 stock native scene-detach patch is mandatory',()=>fixture(f=>{
 delete f.deps['./npc/nativeNpcService'].PF66_SCOPED_DOCK_SCENE_DETACH_V1;
 assert.throws(()=>call(f),/STOCK_NATIVE_BRIDGE_MISSING/);
 assert.deepEqual(f.events,['source']);
}));
test('operator-supplied executeNativeDock/verifyOriginalDockReceipt cannot bypass source-bound PF66 and PF56',()=>fixture(f=>{
 f.hooks.executeNativeDock=()=>({success:true});
 f.hooks.verifyOriginalDockReceipt=()=>({status:'FAKE'});
 assert.equal(call(f).status,'INSTALLED_WORK_SOURCE_BOUND');
 assert.ok(f.events.indexOf('scoped-dock')<f.events.indexOf('return'));
 assert.ok(f.events.indexOf('dock-witness')<f.events.indexOf('return'));
}));

test('PF61 original native cleanup store patch required before all native side effects',()=>fixture(f=>{
 delete f.deps['./npc/nativeNpcStore'].PF61_SCOPED_ORIGINAL_NATIVE_CLEANUP_V1;
 assert.throws(()=>call(f),/STOCK_NATIVE_BRIDGE_MISSING/);
 assert.deepEqual(f.events,['source']);
}));
test('PF60 original custody source failure blocks /pf publication',()=>fixture(f=>{
 f.setBroken('terminal-sources');assert.throws(()=>call(f),/PF60_ORIGINAL_DOCK_SOURCE_MISSING/);
 assert.equal(f.events.includes('return'),false);assert.equal(f.events.includes('chat'),false);
}));
test('PF61 scoped cleanup source failure cannot expose a partially initialized fleet',()=>fixture(f=>{
 f.setBroken('scoped-cleanup');assert.throws(()=>call(f),/PF61_ORIGINAL_CLEANUP_MISSING/);
 assert.equal(f.events.includes('PF58'),false);
 assert.throws(()=>call(f),/ALREADY_BOOTED_OR_FAILED_STICKY/);
}));
test('PF60 terminal-custody source failure blocks PF56 and /pf',()=>fixture(f=>{
 f.setBroken('terminal-custody');assert.throws(()=>call(f),/PF60_CUSTODY_SOURCE_MISSING/);
 assert.equal(f.events.includes('return'),false);assert.equal(f.events.includes('chat'),false);
}));
test('no user-injected one-shot dock coordinator may replace the source-bound implementation',()=>fixture(f=>{
 f.hooks.scopedDock={execute:()=>({success:true})};
 f.hooks.terminalCustody={prepare:()=>({status:'PREPARED'})};
 assert.equal(call(f).status,'INSTALLED_WORK_SOURCE_BOUND');
 assert.ok(f.events.indexOf('dock-coordinator')<f.events.indexOf('return'));
}));

test('source-owned tick dwell is mandatory before PF55/PF56 and cannot publish partial /pf',()=>fixture(f=>{
 f.setBroken('station-dwell');assert.throws(()=>call(f),/ORIGINAL_STATION_MONITOR_MISSING/);
 assert.equal(f.events.includes('return'),false);assert.equal(f.events.includes('chat'),false);
 assert.throws(()=>call(f),/ALREADY_BOOTED_OR_FAILED_STICKY/);
}));
test('trusted bootstrap exports server-only tick sampling, never via in-game command provider',()=>fixture(f=>{
 const b=call(f);assert.equal(typeof b.sampleOriginalStationDwell,'function');
 assert.ok(f.events.indexOf('station-dwell')<f.events.indexOf('scoped-dock'));
}));
test('operator fake native return and arrival callbacks are ignored',()=>fixture(f=>{
 f.hooks.executeNativeReturn=()=>({success:true});
 f.hooks.verifyStationArrival=()=>({source:'FAKE'});
 f.hooks.verifyContinuousDwell=()=>({nativeMonitorPersisted:true});
 f.hooks.verifyOriginalReturnOrder=()=>({source:'FABRICATED_NATIVE_RETURN'});
 f.hooks.verifyOriginalDockReady=()=>true;
 assert.equal(call(f).status,'INSTALLED_WORK_SOURCE_BOUND');
 assert.ok(f.events.includes('station-dwell'));
}));

test('PF56 native tick constructor fails before PF58 and /pf publication',()=>fixture(f=>{
 f.setBroken('station-tick-source');assert.throws(()=>call(f),/STATION_TICK_SOURCE_MISSING/);
 assert.equal(f.events.includes('PF58'),false);assert.equal(f.events.includes('chat'),false);
}));
test('native tick starts only AFTER chat and all original source owners',()=>fixture(f=>{
 const x=call(f);assert.deepEqual(x.nativeStationTickStatus(),{started:true,active:true});
 assert.equal(f.events.at(-2),'chat');assert.equal(f.events.at(-1),'station-tick-start');
 assert.equal(typeof x.stopNativeStationTick,'function');
}));
test('failed native station timer never permits a second PF58/chat install',()=>fixture(f=>{
 f.setBroken('station-tick-start');assert.throws(()=>call(f),/STATION_TIMER_START_FAILED/);
 assert.equal(f.events.at(-2),'chat');
 assert.throws(()=>call(f),/ALREADY_BOOTED_OR_FAILED_STICKY/);
}));

test('PF87 disabled scoped SQLite source flag must disable physical Personal Fleet',()=>fixture(f=>{
 const b=call(f);delete process.env.EVEJS_COOP_PERSONAL_FLEET_ENTITY_ISOLATION;
 assert.equal(b.mayEnable(),false);
 assert.equal(b.getOperationalStatus().ready,false);
}));

test('PF91 cannot start a salary policy for an unrelated original NPC',()=>fixture(f=>{
 assert.throws(()=>f.api.createOriginalWorkBootstrap({
  originalHooks:f.hooks,authoredCatalog,
  authoredSalaryPolicies:[{...authoredSalaryPolicies[0],npcCharacterID:999999}]
 }),/SALARY_TERMS_HIRE_CATALOG_MISMATCH/);
 assert.deepEqual(f.events,[]);
}));
test('PF91 no silently zero-wage salary policy at bootstrap',()=>fixture(f=>{
 assert.throws(()=>f.api.createOriginalWorkBootstrap({
  originalHooks:f.hooks,authoredCatalog,authoredSalaryPolicies:[]
 }),/AUTHORED_NPC_SALARY_POLICY_REQUIRED/);
 assert.deepEqual(f.events,[]);
}));
