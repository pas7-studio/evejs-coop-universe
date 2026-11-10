'use strict';
const {test}=require('node:test'),a=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,
 '../native/coopPersonalFleetOriginalNativeWriterBoundary.js'),'utf8');
const HOOKS=[
 'verifyOriginalWriterHooks','allWritersFenced','allWalletWritersFenced',
 'verifyShipAvailable','verifyRelease','verifyOriginalEquipment',
 'verifyOriginalDeploymentAuthority','verifyExclusiveOwnership',
 'verifyOriginalActor','independentOriginalActorWitness',
 'originalStationUndockPoint','originalOwnershipWitness','verifyNativeFlight',
 'verifyOriginalManifest','verifyFinalOriginalManifest',
 'verifyOriginalDockedPlayerSession','readOriginalWarShipClaim',
 'verifyNativeWreckLoss','verifyWreckAssetCustody','verifyNoCompetingOrders'];
function fixture({missing=false,brokenSource=false,throwingWar=false}={}){
 let claimReads=0,warCalls=0,ownerCalls=0;
 const hooks=Object.fromEntries(HOOKS.filter(x=>x!=='readOriginalWarShipClaim')
  .map(x=>[x,()=>false]));
 hooks.source='ORIGINAL_EVEJS_PERSONAL_FLEET_BOOT_OWNER_V1';
  hooks.sharedOriginalNpcOrderArbiter=Object.fromEntries(
  ['issue','blocked','snapshot','retainWithNativeProof','blocksForSystem']
  .map(x=>[x,()=>null]));
 const owners={source:brokenSource?'CLIENT_WRITER':
  'ORIGINAL_EVEJS_PERSONAL_FLEET_RECIPROCAL_WRITER_OWNERS_V1',
  createSourceOwnedWriterHooks:()=>{ownerCalls++;return hooks;}};
 const war={createOriginalWarClaim:()=>{
  warCalls++;
  if(throwingWar)throw Error('WAR_SQLITE_UNAVAILABLE');
  return {readOriginalWarShipClaim:(link)=>{claimReads++;return link?.pilotID==='coop-pilot-999'?'ASSIGNED':'UNKNOWN';}};
 }};
 const claimsPolicy={KEY:'coop-personal-fleet\u001factor-claims-v1',
  validate:raw=>raw,empty:()=>({version:1,claims:{},generations:{},processed:{}})};
 const claims={createOriginalClaimsPolicy:()=>claimsPolicy};
 const deps={
  './coopPersonalFleetOriginalWorkBootstrap':{HOOKS},
  './coopPersonalFleetOriginalWarClaim':war,
  './coopPersonalFleetOriginalClaimsPolicy':claims,
  './coopPersonalFleetOriginalReciprocalWriterOwners':owners};
 const m={exports:{}},imports=[];
 vm.runInNewContext(source,{module:m,exports:m.exports,
  require:name=>{
   imports.push(name);
   if(name==='./coopPersonalFleetOriginalReciprocalWriterOwners'&&missing){
    const err=Error('source missing');err.code='MODULE_NOT_FOUND';throw err;
   }
   if(!(name in deps))throw Error('PF103_UNKNOWN_DEP:'+name);
   return deps[name];
  },Object,Array,Error},{filename:'pf103-boundary.js'});
 return {api:m.exports,hooks,owners,war,claimsPolicy,imports,claimReads:()=>claimReads,
  warCalls:()=>warCalls,ownerCalls:()=>ownerCalls};
}
test('PF103 boundary has fixed source identity required by PF102B',()=>{
 const f=fixture();
 a.equal(f.api.source,'ORIGINAL_EVEJS_PERSONAL_FLEET_NATIVE_WRITERS_V1');
 a.equal(typeof f.api.createNativeWriterHooks,'function');
});
test('PF103 missing real reciprocal writer owners must fail before constructing WAR claim',()=>{
 const f=fixture({missing:true});
 a.throws(()=>f.api.createNativeWriterHooks(),
  /PF103_ORIGINAL_RECIPROCAL_WRITER_OWNERS_NOT_INSTALLED/);
 a.equal(f.warCalls(),0);
});
test('PF103 never accepts a fake reciprocal writer source',()=>{
 const f=fixture({brokenSource:true});
 a.throws(()=>f.api.createNativeWriterHooks(),
  /PF103_ORIGINAL_WRITER_OWNER_SOURCE_INVALID/);
 a.equal(f.ownerCalls(),0);
});
test('PF103 source owners must provide every real physical authority',()=>{
 const f=fixture();delete f.hooks.verifyExclusiveOwnership;
 a.throws(()=>f.api.createNativeWriterHooks(),
  /PF103_ORIGINAL_RECIPROCAL_WRITERS_INCOMPLETE/);
 a.equal(f.warCalls(),0);
});
test('PF103 rejects original owner attempting to bypass its WAR witness',()=>{
 const f=fixture();f.hooks.readOriginalWarShipClaim=()=> 'UNASSIGNED';
 a.throws(()=>f.api.createNativeWriterHooks(),
  /PF103_ORIGINAL_RECIPROCAL_WRITERS_INCOMPLETE/);
 a.equal(f.warCalls(),0);
});
test('PF105 original owner is forbidden to inject another actor claims parser',()=>{
 const f=fixture();f.hooks.claimsPolicy={KEY:'coop-personal-fleet\u001factor-claims-v1',
  validate:()=>({}),empty:()=>({})};
 a.throws(()=>f.api.createNativeWriterHooks(),
  /PF103_ORIGINAL_RECIPROCAL_WRITERS_INCOMPLETE/);
});
test('PF105 native boundary uses identical canonical original PF58 claims policy',()=>{
 const f=fixture(),h=f.api.createNativeWriterHooks();
 a.equal(h.claimsPolicy,f.claimsPolicy);
 a.equal(h.claimsPolicy.KEY,'coop-personal-fleet\u001factor-claims-v1');
});
test('PF103 requires original shared arbiter with native retain',()=>{
 const f=fixture();delete f.hooks.sharedOriginalNpcOrderArbiter.retainWithNativeProof;
 a.throws(()=>f.api.createNativeWriterHooks(),
  /PF103_ORIGINAL_RECIPROCAL_WRITERS_INCOMPLETE/);
});
test('PF103 denies module replacement of original ItemStore',()=>{
 const f=fixture();f.hooks.stockItemStore={};
 a.throws(()=>f.api.createNativeWriterHooks(),
  /PF103_ORIGINAL_RECIPROCAL_WRITERS_INCOMPLETE/);
});
test('PF103 real original WAR claim source is installed instead of owner fake',()=>{
 const f=fixture(),result=f.api.createNativeWriterHooks();
 a.equal(result.source,'ORIGINAL_EVEJS_PERSONAL_FLEET_BOOT_OWNER_V1');
 a.equal(result.readOriginalWarShipClaim({pilotID:'coop-pilot-999'}),'ASSIGNED');
 a.equal(result.readOriginalWarShipClaim({pilotID:'other'}),'UNKNOWN');
 a.equal(f.claimReads(),2);
 a.equal(f.warCalls(),1);
});
test('PF103 native reciprocal owners do not gain write ability through claim API',()=>{
 const f=fixture(),result=f.api.createNativeWriterHooks();
 a.equal(Object.isFrozen(result),true);
 a.equal(result.sharedOriginalNpcOrderArbiter,f.hooks.sharedOriginalNpcOrderArbiter);
 a.equal(result.verifyOriginalWriterHooks(),false);
 a.equal(result.allWritersFenced(),false);
 a.equal(result.allWalletWritersFenced(),false);
});
test('PF103 thrown original WAR source denies readiness (not synthetic empty)',()=>{
 const f=fixture({throwingWar:true});
 a.throws(()=>f.api.createNativeWriterHooks(),/WAR_SQLITE_UNAVAILABLE/);
});
test('PF103 WAR binding cannot be installed before real source owner validation',()=>{
 const f=fixture();f.hooks.source='FAKE';
 a.throws(()=>f.api.createNativeWriterHooks(),
  /PF103_ORIGINAL_RECIPROCAL_WRITERS_INCOMPLETE/);
 a.equal(f.warCalls(),0);
});
