import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createRequire} from 'node:module';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
const require=createRequire(import.meta.url);
const {createMiningShutdownProtocol} = require('../scripts/lib/personal-fleet-mining-shutdown.cjs');
const TOKEN='token-unique-1234567890';
const ATTEMPT='shutdown-00000001';
const FP='a'.repeat(64);
const WRITERS=['startup','restore','order','ore_extract','haul_transfer','haul_delivery','despawn','reconcile','shutdown_cleanup'];
function fixture({stop, audit, coverage, receipt, writers=WRITERS, dbFile=':memory:'}={}) {
 const db=new DatabaseSync(dbFile);
 db.exec(`PRAGMA busy_timeout=500; CREATE TABLE IF NOT EXISTS lease(system_id INTEGER PRIMARY KEY, token TEXT, state TEXT, witness TEXT);
 CREATE TABLE IF NOT EXISTS gate(system_id INTEGER PRIMARY KEY, payload TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS permit(operation_id TEXT PRIMARY KEY, system_id INTEGER, payload TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS personal_claim(system_id INTEGER, claim_id TEXT PRIMARY KEY);`);
 db.prepare('INSERT OR IGNORE INTO lease VALUES(?,?,?,NULL)').run(30000142,TOKEN,'ACTIVE');
 const tx={
  readLease(id){const v=db.prepare('SELECT * FROM lease WHERE system_id=?').get(id);return v&&{token:v.token,state:v.state,witness:v.witness};},
  readGate(id){const v=db.prepare('SELECT payload FROM gate WHERE system_id=?').get(id);return v?JSON.parse(v.payload):null;},
  writeGate(r){db.prepare('INSERT INTO gate VALUES(?,?) ON CONFLICT(system_id) DO UPDATE SET payload=excluded.payload').run(r.systemID,JSON.stringify(r));},
  countPersonalClaims(id){return db.prepare('SELECT count(*) AS n FROM personal_claim WHERE system_id=?').get(id).n;},
  readPermit(id){const v=db.prepare('SELECT payload FROM permit WHERE operation_id=?').get(id);return v?JSON.parse(v.payload):null;},
  writePermit(r){db.prepare('INSERT INTO permit VALUES(?,?,?) ON CONFLICT(operation_id) DO UPDATE SET payload=excluded.payload').run(r.operationID,r.systemID,JSON.stringify(r));},
  listPermits(id){return db.prepare('SELECT payload FROM permit WHERE system_id=?').all(id).map(v=>JSON.parse(v.payload));},
  releaseLease(id,token,witness){let r=db.prepare('UPDATE lease SET state=?,witness=? WHERE system_id=? AND token=? AND state=?')
    .run('RELEASED',JSON.stringify(witness),id,token,'ACTIVE');return r.changes===1;}
 };
 function transact(fn){db.exec('BEGIN IMMEDIATE');try{const result=fn(tx);if(result && typeof result.then==='function')throw Error('ASYNC_TRANSACTION_DISALLOWED');db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}}
 const deps={transact,writerNames:writers,now:()=>1770000000000,
  nativeStop:stop??(async ({systemID,attemptID})=>({status:'STOP_CONFIRMED',systemID,attemptID})),
  nativeAudit:audit??(async ({systemID})=>({status:'OBSERVED_EMPTY_UNPROVEN',systemID,blockers:[]})),
  verifyNativeStop:async()=>true,
  verifyCoverage:coverage??(async ({writerNames})=>({status:'ALL_WRITERS_FENCED',writerNames,sourceFingerprint:FP})),
  verifyReceipt:receipt??(({receipt})=>receipt?.trusted===true)};
 let protocol=createMiningShutdownProtocol(deps);
 const activate=()=>protocol.activate({systemID:30000142,leaseToken:TOKEN});
 const begin=(operationID='operation-00001',writer='order',args={})=>protocol.beginWrite({systemID:30000142,leaseToken:TOKEN,writer,operationID,...args});
 const finish=(operationID='operation-00001',receipt={trusted:true})=>protocol.finishWrite({systemID:30000142,leaseToken:TOKEN,operationID,receipt});
 const drain=(attemptID=ATTEMPT)=>protocol.beginShutdown({systemID:30000142,leaseToken:TOKEN,attemptID});
 const complete=(attemptID=ATTEMPT)=>protocol.completeShutdown({systemID:30000142,leaseToken:TOKEN,attemptID});
 const close=()=>db.close();
 return {db,tx,transact,deps,get protocol(){return protocol},setProtocol(p){protocol=p},activate,begin,finish,drain,complete,close};
}
const boom=(code,fn)=>assert.throws(fn,e=>e.code===code,code);
const boomAsync=async (code,fn)=>assert.rejects(fn,e=>e.code===code,code);

