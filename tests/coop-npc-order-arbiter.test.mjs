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
 return {arbiter,bridge,issue,assignments,scene,entity,controller,
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
test('in-flight native warp blocks even same owner and emergency tactics without executing',()=>{
 const f=fixture();assert.equal(f.issue('GATE').success,true);
 f.entity.mode='WARP';f.advance(60001);
 assert.equal(f.issue('GATE').errorMsg,'COOP_NPC_ORDER_NATIVE_WARP_ACTIVE');
 assert.equal(f.issue('TACTICS').errorMsg,'COOP_NPC_ORDER_NATIVE_WARP_ACTIVE');
 assert.deepEqual([...f.bridge.blocksForSystem(sys,'TACTICS')],[501]);
 assert.equal(f.arbiter.snapshot().leases[0].owner,'GATE');
 assert.ok(f.arbiter.snapshot().leases[0].expiresAt>160001);
 assert.equal(f.executed,1);
});
test('native orbit order retains lease through TTL; competing patrol blocked until release',()=>{
 const f=fixture();assert.equal(f.issue('CIVILIAN').success,true);
 f.setController({entityID:501,systemID:sys,manualOrder:{type:'orbit',targetID:400}});
 f.advance(90000);
 assert.deepEqual([...f.bridge.blocksForSystem(sys,'PATROL')],[501]);
 assert.equal(f.issue('PATROL').errorMsg,'COOP_NPC_ORDER_NATIVE_COMMAND_ACTIVE');
 assert.equal(f.arbiter.snapshot().leases[0].owner,'CIVILIAN');
 f.setController({entityID:501,systemID:sys,manualOrder:null});
 assert.equal(f.issue('TACTICS').success,true);
});
test('unleased ongoing native attack cannot be overwritten by raid or peaceful orders',()=>{
 const f=fixture();f.setController({entityID:501,systemID:sys,manualOrder:{type:'attack',targetID:770},currentTargetID:770});
 assert.equal(f.issue('RAID').errorMsg,'COOP_NPC_ORDER_NATIVE_COMMAND_ACTIVE');
 assert.equal(f.issue('GATE').errorMsg,'COOP_NPC_ORDER_NATIVE_COMBAT_ACTIVE');
 assert.equal(f.issue('CIVILIAN').errorMsg,'COOP_NPC_ORDER_NATIVE_COMBAT_ACTIVE');
 assert.equal(f.issue('TACTICS',()=>({success:true}),'retreat-warp').success,true);
 assert.equal(f.executed,1);
});
test('accepted owned raid can continue its own combat order, while unrelated owners wait',()=>{
 const f=fixture();assert.equal(f.issue('RAID',()=>({success:true}),'attack').success,true);
 f.setController({entityID:501,systemID:sys,manualOrder:{type:'attack',targetID:770},currentTargetID:770});
 f.advance(70000);
 assert.equal(f.issue('RAID',()=>({success:true}),'attack').success,true);
 assert.equal(f.issue('PATROL').errorMsg,'COOP_NPC_ORDER_NATIVE_COMBAT_ACTIVE');
});
test('reentrant commands cannot bypass a pending native command, even for emergency owner',()=>{
 const f=fixture();let nested=null;
 const result=f.issue('CIVILIAN',()=>{nested=f.issue('TACTICS');return {success:true};});
 assert.equal(result.success,true);
 assert.equal(nested.errorMsg,'COOP_NPC_ORDER_LEASED');
 assert.equal(f.executed,1);
});
test('a definite native rejection restores the preempted owner lease',()=>{
 const f=fixture();f.issue('RAID');
 assert.equal(f.issue('TACTICS',()=>({success:false,errorMsg:'NO_CAPACITOR'})).errorMsg,'NO_CAPACITOR');
 assert.equal(f.arbiter.snapshot().leases[0].owner,'RAID');
 assert.equal(f.issue('PATROL').errorMsg,'COOP_NPC_ORDER_LEASED');
});
test('uncertain async result blocks future orders forever even after apparent idle',()=>{
 const f=fixture();assert.equal(f.issue('GATE',()=>Promise.resolve({success:true})).errorMsg,'COOP_NPC_ORDER_REPAIR_REQUIRED');
 f.advance(1000000);
 assert.equal(f.issue('TACTICS').errorMsg,'COOP_NPC_ORDER_REPAIR_REQUIRED');
 assert.equal(f.arbiter.snapshot().leases[0].phase,'OUTCOME_UNKNOWN');
});
test('two independent native ships at one scene keep separate owners',()=>{
 const f=fixture();f.assignments.push({pilotID:'coop-pilot-002',entityID:502,systemID:sys});
 const ships=new Map([[501,f.entity],[502,{itemID:502,kind:'ship',nativeNpc:true}]]);
 f.scene.getEntityByID=id=>ships.get(id);
 const controllers=new Map([[501,{entityID:501,systemID:sys}],[502,{entityID:502,systemID:sys}]]);
 const arb=createOrderArbiter({clock:()=>100000});
 const bridge=createOrderBridge({arbiter:arb,assignments:()=>f.assignments,
  sceneForSystem:()=>f.scene,getController:id=>controllers.get(id)});
 assert.equal(bridge.issue({entityID:501,owner:'RAID',action:'attack',execute:()=>({success:true})}).success,true);
 assert.equal(bridge.issue({entityID:502,owner:'PATROL',action:'orbit',execute:()=>({success:true})}).success,true);
 assert.deepEqual([...bridge.blocksForSystem(sys,'CIVILIAN')].sort(),[501,502]);
});
test('mismatching native ship ID or native state getter throwing fails closed',()=>{
 const f=fixture();f.entity.itemID=999;
 assert.equal(f.issue('GATE').errorMsg,'COOP_NPC_ORDER_NATIVE_PROOF_MISSING');
 f.entity.itemID=501;
 f.setController(null);
 assert.equal(f.issue('GATE').errorMsg,'COOP_NPC_ORDER_NATIVE_PROOF_MISSING');
 assert.equal(f.executed,0);
});

test('preexisting unowned orbit order cannot be hijacked after restart or identity change',()=>{
 const f=fixture();
 f.setController({entityID:501,systemID:sys,manualOrder:{type:'orbit',targetID:3001}});
 assert.equal(f.issue('CIVILIAN').errorMsg,'COOP_NPC_ORDER_NATIVE_COMMAND_ACTIVE');
 assert.equal(f.issue('GATE').errorMsg,'COOP_NPC_ORDER_NATIVE_COMMAND_ACTIVE');
 assert.equal(f.issue('RAID').errorMsg,'COOP_NPC_ORDER_NATIVE_COMMAND_ACTIVE');
 assert.equal(f.executed,0);
 assert.equal(f.issue('TACTICS',()=>({success:true}),'retreat-warp').success,true);
});

test('scene-level native orbit has no manualOrder but retains active owner after TTL',()=>{
 const f=fixture(); assert.equal(f.issue('CIVILIAN').success,true);
 f.entity.mode='ORBIT';f.entity.targetEntityID=3003;f.advance(65000);
 assert.equal(f.issue('PATROL').errorMsg,'COOP_NPC_ORDER_NATIVE_COMMAND_ACTIVE');
 assert.equal(f.arbiter.snapshot().leases[0].owner,'CIVILIAN');
 assert.ok(f.arbiter.snapshot().leases[0].expiresAt>165000);
 assert.equal(f.issue('CIVILIAN').success,true);
});
test('a native scene orbit without arbiter lease is not overwritten by planners',()=>{
 const f=fixture();f.entity.mode='ORBIT';
 assert.equal(f.issue('GATE').errorMsg,'COOP_NPC_ORDER_NATIVE_COMMAND_ACTIVE');
 assert.equal(f.issue('RAID').errorMsg,'COOP_NPC_ORDER_NATIVE_COMMAND_ACTIVE');
 assert.equal(f.issue('TACTICS',()=>({success:true}),'retreat-warp').success,true);
});
test('native manual orbit target is not treated as weapon combat by itself',()=>{
 const f=fixture();f.setController({entityID:501,systemID:sys,manualOrder:{type:'orbit',targetID:3004},currentTargetID:3004});
 assert.equal(f.issue('RAID').errorMsg,'COOP_NPC_ORDER_NATIVE_COMMAND_ACTIVE');
 assert.equal(f.executed,0);
});

test('unknown native controller order is not assumed idle or safe to overwrite',()=>{
 const f=fixture();f.setController({entityID:501,systemID:sys,manualOrder:{}});
 assert.equal(f.issue('CIVILIAN').errorMsg,'COOP_NPC_ORDER_NATIVE_COMMAND_ACTIVE');
 assert.equal(f.issue('RAID').errorMsg,'COOP_NPC_ORDER_NATIVE_COMMAND_ACTIVE');
 assert.equal(f.executed,0);
});

test('unrecognized native response is uncertain, never a definitive refusal',()=>{
 const f=fixture();
 assert.equal(f.issue('CIVILIAN',()=>({status:'QUEUED'})).errorMsg,'COOP_NPC_ORDER_REPAIR_REQUIRED');
 assert.equal(f.arbiter.snapshot().leases[0].phase,'OUTCOME_UNKNOWN');
 assert.equal(f.issue('TACTICS').errorMsg,'COOP_NPC_ORDER_REPAIR_REQUIRED');
});
test('throwing native acknowledgement getter fences the command permanently',()=>{
 const f=fixture();
 const ack=Object.defineProperty({},'success',{get(){throw Error('unknown native state');}});
 assert.equal(f.issue('GATE',()=>ack).errorMsg,'COOP_NPC_ORDER_REPAIR_REQUIRED');
 assert.equal(f.arbiter.snapshot().leases[0].phase,'OUTCOME_UNKNOWN');
 assert.equal(f.issue('TACTICS').errorMsg,'COOP_NPC_ORDER_REPAIR_REQUIRED');
});
test('throwing native then getter also fences the command instead of leaking ISSUING',()=>{
 const f=fixture();
 const ack=Object.defineProperty({success:true},'then',{get(){throw Error('uncertain promise');}});
 assert.equal(f.issue('RAID',()=>ack).errorMsg,'COOP_NPC_ORDER_REPAIR_REQUIRED');
 assert.equal(f.arbiter.snapshot().leases[0].phase,'OUTCOME_UNKNOWN');
 assert.equal(f.issue('TACTICS').errorMsg,'COOP_NPC_ORDER_REPAIR_REQUIRED');
});
