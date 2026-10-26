import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {createOrderArbiter}=require('../integration/coopNpcOrderArbiter.cjs');
const {createOrderBridge}=require('../integration/coopNpcOrderBridge.cjs');
function fixture(claim=()=>'ASSIGNED'){
 let now=100000,executed=0;
 const pilotID='coop-pilot-001',systemID=101,entityID=501;
 const ship={itemID:entityID,kind:'ship',nativeNpc:true,corporationID:31};
 const scene={systemID,getEntityByID:id=>id===entityID?ship:null};
 const controller={systemID,entityID,manualOrder:null};
 const arb=createOrderArbiter({clock:()=>now,leaseMs:30000});
 const bridge=createOrderBridge({arbiter,assignments:()=>[{systemID,entityID,pilotID}],
  sceneForSystem:()=>scene,getController:()=>controller,warShipClaim:claim});
 const issue=(owner,action='attack')=>bridge.issue({systemID,entityID,owner,action,
  execute:()=>{executed++;return {success:true}}});
 return {issue,bridge,arb,ship,controller,advance:ms=>{now+=ms},get executed(){return executed}};
}
test('WAR commands only verified registered hulls, with no involuntary takeover',()=>{
 const no=fixture(()=>'UNASSIGNED');
 assert.equal(no.issue('WAR').errorMsg,'COOP_NPC_ORDER_WAR_SHIP_UNVERIFIED');
 assert.equal(no.issue('RAID').success,true);
 assert.equal(no.issue('WAR').errorMsg,'COOP_NPC_ORDER_WAR_SHIP_UNVERIFIED');
 const f=fixture();
 assert.equal(f.issue('WAR').success,true);
 assert.equal(f.issue('RAID').errorMsg,'COOP_NPC_ORDER_WAR_SHIP_RESERVED');
 assert.equal(f.issue('CIVILIAN').errorMsg,'COOP_NPC_ORDER_WAR_SHIP_RESERVED');
 assert.equal(f.issue('GATE').errorMsg,'COOP_NPC_ORDER_WAR_SHIP_RESERVED');
 assert.equal(f.executed,1);
});
test('war hull remains reserved after arbiter lease expiry',()=>{
 const f=fixture();assert.equal(f.issue('WAR').success,true);
 f.advance(30001);
 assert.equal(f.issue('RAID').errorMsg,'COOP_NPC_ORDER_WAR_SHIP_RESERVED');
 assert.equal(f.issue('WAR').success,true);
 assert.equal(f.executed,2);
});
test('TACTICS emergency may preempt WAR, but WAR cannot preempt TACTICS',()=>{
 const f=fixture();
 assert.equal(f.issue('WAR').success,true);
 assert.equal(f.issue('TACTICS','retreat-warp').success,true);
 assert.equal(f.issue('WAR').errorMsg,'COOP_NPC_ORDER_LEASED');
 assert.equal(f.arb.snapshot().leases[0].owner,'TACTICS');
});
test('unknown registry claim fences all normal directors, never guesses no reservation',()=>{
 const f=fixture(()=>{throw Error('database damaged')});
 assert.equal(f.issue('WAR').errorMsg,'COOP_NPC_ORDER_WAR_SHIP_UNVERIFIED');
 assert.equal(f.issue('RAID').errorMsg,'COOP_NPC_ORDER_WAR_SHIP_RESERVED');
 assert.equal(f.issue('PATROL').errorMsg,'COOP_NPC_ORDER_WAR_SHIP_RESERVED');
 assert.equal(f.issue('TACTICS','retreat-warp').success,true);
});
test('WAR cannot hijack unleased existing native attack after restart',()=>{
 const f=fixture();
 f.controller.manualOrder={type:'attack',targetID:777};f.controller.currentTargetID=777;
 assert.equal(f.issue('WAR').errorMsg,'COOP_NPC_ORDER_NATIVE_COMMAND_ACTIVE');
 assert.equal(f.executed,0);
});
test('WAR may continue its accepted native attack order while others cannot',()=>{
 const f=fixture();
 assert.equal(f.issue('WAR').success,true);
 f.controller.manualOrder={type:'attack',targetID:777};f.controller.currentTargetID=777;
 assert.equal(f.issue('WAR').success,true);
 assert.equal(f.issue('TACTICS','retreat-warp').success,true);
 assert.equal(f.executed,3);
});
test('WAR may not override native warp or unverified physical hull',()=>{
 const f=fixture();f.ship.mode='WARP';
 assert.equal(f.issue('WAR').errorMsg,'COOP_NPC_ORDER_NATIVE_WARP_ACTIVE');
 f.ship.mode='IDLE';f.ship.nativeNpc=false;
 assert.equal(f.issue('WAR').errorMsg,'COOP_NPC_ORDER_NATIVE_PROOF_MISSING');
 assert.equal(f.executed,0);
});