test('activate requires same original lease',()=>{let f=fixture();f.activate();assert.equal(f.protocol.inspect({systemID:30000142}).gate.state,'ACTIVE');assert.equal(f.activate().status,'ALREADY_ACTIVE');f.close()});
test('PF claim blocks activation',()=>{let f=fixture();f.db.prepare('INSERT INTO personal_claim VALUES (?,?)').run(30000142,'pf-claim-1');boom('PF_CLAIMS_UNKNOWN_OR_PRESENT',f.activate);f.close()});
test('missing ACTIVE lease blocks activation',()=>{let f=fixture();f.db.exec("UPDATE lease SET state='STARTING'");boom('LEASE_NOT_OWNED',f.activate);f.close()});
test('unregistered writer rejected',()=>{let f=fixture();f.activate();boom('WRITER_NOT_REGISTERED',()=>f.begin('operation-00001','exploration'));f.close()});
test('reused id is rejected, never replays native mutations',()=>{let f=fixture();f.activate();f.begin();boom('OPERATION_ID_REUSED',()=>f.begin());f.close()});
test('cleanup impossible before shutdown',()=>{let f=fixture();f.activate();boom('CLEANUP_OUTSIDE_SHUTDOWN',()=>f.begin('operation-00022','shutdown_cleanup'));f.close()});
test('normal writers fenced after DRAINING',()=>{let f=fixture();f.activate();f.drain();boom('WRITER_FENCED_BY_SHUTDOWN',()=>f.begin());f.close()});
test('cleanup needs exact durable attempt id',()=>{let f=fixture();f.activate();f.drain();boom('WRITER_FENCED_BY_SHUTDOWN',()=>f.begin('operation-00022','shutdown_cleanup',{shutdownAttemptID:'shutdown-00000002'}));f.close()});
test('pending operation blocks native stop',async ()=>{let calls=0;let f=fixture({stop:async (...args)=>{calls++;return {status:'STOP_CONFIRMED'};}});f.activate();f.begin();f.drain();let r=await f.complete();assert.equal(r.status,'BLOCKED_PENDING_WRITERS');assert.equal(calls,0);assert.equal(f.protocol.inspect({systemID:30000142}).lease.state,'ACTIVE');f.close()});
test('unverified receipt leaves permit pending',()=>{let f=fixture();f.activate();f.begin();boom('WRITE_RECEIPT_NOT_PROVEN',()=>f.finish('operation-00001',{trusted:false}));assert.equal(f.protocol.inspect({systemID:30000142}).pending.length,1);f.close()});
test('acknowledged permit allows shutdown',async ()=>{let f=fixture();f.activate();f.begin();f.finish();f.drain();assert.equal((await f.complete()).status,'RELEASED');f.close()});
test('wrong token never releases lease',async ()=>{let f=fixture();f.activate();f.drain();await boomAsync('LEASE_NOT_OWNED',()=>f.protocol.completeShutdown({systemID:30000142,leaseToken:'another-token-123456',attemptID:ATTEMPT}));f.close()});
test('native stop failure stays DRAINING',async ()=>{let f=fixture({stop:async()=>{throw Error('power failure')}});f.activate();f.drain();await assert.rejects(f.complete,/power failure/);assert.equal(f.protocol.inspect({systemID:30000142}).gate.state,'DRAINING');f.close()});
test('native stop without confirmed ID leaves lease ACTIVE',async ()=>{let f=fixture({stop:async()=>({status:'STOP_CONFIRMED',systemID:1,attemptID:ATTEMPT})});f.activate();f.drain();await boomAsync('NATIVE_STOP_UNPROVEN',f.complete);assert.equal(f.protocol.inspect({systemID:30000142}).lease.state,'ACTIVE');f.close()});
test('native auditor must return PF45 precise observation',async ()=>{let f=fixture({audit:async({systemID})=>({status:'OK',systemID,blockers:[]})});f.activate();f.drain();await boomAsync('NATIVE_NOT_OBSERVED_EMPTY',f.complete);assert.equal(f.protocol.inspect({systemID:30000142}).gate.state,'VERIFYING');f.close()});
test('PF45 blockers prevent release',async ()=>{let f=fixture({audit:async({systemID})=>({status:'OBSERVED_EMPTY_UNPROVEN',systemID,blockers:['orphan-hauler']})});f.activate();f.drain();await boomAsync('NATIVE_NOT_OBSERVED_EMPTY',f.complete);assert.equal(f.protocol.inspect({systemID:30000142}).lease.state,'ACTIVE');f.close()});
test('unverified writer set prevents release',async ()=>{let f=fixture({coverage:async()=>({status:'ALL_WRITERS_FENCED',writerNames:['order'],sourceFingerprint:FP})});f.activate();f.drain();await boomAsync('MINING_WRITER_COVERAGE_UNPROVEN',f.complete);f.close()});
test('invalid fingerprint prevents release',async ()=>{let f=fixture({coverage:async({writerNames})=>({status:'ALL_WRITERS_FENCED',writerNames,sourceFingerprint:'fake'})});f.activate();f.drain();await boomAsync('MINING_WRITER_COVERAGE_UNPROVEN',f.complete);f.close()});
test('successful release includes durable witness',async ()=>{let f=fixture();f.activate();f.drain();let result=await f.complete();assert.equal(result.status,'RELEASED');assert.equal(result.witness.attemptID,ATTEMPT);let row=f.protocol.inspect({systemID:30000142});assert.equal(row.gate.state,'RELEASED');assert.equal(row.lease.state,'RELEASED');assert.equal(JSON.parse(row.lease.witness).sourceFingerprint,FP);f.close()});
test('lease CAS failure rolls back witness atomically',async ()=>{let f=fixture();f.activate();f.drain();let release=f.tx.releaseLease;f.tx.releaseLease=()=>false;await boomAsync('ATOMIC_LEASE_RELEASE_FAILED',f.complete);let row=f.protocol.inspect({systemID:30000142});assert.equal(row.gate.state,'VERIFYING');assert.equal(row.lease.state,'ACTIVE');f.tx.releaseLease=release;assert.equal((await f.complete()).status,'RELEASED');f.close()});
test('new cleanup writer forbidden during native audit after VERIFYING',async ()=>{let f;f=fixture({audit:async ({systemID})=>{boom('GATE_NOT_OWNED_OR_STATE',()=>f.begin('operation-clean-22','shutdown_cleanup',{shutdownAttemptID:ATTEMPT}));return {status:'OBSERVED_EMPTY_UNPROVEN',systemID,blockers:[]}}});f.activate();f.drain();assert.equal((await f.complete()).status,'RELEASED');f.close()});
test('native cleanup is durably tracked and acknowledged',async ()=>{let f=fixture({stop:async ({systemID,attemptID,beginCleanup,finishCleanup})=>{beginCleanup('operation-clean-23');finishCleanup('operation-clean-23',{trusted:true});return {status:'STOP_CONFIRMED',systemID,attemptID}}});f.activate();f.drain();assert.equal((await f.complete()).status,'RELEASED');f.close()});
test('unknown cleanup outcome quarantines lease',async ()=>{let f=fixture({stop:async ({systemID,attemptID,beginCleanup})=>{beginCleanup('operation-clean-24');return {status:'STOP_CONFIRMED',systemID,attemptID}}});f.activate();f.drain();await boomAsync('PENDING_WRITERS_BEFORE_VERIFYING',f.complete);assert.equal(f.protocol.inspect({systemID:30000142}).gate.state,'DRAINING');f.close()});
test('stale shutdown attempt fenced',async ()=>{let f=fixture();f.activate();f.drain();boom('SHUTDOWN_ATTEMPT_FENCED',()=>f.drain('shutdown-00000002'));await boomAsync('SHUTDOWN_ATTEMPT_FENCED',()=>f.complete('shutdown-00000002'));f.close()});
test('cannot reactivate released gate with same lease',async ()=>{let f=fixture();f.activate();f.drain();await f.complete();boom('LEASE_NOT_OWNED',f.activate);f.close()});
test('reboot after audit failure resumes VERIFYING without running stop twice',async ()=>{let n=0;let f=fixture({stop:async({systemID,attemptID})=>{n++;return {status:'STOP_CONFIRMED',systemID,attemptID}},audit:async()=>{throw Error('audit unavailable')}});f.activate();f.drain();await assert.rejects(f.complete,/audit unavailable/);let repl=createMiningShutdownProtocol({...f.deps,nativeAudit:async({systemID})=>({status:'OBSERVED_EMPTY_UNPROVEN',systemID,blockers:[]})});f.setProtocol(repl);assert.equal((await f.complete()).status,'RELEASED');assert.equal(n,1);f.close()});
test('process restart persists DRAINING and blocks new writers',()=>{let dir=fs.mkdtempSync(path.join(os.tmpdir(),'pf46-'));let file=path.join(dir,'state.db');try{let a=fixture({dbFile:file});a.activate();a.drain();a.close();let b=fixture({dbFile:file});boom('WRITER_FENCED_BY_SHUTDOWN',()=>b.begin());assert.equal(b.protocol.inspect({systemID:30000142}).gate.state,'DRAINING');b.close()}finally{fs.rmSync(dir,{force:true,recursive:true})}});
test('transaction rollback on gate-write exception preserves lease',async ()=>{let f=fixture();f.activate();f.drain();let w=f.tx.writeGate;f.tx.writeGate=()=>{throw Error('disk unavailable')};await assert.rejects(f.complete,/disk unavailable/);assert.equal(f.protocol.inspect({systemID:30000142}).lease.state,'ACTIVE');f.tx.writeGate=w;f.close()});
test('bad writer manifest fails before transactions',()=>{let f=fixture();boom('WRITER_MANIFEST_INVALID',()=>createMiningShutdownProtocol({...f.deps,writerNames:['order']}));f.close()});
test('no new claims allowed at release checkpoint',async ()=>{let f=fixture({audit:async ({systemID})=>{f.db.prepare('INSERT INTO personal_claim VALUES (?,?)').run(systemID,'illicit-claim');return {status:'OBSERVED_EMPTY_UNPROVEN',systemID,blockers:[]}}});f.activate();f.drain();await boomAsync('PF_CLAIMS_UNKNOWN_OR_PRESENT',f.complete);assert.equal(f.protocol.inspect({systemID:30000142}).lease.state,'ACTIVE');f.close()});
test('corrupt permit journal fails closed',()=>{let f=fixture();f.activate();f.db.prepare('INSERT INTO permit VALUES(?,?,?)').run('operation-00002',30000142,JSON.stringify({systemID:30000142,operationID:'operation-00002',writer:'unknown',state:'ACKED'}));boom('PERMIT_LEDGER_CORRUPT',()=>f.protocol.inspect({systemID:30000142}));f.close()});
test('writer manifest drift after restart quarantines ownership',()=>{let f=fixture();f.activate();let changed=createMiningShutdownProtocol({...f.deps,writerNames:[...WRITERS,'new_mining_writer']});boom('WRITER_MANIFEST_CHANGED',()=>changed.beginShutdown({systemID:30000142,leaseToken:TOKEN,attemptID:ATTEMPT}));f.close()});
test('release cannot replay after durable commit',async ()=>{let f=fixture();f.activate();f.drain();await f.complete();await boomAsync('LEASE_NOT_OWNED',f.complete);f.close()});
test('stop callback receives only scoped cleanup capabilities',async ()=>{let seen;let f=fixture({stop:async params=>{seen=Object.keys(params).sort();return {status:'STOP_CONFIRMED',systemID:params.systemID,attemptID:params.attemptID}}});f.activate();f.drain();await f.complete();assert.deepEqual(seen,['attemptID','beginCleanup','finishCleanup','systemID']);f.close()});
test('invalid system and token rejected',()=>{let f=fixture();boom('SYSTEM_ID_INVALID',()=>f.protocol.activate({systemID:0,leaseToken:TOKEN}));boom('LEASE_TOKEN_INVALID',()=>f.protocol.activate({systemID:1,leaseToken:'short'}));f.close()});

