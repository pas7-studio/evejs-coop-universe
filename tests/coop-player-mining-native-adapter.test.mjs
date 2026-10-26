import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {createAdapter}=require('../integration/coopPlayerMiningFleetTick.cjs');
const {FLEET_INDEX,CONTRACT}=require('../integration/coopPlayerMiningCompany.cjs');
const OP='coop-mining-shift:'+'b'.repeat(32),CORP=7101,NPC=7201,SYSTEM=30000144,FLEET=960004609;
function fixture(bound=true){
 const records=new Map(),fleet={fleetID:FLEET,systemID:SYSTEM,source:'startup',
   minerEntityIDs:[1001,1002],haulerEntityIDs:[1003],state:'mining'};
 const ships=new Map([1001,1002,1003].map(id=>[id,{itemID:id,kind:'ship',nativeNpc:true,
  mode:'IDLE',activeModuleEffects:new Map()}]));
 const entities=new Map([1001,1002,1003].map(id=>[id,{entityID:id,systemID:SYSTEM,
  ownerID:NPC,transient:false}]));
 const controllers=new Map([1001,1002,1003].map(id=>[id,{entityID:id,systemID:SYSTEM,
  transient:false}]));
 const cargo=new Map([[1001,[{cargoID:3001,typeID:34,quantity:10,ownerID:NPC,
  entityID:1001,transient:false,moduleID:0}]]]);
 if(bound){records.set(FLEET_INDEX(SYSTEM,FLEET),{version:1,operationID:OP,
 corporationID:CORP,employerCorpID:NPC,systemID:SYSTEM,fleetID:FLEET});
 records.set(CONTRACT(OP),{version:1,status:'FUNDED',operationID:OP,
 corporationID:CORP,employerCorpID:NPC,systemID:SYSTEM,fleetID:FLEET,
 minerIDs:[1001,1002],haulerIDs:[1003],directive:'MINE',commandSeq:0,commandState:'IDLE'});}
 const db={read(table,p){assert.equal(table,'corporationRuntime');
  const key=p.slice(1).replace('/',"\u001f");
  return records.has(key)?{success:true,data:structuredClone(records.get(key))}:
   {success:false,errorMsg:'ENTRY_NOT_FOUND'};},coopAtomicNativeRows:{mode:'SERVER_INTERNAL_FLAGGED',isPoisoned:()=>false,
 transact(t,fn){return fn({get:(_,k)=>records.get(k)||null,put:(_,k,v)=>records.set(k,structuredClone(v))})}}};
 const scene={systemID:SYSTEM,getEntityByID:id=>ships.get(id)||null};
 const store={getNativeEntity:id=>entities.get(id)||null,
 getNativeController:id=>controllers.get(id)||null,
 listNativeCargoForEntity:id=>cargo.get(id)||[]};
 const a=createAdapter({gameStore:db,store,access:{isMember:()=>true,canIndustry:()=>true},
 getFleetRecord:()=>fleet,getScene:()=>scene,enabled:()=>true,clock:()=>1793030000000});
 const run=(args={})=>a.beforeTick({scene,fleetRecord:fleet,now:1793030000000,
 hooks:{},startHaul:()=>true,deactivate:()=>{},retreat:()=>3,...args});
 const assign=(command,expectedSeq=0)=>a.assign({session:{characterID:90},corporationID:CORP,
 systemID:SYSTEM,fleetID:FLEET,operationID:OP,command,expectedSeq});
 return {a,run,assign,fleet,records,ships,entities,controllers,cargo};
}
test('strict native adapter verifies stock startup fleet and original durable pilot hulls',()=>{
 const x=fixture();assert.deepEqual(x.a.verified({systemID:SYSTEM,fleetID:FLEET}),{
  systemID:SYSTEM,fleetID:FLEET,ownerID:NPC,minerIDs:[1001,1002],haulerIDs:[1003]});
 x.entities.get(1003).ownerID=9999;
 assert.equal(x.a.verified({systemID:SYSTEM,fleetID:FLEET}),null);
});
test('uncontracted native startup fleet remains on original stock loop',()=>{
 const x=fixture(false);assert.equal(x.run(),false);
 x.controllers.delete(1002);assert.equal(x.run(),false);
});
test('HOLD command deactivates original miner effects before suppressing tick',()=>{
 const x=fixture();x.ships.get(1001).activeModuleEffects.set(1,{targetID:2});
 assert.equal(x.assign('HOLD').status,'ORDER_QUEUED');let stopped=0;
 assert.equal(x.run({deactivate:()=>{stopped++;x.ships.get(1001).activeModuleEffects.clear();}}),true);
 assert.equal(stopped,1);assert.equal(x.fleet.state,'coop-hold');
});
test('HAUL never calls native warp with forged or transient cargo',()=>{
 const x=fixture();x.assign('HAUL');let calls=0;
 x.cargo.get(1001)[0].transient=true;
 assert.equal(x.run({startHaul:()=>{calls++;return true}}),false);
 assert.equal(calls,0);assert.equal(x.records.get(CONTRACT(OP)).commandState,'PENDING');
 x.cargo.get(1001)[0].transient=false;
 assert.equal(x.run({startHaul:()=>{calls++;x.fleet.state='hauling';return true}}),false);
 assert.equal(calls,1);assert.equal(x.records.get(CONTRACT(OP)).commandState,'NATIVE_REQUESTED');
});
test('missing physical contracted hauler quarantines native think',()=>{
 const x=fixture();x.assign('HOLD');x.ships.delete(1003);
 assert.equal(x.run(),true);assert.equal(x.records.get(CONTRACT(OP)).commandState,'PENDING');
});
