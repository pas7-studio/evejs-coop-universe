"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {assertHaulWriteAuthorized:guard,CLAIMS,WAR,SHUTDOWN,PERMIT}=require('../native/coopPersonalFleetHaulTxnGuard');
const SYSTEM=30000144,MINER=63001,HAULER=63002,TOKEN='token-pf50-native-0001';
const opKey='pf-haul:'+createHash('sha256').update('sample').digest('hex');
const permit={operationID:opKey,systemID:SYSTEM,leaseToken:TOKEN,writer:'haul_transfer',state:'PENDING',attemptID:null};
const gate={systemID:SYSTEM,leaseToken:TOKEN,state:'ACTIVE',stopPhase:'NONE',writerNames:['haul_transfer','mining_cycle','shutdown_cleanup']};
const lease={systemID:SYSTEM,state:'ACTIVE',token:TOKEN};
const params={systemID:SYSTEM,minerID:MINER,haulerID:HAULER,opKey};
function fixture(){
 const rows=new Map([
  [CLAIMS,{version:1,claims:{},generations:{},processed:{}}],
  [WAR,{version:1,ships:{},processed:{},history:[]}],
  [SHUTDOWN+SYSTEM,{version:1,systemID:SYSTEM,gate,permits:{[opKey]:permit}}],
  [PERMIT+opKey,permit]
 ]);
 const tx={get(t,k){assert.equal(t,'corporationRuntime');return rows.has(k)?structuredClone(rows.get(k)):null;}};
 return {rows,tx,reader:()=>lease};
}
function checked(mutate){const f=fixture();mutate?.(f);return guard(f.tx,params,f.reader)}
function fails(why,mutate){test(why,()=>assert.throws(()=>checked(mutate),/PF50_/))}
test('valid native pending permit + exact active lease',()=>assert.equal(checked(),true));
test('does not mutate authoritative rows',()=>{const f=fixture(),snapshot=structuredClone([...f.rows]);guard(f.tx,params,f.reader);assert.deepEqual([...f.rows],snapshot)});
fails('missing PF claim record',f=>f.rows.delete(CLAIMS));
fails('undefined claim row uncertainty',f=>f.tx.get=()=>undefined);
fails('malformed claim registry',f=>f.rows.set(CLAIMS,{version:0,claims:{}}));
fails('corrupt claim unrelated ship',f=>{let s=f.rows.get(CLAIMS);s.claims['999']={entityID:999,pilotID:'bad'};f.rows.set(CLAIMS,s)});
fails('foreign personal claim miner',f=>{let s=f.rows.get(CLAIMS);s.generations[String(MINER)]=1;s.claims[String(MINER)]={entityID:MINER,systemID:SYSTEM,ownerCharacterID:7,pilotID:'coop-pilot-777',ownerType:'PERSONAL_FLEET',assignmentID:'a',generation:1};f.rows.set(CLAIMS,s)});
fails('foreign personal claim hauler',f=>{let s=f.rows.get(CLAIMS);s.generations[String(HAULER)]=1;s.claims[String(HAULER)]={entityID:HAULER,systemID:SYSTEM,ownerCharacterID:7,pilotID:'coop-pilot-777',ownerType:'PERSONAL_FLEET',assignmentID:'a',generation:1};f.rows.set(CLAIMS,s)});
fails('unrelated personal claim in system conservatively blocks',f=>{let s=f.rows.get(CLAIMS);s.generations['777']=1;s.claims['777']={entityID:777,systemID:SYSTEM,ownerCharacterID:7,pilotID:'coop-pilot-777',ownerType:'PERSONAL_FLEET',assignmentID:'a',generation:1};f.rows.set(CLAIMS,s)});
fails('war reserved miner',f=>{let s=f.rows.get(WAR);s.ships[String(MINER)]={entityID:MINER,pilotID:'coop-pilot-777'};f.rows.set(WAR,s)});
fails('war reserved hauler transfer',f=>{let s=f.rows.get(WAR);s.transfers={[HAULER]:{entityID:HAULER,pilotID:'coop-pilot-777'}};f.rows.set(WAR,s)});
fails('invalid war ship outside fleet',f=>{let s=f.rows.get(WAR);s.ships['bad']={entityID:900,pilotID:'coop-pilot-777'};f.rows.set(WAR,s)});
fails('missing gate',f=>f.rows.delete(SHUTDOWN+SYSTEM));
fails('shutdown DRAINING',f=>{let s=f.rows.get(SHUTDOWN+SYSTEM);s.gate={...s.gate,state:'DRAINING'};f.rows.set(SHUTDOWN+SYSTEM,s)});
fails('shutdown VERIFYING',f=>{let s=f.rows.get(SHUTDOWN+SYSTEM);s.gate={...s.gate,state:'VERIFYING'};f.rows.set(SHUTDOWN+SYSTEM,s)});
fails('stop in progress',f=>{let s=f.rows.get(SHUTDOWN+SYSTEM);s.gate={...s.gate,stopPhase:'IN_PROGRESS'};f.rows.set(SHUTDOWN+SYSTEM,s)});
fails('no hauling writer registered',f=>{let s=f.rows.get(SHUTDOWN+SYSTEM);s.gate={...s.gate,writerNames:['mining_cycle','shutdown_cleanup']};f.rows.set(SHUTDOWN+SYSTEM,s)});
fails('duplicate writer manifest',f=>{let s=f.rows.get(SHUTDOWN+SYSTEM);s.gate={...s.gate,writerNames:['haul_transfer','haul_transfer']};f.rows.set(SHUTDOWN+SYSTEM,s)});
fails('lease reader not bound',f=>f.reader=null);
fails('lease source throws',f=>f.reader=()=>{throw Error('db')});
fails('lease absent',f=>f.reader=()=>null);
fails('lease STARTING',f=>f.reader=()=>({...lease,state:'STARTING'}));
fails('lease token rotated',f=>f.reader=()=>({...lease,token:'other-token-number-12345'}));
fails('permit missing',f=>f.rows.delete(PERMIT+opKey));
fails('permit ACKED',f=>f.rows.set(PERMIT+opKey,{...permit,state:'ACKED'}));
fails('permit attempt differs from null',f=>f.rows.set(PERMIT+opKey,{...permit,attemptID:'shutdown-00003'}));
fails('permit wrong writer',f=>f.rows.set(PERMIT+opKey,{...permit,writer:'mining_cycle'}));
fails('permit wrong ship system',f=>f.rows.set(PERMIT+opKey,{...permit,systemID:30000142}));
fails('gate permit and indexed permit disagree',f=>{let s=f.rows.get(SHUTDOWN+SYSTEM);s.permits={[opKey]:{...permit,state:'ACKED'}};f.rows.set(SHUTDOWN+SYSTEM,s)});
fails('permit ledger over cap',f=>{let s=f.rows.get(SHUTDOWN+SYSTEM);for(let i=0;i<8193;i++)s.permits['k'+i]=permit;f.rows.set(SHUTDOWN+SYSTEM,s)});
test('invalid command params reject',()=>{let f=fixture();assert.throws(()=>guard(f.tx,{...params,opKey:'bad'},f.reader),/PF50_SCOPE_INVALID/);assert.throws(()=>guard(f.tx,{...params,haulerID:MINER},f.reader),/PF50_SCOPE_INVALID/)});