test('PF47: concurrent complete cannot invoke nativeStop twice for one durable attempt',async()=>{
 let release;let stopCalls=0;
 const f=fixture({stop:async({systemID,attemptID})=>{
   stopCalls++;
   await new Promise(resolve=>{release=resolve});
   return {status:'STOP_CONFIRMED',systemID,attemptID};
 }});
 f.activate();f.drain();
 const first=f.complete();
 assert.equal(f.protocol.inspect({systemID:30000142}).gate.stopPhase,'IN_PROGRESS');
 assert.deepEqual(await f.complete(),{status:'BLOCKED_STOP_OUTCOME_UNKNOWN'});
 assert.equal(stopCalls,1);
 release();assert.equal((await first).status,'RELEASED');
 f.close();
});

test('PF47: crash during nativeStop never automatically calls it again',async()=>{
 let calls=0;let f=fixture({stop:async()=>{calls++;throw Error('simulated power loss');}});
 f.activate();f.drain();await assert.rejects(f.complete,/simulated power loss/);
 assert.equal(f.protocol.inspect({systemID:30000142}).gate.stopPhase,'IN_PROGRESS');
 const restarted=createMiningShutdownProtocol({...f.deps,nativeStop:async()=>{calls++;throw Error('UNSAFE_REPLAY')}});
 f.setProtocol(restarted);
 assert.deepEqual(await f.complete(),{status:'BLOCKED_STOP_OUTCOME_UNKNOWN'});
 assert.equal(calls,1);f.close();
});

