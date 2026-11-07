'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createNativeRemovalGuard,checkOriginalRemoval}=require('../native/coopPersonalFleetNativeRemovalGuard.cjs');
function makeStore(entity=null,controller=null){return {
 getNativeEntity:id=>entity,getNativeController:id=>controller
}}
const ID=900001;
const pfEntity={entityID:ID,personalFleetOriginal:true,ownerID:202};
const pfController={entityID:ID,operatorKind:'PERSONAL_FLEET'};
const lock={assignmentID:'pf-a',sourcePF54Hash:'abc'};
const allow=()=>({known:true,lock:null});
const held=()=>({known:true,lock});
const guard=(reader,enabled=()=>false)=>createNativeRemovalGuard({readShipLock:reader,enabled});

test('ordinary native NPC deletion remains allowed with proven no original ship lock',()=>{
 assert.equal(guard(allow).checkOriginalRemoval(ID,makeStore({entityID:ID},{})).success,true);
});
test('original ship native entity marker blocks cleanup with no installed authority',()=>{
 assert.equal(checkOriginalRemoval(ID,makeStore(pfEntity,{})).errorMsg,'PF59_ORIGINAL_SHIP_GENERIC_CLEANUP_FORBIDDEN');
});
test('PF controller marker blocks cleanup even when entity row is missing',()=>{
 assert.equal(guard(allow).checkOriginalRemoval(ID,makeStore(null,pfController)).success,false);
});
test('original durable lock blocks cleanup even when BOTH native records are missing',()=>{
 assert.equal(guard(held).checkOriginalRemoval(ID,makeStore(null,null)).errorMsg,'PF59_ORIGINAL_SHIP_GENERIC_CLEANUP_FORBIDDEN');
});
test('PF entity marker blocks even with externally reported lock absent',()=>{
 assert.equal(guard(allow).checkOriginalRemoval(ID,makeStore(pfEntity,null)).success,false);
});
test('terminal-like native rows are NOT cleanup authorization',()=>{
 for(const phase of ['DOCKED','LOST','DESTROYED','DISMISSED']){
  const row={...pfEntity,status:phase};
  assert.equal(guard(allow).checkOriginalRemoval(ID,makeStore(row,null)).success,false,phase);
 }
});
test('feature on + missing original lock authority blocks ordinary NPC cleanup',()=>{
 assert.equal(guard(null,()=>true).checkOriginalRemoval(ID,makeStore({},{})).errorMsg,'PF59_ORIGINAL_LOCK_AUTHORITY_NOT_INSTALLED');
});
test('feature off + no authority leaves existing ordinary NPC cleanup alone',()=>{
 assert.equal(guard(null).checkOriginalRemoval(ID,makeStore({},{})).success,true);
});
test('original lock read errors or unknown results block all deletion',()=>{
 for(const reader of [()=>{throw Error('sqlite');},()=>undefined,()=>({known:false,lock:null}),()=>({known:true}),()=>({known:true,lock:undefined}),()=>({known:true,lock:[]})]){
  assert.equal(guard(reader).checkOriginalRemoval(ID,makeStore()).success,false);
 }
});
test('native record read errors block cleanup without side effects',()=>{
 const bad={getNativeEntity(){throw Error('db');},getNativeController(){throw Error('db');}};
 assert.equal(guard(allow).checkOriginalRemoval(ID,bad).errorMsg,'PF59_NATIVE_IDENTITY_READ_UNKNOWN');
});
test('invalid entity IDs and missing store are rejected',()=>{
 for(const id of [0,-1,3.14,Number.MAX_SAFE_INTEGER+1,'123',null])
  assert.equal(guard(allow).checkOriginalRemoval(id,makeStore()).success,false);
 assert.equal(guard(allow).checkOriginalRemoval(ID,{}).success,false);
});
test('conflicting native marker with old lock blocks stale-generation cleanup',()=>{
 assert.equal(guard(held).checkOriginalRemoval(ID,makeStore({entityID:ID,operatorKind:'OTHER'},pfController)).success,false);
});
test('source hook blocks all removal before scene, unregister or cascade',()=>{
 let writes=0;
 const fakeDestroy=(store,gate)=>{
  const decision=gate.checkOriginalRemoval(ID,store);
  if(decision.success!==true)return decision;
  writes++;writes++;writes++;
  return {success:true};
 };
 const g=guard(held);
 assert.equal(fakeDestroy(makeStore(pfEntity,pfController),g).success,false);
 assert.equal(writes,0);
 assert.equal(fakeDestroy(makeStore({},{}),guard(allow)).success,true);
 assert.equal(writes,3);
});
test('feature gate returning malformed value blocks even ordinary cleanup',()=>{
 assert.equal(guard(allow,()=>undefined).checkOriginalRemoval(ID,makeStore()).success,false);
 assert.equal(guard(allow,()=>{throw Error('broken');}).checkOriginalRemoval(ID,makeStore()).success,false);
});
test('original SQLite GameStore authority distinguishes missing (null), unknown (undefined), active lock',()=>{
 const {createOriginalGameStoreLockReader}=require('../native/coopPersonalFleetNativeRemovalGuard.cjs');
 let value=null,poisoned=false;
 const gameStore={coopAtomicNativeRows:{mode:'SERVER_INTERNAL_FLAGGED',
  transact(tables,callback){assert.deepEqual(tables,['corporationRuntime']);
   return callback({get:(table,key)=>{
    assert.equal(table,'corporationRuntime');
    assert.equal(key,'coop-personal-fleet\u001fhandoff-ship-v1:'+ID);
    return value;
   }});},
  isPoisoned:()=>poisoned}};
 const reader=createOriginalGameStoreLockReader(gameStore);
 assert.deepEqual(reader(ID),{known:true,lock:null});
 value=lock;assert.deepEqual(reader(ID),{known:true,lock});
 value=undefined;assert.deepEqual(reader(ID),{known:false});
 poisoned=true;assert.deepEqual(reader(ID),{known:false});
 assert.throws(()=>createOriginalGameStoreLockReader({}),/AUTHORITY_REQUIRED/);
});
