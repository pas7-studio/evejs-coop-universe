'use strict';
const {test}=require('node:test'),a=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,
 '../native/coopPersonalFleetOriginalWorkConfiguration.js'),'utf8');
const same=(actual,expected)=>a.deepEqual(JSON.parse(JSON.stringify(actual)),expected);
const hooks=['verifyOriginalWriterHooks','allWritersFenced','allWalletWritersFenced',
 'verifyShipAvailable','verifyRelease','verifyOriginalEquipment',
 'verifyOriginalDeploymentAuthority','verifyExclusiveOwnership',
 'verifyOriginalActor','independentOriginalActorWitness',
 'originalStationUndockPoint','originalOwnershipWitness','verifyNativeFlight',
 'verifyOriginalManifest','verifyFinalOriginalManifest',
 'verifyOriginalDockedPlayerSession','readOriginalWarShipClaim',
 'verifyNativeWreckLoss','verifyWreckAssetCustody','verifyNoCompetingOrders'];
const c={npcCharacterID:3001001,employerCorpID:1000017,
 profileID:'stock-npc-profile',shipTypeID:606,amountCents:1000};
const wage={npcCharacterID:c.npcCharacterID,employerCorpID:c.employerCorpID,
 profileID:c.profileID,shipTypeID:c.shipTypeID,
 salaryCents:125,periodMs:86400000};
