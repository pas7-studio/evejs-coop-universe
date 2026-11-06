'use strict';
/** PF75: the ACTUAL PF55 durable orders must call the ACTUAL PF55 runtime
 * executor OBJECT. Previous durable module required a callable with `.supports`,
 * while createNpcRuntimeExecutor returns Object.freeze({execute,probe,supports}).
 * This contract test uses the real PF53->PF52->PF54 SQLite fixture, not a
 * synthetic replacement of either PF55 module. Scene/runtime are isolated;
 * never claim this is a live original EveJS game server acceptance.
 */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const F=require('./fixture.cjs');
const {createNpcRuntimeExecutor}=require('../native/coopPersonalFleetNpcRuntimeExecutor.cjs');

function withNative(action,fn,settings={}){
 const tmp=F.tempDb();let f;
 try{
  f=F.open(tmp.file);f.makeActive();
  let calls=[], bridges=[], trusted=true, allowed=true;
  const physical={kind:'ship',itemID:F.SHIP,nativeNpc:true,mode:'STOP',session:null};
  const controller={entityID:F.SHIP,systemID:F.SYSTEM};
  const target={kind:'ship',itemID:F.TARGET};
  const scene={systemID:F.SYSTEM,getEntityByID(id){return id===F.SHIP?physical:id===F.TARGET?target:null}};
  const npcRuntime={
   issueOrder(...v){calls.push(['issueOrder',...v]);return {success:true}},
   stop(...v){calls.push(['stop',...v]);return {success:true}},
   issueAttackOrder(...v){calls.push(['attack',...v]);return {success:true}},
   warpToEntity(...v){calls.push(['warp',...v]);return {success:true}}
  };
  const bridge={issue(v){bridges.push(v);return v.execute()}};
  const executor=createNpcRuntimeExecutor({npcRuntime,orderBridge:bridge,
   sceneForSystem:()=>scene,getController:()=>controller,
   verifyPersonalClaim:()=>trusted,authorizeTarget:()=>allowed,
   enabled:()=>f.shared.enabled});
  assert.equal(typeof executor,'object');
  assert.equal(typeof executor.execute,'function');
  assert.equal(typeof executor.supports,'function');
  const make=(nativeExecutor)=>F.pf55.createPersonalFleetNativeOrders({
   gameStore:f.gameStore,pf52:F.pf52,access:{isOwner:f.deps.access.isOwner},
   verifyExclusiveOwnership:()=>f.shared.exclusive,
   verifyNativeActor:()=>true,verifyTarget:()=>true,verifyOriginalControl:()=>true,
   nativeExecutor,verifyPersistedNativeOrder:()=>null,
   allWritersFenced:()=>f.shared.writers,
   enabled:()=>f.shared.enabled,clock:()=>f.shared.clock
  });
  const orders=make(settings.overrideExecutor??executor);
  const c=F.command({action,operationID:'pf75-'+action.toLowerCase()+'-1'});
  return fn({f,c,orders,executor,make,physical,controller,target,scene,calls,bridges,
   setTrusted:x=>trusted=x,setAllowed:x=>allowed=x});
 }finally{f?.close();tmp.cleanup();}
}

for(const [action,method] of [['FOLLOW','issueOrder'],['HOLD','stop'],
 ['ATTACK','attack'],['WARP','warp']]){
 test('real PF55 object executor -> durable '+action+' -> original runtime (once)',()=>
  withNative(action,({f,c,orders,calls,bridges})=>{
   const out=orders.issue(c);
   assert.equal(out.status,'NEEDS_RECONCILIATION',JSON.stringify(out));
   assert.equal(out.nativeAck,'REPORTED_SUCCESS');
   assert.equal(calls.length,1);
   assert.equal(calls[0][0],method);
   assert.equal(bridges.length,1);
   assert.equal(bridges[0].owner,'PERSONAL_FLEET');
   const row=f.get('corporationRuntime',F.pf55.key(F.SHIP));
   assert.equal(row.phase,'ISSUING');
   const again=orders.issue(c);
   assert.equal(again.reason,'PF55_ISSUING_RECONCILIATION_REQUIRED');
   assert.equal(calls.length,1);
   assert.equal(bridges.length,1);
  }));
}

test('no defensive combat policy: object supports() blocks BEFORE durable ISSUING',()=>
 withNative('DEFEND',({f,c,orders,calls,bridges})=>{
  assert.equal(orders.issue(c).reason,'PF55_NATIVE_ACTION_NOT_WIRED');
  assert.equal(f.get('corporationRuntime',F.pf55.key(F.SHIP)),null);
  assert.equal(calls.length,0);assert.equal(bridges.length,0);
 }));

test('native source mismatch: sticky durable intent and zero runtime effects',()=>
 withNative('FOLLOW',({f,c,orders,physical,calls,bridges})=>{
  physical.itemID=9999;
  const out=orders.issue(c);
  assert.equal(out.status,'NEEDS_RECONCILIATION');
  assert.equal(out.nativeAck,'NOT_PROVEN');
  assert.equal(bridges.length,0);assert.equal(calls.length,0);
  assert.equal(f.get('corporationRuntime',F.pf55.key(F.SHIP)).phase,'ISSUING');
  assert.equal(orders.issue(c).reason,'PF55_ISSUING_RECONCILIATION_REQUIRED');
 }));

test('invalid executor object without execute() fails at composition, before durable writes',()=>
 withNative('FOLLOW',({f,make})=>{
  assert.throws(()=>make({supports:()=>true}),/PF55_AUTHORITIES_REQUIRED/);
  assert.equal(f.get('corporationRuntime',F.pf55.key(F.SHIP)),null);
 }));

test('legacy function executor supported only when it has explicit supports()',()=>
 withNative('FOLLOW',({f,c,make})=>{
  let count=0;const compat=()=>{count++;return {success:true}};
  compat.supports=()=>true;
  const orders=make(compat);
  assert.equal(orders.issue(c).nativeAck,'REPORTED_SUCCESS');
  assert.equal(count,1);
  assert.throws(()=>make(()=>({success:true})),/PF55_AUTHORITIES_REQUIRED/);
 }));
