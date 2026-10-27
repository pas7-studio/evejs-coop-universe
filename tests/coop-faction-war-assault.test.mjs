import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {campaignReadiness,beginAssault}=require('../integration/coopFactionWarAssault.cjs');
const api=require('../integration/coopFactionWarOpening.cjs');
const core=require('../integration/coopFactionWarCore.cjs');

// The state the opener really produces, so the assault phase is tested against
// the same records the runtime will hold.
const STAR_GATES={
 1:[{itemID:11,destinationID:12,destinationSolarSystemID:2,solarSystemID:1}],
 2:[{itemID:12,destinationID:11,destinationSolarSystemID:1,solarSystemID:2}],
};
const GATES={11:{itemID:11,destinationID:12,solarSystemID:1},
 12:{itemID:12,destinationID:11,solarSystemID:2}};
const CORP_FACTION={1000:500001,2000:500002};
const NATIVES={101:{entityID:101,corporationID:1000,systemID:1},
 201:{entityID:201,corporationID:2000,systemID:2}};
const LINKS=[{pilotID:'coop-pilot-001',entityID:101,systemID:1,role:'patrol'},
 {pilotID:'coop-pilot-003',entityID:201,systemID:2,role:'patrol'}];
const getNativeEntity=(id)=>NATIVES[id]||null;
const getFactionForCorporation=(id)=>CORP_FACTION[id]||null;

function openCampaign(){
 const state=core.empty();
 const plan=api.planWars({state,
  presence:api.collectPresence({links:LINKS,getNativeEntity,getFactionForCorporation}),
  getStargatesForSystem:(id)=>STAR_GATES[id]||[],getGate:(id)=>GATES[id]||null,nowMs:1000});
 const opened=api.applyOpening({state,plan,nowMs:1000});
 assert.equal(opened.status,'OPENED');
 return {state:opened.state,campaignID:opened.campaignID};
}

test('a campaign waits until both sides really have ships',()=>{
 const {state,campaignID}=openCampaign();
 const waiting=campaignReadiness({state,ships:{
  '101':{entityID:101,campaignID,factionID:500001,systemID:1}}});
 assert.equal(waiting.status,'WAITING');
 assert.equal(waiting.attackerShips,1);
 assert.equal(waiting.defenderShips,0);
 assert.equal(waiting.required,1);
 assert.equal(beginAssault({state,readiness:waiting,nowMs:2000}).status,'REFUSED');
});

test('a full native muster turns PREPARING into ASSAULT through the core',()=>{
 const {state,campaignID}=openCampaign();
 const ships={
  '101':{entityID:101,campaignID,factionID:500001,systemID:1},
  '201':{entityID:201,campaignID,factionID:500002,systemID:2},
 };
 const ready=campaignReadiness({state,ships});
 assert.equal(ready.status,'READY');
 assert.deepEqual(ready.attackerShips,[101]);
 assert.deepEqual(ready.defenderShips,[201]);
 assert.equal(ready.evidence,'REAL_NATIVE_PATROLS_RESERVED_ON_BOTH_SIDES');
 const assault=beginAssault({state,readiness:ready,nowMs:2000});
 assert.equal(assault.status,'ASSAULT_BEGUN');
 core.validateState(assault.state);
 assert.equal(assault.state.campaigns[campaignID].state,'ASSAULT');
 assert.equal(assault.state.campaigns[campaignID].revision,2);
 assert.equal(assault.state.history.at(-1).type,'BEGIN_ASSAULT');
 assert.equal(assault.state.history.at(-1).eventID,'assault:'+campaignID);
});

test('ships in the wrong system never count as a muster',()=>{
 const {state,campaignID}=openCampaign();
 const ready=campaignReadiness({state,ships:{
  '101':{entityID:101,campaignID,factionID:500001,systemID:2},  // attacker parked in enemy space
  '201':{entityID:201,campaignID,factionID:500002,systemID:1}}});
 assert.equal(ready.status,'WAITING');
});

test('a two-ship minimum is honoured per side',()=>{
 const {state,campaignID}=openCampaign();
 const ships={
  '101':{entityID:101,campaignID,factionID:500001,systemID:1},
  '201':{entityID:201,campaignID,factionID:500002,systemID:2},
 };
 assert.equal(campaignReadiness({state,ships,minPerSide:2}).status,'WAITING');
 assert.equal(campaignReadiness({state,ships,minPerSide:1}).status,'READY');
});

test('nothing is mustered when there is no preparing campaign',()=>{
 assert.equal(campaignReadiness({state:core.empty(),ships:{}}).status,'REFUSED');
 assert.equal(campaignReadiness({state:core.empty(),ships:{}}).reason,'NO_PREPARING_CAMPAIGN');
 assert.equal(campaignReadiness({ships:{}}).reason,'NO_WAR_STATE');
 assert.equal(beginAssault({state:core.empty(),readiness:{status:'WAITING'}}).reason,'MUSTER_NOT_READY');
});

test('a waiting border never hides a border whose sides are mustered',()=>{
 // Two campaigns under different wars: the lexicographically first one can never
 // muster (its defender has no ship), the second one has a real ship on each side.
 const state=core.empty();
 state.wars['war:a']={warID:'war:a',attackerFactionID:500001,
  defenderFactionID:500003,state:'ACTIVE',declaredAt:1};
 state.wars['war:b']={warID:'war:b',attackerFactionID:500001,
  defenderFactionID:500002,state:'ACTIVE',declaredAt:1};
 const territory=(systemID,owner)=>({systemID,originalOwnerFactionID:owner,
  militaryControllerFactionID:owner,state:'SECURE',revision:1,changedAt:1});
 state.territories['1']=territory(1,500001);
 state.territories['2']=territory(2,500002);
 state.territories['3']=territory(3,500003);
 const campaign=(campaignID,warID,target)=>({campaignID,warID,
  attackerFactionID:500001,sourceSystemID:1,targetSystemID:target,
  supplyReservationID:'paper-supply:'+campaignID,state:'PREPARING',
  startedAt:1,objectiveEvidence:[],revision:1});
 state.campaigns['war:a:campaign:3']=campaign('war:a:campaign:3','war:a',3);
 state.campaigns['war:b:campaign:2']=campaign('war:b:campaign:2','war:b',2);
 const ships={
  '101':{entityID:101,campaignID:'war:b:campaign:2',factionID:500001,systemID:1},
  '201':{entityID:201,campaignID:'war:b:campaign:2',factionID:500002,systemID:2},
 };
 const ready=campaignReadiness({state,ships});
 assert.equal(ready.status,'READY');
 assert.equal(ready.campaignID,'war:b:campaign:2');
 assert.deepEqual(ready.attackerShips,[101]);
 assert.deepEqual(ready.defenderShips,[201]);
 assert.equal(beginAssault({state,readiness:ready,nowMs:2000}).status,'ASSAULT_BEGUN');
 // With no ship at all every border is reported, and the blocked one first.
 const none=campaignReadiness({state,ships:{}});
 assert.equal(none.status,'WAITING');
 assert.equal(none.waiting.length,2);
 assert.equal(none.campaignID,'war:a:campaign:3');
});
