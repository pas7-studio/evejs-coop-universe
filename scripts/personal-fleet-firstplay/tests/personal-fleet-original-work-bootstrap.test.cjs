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
 'originalStationUndockPoint','originalOwnershipWitness','verifyNativeActor',
 'verifyTarget','verifyOriginalControl','verifyPersistedNativeOrder',
 'verifyNativeFlight','verifyOriginalReturnOrder','verifyStationArrival',
 'verifyContinuousDwell','verifyOriginalManifest','verifyOriginalDockReceipt',
 'verifyFinalOriginalManifest','executeNativeReturn','executeNativeDock',
 'verifyOriginalDockedPlayerSession'];
function fixture(cb){
 const flags=['EVEJS_COOP_PERSONAL_FLEET_NATIVE','EVEJS_COOP_PERSONAL_FLEET_CHAT','EVEJS_COOP_NATIVE_ATOMIC_ROWS'];
 const prior=flags.map(k=>[k,process.env[k]]);for(const k of flags)process.env[k]='1';
 const events=[];const supplied={};const hooks={source:'ORIGINAL_EVEJS_PERSONAL_FLEET_BOOT_OWNER_V1',
   claimsPolicy:{KEY:'coop-personal-fleet\u001factor-claims-v1',validate:x=>x,empty:()=>({})},
   originalOrderExecutor:{execute:()=>({success:false}),supports:()=>true}};
 for(const name of hooksList)hooks[name]=()=>true;
 let broken='',originalPoisoned=false;
 const gameStore={coopAtomicNativeRows:{mode:'SERVER_INTERNAL_FLAGGED',transact:()=>{},isPoisoned:()=>originalPoisoned}};
 const deps={
  './coopPersonalFleetOriginalSourceBindings':{createOriginalSourceBindings(){events.push('source');
   return {gameStore,access:{isOwner:()=>false},resolveOwnerCorporation:()=>1,
    resolveOriginalDockContext:()=>null,resolveOriginalFollowTarget:()=>null};}},
  './coopPersonalFleetOriginalWalletAuthority':{createOriginalWalletAuthority(){events.push('wallet');
   if(broken==='wallet')throw Error('PF_WALLET_SOURCE_MISSING');
   return {originalTransactionID:()=>150000001,verifyJournalID:()=>true,notifyOriginalWallet:()=>true};}},
  './coopPersonalFleetOriginalOfferAuthority':{createSourceBoundOriginalOfferAuthority(){events.push('offers');return {
   resolveNativeOffer:()=>null,verifyOriginalNpcPilot:()=>false,verifyNativeEmployer:()=>false,
   listNativeOffers:()=>[],lookupNativeOffer:()=>null,verifyHiredPilotHull:()=>false,
   resolvePaidNativeProfile:()=>null};}},
  './coopPersonalFleetWorkCommandOwner':{createOriginalWorkCommandOwner(args){events.push('owner');
   assert.equal(args.pf57.dismiss().status,'BLOCKED');
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
   assert.equal(args.enabled(),false);return {issue:()=>{},reconcile:()=>{},inspect:()=>{}};}},
  './coopPersonalFleetReturnDock':{createPersonalFleetReturnDock(args){events.push('return');
   assert.equal(args.enabled(),false);return {requestReturn:()=>{},inspect:()=>{}};}},
  './coopPersonalFleetNativeBootstrap':{createSourceBoundNativeBootstrap(args){events.push('PF58');
   assert.equal(args.enabled(),false);assert.equal(args.atomicOriginalTransfer,true);
   assert.equal(args.originalItemStore,stockItemStore);
   if(broken==='PF58')throw Error('PF58_BINDING_FENCED');
   return {executeOriginalHandoff:()=>{}};}},
  '../services/inventory/itemStore':{findItemById:()=>null,moveShipToSpace:()=>false},
  './npc/nativeNpcStore':{getNativeEntity:()=>null},
  './npc/nativeNpcService':{PF58_ORIGINAL_ITEMSTORE_BRIDGE_V1:true},
  './npc/npcRegistry':{getControllerByEntityID:()=>null},
  '../services/chat/sessionRegistry':{getSessions:()=>[]},
  './runtime':{scenes:new Map()}
 };
 const stockItemStore=deps['../services/inventory/itemStore'];
 const ctx={module:{exports:{}},require:name=>{if(!(name in deps))throw Error('UNKNOWN_DEPENDENCY:'+name);
   return deps[name];},process,Date,console,Object,Array,Number,Set};
 vm.runInNewContext(source,ctx,{filename:file});const api=ctx.module.exports;
 try{cb({api,hooks,events,deps,setBroken:x=>broken=x,poison:()=>originalPoisoned=true});}
 finally{for(const [k,v] of prior){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
}
const authoredCatalog=[{npcCharacterID:1001,employerCorpID:1002,profileID:'real-profile',shipTypeID:600,amountCents:100}];
const call=(f)=>f.api.createOriginalWorkBootstrap({originalHooks:f.hooks,authoredCatalog});
test('composition builds original source owners and publishes chat LAST',()=>fixture(f=>{
 const b=call(f);assert.equal(b.status,'INSTALLED_WORK_SOURCE_BOUND');
 assert.equal(b.getOperationalStatus().ready,true);
 assert.deepEqual(f.events,['source','wallet','offers','paid','hangar','deploy','orders','return','owner','PF58','chat']);
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
 delete f.hooks.executeNativeDock;assert.throws(()=>call(f),/BOOT_HOOKS_REQUIRED/);
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
