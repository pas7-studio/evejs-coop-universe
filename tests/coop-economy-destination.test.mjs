import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {rankStations,rankOreTypes,decideDestination,createDestinationOracle,cargoTotals}
 =require('../integration/coopEconomyDestination.cjs');

const buy=(stationID,price,volRemaining,typeID=1230,systemID=30000145)=>({
 order_id:`${stationID}-${price}-${volRemaining}`,bid:true,station_id:stationID,
 price,vol_remaining:volRemaining,type_id:typeID,solar_system_id:systemID
});
const station=(stationID,systemID=30000145,distanceMeters=null)=>({stationID,systemID,distanceMeters});
const ore17464=17464,ore1230=1230;

test('cargo totals ignore module stacks and merge duplicate ore stacks',()=>{
 const totals=cargoTotals([
  {typeID:ore1230,quantity:1200,moduleID:0},
  {typeID:ore1230,quantity:800},
  {typeID:35,quantity:5,moduleID:2205},
  {typeID:0,quantity:10}
 ]);
 assert.equal(totals.get(ore1230),2000);
 assert.equal(totals.has(35),false);
 assert.equal(totals.has(0),false);
});

test('an ore with no buyer never wins the destination',()=>{
 const books={[ore1230]:{buys:[buy(60003724,1842.38,5000,ore1230)]}};
 // The hauler really does carry Scordite III-Grade, which has no buyer here.
 const decision=decideDestination({
  cargo:[{typeID:ore17464,quantity:7560,moduleID:0}],
  candidates:[station(60003724)],
  books
 });
 assert.equal(decision.status,'HOLD_NO_BUYER');
 assert.equal(decision.ranked[0].revenue,0);
});

test('the station that pays the most for the actual cargo wins',()=>{
 const books={[ore1230]:{buys:[
  buy(60000682,40.5,5000),
  buy(60003724,1842.38,5000)
 ]}};
 const decision=decideDestination({
  cargo:[{typeID:ore1230,quantity:5000,moduleID:0}],
  candidates:[station(60000682),station(60003724)],
  books
 });
 assert.equal(decision.status,'CHOSEN');
 assert.equal(decision.stationID,60003724);
 assert.equal(decision.revenue,5000*1842.38);
 assert.equal(decision.unfilled,0);
});

test('expected ISK is capped by the live remaining volume, not by the price',()=>{
 const books={[ore1230]:{buys:[
  // Huge price, almost nothing left to fill.
  buy(60000682,999999,3),
  buy(60003724,1000,5000)
 ]}};
 const decision=decideDestination({
  cargo:[{typeID:ore1230,quantity:5000,moduleID:0}],
  candidates:[station(60000682),station(60003724)],
  books
 });
 assert.equal(decision.stationID,60003724);
 assert.equal(decision.revenue,5000*1000);
 const low=decision.ranked.find(entry=>entry.stationID===60000682);
 assert.equal(low.filled,3);
 assert.equal(low.unfilled,4997);
});

test('an empty book holds the cargo instead of hauling it on speculation',()=>{
 const decision=decideDestination({
  cargo:[{typeID:ore1230,quantity:1000,moduleID:0}],
  candidates:[station(60003724),station(60000682)],
  books:{[ore1230]:{buys:[]}}
 });
 assert.equal(decision.status,'HOLD_NO_BUYER');
 assert.equal(decision.ranked.length,2);
});

test('equal revenue falls back to the nearest physical station',()=>{
 const books={[ore1230]:{buys:[buy(60003724,100,5000),buy(60000682,100,5000)]}};
 const decision=decideDestination({
  cargo:[{typeID:ore1230,quantity:500,moduleID:0}],
  candidates:[station(60003724,30000145,900000),station(60000682,30000145,12000)],
  books
 });
 assert.equal(decision.stationID,60000682);
});