function fixture({
 policy={source:'ORIGINAL_EVEJS_PERSONAL_FLEET_AUTHORED_POLICY_V1',
  catalog:[c],salaryPolicies:[wage]},writer=null,
 missingPolicy=false,missingWriters=false
}={}){
 const calls=[];
 const writerHooks=Object.fromEntries(hooks.map(k=>[k,()=>false]));
 writerHooks.source='ORIGINAL_EVEJS_PERSONAL_FLEET_BOOT_OWNER_V1';
 writerHooks.claimsPolicy={KEY:'coop-personal-fleet\u001factor-claims-v1',
  validate:()=>null,empty:()=>null};
 writerHooks.sharedOriginalNpcOrderArbiter=Object.fromEntries(
  ['issue','blocked','snapshot','retainWithNativeProof','blocksForSystem']
  .map(k=>[k,()=>null]));
 const writerOwner=writer??{source:'ORIGINAL_EVEJS_PERSONAL_FLEET_NATIVE_WRITERS_V1',
  createNativeWriterHooks:()=>writerHooks};
 const m={exports:{}},imports={
  './coopPersonalFleetOriginalWorkBootstrap':{HOOKS:hooks},
  './coopPersonalFleetOriginalAuthoredPolicy':policy,
  './coopPersonalFleetOriginalNativeWriterBoundary':writerOwner
 };
 vm.runInNewContext(source,{module:m,exports:m.exports,require:id=>{
  calls.push(id);
  if(id==='./coopPersonalFleetOriginalAuthoredPolicy'&&missingPolicy||
     id==='./coopPersonalFleetOriginalNativeWriterBoundary'&&missingWriters){
   const err=Error('missing original source');err.code='MODULE_NOT_FOUND';throw err;
  }
  if(!(id in imports))throw Error('PF102B_UNEXPECTED_IMPORT:'+id);
  return imports[id];
 },Object,Number,Set,Array,Error},{filename:'pf102b.js'});
 return {api:m.exports,calls,writerHooks,writerOwner,policy};
}
test('PF102B real source-owned config exports required original native bootstrap API',()=>{
 const f=fixture();
 a.equal(f.api.source,'ORIGINAL_EVEJS_PERSONAL_FLEET_WORK_CONFIGURATION_V1');
 a.equal(typeof f.api.loadNativeAuthoredCatalog,'function');
 a.equal(typeof f.api.loadNativeSalaryPolicies,'function');
 a.equal(typeof f.api.createNativeWriterHooks,'function');
});
test('PF102B captures identical exact native authored catalogue and salary pairs',()=>{
 const f=fixture();
 same(f.api.loadNativeAuthoredCatalog(),[c]);
 same(f.api.loadNativeSalaryPolicies(),[wage]);
});
test('PF102B caller cannot mutate cached NPC wage policy through return value',()=>{
 const f=fixture(),first=f.api.loadNativeSalaryPolicies();
 first[0].salaryCents=1;first.push({...wage,npcCharacterID:3001002});
 same(f.api.loadNativeSalaryPolicies(),[wage]);
});
test('PF102B mutable original policy cannot change after first successful snapshot',()=>{
 const p={source:'ORIGINAL_EVEJS_PERSONAL_FLEET_AUTHORED_POLICY_V1',
  catalog:[{...c}],salaryPolicies:[{...wage}]};
 const f=fixture({policy:p});f.api.loadNativeAuthoredCatalog();
 p.catalog[0].shipTypeID=123;p.salaryPolicies[0].salaryCents=1;
 same(f.api.loadNativeAuthoredCatalog(),[c]);
 same(f.api.loadNativeSalaryPolicies(),[wage]);
});
test('PF102B missing source policy is fatal with exact reason',()=>{
 const f=fixture({missingPolicy:true});
 a.throws(()=>f.api.loadNativeAuthoredCatalog(),/PF102B_SOURCE_AUTHORED_NPC_POLICY_NOT_INSTALLED/);
});
test('PF102B empty authored catalog never turns into generated hire offers',()=>{
 const f=fixture({policy:{source:'ORIGINAL_EVEJS_PERSONAL_FLEET_AUTHORED_POLICY_V1',
  catalog:[],salaryPolicies:[]}});
 a.throws(()=>f.api.loadNativeAuthoredCatalog(),/PF102B_ORIGINAL_NATIVE_POLICY_INCOMPLETE/);
});
test('PF102B forged policy provenance is rejected',()=>{
 const f=fixture({policy:{source:'REQUEST_OVERRIDE',catalog:[c],salaryPolicies:[wage]}});
 a.throws(()=>f.api.loadNativeAuthoredCatalog(),/PF102B_ORIGINAL_NATIVE_POLICY_INCOMPLETE/);
});
test('PF102B unexpected policy keys cannot provide user-controlled extras',()=>{
 const f=fixture({policy:{source:'ORIGINAL_EVEJS_PERSONAL_FLEET_AUTHORED_POLICY_V1',
  catalog:[c],salaryPolicies:[wage],url:'https://bad.invalid'}});
 a.throws(()=>f.api.loadNativeSalaryPolicies(),/PF102B_ORIGINAL_NATIVE_POLICY_INCOMPLETE/);
});
test('PF102B duplicate source NPC cannot be hired twice',()=>{
 const f=fixture({policy:{source:'ORIGINAL_EVEJS_PERSONAL_FLEET_AUTHORED_POLICY_V1',
  catalog:[c,{...c}],salaryPolicies:[wage,{...wage}]}});
 a.throws(()=>f.api.loadNativeAuthoredCatalog(),/PF102B_ORIGINAL_NPC_CATALOG_INVALID_OR_DUPLICATE/);
});
test('PF102B catalog cannot contain an arbitrary free salary override',()=>{
 const f=fixture({policy:{source:'ORIGINAL_EVEJS_PERSONAL_FLEET_AUTHORED_POLICY_V1',
  catalog:[{...c,salaryFree:true}],salaryPolicies:[wage]}});
 a.throws(()=>f.api.loadNativeAuthoredCatalog(),/PF102B_ORIGINAL_NPC_CATALOG_INVALID_OR_DUPLICATE/);
});
test('PF102B wrong employer salary is not associated with genuine NPC',()=>{
 const f=fixture({policy:{source:'ORIGINAL_EVEJS_PERSONAL_FLEET_AUTHORED_POLICY_V1',
  catalog:[c],salaryPolicies:[{...wage,employerCorpID:1234567}]}});
 a.throws(()=>f.api.loadNativeAuthoredCatalog(),/PF102B_ORIGINAL_NPC_WAGES_NOT_ONE_TO_ONE/);
});
test('PF102B negative salary and impossible pay period cannot enter original starter',()=>{
 const f=fixture({policy:{source:'ORIGINAL_EVEJS_PERSONAL_FLEET_AUTHORED_POLICY_V1',
  catalog:[c],salaryPolicies:[{...wage,salaryCents:-1}]}});
 a.throws(()=>f.api.loadNativeSalaryPolicies(),/PF102B_ORIGINAL_NPC_SALARY_POLICY_INVALID/);
 const other=fixture({policy:{source:'ORIGINAL_EVEJS_PERSONAL_FLEET_AUTHORED_POLICY_V1',
  catalog:[c],salaryPolicies:[{...wage,periodMs:0}]}});
 a.throws(()=>other.api.loadNativeSalaryPolicies(),/PF102B_ORIGINAL_NPC_SALARY_POLICY_INVALID/);
});
test('PF102B validates writer module only from original source path',()=>{
 const f=fixture();const h=f.api.createNativeWriterHooks();
 a.equal(h,f.writerHooks);
 same(f.calls,['./coopPersonalFleetOriginalWorkBootstrap',
  './coopPersonalFleetOriginalNativeWriterBoundary']);
});
test('PF102B missing original writer boundary cannot be faked',()=>{
 const f=fixture({missingWriters:true});
 a.throws(()=>f.api.createNativeWriterHooks(),/PF102B_ORIGINAL_NATIVE_WRITER_BOUNDARY_NOT_INSTALLED/);
});
test('PF102B writer factory cannot be supplied through arbitrary object source',()=>{
 const f=fixture({writer:{source:'FAKE',createNativeWriterHooks:()=>({})}});
 a.throws(()=>f.api.createNativeWriterHooks(),/PF102B_ORIGINAL_NATIVE_WRITER_BOUNDARY_INVALID/);
});
test('PF102B bogus writer hook shape cannot produce native readiness',()=>{
 const f=fixture();delete f.writerHooks.verifyOriginalEquipment;
 a.throws(()=>f.api.createNativeWriterHooks(),/PF102B_ORIGINAL_NATIVE_WRITER_HOOK_CONTRACT_INVALID/);
});
test('PF102B original claims-policy key must be exact and validated',()=>{
 const f=fixture();f.writerHooks.claimsPolicy.KEY='foreign-director';
 a.throws(()=>f.api.createNativeWriterHooks(),/PF102B_ORIGINAL_NATIVE_WRITER_HOOK_CONTRACT_INVALID/);
});
test('PF102B shared arbiter cannot be private partial substitute',()=>{
 const f=fixture();delete f.writerHooks.sharedOriginalNpcOrderArbiter.retainWithNativeProof;
 a.throws(()=>f.api.createNativeWriterHooks(),/PF102B_ORIGINAL_NATIVE_WRITER_HOOK_CONTRACT_INVALID/);
});
test('PF102B original owner cannot inject stock GameStore or native runtime',()=>{
 const f=fixture();f.writerHooks.gameStore={};
 a.throws(()=>f.api.createNativeWriterHooks(),/PF102B_ORIGINAL_NATIVE_WRITER_HOOK_CONTRACT_INVALID/);
});
test('PF102B writer declaration is not a readiness assertion',()=>{
 const f=fixture();const h=f.api.createNativeWriterHooks();
 a.equal(h.allWritersFenced(),false);
 a.equal(h.allWalletWritersFenced(),false);
 a.equal(h.verifyOriginalWriterHooks(),false);
});

