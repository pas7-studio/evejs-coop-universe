import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {createOrderArbiter}=require('../integration/coopNpcOrderArbiter.cjs');
const {createOrderBridge}=require('../integration/coopNpcOrderBridge.cjs');
const sys=30000144,pilot='coop-pilot-001';
function fixture(){
 let now=100000,executed=0;
 let assignment={pilotID:pilot,entityID:501,systemID:sys};
 const assignments=[assignment];
 const entity={itemID:501,kind:'ship',nativeNpc:true};
 const scene={systemID:sys,getEntityByID:id=>id===501?entity:null};
 let controller={entityID:501,systemID:sys,manualOrder:null};
 const arbiter=createOrderArbiter({clock:()=>now,leaseMs:60000});
 const bridge=createOrderBridge({arbiter,assignments:()=>assignments,
  sceneForSystem:()=>scene,getController:()=>controller});
 const issue=(owner,execute=()=>({success:true}),action='warp')=>bridge.issue({entityID:501,owner,action,
  execute:()=>{executed++;return execute();}});
 return {arbiter,bridge,issue,assignments,scene,entity,
  get executed(){return executed;},advance:ms=>{now+=ms;},
  setController:v=>{controller=v;}};
}
test('civilian, gate and raid cannot overwrite another active owner; native executor runs exactly once',()=>{
 const f=fixture();
 assert.equal(f.issue('CIVILIAN').success,true);
 assert.equal(f.issue('GATE').errorMsg,'COOP_NPC_ORDER_LEASED');
 assert.equal(f.issue('RAID').errorMsg,'COOP_NPC_ORDER_LEASED');
 assert.equal(f.executed,1);
 assert.deepEqual([...f.bridge.blocksForSystem(sys,'RAID')],[501]);
 assert.equal(f.issue('CIVILIAN').success,true);
 assert.equal(f.executed,2);
});
test('genuine tactics can preempt, while a later noncombat order cannot preempt tactical lease',()=>{
 const f=fixture();
 assert.equal(f.issue('RAID').success,true);
 assert.equal(f.issue('TACTICS').success,true);
 assert.equal(f.issue('GATE').errorMsg,'COOP_NPC_ORDER_LEASED');
 assert.equal(f.issue('PATROL').errorMsg,'COOP_NPC_ORDER_LEASED');
 assert.equal(f.executed,2);
 assert.equal(f.arbiter.snapshot().leases[0].owner,'TACTICS');
});
test('on native failure no lease is gained; thrown or async outcomes are fenced as ambiguous',()=>{
 const f=fixture();
 assert.equal(f.issue('RAID',()=>({success:false,errorMsg:'WARP_DENIED'})).errorMsg,'WARP_DENIED');
 assert.equal(f.issue('GATE').success,true);
 f.advance(60001);
 assert.equal(f.issue('RAID',()=>{throw new Error('unknown outcome')}).errorMsg,'COOP_NPC_ORDER_REPAIR_REQUIRED');
 f.advance(9999999);
 assert.equal(f.issue('TACTICS').errorMsg,'COOP_NPC_ORDER_REPAIR_REQUIRED');
 assert.equal(f.arbiter.snapshot().counters.ambiguous,1);
 assert.equal(f.arbiter.clearWithNativeProof({systemID:sys,entityID:501,pilotID:pilot,owner:'RAID',shipAbsent:true}).status,'NEEDS_OPERATOR_REPAIR');
});
test('missing native scene, stale identity, player ship and wrong controller fail closed',()=>{
 const f=fixture();
 f.entity.nativeNpc=false;
 assert.equal(f.issue('RAID').errorMsg,'COOP_NPC_ORDER_NATIVE_PROOF_MISSING');
 f.entity.nativeNpc=true; f.entity.session={characterID:4};
 assert.equal(f.issue('RAID').errorMsg,'COOP_NPC_ORDER_NATIVE_PROOF_MISSING');
 delete f.entity.session;
 f.setController({entityID:501,systemID:30000142});
 assert.equal(f.issue('RAID').errorMsg,'COOP_NPC_ORDER_NATIVE_PROOF_MISSING');
 f.setController({entityID:501,systemID:sys});
 f.assignments.push({pilotID:'coop-pilot-002',entityID:501,systemID:sys});
 assert.equal(f.issue('RAID').errorMsg,'COOP_NPC_ORDER_IDENTITY_UNVERIFIED');
 assert.equal(f.executed,0);
});
test('multiple hulls owned by one pilot are blocked even when one hull is locally valid',()=>{
 const f=fixture();
 f.assignments.push({pilotID:pilot,entityID:502,systemID:sys});
 assert.equal(f.issue('RAID').errorMsg,'COOP_NPC_ORDER_IDENTITY_UNVERIFIED');
});
test('leases expire; old pilot identity cannot take control of another pilot while live',()=>{
 const f=fixture();
 assert.equal(f.issue('GATE').success,true);
 f.assignments.splice(0,1,{pilotID:'coop-pilot-009',entityID:501,systemID:sys});
 assert.equal(f.issue('CIVILIAN').errorMsg,'COOP_NPC_ORDER_LEASED');
 f.advance(60001);
 assert.equal(f.issue('CIVILIAN').success,true);
 assert.equal(f.arbiter.snapshot().leases[0].pilotID,'coop-pilot-009');
});
test('explicit proof-gated release and bounded active lease cap',()=>{
 const f=fixture();f.issue('GATE');
 assert.equal(f.arbiter.clearWithNativeProof({systemID:sys,entityID:501,pilotID:pilot,owner:'GATE'}).status,'PROOF_REQUIRED');
 assert.equal(f.arbiter.clearWithNativeProof({systemID:sys,entityID:501,pilotID:pilot,owner:'RAID',controllerIdle:true}).status,'WRONG_OWNER');
 assert.equal(f.arbiter.clearWithNativeProof({systemID:sys,entityID:501,pilotID:pilot,owner:'GATE',controllerIdle:true}).status,'RELEASED');
 assert.equal(f.issue('RAID').success,true);
 const capped=createOrderArbiter({clock:()=>100,leaseMs:60000,maxEntries:1});
 const opt=(id,owner)=>capped.issue({entityID:id,pilotID:pilot,systemID:sys,owner,action:'warp',execute:()=>({success:true}),verify:()=>true});
 assert.equal(opt(1,'RAID').success,true);
 assert.equal(opt(2,'PATROL').errorMsg,'COOP_NPC_ORDER_CAP_REACHED');
});
test('same native entity ID in different systems does not accidentally share a lease',()=>{
 const f=fixture();f.issue('RAID');
 const other=f.arbiter.issue({entityID:501,systemID:30000142,pilotID:'coop-pilot-002',owner:'GATE',action:'warp',execute:()=>({success:true}),verify:()=>true});
 assert.equal(other.success,true);
 assert.equal(f.arbiter.snapshot().leases.length,2);
});
