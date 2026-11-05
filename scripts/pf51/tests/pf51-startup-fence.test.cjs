'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {createStartupFence,ADMISSION,CLAIMS,WAR,SHUTDOWN,validateEvidence}=require('../native/coopPersonalFleetMiningStartupFence');
const SEP='\u001f',SYSTEM=30000144,TOKEN='lease-0123456789-abc';
const LEASE='pf44-test'+SEP+'lease';
const eHash='a'.repeat(64),cHash='b'.repeat(64),gHash='c'.repeat(64);
const evidence=(n=1)=>({version:1,status:'VERIFIED',systemID:SYSTEM,slots:Array.from({length:n},(_,i)=>({slot:i+1,miners:[100+i*2],haulers:[101+i*2],originalEntityHash:eHash,originalControllerHash:cHash,originalCargoHash:gHash}))});
function fixture({enabled=true,integrated=true,leaseState='STARTING',nativeProof=evidence(),preflight=true}={}){
 const rows=new Map();
 rows.set(CLAIMS,{version:1,claims:{},generations:{},processed:{}});
 rows.set(WAR,{version:1,ships:{},transfers:{},history:[],processed:{}});
 rows.set(LEASE,{version:1,systemID:SYSTEM,state:leaseState,token:TOKEN});
 rows.set(SHUTDOWN+SYSTEM,leaseState==='STARTING'?null:{version:1,systemID:SYSTEM,gate:{systemID:SYSTEM,state:'ACTIVE',stopPhase:'NONE',leaseToken:TOKEN,writerNames:['mining_startup']},permits:{}});
 let writes=0,preflightCalls=0,verifyCalls=0,transactions=0,failCommit=false;
 const gameStore={coopAtomicNativeRows:{isPoisoned:()=>false,transact(tables,fn){
  assert.deepEqual(tables,['corporationRuntime']);transactions++;
  const snapshot=new Map([...rows].map(([k,v])=>[k,structuredClone(v)]));
  const tx={get(t,k){assert.equal(t,'corporationRuntime');return snapshot.has(k)?structuredClone(snapshot.get(k)):null;},put(t,k,v){assert.equal(t,'corporationRuntime');writes++;snapshot.set(k,structuredClone(v));}};
  const value=fn(tx);
  if(failCommit){const error=Error('ambiguous');error.coopCommitOutcomeUnknown=true;throw error;}
  rows.clear();for(const [k,v] of snapshot)rows.set(k,v);
  return value;
 }}};
 const f=createStartupFence({gameStore,readMiningLease:(tx)=>tx.get('corporationRuntime',LEASE),
  verifyOriginalPreflight:()=>{preflightCalls++;return preflight;},
  verifyNativeStartup:()=>{verifyCalls++;return nativeProof;},
  writersIntegrated:()=>integrated,enabled:()=>enabled,clock:()=>1700000000000});
 return {rows,f,stats:()=>({writes,preflightCalls,verifyCalls,transactions}),setCommitAmbiguous:x=>{failCommit=x},gameStore};
}
const command=(fleetCount=1,operationID='pf51-op-00000001')=>({systemID:SYSTEM,fleetCount,operationID});
const admit=x=>x.f.admit(command());
const blocked=(value,pattern)=>{assert.equal(value.status,'BLOCKED');assert.match(value.reason,pattern)};
test('off means zero native transactions or writes',()=>{let x=fixture({enabled:false});assert.equal(admit(x).status,'DISABLED');assert.equal(x.stats().transactions,0);});
test('unproven reciprocal writer coverage blocks before transaction',()=>{let x=fixture({integrated:false});blocked(admit(x),/RECIPROCAL_WRITERS_UNPROVEN/);assert.equal(x.stats().transactions,0)});
test('first durable startup admission is persisted',()=>{const x=fixture();assert.equal(admit(x).status,'ADMITTED');const r=x.rows.get(ADMISSION+SYSTEM);assert.equal(r.state,'IN_FLIGHT');assert.equal(r.leaseToken,TOKEN);});
test('repeated operationID cannot spawn again',()=>{const x=fixture();admit(x);blocked(admit(x),/STARTUP_OUTCOME_UNKNOWN/);assert.equal(x.stats().writes,1);});
test('different operation ID cannot bypass crashed attempt',()=>{const x=fixture();admit(x);blocked(x.f.admit({...command(),operationID:'another-valid-operation'}),/STARTUP_OUTCOME_UNKNOWN/);});
test('no automatic expiration after arbitrarily long time',()=>{const x=fixture();admit(x);x.rows.get(ADMISSION+SYSTEM).createdAt=1;blocked(x.f.admit({...command(),operationID:'another-valid-operation'}),/STARTUP_OUTCOME_UNKNOWN/);});
test('missing PF claims must block',()=>{let x=fixture();x.rows.delete(CLAIMS);blocked(admit(x),/PF_CLAIMS_UNVERIFIED/)});
test('malformed PF claims must block',()=>{let x=fixture();x.rows.get(CLAIMS).claims['222']={entityID:222};blocked(admit(x),/PF_CLAIM_CORRUPT/)});
test('foreign PF claim in this system must block',()=>{let x=fixture();let v=x.rows.get(CLAIMS);v.generations['222']=1;v.claims['222']={entityID:222,pilotID:'coop-pilot-123',systemID:SYSTEM,ownerCharacterID:111,assignmentID:'a-1',generation:1,ownerType:'PERSONAL_FLEET'};blocked(admit(x),/PF_ACTOR_IN_SYSTEM/)});
test('WAR actor in system blocks',()=>{let x=fixture();x.rows.get(WAR).ships['333']={entityID:333,pilotID:'coop-pilot-123',systemID:SYSTEM};blocked(admit(x),/WAR_ACTOR_IN_SYSTEM/)});
test('corrupt unrelated WAR record blocks rather than ignoring',()=>{let x=fixture();x.rows.get(WAR).ships['333']={entityID:999};blocked(admit(x),/WAR_CORRUPT/)});
test('ACTIVE requires a complete shutdown gate',()=>{let x=fixture({leaseState:'ACTIVE'});x.rows.delete(SHUTDOWN+SYSTEM);blocked(admit(x),/STARTUP_GATE_UNVERIFIED/);x=fixture({leaseState:'ACTIVE'});x.rows.get(SHUTDOWN+SYSTEM).gate.state='RELEASED';blocked(admit(x),/STARTUP_GATE_UNVERIFIED/);});
test('shutdown DRAINING blocks startup',()=>{let x=fixture({leaseState:'ACTIVE'});x.rows.get(SHUTDOWN+SYSTEM).gate.stopPhase='DRAINING';blocked(admit(x),/STARTUP_GATE_UNVERIFIED/);});
test('lease fencing token mismatch blocks',()=>{let x=fixture({leaseState:'ACTIVE'});x.rows.get(LEASE).token='another-token-123456';blocked(admit(x),/STARTUP_GATE_UNVERIFIED/);});
test('missing readMiningLease callback throws on construction',()=>{assert.throws(()=>createStartupFence({gameStore:fixture().gameStore}),/AUTHORITIES_REQUIRED/)});
test('ACTIVE lease with ACTIVE gate can reserve verified restore',()=>{let x=fixture({leaseState:'ACTIVE'});assert.equal(admit(x).status,'ADMITTED');});
test('any pending writer permit blocks startup',()=>{let x=fixture({leaseState:'ACTIVE'});x.rows.get(SHUTDOWN+SYSTEM).permits['op-123456']={operationID:'op-123456',systemID:SYSTEM,leaseToken:TOKEN,state:'PENDING'};blocked(admit(x),/INFLIGHT_NATIVE_WRITE/)});
test('preflight false blocks without writing admission',()=>{let x=fixture({preflight:false});blocked(admit(x),/ORIGINAL_PREFLIGHT_NOT_PROVEN/);assert.equal(x.rows.has(ADMISSION+SYSTEM),false)});
test('same-lease verified finish persists exact original hashes',()=>{let x=fixture();admit(x);let out=x.f.finish({systemID:SYSTEM,operationID:command().operationID});assert.equal(out.status,'VERIFIED');assert.equal(x.rows.get(ADMISSION+SYSTEM).evidence.slots[0].originalCargoHash,gHash);});
test('finish is replay-safe',()=>{let x=fixture();admit(x);x.f.finish({systemID:SYSTEM,operationID:command().operationID});assert.deepEqual(x.f.finish({systemID:SYSTEM,operationID:command().operationID}),{status:'VERIFIED',operationID:command().operationID,replayed:true});});
test('wrong operation cannot finish another startup',()=>{let x=fixture();admit(x);blocked(x.f.finish({systemID:SYSTEM,operationID:'different-op-1234'}),/STARTUP_RECEIPT_NOT_FOUND/);});
test('reconcile after crash only verifies, never admits or spawns',()=>{let x=fixture();admit(x);let out=x.f.reconcile({systemID:SYSTEM});assert.equal(out.status,'VERIFIED');assert.equal(out.reconciled,true);assert.equal(x.stats().preflightCalls,1);assert.equal(x.stats().verifyCalls,1);});
test('reconcile missing admission refuses',()=>{let x=fixture();blocked(x.f.reconcile({systemID:SYSTEM}),/STARTUP_RECONCILE_UNVERIFIED/);});
test('after verified startup, repeat admission demands explicit handover',()=>{let x=fixture();admit(x);x.f.finish({systemID:SYSTEM,operationID:command().operationID});blocked(x.f.admit({...command(),operationID:'another-valid-operation'}),/PRIOR_STARTUP_REQUIRES_HANDOVER/);});
test('invalid native evidence cannot complete or clear fence',()=>{let x=fixture({nativeProof:{version:1,status:'VERIFIED',systemID:SYSTEM,slots:[]}});admit(x);blocked(x.f.finish({systemID:SYSTEM,operationID:command().operationID}),/NATIVE_EVIDENCE_UNVERIFIED/);assert.equal(x.rows.get(ADMISSION+SYSTEM).state,'IN_FLIGHT');});
test('duplicate native entity id is rejected',()=>{let e=evidence();e.slots[0].haulers=[e.slots[0].miners[0]];assert.throws(()=>validateEvidence(e,SYSTEM,1),/DUPLICATE_NATIVE_SHIP/);});
test('invalid native SHA is rejected',()=>{let e=evidence();e.slots[0].originalCargoHash='a';assert.throws(()=>validateEvidence(e,SYSTEM,1),/NATIVE_EVIDENCE_INVALID/);});
test('wrong lease after an admission prevents finish',()=>{let x=fixture();admit(x);x.rows.get(LEASE).token='different-token-1234';blocked(x.f.finish({systemID:SYSTEM,operationID:command().operationID}),/STARTUP_RECEIPT_NOT_FOUND/);});
test('commit outcome ambiguity must not report admission success',()=>{let x=fixture();x.setCommitAmbiguous(true);blocked(admit(x),/COMMIT_OUTCOME_UNKNOWN/);assert.equal(x.rows.has(ADMISSION+SYSTEM),false);});
test('poisoned store blocks without mutation',()=>{let x=fixture();x.gameStore.coopAtomicNativeRows.isPoisoned=()=>true;blocked(admit(x),/GAMESTORE_POISONED/);assert.equal(x.stats().transactions,0);});
test('invalid fleet count and systemID fail before transaction',()=>{let x=fixture();blocked(x.f.admit(command(-1)),/COMMAND_INVALID/);blocked(x.f.admit({...command(),systemID:0}),/COMMAND_INVALID/);assert.equal(x.stats().transactions,0);});
test('receipt key is stable and scoped per original system',()=>{assert.equal(ADMISSION+SYSTEM,'coop-personal-fleet\u001fmining-startup-admission-v1\u001f30000144');});

