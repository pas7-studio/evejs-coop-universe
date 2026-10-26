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
