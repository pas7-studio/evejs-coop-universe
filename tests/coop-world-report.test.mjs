import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {summarize}=require("../scripts/coop-world-report.cjs");
const now=Date.parse("2026-10-24T20:00:00.000Z");
const event=(name,extra={})=>JSON.stringify({at:new Date(now-60000).toISOString(),event:name,systemID:30000142,...extra});
test("healthy transport and empty upstream fixture cannot be called a living world",()=>{
 const input=[event("space-login-attach",{characterID:1}),event("living-world-topology",{
  realWaypoints:0,realAsteroidBelts:0,sceneReady:true
 })].join("\n");
 const result=summarize(input,{now});
 assert.equal(result.status,"MISSING_NATIVE_WORLD_DATA");
 assert.equal(result.actualMiningFleets,0);
 assert.equal(result.physicalNpcShipAssignments,0);
});
test("a TCP-only health result needs actual in-game scene evidence",()=>{
 const result=summarize(event("tcp-reconnected",{characterID:1}),{now});
 assert.equal(result.status,"AWAITING_INGAME_ARRIVAL");
 assert.ok(result.blockers.length);
});
test("native mining ships and physical NPCs are enough for a scene-ready playtest, not a client pass",()=>{
 const input=[
  event("living-world-topology",{realWaypoints:8,realAsteroidBelts:2,realStargates:2,realStations:1}),
  event("living-native-industry",{fleets:[{fleetID:77,minerIDs:[1001,1002],haulerIDs:[2001],loadedHaulerOreQuantity:150}]}),
  event("virtual-world-materialization",{livingShips:[
   {pilotID:"coop-pilot-001",entityID:1001,role:"miner"},
   {pilotID:"coop-pilot-005",entityID:3001,role:"pirate"}
  ]})
 ].join("\n");
 const result=summarize(input,{now});
 assert.equal(result.status,"READY_FOR_CLIENT_PLAYTEST");
 assert.equal(result.actualMinerShips,2);
 assert.equal(result.actualHaulerShips,1);
 assert.equal(result.oreOnRealHaulers,150);
 assert.equal(result.physicalNpcRoles.pirate,1);
 assert.ok(result.limits.some(x=>x.includes("client rendering")));
});
test("no native miners cannot be masked by many virtual residents",()=>{
 const input=[
  event("living-world-topology",{realWaypoints:7,realAsteroidBelts:1}),
  event("virtual-world-presence",{residentCount:20}),
  event("living-native-industry",{fleets:[]}),
  event("virtual-world-materialization",{livingShips:[{pilotID:"coop-pilot-005",entityID:3001,role:"pirate"}]})
 ].join("\n");
 assert.equal(summarize(input,{now}).status,"NO_NATIVE_MINING_FLEET");
});