test('no candidate station is a blocker, never a silent haul',()=>{
 const decision=decideDestination({
  cargo:[{typeID:ore1230,quantity:10,moduleID:0}],
  candidates:[],
  books:{[ore1230]:{buys:[buy(60003724,10,10)]}}
 });
 assert.equal(decision.status,'NO_NATIVE_NPC_STATION');
});

test('preferred ore prefers a real buyer and skips ore nobody buys',()=>{
 const books={
  [ore1230]:{buys:[buy(60003724,1842.38,5000,ore1230)]},
  [ore17464]:{buys:[]},
  1228:{buys:[buy(60015169,41,900000,1228,30000142)]}
 };
 const ranked=rankOreTypes({typeIDs:[ore17464,ore1230,1228],books});
 assert.deepEqual(ranked.ranked.map(entry=>entry.typeID),[ore1230,1228]);
 assert.equal(ranked.best.stationID,60003724);
});

test('ranking accepts a Map of books as well as a plain object',()=>{
 const books=new Map([[ore1230,{buys:[buy(60003724,1842.38,5000)]}]]);
 const ranked=rankStations({cargo:[{typeID:ore1230,quantity:100,moduleID:0}],
  candidates:[station(60003724)],books});
 assert.equal(ranked.best.stationID,60003724);
 assert.equal(ranked.best.revenue,184238);
});

test('the oracle warms up asynchronously and never blocks native code',async()=>{
 const issued=[];
 const oracle=createDestinationOracle({
  call:async(method,params)=>{issued.push([method,params]);return {buys:[buy(60003724,1842.38,5000,params.type_id)]};},
  getOreTypes:()=>[{typeID:ore1230}],
  getSystemRegion:()=>({regionID:10000002})
 });
 const cargo=[{typeID:ore1230,quantity:4000,moduleID:0}];
 const first=oracle.decide({cargo,candidates:[station(60003724)],systemID:30000145});
 assert.equal(first.status,'WARMING');
 await new Promise(resolve=>setTimeout(resolve,20));
 const second=oracle.decide({cargo,candidates:[station(60003724)],systemID:30000145});
 assert.equal(second.status,'CHOSEN');
 assert.equal(second.stationID,60003724);
 assert.equal(second.regionID,10000002);
 assert.deepEqual(issued[0],['GetOrders',{region_id:10000002,type_id:ore1230}]);
});

test('a failed book reply is not cached as a profitable market',async()=>{
 const oracle=createDestinationOracle({
  call:async()=>{throw new Error('RPC_DOWN');},
  getOreTypes:()=>[{typeID:ore1230}],
  getSystemRegion:()=>({regionID:10000002})
 });
 oracle.decide({cargo:[{typeID:ore1230,quantity:10,moduleID:0}],
  candidates:[station(60003724)],systemID:30000145});
 await new Promise(resolve=>setTimeout(resolve,20));
 const after=oracle.decide({cargo:[{typeID:ore1230,quantity:10,moduleID:0}],
  candidates:[station(60003724)],systemID:30000145});
 assert.equal(after.status,'WARMING');
});

test('ore advice reports the real preferred ore for the system',async()=>{
 const events=[];
 const oracle=createDestinationOracle({
  call:async(method,params)=>({buys:params.type_id===ore1230?[buy(60003724,1842.38,5000,ore1230)]:[]}),
  getOreTypes:()=>[{typeID:ore1230},{typeID:ore17464}],
  getSystemRegion:()=>({regionID:10000002}),
  probe:{observe:(name,session,context,data)=>events.push({name,data})}
 });
 oracle.observePreferredOre({systemID:30000145,reason:'test'});
 await new Promise(resolve=>setTimeout(resolve,20));
 const quick=oracle.preferredOre({systemID:30000145});
 assert.equal(quick.status,'RANKED');
 assert.equal(quick.best.typeID,ore1230);
 oracle.observePreferredOre({systemID:30000145,reason:'test'});
 assert.equal(events.length,1);
 assert.equal(events[0].name,'living-economy-ore');
 assert.equal(events[0].data.preferredOreTypeID,ore1230);
});
