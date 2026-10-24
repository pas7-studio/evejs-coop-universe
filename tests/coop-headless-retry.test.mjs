import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {nextHeadlessRetryMs,isHeadlessNativeReady}=require("../integration/coopVirtualWorldRuntime.cjs");

test("first five incomplete boots retry quickly, but never more often than every 30 seconds",()=>{
 for(let n=1;n<=5;n++)assert.equal(nextHeadlessRetryMs(n),30000);
});
test("after six incomplete attempts, boot keeps trying with bounded 5-15 minute backoff",()=>{
 assert.equal(nextHeadlessRetryMs(6),300000);
 assert.equal(nextHeadlessRetryMs(11),300000);
 assert.equal(nextHeadlessRetryMs(12),600000);
 assert.equal(nextHeadlessRetryMs(18),900000);
 assert.equal(nextHeadlessRetryMs(1000),900000);
});
test("native-mining boot readiness is supported by real NPC plus belts plus mining ships",()=>{
 assert.equal(isHeadlessNativeReady({miningEnabled:true,physicalNpcCount:1,
  waypointCount:4,beltCount:1,physicalMiningShips:2}),true);
 assert.equal(isHeadlessNativeReady({miningEnabled:true,physicalNpcCount:1,
  waypointCount:4,beltCount:1,physicalMiningShips:0}),false);
 assert.equal(isHeadlessNativeReady({miningEnabled:true,physicalNpcCount:1,
  waypointCount:4,beltCount:0,physicalMiningShips:2}),false);
});
test("non-mining native world requires real scene anchor and named physical NPC but no stock mining fleet",()=>{
 assert.equal(isHeadlessNativeReady({miningEnabled:false,physicalNpcCount:1,
  waypointCount:2,beltCount:0,physicalMiningShips:0}),true);
 assert.equal(isHeadlessNativeReady({miningEnabled:false,physicalNpcCount:0,
  waypointCount:2,beltCount:0,physicalMiningShips:0}),false);
 assert.equal(isHeadlessNativeReady({miningEnabled:false,physicalNpcCount:1,
  waypointCount:0,beltCount:0,physicalMiningShips:0}),false);
});
