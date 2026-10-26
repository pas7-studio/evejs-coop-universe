import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {planRoute,GATE_RANGE_M}=require('../integration/coopCourierGateHop.cjs');

// A tiny reciprocal gate graph: A <-> B <-> C, plus a one-way decoy B -> D that
// must never be used, because the stock jump validates both directions.
function graph(){
 const gates={
  100:{itemID:100,solarSystemID:1,destinationID:200,destinationSolarSystemID:2},
  200:{itemID:200,solarSystemID:2,destinationID:100,destinationSolarSystemID:1},
  300:{itemID:300,solarSystemID:2,destinationID:400,destinationSolarSystemID:3},
  400:{itemID:400,solarSystemID:3,destinationID:300,destinationSolarSystemID:2},
  500:{itemID:500,solarSystemID:2,destinationID:600,destinationSolarSystemID:4},
  600:{itemID:600,solarSystemID:4,destinationID:999,destinationSolarSystemID:2},
 };
 const bySystem={};
 for(const gate of Object.values(gates))(bySystem[gate.solarSystemID]=bySystem[gate.solarSystemID]||[]).push(gate);
 return {gates,bySystem};
}

test('planRoute uses a direct reciprocal gate',()=>{
 const {gates,bySystem}=graph();
 const route=planRoute({fromSystemID:1,toSystemID:2,getStargatesForSystem:id=>bySystem[id]||[],getGate:id=>gates[id]||null});
 assert.equal(route.length,1);
 assert.deepEqual(route[0],{fromGateID:100,toGateID:200,fromSystemID:1,toSystemID:2});
});

test('planRoute finds a two-hop route through a real reciprocal pair',()=>{
 const {gates,bySystem}=graph();
 const route=planRoute({fromSystemID:1,toSystemID:3,getStargatesForSystem:id=>bySystem[id]||[],getGate:id=>gates[id]||null});
 assert.equal(route.length,2);
 assert.equal(route[0].toSystemID,2);
 assert.equal(route[1].toSystemID,3);
});

test('planRoute refuses a one-way gate pair and an unreachable system',()=>{
 const {gates,bySystem}=graph();
 const oneWay=planRoute({fromSystemID:2,toSystemID:4,getStargatesForSystem:id=>bySystem[id]||[],getGate:id=>gates[id]||null});
 assert.equal(oneWay,null);
 const unreachable=planRoute({fromSystemID:1,toSystemID:99,getStargatesForSystem:id=>bySystem[id]||[],getGate:id=>gates[id]||null});
 assert.equal(unreachable,null);
});

test('planRoute never hops for a same-system delivery and needs real inputs',()=>{
 const {gates,bySystem}=graph();
 assert.deepEqual(planRoute({fromSystemID:2,toSystemID:2,getStargatesForSystem:id=>bySystem[id]||[],getGate:id=>gates[id]||null}),[]);
 assert.equal(planRoute({fromSystemID:0,toSystemID:2,getStargatesForSystem:id=>bySystem[id]||[],getGate:id=>gates[id]||null}),null);
 assert.equal(planRoute({fromSystemID:1,toSystemID:2}),null);
});

test('the gate jump range stays the stock 2500 m surface separation',()=>{
 assert.equal(GATE_RANGE_M,2500);
});
