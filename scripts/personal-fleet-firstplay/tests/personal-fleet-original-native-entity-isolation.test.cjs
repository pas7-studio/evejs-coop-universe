'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const isolation=require('../native/coopPersonalFleetNativeEntityIsolation.js');
const {policyFor,capture,verifyShadow,guardMutation,entityKey,CONTRACT}=isolation;
const F='coop-personal-fleet\u001f',T='corporationRuntime',NE='npcEntities';
const env={EVEJS_COOP_PERSONAL_FLEET_ENTITY_ISOLATION:'1',
 EVEJS_COOP_PERSONAL_FLEET_NATIVE:'1',EVEJS_COOP_NATIVE_ATOMIC_ROWS:'1'};
const options=(mode='ORDER',extra={})=>({contract:CONTRACT,
 shipItemID:2301,operationID:'op-123',assignmentID:'assignment-123',mode,...extra});
const entity=()=>({entityID:2301,ownerID:500,systemID:30000142,typeID:606,
 personalFleetOriginal:true,personalFleetAssignmentID:'assignment-123',
 personalFleetPilotID:'coop-pilot-123',personalFleetGeneration:1,
 mode:'STOP',targetEntityID:0,followRange:0,position:{x:10,y:0,z:0},
 velocity:{x:0,y:0,z:0},direction:{x:1,y:0,z:0},
 targetPoint:{x:10,y:0,z:0},speedFraction:0});
const copy=x=>structuredClone(x);
const base=()=>new Map([
 [NE,new Map([[entityKey(2301),entity()]])],
 [T,new Map()],
 ['items',new Map()],
 ['characters',new Map()]]);
