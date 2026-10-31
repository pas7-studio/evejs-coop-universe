import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {borderEdges,buildFronts,contestedSystemIDs,ownerOf}=require('../integration/coopFactionWarFronts.cjs');

// A - B - C in a line plus D hanging off B, all connected by reciprocal gates.
// A owns 1,2 (Caldari); B owns 3,4 (Gallente) -> the front is exactly 2-3.
function world(){
 const gates={
  11:{itemID:11,solarSystemID:1,destinationID:12,destinationSolarSystemID:2},
  12:{itemID:12,solarSystemID:2,destinationID:11,destinationSolarSystemID:1},
  21:{itemID:21,solarSystemID:2,destinationID:22,destinationSolarSystemID:3},
  22:{itemID:22,solarSystemID:3,destinationID:21,destinationSolarSystemID:2},
  31:{itemID:31,solarSystemID:3,destinationID:32,destinationSolarSystemID:4},
  32:{itemID:32,solarSystemID:4,destinationID:31,destinationSolarSystemID:3},
  41:{itemID:41,solarSystemID:3,destinationID:42,destinationSolarSystemID:5},
  42:{itemID:42,solarSystemID:5,destinationID:41,destinationSolarSystemID:3},
 };
 const bySystem={};
 for(const g of Object.values(gates))(bySystem[g.solarSystemID]=bySystem[g.solarSystemID]||[]).push(g);
 return {getStargatesForSystem:(id)=>bySystem[id]||[],getGate:(id)=>gates[id]||null};
}

test('a front is the border between two owners, derived from real gates',()=>{
 const territories={1:'caldari',2:'caldari',3:'gallente',4:'gallente',5:'caldari'};
 const fronts=buildFronts({territories,...world()});
 assert.equal(fronts.length,1);
 const front=fronts[0];
 assert.deepEqual(front.factions,['caldari','gallente']);
 // 2-3 is the only real border; 3-5 is Gallente vs Caldari too (D hangs off B).
 assert.deepEqual(front.systemIDs,[2,3,5]);
 assert.equal(front.edges.length,2);
});

test('same-owner neighbours are never a front',()=>{
 const territories={1:'caldari',2:'caldari',3:'caldari'};
 assert.deepEqual(buildFronts({territories,...world()}),[]);
 assert.deepEqual(contestedSystemIDs({territories,...world()}),[]);
});

test('unowned systems never create a front and never get a border',()=>{
 const territories={1:'caldari',2:'caldari',3:null,4:undefined};
 assert.deepEqual(buildFronts({territories,...world()}),[]);
 assert.equal(ownerOf(territories,3),null);
});

test('two separate borders produce two separate fronts',()=>{
 const territories={1:'caldari',2:'gallente',3:'minmatar',4:'minmatar',5:'amarr'};
 const fronts=buildFronts({territories,...world()});
 const ids=fronts.map((f)=>f.frontID).sort();
 // 1-2 (caldari|gallente), 2-3 (gallente|minmatar), 3-5 (minmatar|amarr):
 // three real borders, therefore three fronts - each one a separate line.
 assert.deepEqual(ids,['front:amarr-minmatar','front:caldari-gallente','front:gallente-minmatar']);
});

test('contested systems are exactly the systems on a border',()=>{
 const territories={1:'caldari',2:'caldari',3:'gallente',4:'gallente',5:'caldari'};
 assert.deepEqual(contestedSystemIDs({territories,...world()}),[2,3,5]);
 assert.deepEqual(contestedSystemIDs({territories}),[]);
});

test('territory comes from real presence, never from a coin flip',()=>{
 const {territoriesFromPresence}=require('../integration/coopFactionWarFronts.cjs');
 const pilots=[
  {systemID:1,factionID:'caldari'},{systemID:1,factionID:'caldari'},
  {systemID:2,factionID:'gallente'},{systemID:2,factionID:'gallente'},{systemID:2,factionID:'gallente'},
  {systemID:3,factionID:'caldari'},{systemID:3,factionID:'gallente'},
  {systemID:4,factionID:'caldari'},
 ];
 const territories=territoriesFromPresence({pilots});
 assert.equal(territories[1],'caldari');
 assert.equal(territories[2],'gallente');
 assert.equal(territories[3],undefined);   // tie is contested, not owned
 assert.equal(territories[4],'caldari');
 assert.equal(territoriesFromPresence({pilots,minShips:2})[4],undefined);
 assert.deepEqual(territoriesFromPresence({pilots:[{systemID:0,factionID:'x'},{systemID:1}]}),{});
});

// FW-112: a front must never run out.
//
// MEASURED on the play stack 2026-10-30 after the first real capture: 30003837 became
// OCCUPIED, every owned system then touched only friends, and the frontier answered NO_FRONT
// 137 times in one hour with an EMPTY skip list. The war machine had nothing left to fight
// over. The SDE already says who owns the next system, so a faction that holds its whole
// border pushes into it - but ONLY when no registered border exists, and the edge is marked
// expanded so it can never be mistaken for an old one.
test('no registered border is not the end of the war: the SDE owner is the next defender',()=>{
 const territories={1:'caldari',2:'caldari'};
 assert.deepEqual(buildFronts({territories,...world()}),[]);
 const sde={3:500002};
 const fronts=buildFronts({territories,...world(),
  fallbackOwner:(id)=>sde[id]||0});
 assert.equal(fronts.length,1);
 const edge=fronts[0].edges[0];
 assert.equal(edge.fromSystemID,2);
 assert.equal(edge.toSystemID,3);
 assert.equal(edge.toOwner,'500002');
 assert.equal(edge.expanded,true);
});

