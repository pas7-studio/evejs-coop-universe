'use strict';
const {test}=require('node:test'),a=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../native/coopPersonalFleetOriginalSalaryTerms.js'),'utf8');
const SEP='\u001f',T='corporationRuntime',PID='coop-pilot-123456',
 CONTRACT='contract-123',OWNER=500,EMPLOYER=1002000,CREATED=1700000000000,
 PERIOD=86400000;
const terms=[{npcCharacterID:123456,employerCorpID:EMPLOYER,
 profileID:'npc-profile-123',shipTypeID:606,salaryCents:2500,periodMs:PERIOD}];
function f({authoredPolicies=terms}={}){
 let now=CREATED+5*PERIOD,enabled=true,fenced=true,
  pilotRows=[],controllerRows=[],runtimeRows=[],paidOK=true,
  characterName='Authentic NPC',definitionValid=true;
 const paid={status:'PAID',operationID:'pf-hire-1',pilotID:PID,
  ownerCharacterID:OWNER,contractID:CONTRACT,employerCorpID:EMPLOYER,
  hireReceiptHash:'a'.repeat(64),createdAtMs:CREATED};
 const idx={version:1,pilots:{[PID]:{pilotID:PID,ownerCharacterID:OWNER,
  contractID:CONTRACT,hireReceiptHash:paid.hireReceiptHash}},
  contracts:{[CONTRACT]:PID},processed:{'pf-hire-1':{
   receipt:{type:'HIRED',pilotID:PID,contractID:CONTRACT}}}};
 const ledger={version:1,contracts:{[PID]:{lastPeriod:0}}};
 const store={
  ['coop-personal-fleet'+SEP+'hangar-reservations-v1']:idx,
  ['coop-personal-fleet'+SEP+'contract-lifecycle-v1']:ledger,
  ['coop-personal-fleet'+SEP+'paid-hire-v1:pf-hire-1']:paid};
 const original={
  './coopPersonalFleetPaidHiring':{
   verifyPaidReceipt:()=>paidOK,paidKey:id=>'coop-personal-fleet'+SEP+'paid-hire-v1:'+id},
  './coopPersonalFleetHangarBridge':{REGISTRY_KEY:'coop-personal-fleet'+SEP+'hangar-reservations-v1',
   validateIndex:x=>x},
  './npc/npcData':{buildNpcDefinition:id=>definitionValid?{
   profile:{profileID:id,shipTypeID:606},loadout:{},behaviorProfile:{}}:null},
  '../services/corporation/corporationState':{
   getNpcCharacterOwnerRecord:id=>({ownerID:id,typeID:1373,ownerName:characterName}),
   getCorporationRecord:id=>({corporationID:id,isNPC:true}),
   isNpcCorporationID:id=>id===EMPLOYER},
  './npc/nativeNpcStore':{listNativeEntities:()=>pilotRows,
   listNativeControllers:()=>controllerRows},
  './npc/npcRegistry':{listControllers:()=>runtimeRows}
 };
 const m={exports:{}};
 vm.runInNewContext(source,{require:name=>{
  if(!(name in original))throw Error('UNKNOWN_ORIGINAL_SOURCE:'+name);
  return original[name];
 },module:m,exports:m.exports,Number,Object,Array,Set,Date,Math},{filename:'native-terms.js'});
 const create=()=>m.exports.createOriginalSalaryTerms({authoredPolicies,
  clock:()=>now,enabled:()=>enabled,allWritersFenced:()=>fenced});
 const tx={get:(t,k)=>t===T?store[k]??null:null};
 const c={pilotID:PID,contractID:CONTRACT,ownerCharacterID:OWNER,
  periodIndex:1,operationID:'pf-pay-1'};
 return {create,tx,c,paid,idx,ledger,store,
  setClock:x=>now=x,setEnabled:x=>enabled=x,setFenced:x=>fenced=x,
  setPaidOK:x=>paidOK=x,setCharacterName:x=>characterName=x,
  setDefinitionValid:x=>definitionValid=x,
  setPilotRows:x=>pilotRows=x,setControllerRows:x=>controllerRows=x,
  setRuntimeRows:x=>runtimeRows=x};
}
test('source wage amount, time and employer match original paid contract',()=>{
 const x=f(),m=x.create(),q=m.resolveNativeSalary(x.c,x.paid,x.tx);
 a.equal(q.source,'ORIGINAL_EVEJS_PERSONAL_NPC_SALARY_V1');
 a.equal(q.amountCents,2500);a.equal(q.dueAtMs,CREATED+PERIOD);
 a.equal(q.expiresAtMs,Number.MAX_SAFE_INTEGER);
 a.equal(m.readOriginalHire(x.c,x.tx).operationID,'pf-hire-1');
 a.equal(m.verifyOriginalNpcService(x.c,x.paid,x.tx),true);
});
test('future salary is never charged',()=>{
 const x=f();x.setClock(CREATED+PERIOD-1);
 a.equal(x.create().resolveNativeSalary(x.c,x.paid,x.tx),null);
});
test('missed periods stay individually payable after downtime',()=>{
 const x=f(),m=x.create();x.setClock(CREATED+17*PERIOD);
 a.equal(m.resolveNativeSalary({...x.c,periodIndex:16},x.paid,x.tx).periodIndex,16);
});
test('user cannot choose employer, price or foreign contract',()=>{
 const x=f(),m=x.create();
 a.equal(m.resolveNativeSalary({...x.c,contractID:'wrong',amountCents:1},x.paid,x.tx),null);
 a.equal(m.resolveNativeSalary({...x.c,pilotID:'coop-pilot-999'},x.paid,x.tx),null);
});
test('second paid hire with same pilot is ambiguous and denied',()=>{
 const x=f();x.idx.processed['pf-hire-2']={receipt:{type:'HIRED',pilotID:PID,contractID:CONTRACT}};
 a.equal(x.create().readOriginalHire(x.c,x.tx),null);
});
test('tampered paid hire cannot serve as source for new salary',()=>{
 const x=f();x.setPaidOK(false);
 a.equal(x.create().resolveNativeSalary(x.c,x.paid,x.tx),null);
});
test('unrecognized NPC or invalid native profile is denied',()=>{
 const x=f();x.setCharacterName('Entity 123456');
 a.equal(x.create().resolveNativeSalary(x.c,x.paid,x.tx),null);
 x.setCharacterName('Authentic NPC');x.setDefinitionValid(false);
 a.equal(x.create().resolveNativeSalary(x.c,x.paid,x.tx),null);
});
test('no implicit wage or zero wage configuration',()=>{
 a.throws(()=>f({authoredPolicies:[]}).create(),/SOURCE_AUTHORED_SALARY_TERMS_REQUIRED/);
 a.throws(()=>f({authoredPolicies:[{...terms[0],salaryCents:0}]}).create(),/SOURCE_AUTHORED_SALARY_TERMS_REQUIRED/);
});
test('unpaid periods prevent original employment dismissal',()=>{
 const x=f(),m=x.create();x.ledger.contracts[PID].lastPeriod=2;
 a.equal(m.verifyDismissalSettlement(x.c,x.tx),false);
 x.ledger.contracts[PID].lastPeriod=5;
 a.equal(m.verifyDismissalSettlement(x.c,x.tx),true);
});
test('native entity, durable controller or runtime controller block dismissal',()=>{
 const x=f(),m=x.create();
 a.equal(m.verifyNativePilotReleased(x.c,x.tx),true);
 x.setPilotRows([{personalFleetPilotID:PID}]);a.equal(m.verifyNativePilotReleased(x.c,x.tx),false);
 x.setPilotRows([]);x.setControllerRows([{personalFleetPilotID:PID}]);a.equal(m.verifyNativePilotReleased(x.c,x.tx),false);
 x.setControllerRows([]);x.setRuntimeRows([{personalFleetPilotID:PID}]);a.equal(m.verifyNativePilotReleased(x.c,x.tx),false);
});
test('disabled source, revoked writers cannot authorize wages or dismissal',()=>{
 const x=f(),m=x.create();x.setEnabled(false);
 a.equal(m.resolveNativeSalary(x.c,x.paid,x.tx),null);
 x.setEnabled(true);x.setFenced(false);
 a.equal(m.verifyDismissalSettlement(x.c,x.tx),false);
});
test('wage authorizer is strictly read only',()=>{
 const x=f(),m=x.create(),writes=[];
 const tx={get:(...a)=>x.tx.get(...a),put:(...a)=>writes.push(a)};
 m.readOriginalHire(x.c,tx);m.resolveNativeSalary(x.c,x.paid,tx);
 m.verifyDismissalSettlement(x.c,tx);m.verifyNativePilotReleased(x.c,tx);
 a.deepEqual(writes,[]);
});