function fixture(mode='ORDER'){
 const tables=base(),writes=[];
 const tx={get:(t,k)=>copy(tables.get(t)?.get(k)??null),
  scan:t=>[...tables.get(t).entries()].map(([key,value])=>({key,value:copy(value)})),
  put:(t,k,v)=>{writes.push([t,k]);tables.get(t).set(k,copy(v));}};
 const policy=policyFor([T,'items','characters',NE],options(mode),env);
 const gated=guardMutation(tx,policy);
 const receipt=(type='ORDER')=>({version:1,
  source:type==='ORDER'?'EVEJS_ORIGINAL_NATIVE_ORDER_COMMITTED_V1':
   'EVEJS_ORIGINAL_NATIVE_RETURN_COMMITTED_V1',
  operationID:'op-123',signature:'a'.repeat(64),assignmentID:'assignment-123',
  ownerCharacterID:500,pilotID:'coop-pilot-123',shipItemID:2301,
  systemID:30000142,committedAtMs:12345});
 return {tables,tx,gated,writes,receipt};
}
function doOrder(f){
 const next=entity();next.mode='FOLLOW';next.targetEntityID=3345;
 next.followRange=1000;
 f.gated.put(NE,entityKey(2301),next);
 f.gated.put(T,F+'native-order-receipt-v1:op-123',f.receipt());
 f.gated.assertWriteSetComplete();
}
function doReturn(f){
 const next=entity();next.personalFleetReturnOrder={version:1,
  operationID:'op-123',signature:'a'.repeat(64),
  assignmentID:'assignment-123',shipItemID:2301,
  ownerCharacterID:500,stationID:6001,committedAtMs:12345};
 f.gated.put(NE,entityKey(2301),next);
 f.gated.put(T,F+'native-return-receipt-v1:op-123',
  {...f.receipt('RETURN'),stationID:6001});
 f.gated.assertWriteSetComplete();
}
test('PF87 explicit original source flags and exact table set required',()=>{
 assert.equal(policyFor([NE,T,'characters','items'],options(),env).mode,'ORDER');
 assert.throws(()=>policyFor([T,NE],options(),env),/POLICY_NOT_AUTHORIZED/);
 assert.throws(()=>policyFor([T,'items','characters',NE],options(),{}),/POLICY_NOT_AUTHORIZED/);
 assert.throws(()=>policyFor([T,'items','characters',NE],options('ORDER',{shipItemID:0}),env),/CONTRACT_INVALID/);
 assert.equal(policyFor([T],{},env),null);
});
test('PF87 original SQLite row keys use a single separator',()=>{
 assert.equal(entityKey(2301),'entities\u001f2301');
});
test('PF87 ORDER writes only the owning NPC and its matching receipt',()=>{
 const f=fixture();doOrder(f);
 assert.deepEqual(f.writes,[[NE,entityKey(2301)],[T,F+'native-order-receipt-v1:op-123']]);
 assert.equal(f.tx.get(NE,entityKey(2301)).mode,'FOLLOW');
});
test('PF87 return marker and receipt are an indivisible pair',()=>{
 const f=fixture('RETURN');doReturn(f);
 assert.equal(f.tx.get(NE,entityKey(2301)).personalFleetReturnOrder.stationID,6001);
});
test('PF87 only reads may do zero writes',()=>{
 fixture('ORDER').gated.assertWriteSetComplete();
 fixture('RETURN').gated.assertWriteSetComplete();
 fixture('CONFIRM').gated.assertWriteSetComplete();
 fixture('RECONCILE').gated.assertWriteSetComplete();
});
test('PF87 cannot commit an entity without a receipt',()=>{
 const f=fixture();f.gated.put(NE,entityKey(2301),{...entity(),mode:'STOP'});
 assert.throws(()=>f.gated.assertWriteSetComplete(),/HALF_NATIVE_RECEIPT/);
});
test('PF87 cannot commit a receipt without the source entity',()=>{
 const f=fixture();f.gated.put(T,F+'native-order-receipt-v1:op-123',f.receipt());
 assert.throws(()=>f.gated.assertWriteSetComplete(),/HALF_NATIVE_RECEIPT/);
});
test('PF87 rejects other entities and extra table writes',()=>{
 const f=fixture();
 assert.throws(()=>f.gated.put(NE,entityKey(2302),entity()),/FOREIGN_NATIVE_ENTITY/);
 assert.throws(()=>f.gated.put('items','items',{}),/UNSCOPED_NATIVE_TRANSACTION/);
 assert.throws(()=>f.gated.del(NE,entityKey(2301)),/DELETE_FORBIDDEN/);
});
test('PF87 cannot change immutable hull ownership during ACK',()=>{
 const f=fixture();
 assert.throws(()=>f.gated.put(NE,entityKey(2301),{...entity(),ownerID:555}),/FOREIGN_NATIVE_ENTITY/);
 assert.throws(()=>f.gated.put(NE,entityKey(2301),{...entity(),typeID:998}),/FOREIGN_NATIVE_ENTITY/);
});
test('PF87 rejects original transient hull as receipt target',()=>{
 const f=fixture();f.tables.get(NE).set(entityKey(2301),{...entity(),transient:true});
 assert.throws(()=>guardMutation(f.tx,policyFor([T,'items','characters',NE],options(),env)),/TARGET_NOT_ORIGINAL_DURABLE/);
});
test('PF87 rejects mismatched native return receipt',()=>{
 const f=fixture('RETURN'),e=entity();
 e.personalFleetReturnOrder={version:1,operationID:'op-123',assignmentID:'assignment-123',
  signature:'a'.repeat(64),shipItemID:2301,stationID:6001,
  ownerCharacterID:500,committedAtMs:12345};
 f.gated.put(NE,entityKey(2301),e);
 assert.throws(()=>f.gated.put(T,F+'native-return-receipt-v1:op-123',
   {...f.receipt('RETURN'),stationID:9999})||f.gated.assertWriteSetComplete(),
   /RETURN_RECEIPT_MARKER_MISMATCH/);
});
test('PF87 rejects unauthorized receipt source',()=>{
 const f=fixture();
 assert.throws(()=>f.gated.put(T,F+'native-order-receipt-v1:op-123',
  {...f.receipt(),source:'OTHER_SYSTEM'}),/FOREIGN_NATIVE_RECEIPT/);
});
test('PF87 allows exact PF56 RETURN_ISSUING -> RETURNING',()=>{
 const f=fixture('CONFIRM'),key=F+'return-dock-v1:assignment-123';
 f.tables.get(T).set(key,{phase:'RETURN_ISSUING',operationID:'op-123',
  assignmentID:'assignment-123',shipItemID:2301,signature:'a'.repeat(64)});
 f.gated.put(T,key,{...f.tx.get(T,key),phase:'RETURNING',returnProofHash:'b'.repeat(64)});
 f.gated.assertWriteSetComplete();
 assert.equal(f.tx.get(T,key).phase,'RETURNING');
});
test('PF87 confirm cannot alter any other return field',()=>{
 const f=fixture('CONFIRM'),key=F+'return-dock-v1:assignment-123';
 f.tables.get(T).set(key,{phase:'RETURN_ISSUING',operationID:'op-123',
  assignmentID:'assignment-123',shipItemID:2301,ownerCharacterID:500});
 assert.throws(()=>f.gated.put(T,key,{...f.tx.get(T,key),ownerCharacterID:999,
  phase:'RETURNING',returnProofHash:'b'.repeat(64)}),/CONFIRM_STATE_INVALID/);
});
test('PF87 PF55 two-row ACK reconciliation stays scoped',()=>{
 const f=fixture('RECONCILE'),manual=F+'manual-order-v1:2301',
  index=F+'manual-order-operations-v1';
 const before={phase:'ISSUING',operationID:'op-123',assignmentID:'assignment-123',
  shipItemID:2301,signature:'a'.repeat(64)};
 f.tables.get(T).set(manual,before);
 f.tables.get(T).set(index,{version:1,operations:{'op-123':{phase:'ISSUING',shipItemID:2301},
  'other-op':{phase:'ACKED',shipItemID:2302}}});
 f.gated.put(T,manual,{...before,phase:'ACKED',proofHash:'b'.repeat(64),ackedAtMs:12345});
 const ix=f.tx.get(T,index);ix.operations['op-123'].phase='ACKED';
 f.gated.put(T,index,ix);f.gated.assertWriteSetComplete();
 assert.equal(f.tx.get(T,index).operations['other-op'].phase,'ACKED');
});
test('PF87 rejects incomplete PF55 reconcile index commit',()=>{
 const f=fixture('RECONCILE'),manual=F+'manual-order-v1:2301';
 const before={phase:'ISSUING',operationID:'op-123',assignmentID:'assignment-123',shipItemID:2301};
 f.tables.get(T).set(manual,before);
 f.gated.put(T,manual,{...before,phase:'ACKED',proofHash:'b'.repeat(64),ackedAtMs:12345});
 assert.throws(()=>f.gated.assertWriteSetComplete(),/INCOMPLETE_RECONCILE/);
});
test('PF87 transient NPC never appears in durable SQLite snapshot',()=>{
 const e=entity(),tmp={...entity(),entityID:2302,transient:true,
  personalFleetAssignmentID:'other-assignment'};
 const durable={nextEntityID:9900,entities:{'2301':e}};
 const live=copy(durable);live.entities['2302']=tmp;
 const paths=new Set(['/entities/2302']);
 const proof=capture({paths,live,durable,shipItemID:2301});
 assert.deepEqual(proof.ids,['2302']);
 verifyShadow({witness:proof,paths,live});
 assert.equal(durable.entities['2302'],undefined);
 live.entities['2301'].mode='FOLLOW';
 verifyShadow({witness:proof,paths,live});
 assert.equal(live.entities['2302'].transient,true);
});
test('PF87 missing transient cache row fails closed',()=>{
 const durable={entities:{'2301':entity()}},live=copy(durable);
 assert.throws(()=>capture({paths:new Set(['/entities/2302']),live,durable,shipItemID:2301}),
  /TRANSIENT_ENTITY_NOT_ISOLATED/);
});
test('PF87 target cannot be marked transient',()=>{
 const live={entities:{'2301':{...entity(),transient:true}}},durable={entities:{}};
 assert.throws(()=>capture({paths:new Set(['/entities/2301']),live,durable,shipItemID:2301}),
  /TRANSIENT_ENTITY_NOT_ISOLATED/);
});
test('PF87 unknown transient paths cannot bypass native isolation',()=>{
 const durable={entities:{'2301':entity()}},live=copy(durable);
 assert.throws(()=>capture({paths:new Set(['/other/2302']),live,durable,shipItemID:2301}),
  /TRANSIENT_PATH_NOT_ENTITY_SCOPED/);
});
test('PF87 durable preimage drift forbids receipt',()=>{
 const durable={entities:{'2301':entity()}},live=copy(durable);
 live.entities['2301'].ownerID=666;
 live.entities['2302']={...entity(),entityID:2302,transient:true};
 assert.throws(()=>capture({paths:new Set(['/entities/2302']),live,durable,shipItemID:2301}),
  /CACHE_DURABLE_PREIMAGE_MISMATCH/);
});
test('PF87 shadow mutation after COMMIT must be fatal to caller',()=>{
 const durable={entities:{'2301':entity()}},live=copy(durable);
 live.entities['2302']={...entity(),entityID:2302,transient:true};
 const paths=new Set(['/entities/2302']);
 const witness=capture({paths,live,durable,shipItemID:2301});
 live.entities['2302'].mode='FOLLOW';
 assert.throws(()=>verifyShadow({witness,paths,live}),/TRANSIENT_SHADOW_CHANGED_AFTER_COMMIT/);
});
