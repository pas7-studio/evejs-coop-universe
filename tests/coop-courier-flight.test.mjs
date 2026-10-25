import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {
 STEPS,createFlight,nextAction,advanceFlight,selectActiveFlights,
}=require('../integration/coopCourierFlight.cjs');

const contract={contractID:980000000,startStationID:60015260,endStationID:60015262};
const identity={character:{characterID:140000100},ship:{itemID:9988400100000}};

test('a flight is planned only for a real contract and a real courier',()=>{
 const flight=createFlight({contract,identity,nowMs:1000});
 assert.equal(flight.status,'FLIGHT_PLANNED');
 assert.equal(flight.step,'undock');
 assert.equal(flight.originStationID,60015260);
 assert.equal(flight.destinationStationID,60015262);
 assert.equal(createFlight({contract:{...contract,endStationID:60015260},identity,nowMs:1}).status,'NO_FLIGHT');
 assert.equal(createFlight({contract,identity:{character:{}},nowMs:1}).status,'NO_FLIGHT');
});

test('the flight walks undock -> warp -> arrive -> dock -> done on confirmed outcomes',()=>{
 let flight=createFlight({contract,identity,nowMs:0});
 const seen=[];
 for(let index=0;index<5;index+=1){
  const action=nextAction(flight,index*1000);
  seen.push(action.status==='ACTION'?action.action:action.status);
  flight=advanceFlight(flight,'OK',index*1000+1);
 }
 assert.deepEqual(seen,['undock','warp','arrive','dock','FLIGHT_DONE']);
 assert.equal(flight.step,'done');
 assert.deepEqual(STEPS,['undock','warp','arrive','dock','done']);
});

test('an unconfirmed outcome does not advance and does not retry blindly',()=>{
 const flight=createFlight({contract,identity,nowMs:0});
 const same=advanceFlight(flight,'UNKNOWN',500);
 assert.equal(same.step,'undock');
 assert.equal(same.lastObserved,'UNKNOWN');
 const failed=advanceFlight(flight,'FAILED',500);
 assert.equal(failed.step,'failed');
});

test('a stuck step times out instead of hanging forever',()=>{
 const flight=createFlight({contract,identity,nowMs:0});
 const timeout=nextAction(flight,999999);
 assert.equal(timeout.status,'FLIGHT_TIMEOUT');
 assert.equal(timeout.step,'undock');
});

test('concurrency is capped so per-tick cost stays flat',()=>{
 const flights=[1,2,3,4,5].map((n)=>({contractID:n,step:'warp'}));
 const selected=selectActiveFlights(flights,{maxConcurrentFlights:3});
 assert.equal(selected.activeCount,5);
 assert.deepEqual(selected.admitted,[1,2,3]);
 assert.deepEqual(selected.deferred,[4,5]);
 const finished=[{contractID:1,step:'done'},{contractID:2,step:'failed'}];
 assert.equal(selectActiveFlights(finished,{maxConcurrentFlights:3}).activeCount,0);
});
