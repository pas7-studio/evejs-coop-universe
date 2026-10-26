import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const view=require('../integration/coopWarClientView.cjs');
const core=require('../integration/coopFactionWarCore.cjs');

function warState(){
 const state=core.empty();
 state.wars['war:500010-500014']={warID:'war:500010-500014',state:'ACTIVE',
  attackerFactionID:500010,defenderFactionID:500014,declaredAt:1};
 state.campaigns['camp:1']={campaignID:'camp:1',warID:'war:500010-500014',state:'ASSAULT',
  sourceSystemID:30000142,targetSystemID:30000144,startedAt:1,objectiveEvidence:[],revision:2};
 state.campaigns['camp:2']={campaignID:'camp:2',warID:'war:500010-500014',state:'OCCUPIED',
  sourceSystemID:30000142,targetSystemID:30000145,startedAt:1,objectiveEvidence:[],revision:3};
 state.territories['30000142']={systemID:30000142,originalOwnerFactionID:500010,
  militaryControllerFactionID:500010,state:'SECURE',revision:1,changedAt:1};
 state.territories['30000144']={systemID:30000144,originalOwnerFactionID:500014,
  militaryControllerFactionID:500014,state:'CONTESTED',revision:2,changedAt:2};
 return state;
}

test('only a live campaign of an active war reaches the map layer',()=>{
 const state=warState();
 const snapshots=view.campaignSnapshots(state,{nowMs:1000000});
 assert.equal(snapshots.length,1);                       // OCCUPIED is history, not a live front
 const snapshot=snapshots[0];
 assert.equal(snapshot.originSolarsystemID,30000144);
 assert.deepEqual(snapshot.coveredSolarsystemIDs,[30000142,30000144]);
 assert.equal(snapshot.fsmState,view.CAMPAIGN_STATE_ACTIVE);
 assert.equal(snapshot.pirateFactionID,500010);
 assert.equal(snapshot.warzoneID,view.DEFAULT_WARZONE_ID);
 assert.equal(Number.isSafeInteger(snapshot.campaignID),true);
 assert.equal(snapshot.campaignID>0,true);
 // a Windows FILETIME, not an ISO string
 assert.match(snapshot.stateExpiryTimestamp,/^\d{17,19}$/);
 // an ended war shows nothing at all
 const ended=warState();
 ended.wars['war:500010-500014'].state='ENDED';
 assert.deepEqual(view.campaignSnapshots(ended,{nowMs:1000000}),[]);
});

test('campaign ids are stable for the same campaign',()=>{
 assert.equal(view.numericID('camp:1'),view.numericID('camp:1'));
 assert.notEqual(view.numericID('camp:1'),view.numericID('camp:2'));
 assert.equal(view.numericID('camp:1')>0,true);
});

test('the front tab shows real control and who contests it',()=>{
 const states=view.occupationStates(warState());
 assert.equal(states['30000142'].ownerID,500010);
 assert.equal(states['30000142'].contested,false);
 assert.equal(states['30000144'].ownerID,500014);
 assert.equal(states['30000144'].occupierID,500010);     // the attacker pushing it
 assert.equal(states['30000144'].contested,true);
 assert.equal(states['30000144'].militaryState,'CONTESTED');
 // an empty world has no front to show
 assert.deepEqual(view.occupationStates(core.empty()),{});
});

test('a front report is built from real values only',()=>{
 assert.match(view.frontReport('war-opened',{attackerFactionID:500010,
  defenderFactionID:500014,targetSystemID:30000144}),/opened a front/);
 assert.match(view.frontReport('assault-begun',{targetSystemID:30000144,
  attackerShips:3,defenderShips:2}),/3 attacking ships against 2 defenders/);
 assert.match(view.frontReport('objective-captured',{systemID:30000144,factionID:500010}),
  /captured by #500010/);
 assert.equal(view.frontReport('unknown-kind',{}),null);
 assert.match(view.frontReport('war-opened',{}),/unknown/);
});

test('the campaign objective structure reaches the client snapshot',()=>{
 // No bound objective yet: the client gets 0, like stock.
 const none=warState();
 assert.equal(view.campaignSnapshots(none,{nowMs:1})[0].structureID,0);
 // A really bound native structure (objectiveID from the adjudicator).
 const bound=warState();
 bound.campaigns['camp:1'].objectiveEvidence=[{objectiveID:'structure:1030000000000',
  proofID:'native:1',at:1}];
 assert.equal(view.campaignSnapshots(bound,{nowMs:1})[0].structureID,1030000000000);
 // The latest bound objective wins, and junk never becomes a target.
 bound.campaigns['camp:1'].objectiveEvidence.push({objectiveID:'structure:1030000000001',proofID:'native:2',at:2});
 assert.equal(view.campaignSnapshots(bound,{nowMs:1})[0].structureID,1030000000001);
 bound.campaigns['camp:1'].objectiveEvidence.push({objectiveID:'structure:0',proofID:'native:3',at:3},
  {objectiveID:'station:60000682',proofID:'native:4',at:4});
 assert.equal(view.campaignSnapshots(bound,{nowMs:1})[0].structureID,1030000000001);
 assert.equal(view.objectiveStructureID({objectiveEvidence:null}),0);
 assert.equal(view.objectiveStructureID(null),0);
});
