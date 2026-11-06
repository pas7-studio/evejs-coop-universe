'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createPermitVerifier,validateOriginalClaimsIndex}=require('../../pf58/native/coopPersonalFleetOriginalNativePermit.cjs');
const P='coop-personal-fleet\u001f';
const E={personalFleetOriginal:true,entityID:4101,systemID:30000142,ownerID:901,
 typeID:606,personalFleetGeneration:2,personalFleetAssignmentID:'assignment-pf65',
 personalFleetPilotID:'coop-pilot-123'};
const claim=(ship=E.entityID,pilot=E.personalFleetPilotID,overrides={})=>({
 entityID:ship,pilotID:pilot,ownerCharacterID:E.ownerID,systemID:E.systemID,
 assignmentID:E.personalFleetAssignmentID,generation:4,ownerType:'PERSONAL_FLEET',
 ...overrides});
const empty=()=>({version:1,claims:{},generations:{},processed:{}});
const populated=()=>{const r=empty();r.claims[String(E.entityID)]=claim();r.generations[String(E.entityID)]=4;return r;};
function fixture(phase='ISSUING',root=empty()){
 const state=new Map();let enabled=true,writers=true,poisoned=false,failRead=false;
 const put=(t,k,v)=>state.set(t+'|'+k,v);
 put('corporationRuntime',P+'deploy-v1:'+E.personalFleetAssignmentID,{
  phase,assignmentID:E.personalFleetAssignmentID,shipItemID:E.entityID,
  ownerCharacterID:E.ownerID,systemID:E.systemID,typeID:E.typeID,
  pilotID:E.personalFleetPilotID,generation:E.personalFleetGeneration,
  actorGeneration:4,dispatchCount:1});
 put('corporationRuntime',P+'handoff-v1:'+E.personalFleetAssignmentID,{
  status:'CONSUMED',version:1,assignmentID:E.personalFleetAssignmentID,
  shipItemID:E.entityID,ownerCharacterID:E.ownerID,pilotID:E.personalFleetPilotID,
  generation:E.personalFleetGeneration,sourcePF54Hash:'hash-1'});
 put('corporationRuntime',P+'handoff-ship-v1:'+E.entityID,{
  assignmentID:E.personalFleetAssignmentID,sourcePF54Hash:'hash-1'});
 put('items','items',{[String(E.entityID)]:{
  itemID:E.entityID,ownerID:E.ownerID,typeID:E.typeID,categoryID:6,
  flagID:0,locationID:E.systemID,spaceState:{systemID:E.systemID}}});
 put('corporationRuntime',P+'actor-claims-v1',root);
 let count=0,reads=[];
 const gameStore={coopAtomicNativeRows:{mode:'SERVER_INTERNAL_FLAGGED',isPoisoned:()=>poisoned,
  transact(tables,fn){count++;assert.deepEqual(tables,['corporationRuntime','items']);
   return fn({get(t,k){reads.push([t,k]);return failRead?undefined:state.get(t+'|'+k);}});}}};
 const verifier=createPermitVerifier({gameStore,enabled:()=>enabled,allWritersFenced:()=>writers});
 return {state,put,verifier,entity:{...E},get reads(){return reads;},get count(){return count;},
  setEnabled(v){enabled=v;},setWriters(v){writers=v;},setPoison(v){poisoned=v;},setFailRead(v){failRead=v;}};
}
const check=(f,allowIssuing=true)=>f.verifier.verify({entityRecord:f.entity,allowIssuing});
test('PF65 initial ISSUING with validated empty claims permits the exact original ship',()=>{
 const f=fixture();assert.equal(check(f),true);assert.equal(check(f,false),false);
});
test('PF65 proven absent claims row permits first single-flight ISSUING only',()=>{
 const f=fixture('ISSUING',null);assert.equal(check(f),true);
 const active=fixture('ACTIVE',null);assert.equal(check(active,false),false);
});
test('PF65 valid ACTIVE actor claim permits native reload, never initial ISSUING',()=>{
 const f=fixture('ACTIVE',populated());assert.equal(check(f,false),true);
 const early=fixture('ISSUING',populated());assert.equal(check(early),false);
});
test('PF65 actor claim belonging to same pilot on another ship blocks new ISSUING',()=>{
 const r=empty(),other=4200;r.claims[other]=claim(other);r.generations[other]=4;
 const f=fixture('ISSUING',r);assert.equal(check(f),false);
});
test('PF65 actor claim for another pilot on another ship is compatible',()=>{
 const r=empty(),other=4200;r.claims[other]=claim(other,'coop-pilot-999');r.generations[other]=4;
 assert.equal(check(fixture('ISSUING',r)),true);
});
test('PF65 malformed claim root (absent fields/version/bad type) never interpreted as empty',()=>{
 for(const r of [{version:1,claims:{}},{version:0,claims:{},generations:{},processed:{}},
  {version:1,claims:[],generations:{},processed:{}},
  {version:1,claims:{},generations:null,processed:{}},
  {version:1,claims:{},generations:{},processed:[]},'invalid',false,42]){
   assert.equal(check(fixture('ISSUING',r)),false,JSON.stringify(r));
 }
});
test('PF65 undefined unreadable registry is fail-closed',()=>{
 const f=fixture();f.put('corporationRuntime',P+'actor-claims-v1',undefined);
 assert.equal(check(f),false);
});
test('PF65 malformed unrelated ship claim blocks issuance',()=>{
 const r=empty();r.claims['9999']={pilotID:'coop-pilot-456'};r.generations['9999']=3;
 assert.equal(check(fixture('ISSUING',r)),false);
});
test('PF65 rejects duplicate claims for the same pilot',()=>{
 const r=populated();r.claims['4102']=claim(4102);r.generations['4102']=4;
 assert.equal(check(fixture('ACTIVE',r),false),false);
});
test('PF65 rejects noncanonical entity keys, corrupt generation, bad receipts',()=>{
 const variants=[];
 let a=populated();a.claims['04101']=a.claims['4101'];delete a.claims['4101'];variants.push(a);
 a=populated();a.generations['4101']=3;variants.push(a);
 a=populated();a.generations['bad']=4;variants.push(a);
 a=populated();a.processed['tx-1']={signature:33,receipt:{}};variants.push(a);
 a=populated();a.processed['tx-1']={signature:'sig'};variants.push(a);
 a=populated();a.claims['4101'].ownerType='PIRATE';variants.push(a);
 for(const r of variants)assert.equal(check(fixture('ACTIVE',r),false),false);
});
test('PF65 ACTIVE claim exact identity and actor generation are mandatory',()=>{
 for(const bad of [{ownerID:999},{typeID:607},
  {personalFleetAssignmentID:'assignment-other'},{personalFleetGeneration:3}]){
  const f=fixture('ACTIVE',populated());f.entity={...f.entity,...bad};assert.equal(check(f,false),false);
 }
 const f=fixture('ACTIVE',populated());
 const dep=f.state.get('corporationRuntime|'+P+'deploy-v1:'+E.personalFleetAssignmentID);
 f.put('corporationRuntime',P+'deploy-v1:'+E.personalFleetAssignmentID,{...dep,actorGeneration:7});
 assert.equal(check(f,false),false);
 f.put('corporationRuntime',P+'deploy-v1:'+E.personalFleetAssignmentID,dep);
 let r=populated();r.claims['4101'].generation=5;r.generations['4101']=5;
 f.put('corporationRuntime',P+'actor-claims-v1',r);assert.equal(check(f,false),false);
});
test('PF65 missing or mismatched stock hull denies before claim authorization',()=>{
 const f=fixture();f.put('items','items',{[String(E.entityID)]:{ownerID:E.ownerID}});
 assert.equal(check(f),false);
});
test('PF65 original consumed handoff and ship lease remain mandatory',()=>{
 const f=fixture();f.put('corporationRuntime',P+'handoff-ship-v1:'+E.entityID,null);
 assert.equal(check(f),false);
});
test('PF65 disabled, unfenced or poisoned original GameStore never issues a permit',()=>{
 const f=fixture();f.setEnabled(false);assert.equal(check(f),false);
 f.setEnabled(true);f.setWriters(false);assert.equal(check(f),false);
 f.setWriters(true);f.setPoison(true);assert.equal(check(f),false);
 assert.equal(f.count,0);
});
test('PF65 uncertain original atomic read never returns allow',()=>{
 const f=fixture();f.setFailRead(true);assert.equal(check(f),false);
});
test('PF65 corrupt claims index validation matches all canonical receipt limits',()=>{
 let r=empty();for(let i=0;i<1025;i++)r.processed['r-'+i]={signature:'x',receipt:{}};
 assert.equal(validateOriginalClaimsIndex(r),null);
 r=empty();r.generations['1']=1;assert.deepEqual(validateOriginalClaimsIndex(r),r);
});
