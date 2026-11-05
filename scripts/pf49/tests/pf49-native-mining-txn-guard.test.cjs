"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {execFileSync} = require('node:child_process');
const {assertMiningWriteAuthorized: guard,CLAIMS,SHUTDOWN,PERMIT,WAR} =
  require('../native/coopPersonalFleetMiningTxnGuard.js');
const sys = 30000144, ship = 987001;
const opKey = 'coopMiningCycle:'+'a'.repeat(64);
const tok = 'mining-token-0000000001';
function fixture(){
  const permit = {systemID:sys,leaseToken:tok,writer:'mining_cycle',operationID:opKey,
    state:'PENDING',attemptID:null,createdAt:1};
  const rows = {
    [CLAIMS]:{version:1,claims:{},generations:{},processed:{}},
    [WAR]:null,
    [SHUTDOWN+sys]:{version:1,systemID:sys,gate:{systemID:sys,state:'ACTIVE',stopPhase:'NONE',
      leaseToken:tok,writerNames:['mining_cycle','shutdown_cleanup']},permits:{[opKey]:permit}},
    [PERMIT+opKey]:structuredClone(permit),
  };
  let reads=0, writes=0;
  const tx={
    get(table,key){reads++;assert.equal(table,'corporationRuntime');
      return Object.prototype.hasOwnProperty.call(rows,key)?structuredClone(rows[key]):null;},
    put(){writes++;throw Error('SHOULD_NOT_WRITE');},
  };
  const readLease=()=>({systemID:sys,state:'ACTIVE',token:tok});
  const run=()=>guard(tx,{systemID:sys,shipID:ship,opKey},readLease);
  return {rows,tx,readLease,run,stats:()=>({reads,writes})};
}
function fail(name, mutate, reason){
  test(name,()=>{const f=fixture();mutate(f);assert.throws(f.run,new RegExp('PF49_'+reason));
    assert.equal(f.stats().writes,0);});
}
test('healthy original active lease + PF46 pending permit grants read-only audit',()=>{
  const f=fixture();assert.equal(f.run(),true);assert.equal(f.stats().reads,4);assert.equal(f.stats().writes,0);
});
test('does not authorize an out-of-transaction or invalid command context',()=>{
  assert.throws(()=>guard(),/PF49_ATOMIC_TX_MISSING/);
  assert.throws(()=>guard({get:()=>null},{systemID:sys,shipID:ship,opKey}),/PF49_PF44_LEASE_READER_UNBOUND/);
  const f=fixture();assert.throws(()=>guard(f.tx,{systemID:0,shipID:ship,opKey},f.readLease),/PF49_SCOPE_INVALID/);
  assert.throws(()=>guard(f.tx,{systemID:sys,shipID:ship,opKey:'bad'},f.readLease),/PF49_SCOPE_INVALID/);
});
fail('missing PF claim registry',f=>{delete f.rows[CLAIMS];},'CLAIMS_UNPROVEN');
fail('unversioned PF claim registry',f=>{f.rows[CLAIMS].version=2;},'CLAIMS_UNPROVEN');
fail('malformed generations',f=>{f.rows[CLAIMS].generations['1']=0;},'CLAIM_GENERATION_CORRUPT');
fail('malformed processed receipt',f=>{f.rows[CLAIMS].processed.foo={signature:'x'};},'CLAIM_RECEIPT_CORRUPT');
function putClaim(f,id,s=30000148){f.rows[CLAIMS].generations[String(id)]=1;
 f.rows[CLAIMS].claims[String(id)]={entityID:id,systemID:s,pilotID:'coop-pilot-123',ownerType:'PERSONAL_FLEET',
 ownerCharacterID:123,assignmentID:'fleet-001',generation:1};}
