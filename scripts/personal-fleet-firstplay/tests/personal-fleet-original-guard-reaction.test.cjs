'use strict';
const {test}=require('node:test'),a=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const crypto=require('node:crypto');
const source=fs.readFileSync(path.join(__dirname,'../native/coopPersonalFleetOriginalGuardReaction.js'),'utf8');
const T='corporationRuntime',IT='items',CH='characters',F='coop-personal-fleet\u001f';
function f(){
 const owner=500,system=30000142,shipID=2301,playerShip=3003,attacker=3333;
 let now=1700000002000,enabled=true,fenced=true,poisoned=false,
  legal=true,durable=true,arbiter=true,accepted=true,calls=[],ackCalls=0;
 const session={characterID:owner,userid:55,socket:{destroyed:false},
  _space:{shipID:playerShip,systemID:system,initialStateSent:true}};
 const event={source:'EVEJS_ORIGINAL_KILLMAIL_APPLIED_DAMAGE_V1',
  ownerCharacterID:owner,ownerShipItemID:playerShip,systemID:system,
  attackerEntityID:attacker,damageAtMs:1700000001000};
 const guard={version:1,phase:'ACKED',operationID:'guard-1',signature:'a'.repeat(64),
  action:'DEFEND',targetEntityID:playerShip,ownerCharacterID:owner,
  shipItemID:shipID,systemID:system,assignmentID:'asgn-1',
  pilotID:'coop-pilot-123',actorGeneration:2};
 const db={
  [T]:{
   index:{version:1,ships:{[shipID]:{shipItemID:shipID,generation:1,
    ownerCharacterID:owner,assignmentID:guard.assignmentID,pilotID:guard.pilotID}}},
   ['roster:'+owner]:{version:1,revision:1,pilots:{
    [guard.pilotID]:{shipItemID:shipID,assignmentID:guard.assignmentID}}},
   [F+'actor-claims-v1']:{version:1,claims:{
    [shipID]:{ownerType:'PERSONAL_FLEET',generation:2}}},
   [F+'deploy-v1:'+guard.assignmentID]:{phase:'ACTIVE',shipItemID:shipID,actorGeneration:2},
   [F+'manual-order-v1:'+shipID]:guard,
   [F+'manual-order-operations-v1']:{version:1,operations:{
    [guard.operationID]:{phase:'ACKED',signature:guard.signature}}}},
  [CH]:{[owner]:{characterID:owner,accountId:55,shipID:playerShip}},
  [IT]:{items:{[shipID]:{itemID:shipID,ownerID:owner,categoryID:6,locationID:system}}}
 };
 const deps={
  'node:crypto':crypto,
  '../gameStore':{coopAtomicNativeRows:{mode:'SERVER_INTERNAL_FLAGGED',
   isPoisoned:()=>poisoned,transact:(tables,fn)=>{
    a.deepEqual([...tables],[T,IT,CH]);
    return fn({get:(t,k)=>db[t]?.[k]??null});
   }}},
  '../services/chat/sessionRegistry':{getSessions:()=>[session]},
  './coopPersonalFleetHangarBridge':{REGISTRY_KEY:'index',ROSTER_PREFIX:'roster:',
   validateIndex:x=>x,validateRoster:x=>x},
  './coopPersonalFleetNativeOrders':{OP_INDEX:F+'manual-order-operations-v1',
   key:x=>F+'manual-order-v1:'+x,signature:row=>row.signature},
  './coopPersonalFleetOriginalGuardAggression':{
   listRecent:()=>legal?[event]:[],read:()=>durable?event:null}
 };
 const m={exports:{}};
 vm.runInNewContext(source,{module:m,exports:m.exports,require:id=>{
  if(!(id in deps))throw Error('UNEXPECTED_SOURCE '+id);return deps[id];
 },Object,Number,Array,Set,Map},{filename:'PF97GuardReaction.js'});
 const reaction=m.exports.createOriginalGuardReaction({
  enabled:()=>enabled,allWritersFenced:()=>fenced,clock:()=>now,
  canIssuePersonalCombat:()=>arbiter,
  orders:{issue:c=>{calls.push(c);return accepted?{status:'NEEDS_RECONCILIATION'}:{status:'BLOCKED'};},
   reconcile:()=>{ackCalls++;return {status:'ACKED'};}}
 });
 return {reaction,db,guard,event,owner,shipID,attacker,session,
  orders:()=>calls,acks:()=>ackCalls,noEvidence:()=>legal=false,
  corruptEvidence:()=>durable=false,blockArbiter:()=>arbiter=false,
  allowArbiter:()=>arbiter=true,unknown:()=>accepted=false,
  unfence:()=>fenced=false,stop:()=>enabled=false,
  age:ms=>now+=ms};
}
test('PF97 native guard truly retaliates against the just-damaging NPC',()=>{
 const x=f(),r=x.reaction.tick();
 a.equal(r.status,'GUARD_SCANNED');a.equal(r.issued,1);a.equal(r.acked,1);
 const c=x.orders()[0];
 a.equal(c.action,'ATTACK');a.equal(c.targetEntityID,x.attacker);
 a.equal(c.shipItemID,x.shipID);a.equal(c.session,x.session);
 a.equal(c.actorGeneration,2);
});
test('PF97 guard cannot redispatch the same applied damage event',()=>{
 const x=f();x.reaction.tick();x.reaction.tick();
 a.equal(x.orders().length,1);a.equal(x.acks(),1);
});
test('PF97 no actual applied damage produces no autonomous combat',()=>{
 const x=f();x.noEvidence();
 a.equal(x.reaction.tick().issued,0);a.equal(x.orders().length,0);
});
test('PF97 damage target replaced before tick prevents a fake retaliation',()=>{
 const x=f();x.corruptEvidence();
 a.equal(x.reaction.tick().issued,0);
});
test('PF97 source guard must be original PF55 ACKED, not merely a client claim',()=>{
 const x=f();x.guard.phase='ISSUING';
 a.equal(x.reaction.tick().issued,0);
});
test('PF97 stock arbiter decline does not create a durable ISSUING order',()=>{
 const x=f();x.blockArbiter();
 a.equal(x.reaction.tick().issued,0);a.equal(x.orders().length,0);
 x.allowArbiter();a.equal(x.reaction.tick().issued,1);
});
test('PF97 native order commit-unknown gets a sticky no-replay fence',()=>{
 const x=f();x.unknown();x.reaction.tick();x.reaction.tick();
 a.equal(x.orders().length,1);a.equal(x.acks(),0);
});
test('PF97 callback cannot change owner session or target to client-supplied ID',()=>{
 const x=f();x.db[CH][x.owner].accountId=999;
 a.equal(x.reaction.tick().issued,0);
});
test('PF97 never triggers a new attack after native evidence expires',()=>{
 const x=f();x.age(120001);
 a.equal(x.reaction.tick().issued,0);
});
test('PF97 revoked original writer authority stops all guard combat',()=>{
 const x=f();x.unfence();
 a.equal(x.reaction.tick().status,'BLOCKED');
 a.equal(x.orders().length,0);
});
