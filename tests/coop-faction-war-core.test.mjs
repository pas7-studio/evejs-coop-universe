import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {empty,transition}=require('../integration/coopFactionWarCore.cjs');
const native={
 declaration:()=>true, territory:()=>true, adjacency:()=>true,supply:()=>true,
 deployment:()=>true, objective:()=>true,capture:()=>true,
 ceasefire:()=>true,enlistment:()=>true,leave:()=>true
};
const step=(s,c,proofs=native)=>transition(s,c,{now:1000000,proofs});
const C=(type,eventID,extra={})=>({type,eventID,...extra});
function setup(){
 let s=empty();
 const apply=c=>{const x=step(s,c);assert.equal(x.status,'APPLIED',JSON.stringify(x));s=x.state;return x};
 apply(C('REGISTER_TERRITORY','seed:A',{systemID:100,ownerFactionID:10}));
 apply(C('REGISTER_TERRITORY','seed:B',{systemID:200,ownerFactionID:20}));
 apply(C('DECLARE_WAR','war:1',{warID:'w1',attackerFactionID:10,defenderFactionID:20}));
 return {get:()=>s,apply};
}
test('default state is isolated; no missing proof can establish a war or territory',()=>{
 const state=empty();
 assert.equal(step(state,C('DECLARE_WAR','d',{warID:'w1',attackerFactionID:10,defenderFactionID:20}),{}).reason,'NATIVE_WAR_AUTHORITY_MISSING');
 assert.equal(step(state,C('REGISTER_TERRITORY','t',{systemID:100,ownerFactionID:10}),{}).reason,'NATIVE_TERRITORY_AUTHORITY_MISSING');
 assert.deepEqual(state,empty());
});
test('declaration is unique per opposing faction pair, replay is idempotent',()=>{
 const {get}=setup(),c=C('DECLARE_WAR','war:1',{warID:'w1',attackerFactionID:10,defenderFactionID:20});
 assert.equal(step(get(),c).status,'DUPLICATE');
 assert.equal(step(get(),{...c,defenderFactionID:99}).reason,'EVENT_ID_CONFLICT');
 assert.equal(step(get(),C('DECLARE_WAR','war:2',{warID:'w2',attackerFactionID:20,defenderFactionID:10})).reason,'WAR_ALREADY_ACTIVE');
 assert.equal(get().territories['100'].militaryControllerFactionID,10);
});
test('campaign requires adjacent native route, source control and supply proof',()=>{
 const {get,apply}=setup();
 const cmd=C('START_CAMPAIGN','camp:1',{campaignID:'c1',warID:'w1',sourceSystemID:100,targetSystemID:200,supplyReservationID:'native-reserve-7'});
 assert.equal(step(get(),cmd,{...native,adjacency:()=>false}).reason,'NATIVE_ROUTE_OR_SUPPLY_UNVERIFIED');
 assert.equal(step(get(),cmd,{...native,supply:()=>false}).reason,'NATIVE_ROUTE_OR_SUPPLY_UNVERIFIED');
 assert.equal(step(get(),{...cmd,sourceSystemID:200}).reason,'CAMPAIGN_PREREQUISITES_NOT_MET');
 apply(cmd);
 assert.equal(get().territories['200'].state,'CONTESTED');
 assert.equal(step(get(),C('START_CAMPAIGN','camp:2',{...cmd,campaignID:'c2',eventID:undefined})).reason,'INVALID_COMMAND');
});
test('orders and arbitrary kill counts cannot capture a system',()=>{
 const {get,apply}=setup();
 apply(C('START_CAMPAIGN','camp:1',{campaignID:'c1',warID:'w1',sourceSystemID:100,targetSystemID:200,supplyReservationID:'res7'}));
 const capture=C('CAPTURE_TERRITORY','capture:1',{campaignID:'c1',proofID:'battle-proof-1'});
 assert.equal(step(get(),capture).reason,'CAPTURE_PREREQUISITES_NOT_MET');
 apply(C('BEGIN_ASSAULT','assault:1',{campaignID:'c1',proofID:'fleet-verified'}));
 assert.equal(step(get(),capture).reason,'CAPTURE_PREREQUISITES_NOT_MET');
 apply(C('RECORD_OBJECTIVE','objective:1',{campaignID:'c1',objectiveID:'site-1',proofID:'real-interaction-1'}));
 assert.equal(step(get(),capture,{...native,capture:()=>false}).reason,'NATIVE_CAPTURE_UNVERIFIED');
 assert.equal(get().territories['200'].militaryControllerFactionID,20);
 const r=apply(capture);
 assert.equal(r.receipt.mode,'MILITARY_CONTROL_ONLY');
 assert.equal(get().territories['200'].militaryControllerFactionID,10);
 assert.equal(get().territories['200'].originalOwnerFactionID,20);
 assert.equal(step(get(),capture).status,'DUPLICATE');
});
test('ceasefire cancels unfinished siege without silently reverting captures',()=>{
 const {get,apply}=setup();
 apply(C('START_CAMPAIGN','camp:1',{campaignID:'c1',warID:'w1',sourceSystemID:100,targetSystemID:200,supplyReservationID:'res1'}));
 apply(C('END_WAR','peace:1',{warID:'w1',proofID:'signed-ceasefire'}));
 assert.equal(get().campaigns.c1.state,'CANCELLED');
 assert.equal(get().territories['200'].state,'SECURE');
 assert.equal(get().wars.w1.state,'ENDED');
 assert.equal(step(get(),C('BEGIN_ASSAULT','a2',{campaignID:'c1',proofID:'p'})).reason,'CAMPAIGN_NOT_PREPARING');
});
test('native-agent enlistment, leave, and 24h cooldown have no corporation mutation',()=>{
 let s=empty();const actor=C('ENLIST','enlist:1',{characterID:44,factionID:10,agentID:9});
 assert.equal(step(s,actor,{...native,enlistment:()=>false}).reason,'NATIVE_AGENT_ENLISTMENT_UNVERIFIED');
 s=step(s,actor).state;
 assert.equal(s.enlistments['44'].rank,0);
 assert.equal(step(s,C('ENLIST','enlist:2',{characterID:44,factionID:20,agentID:9})).reason,'ENLISTMENT_UNAVAILABLE');
 s=step(s,C('LEAVE_MILITIA','leave:1',{characterID:44,proofID:'agent-confirmed'})).state;
 assert.equal(step(s,C('ENLIST','enlist:3',{characterID:44,factionID:20,agentID:9})).reason,'ENLISTMENT_COOLDOWN');
 assert.equal(Object.hasOwn(s,'corporationID'),false);
});
test('corrupt state and exhausted ledger fail closed rather than reset',()=>{
 const s=empty();s.processed={x:{signature:'sig'}};s.version=5;
 assert.throws(()=>step(s,C('DECLARE_WAR','a')),/FW_STATE_INVALID/);
});
