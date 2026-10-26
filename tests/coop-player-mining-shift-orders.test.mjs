import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {createShiftOrders}=require('../integration/coopPlayerMiningShiftOrders.cjs');
const {FLEET_INDEX,CONTRACT}=require('../integration/coopPlayerMiningCompany.cjs');
const OP='coop-mining-shift:'+'f'.repeat(32),CORP=91001,NPC=91002,SYSTEM=30000144,FLEET=960004609;
function setup(){
 const data=new Map(),fleet={systemID:SYSTEM,fleetID:FLEET,ownerID:NPC,
  minerIDs:[1001,1002],haulerIDs:[1003],state:'mining',nextThinkAtMs:123};
 const row={version:1,status:'FUNDED',operationID:OP,corporationID:CORP,
  employerCorpID:NPC,systemID:SYSTEM,fleetID:FLEET,cycles:10,wageCents:900,
  minerIDs:[1001,1002],haulerIDs:[1003],directive:'MINE',commandSeq:0,commandState:'IDLE'};
 data.set(FLEET_INDEX(SYSTEM,FLEET),{version:1,operationID:OP,corporationID:CORP,employerCorpID:NPC,systemID:SYSTEM,fleetID:FLEET});
 data.set(CONTRACT(OP),structuredClone(row));
 let permitted=true,verified=true,enabled=true,poisoned=false,failedWrites=false,writes=0;
 const db={coopAtomicNativeRows:{mode:'SERVER_INTERNAL_FLAGGED',isPoisoned:()=>poisoned,transact(tables,fn){
  assert.deepEqual(tables,['corporationRuntime']);
  const backup=new Map([...data].map(([k,v])=>[k,structuredClone(v)]));
  try{return fn({get:(_t,key)=>data.get(key)||null,
   put:(_t,key,v)=>{data.set(key,structuredClone(v));writes++;if(failedWrites)throw Error('BROKEN_WRITE');}})}
  catch(e){data.clear();for(const [k,v] of backup)data.set(k,v);throw e;}
 }}};
 const svc=createShiftOrders({gameStore:db,access:{isMember:()=>permitted,canIndustry:()=>permitted},
  getFleet:()=>fleet,verifyNativeFleet:()=>verified,
  enabled:()=>enabled,clock:()=>1793030000000});
 const native={deactivate:()=>true,startHaul:()=>true,retreat:()=>3,canResume:()=>true,hasOriginalMinerCargo:()=>true};
 const assign=(command,expectedSeq=0,session={characterID:2001})=>svc.assign({session,
  corporationID:CORP,systemID:SYSTEM,fleetID:FLEET,operationID:OP,command,expectedSeq});
 const state=()=>data.get(CONTRACT(OP));
 return {svc,native,data,fleet,assign,state,writeCount:()=>writes,
  permit:v=>permitted=v,verify:v=>verified=v,enable:v=>enabled=v,poison:v=>poisoned=v,
  failWrites:v=>failedWrites=v};
}
test('disabled command never writes, original mining unaffected',()=>{
 const x=setup();x.enable(false);
 assert.equal(x.assign('HOLD').reason,'MINING_COMPANY_DISABLED');
 assert.equal(x.svc.dispatch({fleet:x.fleet,native:x.native}).status,'DISABLED');
 assert.equal(x.writeCount(),0);
});
test('funded shift has no new dispatcher unless command assigned',()=>{
 const x=setup(),r=x.svc.dispatch({fleet:x.fleet,native:x.native});
 assert.equal(r.status,'NATIVE_MINING_UNMODIFIED');assert.equal(r.skipNativeTick,false);
});
test('authorized hold stops native miner and persists issued receipt',()=>{
 const x=setup();assert.equal(x.assign('HOLD').status,'ORDER_QUEUED');
 const r=x.svc.dispatch({fleet:x.fleet,native:x.native});
 assert.equal(r.status,'NATIVE_ORDER_REQUESTED');assert.equal(r.skipNativeTick,true);
 assert.equal(x.fleet.state,'coop-hold');assert.equal(x.state().commandState,'NATIVE_REQUESTED');
 assert.equal(x.state().commandSeq,1);
});
test('hold continues suppressing stock mining after restart without new issue',()=>{
 const x=setup();x.assign('HOLD');x.svc.dispatch({fleet:x.fleet,native:x.native});
 x.fleet.state='mining';let stops=0;
 const r=x.svc.dispatch({fleet:x.fleet,native:{...x.native,deactivate:()=>{stops++;return true}}});
 assert.equal(r.status,'HOLD_ENFORCED');assert.equal(x.fleet.state,'coop-hold');
 assert.equal(stops,1);assert.equal(x.state().commandSeq,1);
});
test('resume uses stock mining state only after native safe-to-resume',()=>{
 const x=setup();x.assign('HOLD');x.svc.dispatch({fleet:x.fleet,native:x.native});
 assert.equal(x.assign('MINE',1).status,'ORDER_QUEUED');
 const b=x.svc.dispatch({fleet:x.fleet,native:{...x.native,canResume:()=>false}});
 assert.equal(b.reason,'MINING_SHIFT_RESUME_NOT_SAFE');assert.equal(x.fleet.state,'coop-hold');
 assert.equal(x.svc.dispatch({fleet:x.fleet,native:x.native}).status,'NATIVE_ORDER_REQUESTED');
 assert.equal(x.fleet.state,'mining');
});
test('haul requires original miner cargo, does not teleport or invent it',()=>{
 const x=setup();x.assign('HAUL');let attempts=0;
 const r=x.svc.dispatch({fleet:x.fleet,native:{...x.native,hasOriginalMinerCargo:()=>false,
  startHaul:()=>{attempts++;return true}}});
 assert.equal(r.status,'WAITING_FOR_ORIGINAL_MINER_CARGO');assert.equal(attempts,0);
 assert.equal(x.state().commandState,'PENDING');
 assert.equal(x.svc.dispatch({fleet:x.fleet,native:{...x.native,startHaul:()=>{attempts++;x.fleet.state='hauling';return true;}}}).status,'NATIVE_ORDER_REQUESTED');
 assert.equal(attempts,1);
 assert.equal(x.svc.dispatch({fleet:x.fleet,native:{...x.native,startHaul:()=>{attempts++;return true;}}}).status,'NATIVE_ORDER_PREVIOUSLY_REQUESTED');
 assert.equal(attempts,1);
});
test('haul in progress is never interrupted by a new hold directive',()=>{
 const x=setup();x.fleet.state='haulereturn';x.assign('HOLD');let calls=0;
 const r=x.svc.dispatch({fleet:x.fleet,native:{...x.native,deactivate:()=>{calls++;return true}}});
 assert.equal(r.status,'SAFE_HAUL_COMPLETION_PENDING');assert.equal(r.skipNativeTick,false);
 assert.equal(calls,0);assert.equal(x.state().commandState,'PENDING');
 x.fleet.state='mining';assert.equal(x.svc.dispatch({fleet:x.fleet,native:x.native}).status,'NATIVE_ORDER_REQUESTED');
});
test('native retreat attempts original warp once only',()=>{
 const x=setup();x.assign('RETREAT');let calls=0;
 const native={...x.native,retreat:()=>{calls++;x.fleet.state='retreating';return 3}};
 assert.equal(x.svc.dispatch({fleet:x.fleet,native}).status,'NATIVE_ORDER_REQUESTED');
 assert.equal(x.svc.dispatch({fleet:x.fleet,native}).status,'NATIVE_ORDER_PREVIOUSLY_REQUESTED');
 assert.equal(calls,1);
});
test('lost native acknowledgment fences replay and stops stock mining',()=>{
 const x=setup();x.assign('RETREAT');let calls=0;
 const native={...x.native,retreat:()=>{calls++;throw Error('ACK_LOST')}};
 const r=x.svc.dispatch({fleet:x.fleet,native});
 assert.equal(r.reason,'MINING_SHIFT_NATIVE_OUTCOME_UNKNOWN');
 assert.equal(x.state().commandState,'DISPATCH_UNKNOWN');
 assert.equal(x.svc.dispatch({fleet:x.fleet,native}).skipNativeTick,true);
 assert.equal(calls,1);
 assert.equal(x.assign('MINE',1).reason,'MINING_SHIFT_PENDING_NATIVE_OUTCOME');
});
test('crash after ISSUING write never issues second potentially completed order',()=>{
 const x=setup();x.assign('HAUL');x.state().commandState='ISSUING';let attempts=0;
 const r=x.svc.dispatch({fleet:x.fleet,native:{...x.native,startHaul:()=>{attempts++;return true}}});
 assert.equal(r.reason,'MINING_SHIFT_NATIVE_OUTCOME_UNKNOWN');assert.equal(attempts,0);
});
test('stale sequence, cross-corp operation and forged authorizations denied',()=>{
 const x=setup();assert.equal(x.assign('HOLD',2).reason,'MINING_SHIFT_STALE_COMMAND_SEQUENCE');
 x.permit(false);assert.equal(x.assign('HOLD').reason,'NATIVE_CORPORATION_PERMISSION_DENIED');
 x.permit(true);x.data.get(FLEET_INDEX(SYSTEM,FLEET)).operationID='foreign';
 assert.equal(x.assign('HOLD').reason,'MINING_SHIFT_CUSTODY_MISMATCH');
});
test('changed ship ownership or fleet membership blocks commands',()=>{
 const x=setup();x.assign('HOLD');x.verify(false);
 assert.equal(x.svc.dispatch({fleet:x.fleet,native:x.native}).reason,'MINING_SHIFT_NATIVE_FLEET_CHANGED');
 x.verify(true);x.fleet.haulerIDs=[2004];
 assert.equal(x.svc.dispatch({fleet:x.fleet,native:x.native}).reason,'MINING_SHIFT_NATIVE_FLEET_CHANGED');
});
test('state corruption and poisoned GameStore fail closed',()=>{
 const x=setup();x.poison(true);
 assert.equal(x.svc.dispatch({fleet:x.fleet,native:x.native}).reason,'NATIVE_ATOMIC_STORE_POISONED');
 x.poison(false);x.state().commandState='SYNTHETIC_SUCCESS';
 assert.equal(x.svc.dispatch({fleet:x.fleet,native:x.native}).reason,'MINING_SHIFT_BINDING_CORRUPT');
});
test('failed native transactional command fence does not call original native API',()=>{
 const x=setup();x.assign('HOLD');let calls=0;x.failWrites(true);
 const r=x.svc.dispatch({fleet:x.fleet,native:{...x.native,deactivate:()=>{calls++;return true}}});
 assert.match(r.reason,/MINING_SHIFT_COMMAND_FENCE_FAILED/);assert.equal(calls,0);
});
test('uncontracted ordinary NPC fleets are never modified',()=>{
 const x=setup();x.data.clear();let calls=0;
 const r=x.svc.dispatch({fleet:x.fleet,native:{...x.native,startHaul:()=>{calls++;return true}}});
 assert.equal(r.status,'UNCONTRACTED');assert.equal(r.skipNativeTick,false);assert.equal(calls,0);
});