test('WAR ship with unknown system is not accepted as unrelated',()=>{let x=fixture();x.rows.get(WAR).ships['333']={entityID:333,pilotID:'coop-pilot-123'};blocked(admit(x),/WAR_LOCATION_UNPROVEN/);});
test('in-flight WAR transfer with unknown destination blocks startup',()=>{let x=fixture();x.rows.get(WAR).transfers['333']={entityID:333,pilotID:'coop-pilot-123',sourceSystemID:30000143};blocked(admit(x),/WAR_TRANSFER_LOCATION_UNPROVEN/);});
test('WAR transfer into the mining system blocks',()=>{let x=fixture();x.rows.get(WAR).transfers['333']={entityID:333,pilotID:'coop-pilot-123',sourceSystemID:30000143,destinationSystemID:SYSTEM};blocked(admit(x),/WAR_ACTOR_IN_SYSTEM/);});

test('PF44 STARTING with no PF46 gate can admit first startup',()=>{let x=fixture();assert.equal(admit(x).status,'ADMITTED');});
test('PF44 STARTING with existing ACTIVE gate blocks',()=>{let x=fixture();x.rows.set(SHUTDOWN+SYSTEM,{version:1,systemID:SYSTEM,gate:{systemID:SYSTEM,state:'ACTIVE',stopPhase:'NONE',leaseToken:TOKEN,writerNames:['mining_startup']},permits:{}});blocked(admit(x),/STARTING_HAS_FOREIGN_SHUTDOWN_GATE/);});
test('PF44 STARTING with empty gate and empty permits is safe',()=>{let x=fixture();x.rows.set(SHUTDOWN+SYSTEM,{version:1,systemID:SYSTEM,gate:null,permits:{}});assert.equal(admit(x).status,'ADMITTED');});
test('PF44 STARTING with leftover PENDING permit blocks',()=>{let x=fixture();x.rows.set(SHUTDOWN+SYSTEM,{version:1,systemID:SYSTEM,gate:null,permits:{'op-123456':{state:'PENDING'}}});blocked(admit(x),/STARTING_HAS_FOREIGN_SHUTDOWN_GATE/);});
test('PF44 STARTING to ACTIVE transition preserves token and allows verified finish',()=>{let x=fixture();admit(x);x.rows.get(LEASE).state='ACTIVE';x.rows.set(SHUTDOWN+SYSTEM,{version:1,systemID:SYSTEM,gate:{systemID:SYSTEM,state:'ACTIVE',stopPhase:'NONE',leaseToken:TOKEN,writerNames:['mining_startup']},permits:{}});assert.equal(x.f.finish({systemID:SYSTEM,operationID:command().operationID}).status,'VERIFIED');});