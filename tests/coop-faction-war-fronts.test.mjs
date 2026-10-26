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
