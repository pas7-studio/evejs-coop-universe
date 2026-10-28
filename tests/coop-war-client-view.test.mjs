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

test('an occupied system keeps its sovereign owner and names its occupier',()=>{
 // Measured on the live world: 30045343 was captured by 500004, and the map payload
 // said owner=occupier=500004, so the client could not show that 500001 lost it.
 const state=warState();
 state.territories['30000145']={systemID:30000145,originalOwnerFactionID:500014,
  militaryControllerFactionID:500010,state:'OCCUPIED',revision:3,changedAt:3};
 const view30000145=view.occupationStates(state)['30000145'];
 assert.equal(view30000145.ownerID,500014,'the static sovereign owner is not overwritten');
 assert.equal(view30000145.occupierID,500010,'the military controller is the occupier');
 assert.equal(view30000145.contested,true,'a captured system is not a secure one');
 assert.equal(view30000145.militaryState,'OCCUPIED');
});

// The client indexes faction-keyed tables with these values, so a militia corporation
// where a faction belongs is a KeyError in the warzone map, not a cosmetic difference.
// Measured on the live world: 204 occupation states carried 1000180/1000181, the map's
// militia colouring raised, never completed and re-ran at ~36 victory-point calls a
// second, and the map window never opened.
const keyVal = (pairs) => Object.fromEntries(pairs);
const dictOf = (entries) => ({ type: 'dict', entries });

function frontier(){
 const state = core.empty();
 state.wars['war:500001-500004'] = {warID:'war:500001-500004',state:'ACTIVE',
  attackerFactionID:500004,defenderFactionID:500001,declaredAt:1};
 const territory = (systemID, owner, controller) => {
  state.territories[String(systemID)] = {systemID,originalOwnerFactionID:owner,
   militaryControllerFactionID:controller,state:controller === owner ? 'SECURE' : 'OCCUPIED',
   revision:1,changedAt:1};
 };
 territory(30045343, 500001, 500001);   // Caldari ground
 territory(30045344, 500004, 500004);   // Gallente ground, across the border
 territory(30045345, 500004, 500004);   // one jump behind it
 territory(30045346, 500004, 500004);   // two jumps behind it
 territory(30045347, 500001, 500004);   // taken by Gallente
 return state;
}
const gates = {
 30045343: [{destinationSolarSystemID:30045344}],
 30045344: [{destinationSolarSystemID:30045343},{destinationSolarSystemID:30045345}],
 30045345: [{destinationSolarSystemID:30045344},{destinationSolarSystemID:30045346}],
 30045346: [{destinationSolarSystemID:30045345}],
 30045347: [],
};

test('warzone occupation states carry factions, never militia corporations',()=>{
 const response = view.warzonesResponse(keyVal, dictOf, {2:[500001,500004]},
  {state: frontier(), getStargatesForSystem: (id) => gates[id] || []});
 const ours = response.entries.find(([warzoneID]) => warzoneID === 2)[1].entries;
 const ids = new Set();
 for (const [, state] of ours) { ids.add(state.occupierID); ids.add(state.ownerID); }
 assert.ok(!ids.has(1000180) && !ids.has(1000181), 'no militia corporation may appear');
 for (const id of ids) assert.ok([500001,500004].includes(id), 'every id is a warzone faction: ' + id);
});

test('the client gets the two fields it reads without a default',()=>{
 // warzoneMap.py: FACTION_ID_TO_COLOR[occupierID] and
 // ADJACENCY_STATE_TO_ICON_PATH[adjacencyState] - both are hard lookups.
 const response = view.warzonesResponse(keyVal, dictOf, {2:[500001,500004]},
  {state: frontier(), getStargatesForSystem: (id) => gates[id] || []});
 const ours = Object.fromEntries(response.entries.find(([id]) => id === 2)[1].entries);
 assert.ok(ours[30045344], 'the border system is listed');
 assert.equal(ours[30045344].occupierID, 500004);
 assert.equal(ours[30045343].adjacencyState, 'FL', 'ground that touches the other side is the front line');
 assert.equal(ours[30045344].adjacencyState, 'FL');
 assert.equal(ours[30045345].adjacencyState, 'SL', 'one jump behind the front is the second line');
 assert.equal(ours[30045346].adjacencyState, 'BL', 'two jumps behind it is the back line');
 for (const state of Object.values(ours)) assert.ok(['FL','SL','BL'].includes(state.adjacencyState));
});

test('a captured system names the faction it was taken from as the attacker',()=>{
 const state = frontier();
 const response = view.warzonesResponse(keyVal, dictOf, {2:[500001,500004]},
  {state, getStargatesForSystem: (id) => gates[id] || []});
 const ours = Object.fromEntries(response.entries.find(([id]) => id === 2)[1].entries);
 assert.equal(ours[30045347].ownerID, 500001, 'the sovereign owner is kept');
 assert.equal(ours[30045347].occupierID, 500004, 'the controller holds it');
 assert.equal(ours[30045347].attackerID, 500001, 'the war does not invent a third faction');
 assert.equal(ours[30045347].contested, true);
});

test('every system names an attacker the client can look up',()=>{
 // The warzone map and the advantage gauge both do FACTION_ID_TO_COLOR[attackerID];
 // a 0 or an unknown id is a KeyError that takes the whole tab down.
 const state = frontier();
 state.territories['30045348'] = {systemID:30045348,originalOwnerFactionID:500004,
  militaryControllerFactionID:500004,state:'SECURE',revision:1,changedAt:1};
 const response = view.warzonesResponse(keyVal, dictOf, {2:[500001,500004]},
  {state, getStargatesForSystem: (id) => gates[id] || []});
 const ours = Object.fromEntries(response.entries.find(([id]) => id === 2)[1].entries);
 for (const [systemID, entry] of Object.entries(ours)) {
  assert.ok([500001,500004].includes(entry.attackerID),
   'system ' + systemID + ' has no usable attacker: ' + entry.attackerID);
  assert.notEqual(entry.attackerID, entry.occupierID, 'a side cannot attack itself');
 }
});