test('PF47: explicit trusted reconciliation advances ambiguous shutdown',async()=>{
 let f=fixture({stop:async()=>{throw Error('crash');}});f.activate();f.drain();
 await assert.rejects(f.complete(),/crash/);
 const result=await f.protocol.reconcileStopped({systemID:30000142,leaseToken:TOKEN,attemptID:ATTEMPT});
 assert.equal(result.status,'VERIFYING');
 assert.equal((await f.complete()).status,'RELEASED');f.close();
});

test('PF47: unproven reconciliation remains permanently fenced',async()=>{
 let f=fixture({stop:async()=>{throw Error('crash');}});f.activate();f.drain();
 await assert.rejects(f.complete(),/crash/);
 const p=createMiningShutdownProtocol({...f.deps,verifyNativeStop:async()=>false});f.setProtocol(p);
 await boomAsync('NATIVE_STOP_INDEPENDENT_PROOF_MISSING',()=>p.reconcileStopped({systemID:30000142,leaseToken:TOKEN,attemptID:ATTEMPT}));
 assert.equal(p.inspect({systemID:30000142}).gate.state,'DRAINING');
 f.close();
});

test('PF47: absent native stop verifier is a constructor error',()=>{
 const f=fixture();const deps={...f.deps};delete deps.verifyNativeStop;
 boom('NATIVE_STOP_VERIFIER_MISSING',()=>createMiningShutdownProtocol(deps));f.close();
});