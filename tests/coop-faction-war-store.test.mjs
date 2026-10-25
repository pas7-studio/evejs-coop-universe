import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {createFactionWarStore}=require('../integration/coopFactionWarStore.cjs');
function memoryDB(){
 const records=new Map();let calls=0;
 return {records,get calls(){return calls},coopAtomicNativeRows:{transact(tables,work){
  assert.deepEqual(tables,['corporationRuntime']);calls++;
  const staged=new Map(records),tx={get:(t,k)=>staged.get(t+':'+k),
   put:(t,k,v)=>staged.set(t+':'+k,v)};
  const result=work(tx);
  records.clear();for(const [k,v] of staged)records.set(k,v);
  return result;
 }}};
}
const proof={territory:()=>true,declaration:()=>true};
const cmd={type:'REGISTER_TERRITORY',eventID:'territory-1',systemID:100,ownerFactionID:10};
test('off by default, no tables created or mutated',()=>{
 const prev=process.env.EVEJS_COOP_FACTION_WAR,atomicPrev=process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS;process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS="1";delete process.env.EVEJS_COOP_FACTION_WAR;
 try{const db=memoryDB(),s=createFactionWarStore({gameStore:db,proofs:proof});
  assert.equal(s.execute(cmd).status,'DISABLED');assert.equal(db.calls,0);
 }finally{if(prev!==undefined)process.env.EVEJS_COOP_FACTION_WAR=prev; if(atomicPrev===undefined)delete process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS;else process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS=atomicPrev;}
});
test('atomic persistence, duplicate replay, conflict, and restart-like reopening',()=>{
 const prev=process.env.EVEJS_COOP_FACTION_WAR,atomicPrev=process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS;process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS="1";process.env.EVEJS_COOP_FACTION_WAR='1';
 try{const db=memoryDB(),make=()=>createFactionWarStore({gameStore:db,proofs:proof,clock:()=>1000000});
  assert.equal(make().execute(cmd).status,'APPLIED');
  assert.equal(make().execute(cmd).status,'DUPLICATE');
  assert.equal(make().execute({...cmd,ownerFactionID:20}).reason,'EVENT_ID_CONFLICT');
  assert.equal(make().snapshot().territories['100'].militaryControllerFactionID,10);
 }finally{if(prev===undefined)delete process.env.EVEJS_COOP_FACTION_WAR;else process.env.EVEJS_COOP_FACTION_WAR=prev; if(atomicPrev===undefined)delete process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS;else process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS=atomicPrev;}
});
test('transaction failure cannot produce an acknowledged operation',()=>{
 const prev=process.env.EVEJS_COOP_FACTION_WAR,atomicPrev=process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS;process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS="1";process.env.EVEJS_COOP_FACTION_WAR='1';
 try{const db=memoryDB(),bad={coopAtomicNativeRows:{transact:()=>{throw Error('disk failure')}}};
  const s=createFactionWarStore({gameStore:bad,proofs:proof});
  assert.throws(()=>s.execute(cmd),/disk failure/);
  assert.equal(db.records.size,0);
 }finally{if(prev===undefined)delete process.env.EVEJS_COOP_FACTION_WAR;else process.env.EVEJS_COOP_FACTION_WAR=prev; if(atomicPrev===undefined)delete process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS;else process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS=atomicPrev;}
});
