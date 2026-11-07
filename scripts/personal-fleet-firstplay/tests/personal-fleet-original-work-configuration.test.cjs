'use strict';
const {test}=require('node:test'),a=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,
 '../native/coopPersonalFleetOriginalWorkConfiguration.js'),'utf8');
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
 a.deepEqual(f.api.loadNativeAuthoredCatalog(),[c]);
 a.deepEqual(f.api.loadNativeSalaryPolicies(),[wage]);
});
test('PF102B caller cannot mutate cached NPC wage policy through return value',()=>{
 const f=fixture(),first=f.api.loadNativeSalaryPolicies();
 first[0].salaryCents=1;first.push({...wage,npcCharacterID:3001002});
 a.deepEqual(f.api.loadNativeSalaryPolicies(),[wage]);
});
test('PF102B mutable original policy cannot change after first successful snapshot',()=>{
 const p={source:'ORIGINAL_EVEJS_PERSONAL_FLEET_AUTHORED_POLICY_V1',
  catalog:[{...c}],salaryPolicies:[{...wage}]};
 const f=fixture({policy:p});f.api.loadNativeAuthoredCatalog();
 p.catalog[0].shipTypeID=123;p.salaryPolicies[0].salaryCents=1;
 a.deepEqual(f.api.loadNativeAuthoredCatalog(),[c]);
 a.deepEqual(f.api.loadNativeSalaryPolicies(),[wage]);
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
 a.deepEqual(f.calls,['./coopPersonalFleetOriginalWorkBootstrap',
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
