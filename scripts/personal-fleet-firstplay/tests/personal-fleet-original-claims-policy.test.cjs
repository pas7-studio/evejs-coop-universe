'use strict';
const {test}=require('node:test'),a=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
// This is the ACTUAL PF58 original native permit code installed in EveJS by
// PF80, not a reimplementation or a custom authorization callback.
const stock=require('../../pf58/native/coopPersonalFleetOriginalNativePermit.cjs');
const text=fs.readFileSync(path.join(__dirname,
 '../native/coopPersonalFleetOriginalClaimsPolicy.js'),'utf8');
const KEY='coop-personal-fleet\u001factor-claims-v1';
function fixture(permit=stock){
 const m={exports:{}},imports=[];
 vm.runInNewContext(text,{module:m,exports:m.exports,require:name=>{
  imports.push(name);
  if(name!=='./coopPersonalFleetOriginalNativePermit')
   throw Error('PF105_UNEXPECTED_IMPORT:'+name);
  return permit;
 },Object,Array,Error},{filename:'pf105-claims.js'});
 return {policy:()=>m.exports.createOriginalClaimsPolicy(),imports};
}
const actor=(id=2501,pilot='coop-pilot-3011234')=>({
 entityID:id,pilotID:pilot,ownerCharacterID:500,
 systemID:30000142,assignmentID:'pf-assignment-1',
 generation:1,ownerType:'PERSONAL_FLEET'
});
const cloned=x=>JSON.parse(JSON.stringify(x));
test('PF105 original PF58 NativePermit parser is loaded, not a synthetic claims policy',()=>{
 const f=fixture(),p=f.policy();
 a.equal(p.KEY,KEY);
 a.deepEqual(f.imports,['./coopPersonalFleetOriginalNativePermit']);
 a.equal(Object.isFrozen(p),true);
});
test('PF105 original PF58 null durable source is proven empty',()=>{
 const p=fixture().policy();
 a.deepEqual(cloned(p.validate(null)),
  {version:1,claims:{},generations:{},processed:{}});
});
test('PF105 empty() matches actual PF58 validator and remains a fresh writable row',()=>{
 const p=fixture().policy(),a1=p.empty(),a2=p.empty();
 a.notEqual(a1,a2);
 a.deepEqual(cloned(a1),cloned(p.validate(null)));
 a.equal(Object.isFrozen(a1),false);
});
test('PF105 original GameStore undefined read is uncertain, never a free claim',()=>{
 const p=fixture().policy();
 a.throws(()=>p.validate(undefined),/PF105_ORIGINAL_ACTOR_CLAIM_READ_UNCERTAIN/);
});
test('PF105 malformed claims row is rejected by canonical PF58 parser',()=>{
 const p=fixture().policy();
 a.throws(()=>p.validate({version:1,claims:[],generations:{},processed:{}}),
  /PF105_ORIGINAL_ACTOR_CLAIMS_INVALID/);
});
test('PF105 canonical native PF58 accepts genuine one-ship active claim',()=>{
 const p=fixture().policy(),row=p.empty();
 row.claims['2501']=actor();
 row.generations['2501']=1;
 a.equal(p.validate(row),row);
});
test('PF105 canonical PF58 denies duplicate hired pilot across two native ships',()=>{
 const p=fixture().policy(),row=p.empty();
 row.claims['2501']=actor();
 row.claims['2502']=actor(2502);
 row.generations['2501']=1;
 row.generations['2502']=1;
 a.throws(()=>p.validate(row),/PF105_ORIGINAL_ACTOR_CLAIMS_INVALID/);
});
test('PF105 canonical PF58 denies a WAR actor posing as Personal Fleet',()=>{
 const p=fixture().policy(),row=p.empty();
 row.claims['2501']={...actor(),ownerType:'WAR'};
 row.generations['2501']=1;
 a.throws(()=>p.validate(row),/PF105_ORIGINAL_ACTOR_CLAIMS_INVALID/);
});
test('PF105 canonical PF58 refuses claim generation greater than original ledger',()=>{
 const p=fixture().policy(),row=p.empty();
 row.claims['2501']=actor();
 row.generations['2501']=0;
 a.throws(()=>p.validate(row),/PF105_ORIGINAL_ACTOR_CLAIMS_INVALID/);
});
test('PF105 canonical PF58 refuses inauthentic native ship item key',()=>{
 const p=fixture().policy(),row=p.empty();
 row.claims['02501']=actor();
 row.generations['02501']=1;
 a.throws(()=>p.validate(row),/PF105_ORIGINAL_ACTOR_CLAIMS_INVALID/);
});
test('PF105 claim snapshot is never silently repaired or modified on rejection',()=>{
 const p=fixture().policy(),row=p.empty();
 row.claims['2501']={...actor(),ownerType:'FOREIGN'};
 row.generations['2501']=1;
 const before=JSON.stringify(row);
 a.throws(()=>p.validate(row),/PF105_ORIGINAL_ACTOR_CLAIMS_INVALID/);
 a.equal(JSON.stringify(row),before);
});
test('PF105 rejects unexpected runtime permits without original validation source',()=>{
 const f=fixture({});
 a.throws(()=>f.policy(),/PF105_ORIGINAL_PF58_CLAIM_VALIDATOR_NOT_INSTALLED/);
});
test('PF105 rejects altered original PF58 null schema at startup',()=>{
 const f=fixture({validateOriginalClaimsIndex:()=>({version:1,claims:{bad:true},generations:{},processed:{}})});
 a.throws(()=>f.policy(),/PF105_ORIGINAL_PF58_EMPTY_CLAIMS_SCHEMA_CHANGED/);
});
test('PF105 stock actor parser does not itself write to original GameStore',()=>{
 const p=fixture().policy(),a1=p.empty();
 a.equal(p.validate(a1),a1);
 a.equal(Object.keys(a1.claims).length,0);
});