fail('PF claim in same solar system blocks',f=>putClaim(f,ship+1,sys),'PERSONAL_FLEET_ACTOR_RESERVED');
fail('PF claim for same original entity blocks even if system different',f=>putClaim(f,ship),'PERSONAL_FLEET_ACTOR_RESERVED');
fail('foreign unrelated claim does not spoil other systems',f=>{putClaim(f,ship+1);f.rows[CLAIMS].claims[String(ship+1)].ownerCharacterID=0;},'CLAIM_CORRUPT');
test('a valid claim in another system does not claim this miner',()=>{let f=fixture();putClaim(f,ship+1);assert.equal(f.run(),true);});
fail('WAR registry malformed blocks',f=>{f.rows[WAR]={version:1,ships:[]};},'WAR_ROW_CORRUPT');
fail('WAR reserved original ship blocks',f=>{f.rows[WAR]={version:1,ships:{[ship]:{entityID:ship,pilotID:'coop-pilot-993'}}};},'WAR_SHIP_RESERVED');
fail('WAR malformed unrelated row blocks',f=>{f.rows[WAR]={version:1,ships:{'x':{entityID:100,pilotID:'coop-pilot-993'}}};},'WAR_SHIP_CORRUPT');
fail('startup phase not active',f=>{f.rows[SHUTDOWN+sys].gate.state='DRAINING';},'MINING_GATE_NOT_ACTIVE');
fail('verifying phase not active',f=>{f.rows[SHUTDOWN+sys].gate.state='VERIFYING';},'MINING_GATE_NOT_ACTIVE');
fail('stopPhase no longer NONE',f=>{f.rows[SHUTDOWN+sys].gate.stopPhase='IN_PROGRESS';},'MINING_GATE_NOT_ACTIVE');
fail('missing shutdown gate',f=>{delete f.rows[SHUTDOWN+sys];},'GATE_UNPROVEN');
fail('gate token invalid',f=>{f.rows[SHUTDOWN+sys].gate.leaseToken='x';},'MINING_GATE_NOT_ACTIVE');
fail('missing writer roster',f=>{f.rows[SHUTDOWN+sys].gate.writerNames=['shutdown_cleanup'];},'MINING_GATE_NOT_ACTIVE');
fail('duplicate writer roster invalid',f=>{f.rows[SHUTDOWN+sys].gate.writerNames=['mining_cycle','mining_cycle'];},'MINING_GATE_NOT_ACTIVE');
fail('permit missing',f=>{delete f.rows[PERMIT+opKey];},'MINING_WRITE_PERMIT_UNPROVEN');
fail('wrong permit writer denied',f=>{f.rows[PERMIT+opKey].writer='hauler';},'MINING_WRITE_PERMIT_UNPROVEN');
fail('acked permit cannot authorize a second ore write',f=>{f.rows[PERMIT+opKey].state='ACKED';},'MINING_WRITE_PERMIT_UNPROVEN');
fail('permit must match same row index',f=>{f.rows[PERMIT+opKey].createdAt=42;},'MINING_WRITE_PERMIT_UNPROVEN');
fail('permit token mismatch denied',f=>{f.rows[PERMIT+opKey].leaseToken='foreign-token-0000';},'MINING_WRITE_PERMIT_UNPROVEN');
fail('partial permit index cannot grant write',f=>{f.rows[SHUTDOWN+sys].permits={};},'MINING_WRITE_PERMIT_UNPROVEN');
fail('permit with shutdown attempt cannot be normal writer',f=>{f.rows[PERMIT+opKey].attemptID='shut-00000000000';},'MINING_WRITE_PERMIT_UNPROVEN');
test('PF44 authoritative reader denial is caught',()=>{
 const f=fixture();assert.throws(()=>guard(f.tx,{systemID:sys,shipID:ship,opKey},()=>{throw Error('DOWN')}),/PF49_PF44_LEASE_READ_FAILED/);
});
test('PF44 stale/wrong lease token is rejected',()=>{
 const f=fixture();assert.throws(()=>guard(f.tx,{systemID:sys,shipID:ship,opKey},()=>({systemID:sys,state:'ACTIVE',token:'other-token-0010'})),/PF49_PF44_ACTIVE_LEASE_UNPROVEN/);
});
test('undefined native sqlite read never means an empty claim',()=>{
 const f=fixture();f.tx.get=()=>undefined;assert.throws(f.run,/PF49_ATOMIC_ROW_UNCERTAIN/);
});
test('native sqlite throwing on read never allows work',()=>{
 const f=fixture();f.tx.get=()=>{throw Error('DB_FAILED')};assert.throws(f.run,/PF49_ATOMIC_ROW_UNAVAILABLE/);
});
test('PF49 git-apply patch smoke check on exact local excerpts; no PLAY',()=>{
 const base=path.join(__dirname,'fixture');
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'pf49-source-test-'));
 try {
   fs.cpSync(base,temp,{recursive:true});
   const patch=path.resolve(__dirname,'../patches/PF49-native-mining-writer-transaction.patch');
   execFileSync('git',['apply','--check','--unidiff-zero',patch],{cwd:temp});
   execFileSync('git',['apply','--unidiff-zero',patch],{cwd:temp});
   const source=fs.readFileSync(path.join(temp,'Code/server/src/space/coopNativeMiningAtomic.js'),'utf8');
   const cargo=fs.readFileSync(path.join(temp,'Code/server/src/space/coopNativeCargoTransientIsolation.js'),'utf8');
   assert.match(source,/corporationRuntime"\]:/);
   assert.match(source,/pfFence\?\{contract:"mining-cycle-pf"\}/);
   assert.match(source,/PF49_POSTCOMMIT_ACK_UNPROVEN/);
   assert.match(cargo,/PF49_OWNERSHIP_ROWS_READ_ONLY/);
   assert.match(cargo,/MINING_CYCLE_PF/);
   execFileSync('node',['--check',path.join(temp,'Code/server/src/space/coopPersonalFleetMiningTxnGuard.js')]);
 } finally {fs.rmSync(temp,{recursive:true,force:true});}
});