/**
 * Two real checked-in modules under the same native-space module boundary.
 * The bootstrap itself is inert here: this is a startup ordering test, not
 * a claimed live GameStore/ItemStore/server/network test.
 */
function entryFixture({policy=true,writers=true,attest=true,nativeFlag='1'}={}){
 const starterSource=fs.readFileSync(path.join(__dirname,
  '../native/coopPersonalFleetOriginalWorkStarter.js'),'utf8');
 const events=[],process={env:{
  EVEJS_COOP_PERSONAL_FLEET_NATIVE:nativeFlag,
  EVEJS_COOP_PERSONAL_FLEET_CHAT:'1',
  EVEJS_COOP_PERSONAL_FLEET_ENTITY_ISOLATION:'1',
  EVEJS_COOP_NATIVE_ATOMIC_ROWS:'1'
 }};
 const owner=fixture().writerHooks;
 owner.verifyOriginalWriterHooks=()=>{events.push('writer-attest');return attest;};
 owner.allWritersFenced=()=>attest;
 owner.allWalletWritersFenced=()=>attest;
 const mConfig={exports:{}};
 const authored={source:'ORIGINAL_EVEJS_PERSONAL_FLEET_AUTHORED_POLICY_V1',
  catalog:[c],salaryPolicies:[wage]};
 const writerBoundary={source:'ORIGINAL_EVEJS_PERSONAL_FLEET_NATIVE_WRITERS_V1',
  createNativeWriterHooks:()=>{events.push('writer-hook-factory');return owner;}};
 const expectedBootstrap={HOOKS:hooks,createOriginalWorkBootstrap:()=>{
  events.push('bootstrap');
  return {status:'INSTALLED_WORK_SOURCE_BOUND',mayEnable:()=>true,
   getOperationalStatus:()=>({ready:true}),stopNativeStationTick:()=>true};
 }};
 const requireConfig=name=>{
  if(name==='./coopPersonalFleetOriginalWorkBootstrap')return expectedBootstrap;
  if(name==='./coopPersonalFleetOriginalAuthoredPolicy'){
   events.push('author-policy');
   if(!policy){const e=Error('missing authored policy');e.code='MODULE_NOT_FOUND';throw e;}
   return authored;
  }
  if(name==='./coopPersonalFleetOriginalNativeWriterBoundary'){
   events.push('native-writer-boundary');
   if(!writers){const e=Error('missing original writer source');e.code='MODULE_NOT_FOUND';throw e;}
   return writerBoundary;
  }
  throw Error('PF102B_UNEXPECTED_CONFIG_REQUIRE:'+name);
 };
 vm.runInNewContext(source,{module:mConfig,exports:mConfig.exports,
  require:requireConfig,Set,Number,Object,Array,Error},{filename:'pf102b-config.js'});
 const mStarter={exports:{}};
 vm.runInNewContext(starterSource,{module:mStarter,exports:mStarter.exports,
  require:name=>{
   if(name==='./coopPersonalFleetOriginalWorkConfiguration')return mConfig.exports;
   if(name==='./coopPersonalFleetOriginalWorkBootstrap')return expectedBootstrap;
   if(name==='./coopPersonalFleetOriginalCatalogProof')return {
    verifyOriginalCatalogAndWages:()=>{events.push('sde-and-wallet-proof');
     return {verified:true,source:'ORIGINAL_EVEJS_PF102_CATALOG_PREFLIGHT_V1',
      npcCount:1};}
   };
   throw Error('PF102B_UNEXPECTED_STARTER_IMPORT:'+name);
  },process,Number,Object,Array,Error},{filename:'pf102b-starter.js'});
 return {start:()=>mStarter.exports.bootstrapOriginalWorkFromServer(),events};
}
test('PF102B absent authored source aborts before any wallet proof or writer',()=>{
 const f=entryFixture({policy:false});
 a.throws(()=>f.start(),/PF102B_SOURCE_AUTHORED_NPC_POLICY_NOT_INSTALLED/);
 same(f.events,['author-policy']);
});
test('PF102B absent native writer source aborts after genuine catalog proof',()=>{
 const f=entryFixture({writers:false});
 a.throws(()=>f.start(),/PF102B_ORIGINAL_NATIVE_WRITER_BOUNDARY_NOT_INSTALLED/);
 same(f.events,['author-policy','sde-and-wallet-proof','native-writer-boundary']);
});
test('PF102B attestor must be active before startup claims operational',()=>{
 const f=entryFixture({attest:false});
 a.throws(()=>f.start(),/PF88_ORIGINAL_NATIVE_WRITER_FENCES_UNVERIFIED/);
 a.equal(f.events.includes('bootstrap'),false);
});
test('PF102B valid source owners enter normal bootstrap exactly once',()=>{
 const f=entryFixture();const r=f.start();
 a.equal(r.status,'ORIGINAL_WORK_READY');
 same(f.events,['author-policy','sde-and-wallet-proof',
  'native-writer-boundary','writer-hook-factory','writer-attest',
  'bootstrap']);
 a.throws(()=>f.start(),/ATTEMPTED_STICKY/);
});
test('PF102B OFF native flag does not load policies, DB proof or writers',()=>{
 const f=entryFixture({nativeFlag:'0'});
 a.throws(()=>f.start(),/REQUIRED_FLAGS_NOT_INSTALLED/);
 same(f.events,[]);
});