test('a registered controller always wins over the SDE fallback',()=>{
 const territories={1:'caldari',2:'caldari',3:'minmatar'};
 const fronts=buildFronts({territories,...world(),
  fallbackOwner:()=> 'gallente'});
 const edge=fronts[0].edges.find((e)=>e.toSystemID===3||e.fromSystemID===3);
 assert.equal(edge.expanded,false,'a decided system is not an expansion');
 assert.deepEqual(fronts[0].factions,['caldari','minmatar']);
});

test('the fallback never invents an owner for nobody',()=>{
 const territories={1:'caldari',2:'caldari'};
 for(const fallback of [()=>0,()=>null,()=>undefined,()=>-5,()=> 'x',
   ()=>{throw Error('no world')}]){
  assert.deepEqual(buildFronts({territories,...world(),fallbackOwner:fallback}),[]);
 }
 // A neighbour owned by the same faction is still not a front.
 assert.deepEqual(buildFronts({territories,...world(),fallbackOwner:()=> 'caldari'}),[]);
});

test('the planner reaches a front instead of NO_FRONT when only expansion is left',()=>{
 const {planWars}=require('../integration/coopFactionWarOpening.cjs');
 const pilots=[];
 for(let n=0;n<3;n+=1)pilots.push({systemID:1,factionID:'500001',pilotID:'p'+n,entityID:100+n});
 for(let n=0;n<3;n+=1)pilots.push({systemID:2,factionID:'500001',pilotID:'q'+n,entityID:200+n});
 const state={version:1,territories:{},wars:{},campaigns:{}};
 const base={state,presence:{pilots},...world(),nowMs:1000,
  navyCapability:()=>({open:true,reason:'BOTH_SIDES_CAN_FIELD_NAVY'})};
 const refused=planWars(base);
 assert.equal(refused.status,'REFUSED');
 assert.equal(refused.reason,'NO_FRONT');
 assert.equal(refused.expansionAttempted,false,'without an owner authority there is nothing to expand into');
 const sde={3:500002};
 const planned=planWars({...base,ownerOfSystem:(id)=>sde[id]||0});
 assert.notEqual(planned.reason,'NO_FRONT','the frontier must not answer NO_FRONT when expansion is possible');
 assert.equal(planned.expansion,true);
 assert.equal(planned.fronts.length,1);
 const edge=planned.fronts[0].edges[0];
 assert.equal(edge.expanded,true);
 assert.equal(edge.toOwner,'500002');
});

test('an expansion border is provable from the SDE, not from ships that are not there yet',()=>{
 const {planWars}=require('../integration/coopFactionWarOpening.cjs');
 const pilots=[];
 for(let n=0;n<3;n+=1)pilots.push({systemID:1,factionID:'500001',pilotID:'p'+n,entityID:100+n});
 for(let n=0;n<3;n+=1)pilots.push({systemID:2,factionID:'500001',pilotID:'q'+n,entityID:200+n});
 const state={version:1,territories:{},wars:{},campaigns:{}};
 const sde={3:500002};
 const planned=planWars({state,presence:{pilots},...world(),nowMs:1000,
  navyCapability:()=>({open:true,reason:'BOTH_SIDES_CAN_FIELD_NAVY'}),
  ownerOfSystem:(id)=>sde[id]||0});
 assert.equal(planned.status,'READY',planned.reason);
 const proofs=planned.openings[0].proofs;
 // The defender owns the ground in the SDE but has no hull there yet: that is a real war.
 assert.equal(proofs.declaration({attackerFactionID:500001,defenderFactionID:500002}),true);
 assert.equal(proofs.territory({systemID:3,ownerFactionID:500002}),true);
 // Nothing is invented for a faction that owns neither the ground nor a ship.
 assert.equal(proofs.declaration({attackerFactionID:500001,defenderFactionID:500003}),false);
 assert.equal(proofs.territory({systemID:3,ownerFactionID:500003}),false);
 // And an attacker with no presence in the source is still refused.
 assert.equal(proofs.declaration({attackerFactionID:500009,defenderFactionID:500002}),false);
});

test('expansion borders are additional fronts, and a registered border is planned first',()=>{
 const {planWars}=require('../integration/coopFactionWarOpening.cjs');
 const pilots=[];
 for(let n=0;n<3;n+=1)pilots.push({systemID:2,factionID:'500001',pilotID:'p'+n,entityID:100+n});
 for(let n=0;n<3;n+=1)pilots.push({systemID:3,factionID:'500002',pilotID:'q'+n,entityID:200+n});
 // System 3 is registered to 500002, so 2-3 is a DECIDED border. System 1 is unregistered
 // and SDE-owned by 500003, so 2-1 is an EXPANSION border off the same held system.
 const state={version:1,territories:{3:{militaryControllerFactionID:500002}},wars:{},campaigns:{}};
 const sde={1:500003};
 const planned=planWars({state,presence:{pilots},...world(),nowMs:1000,
  navyCapability:()=>({open:true,reason:'BOTH_SIDES_CAN_FIELD_NAVY'}),
  ownerOfSystem:(id)=>sde[id]||0});
 assert.equal(planned.status,'READY',planned.reason);
 assert.equal(planned.expansion,true);
 assert.equal(planned.fronts.length,2,'the decided border and the expansion border are both fronts');
 assert.equal(planned.openings.length,2,'the frontier can carry more than one live campaign');
 assert.equal(planned.openings[0].edge.expanded,false,'the decided border is spent first');
 assert.equal(planned.openings[1].edge.expanded,true);
 assert.equal(planned.openings[1].plan.campaign.targetSystemID,1);
});
