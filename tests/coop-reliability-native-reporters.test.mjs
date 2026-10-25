import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
// Intentionally import the REAL first-party reporters; do not replace them
// with stand-ins for this cross-module native acceptance contract.
const {summarize: summarizeWorld} = require('../scripts/coop-world-report.cjs');
const {summarize: summarizeParty} = require('../scripts/coop-party-report.cjs');
const {checkWorld,checkParty} = require('../scripts/coop-reliability-gates.cjs');
const now=Date.parse('2026-10-25T16:10:00Z');
const meta={projectSha:'a'.repeat(40),upstreamSha:'b'.repeat(40),imageId:'sha256:'+'c'.repeat(64),containerStartedAt:new Date(now-180*60000).toISOString()};
const ev=(kind,age,extra={})=>JSON.stringify({event:kind,at:new Date(now-age*60000).toISOString(),systemID:30000144,...extra});
const boot=[
 ev('living-headless-boot-requested',130,{systems:[30000144,30000142]}),
 ev('living-world-topology',129,{realWaypoints:8,realAsteroidBelts:2,realStargates:2,realStations:1}),
 ev('living-native-industry',129,{fleets:[{minerIDs:[101],haulerIDs:[102]}]}),
 ev('virtual-world-materialization',129,{livingShips:[{entityID:103,pilotID:'coop-pilot-003',role:'pirate'}]})
];
const refreshed=[
 ev('living-native-industry',3,{fleets:[{minerIDs:[101],haulerIDs:[102]}]}),
 ev('virtual-world-materialization',3,{livingShips:[{entityID:103,pilotID:'coop-pilot-003',role:'pirate'}]})
];
const motion=ev('living-native-activity',1,{status:'SAMPLED',observedMovement:2,oreGrowth:1,physicalNpcShips:3});
const text=lines=>lines.join('\n');

test('real World reporter keeps per-process old topology and activity under expanded horizon',()=>{
 const report=summarizeWorld(text([...boot,...refreshed,motion]),{now,windowMinutes:185,requireActivity:true,systemID:30000144});
 assert.equal(report.status,'READY_FOR_CLIENT_PLAYTEST');
 assert.equal(report.activity.status,'MOVEMENT_AND_INTERACTION_OBSERVED');
});
test('actual World reporter + QA gate pass only freshly reconciled native physical activity',()=>{
 const report=checkWorld(text([...boot,...refreshed,motion]),meta,now,30);
 assert.equal(report.status,'PASS_SERVER');
 assert.equal(report.systemID,30000144);
 assert.equal(report.freshSamples,1);
});
test('native reporter historical mining does not substitute current physical fleet',()=>{
 const report=checkWorld(text([...boot,motion]),meta,now,30);
 assert.equal(report.status,'BLOCKED');
 assert.equal(report.freshNativeFleet,false);
});
test('current empty native industry overrides older still-healthy fleet',()=>{
 const report=checkWorld(text([...boot,...refreshed,ev('living-native-industry',0.5,{fleets:[]}),motion]),meta,now,30);
 assert.equal(report.status,'BLOCKED');
 assert.equal(report.freshNativeFleet,false);
});
test('latest native named-NPC disappearance overrides earlier materialization',()=>{
 const report=checkWorld(text([...boot,...refreshed,ev('virtual-world-materialization',0.5,{livingShips:[]}),motion]),meta,now,30);
 assert.equal(report.status,'BLOCKED');
 assert.equal(report.freshNamedShips,false);
});
test('different solar system motion cannot count toward native physical world',()=>{
 const other=ev('living-native-activity',1,{systemID:30000142,status:'SAMPLED',observedMovement:2,oreGrowth:3,physicalNpcShips:3});
 assert.equal(checkWorld(text([...boot,...refreshed,other]),meta,now,30).status,'BLOCKED');
});
test('actual Party reporter correlates two distinct player logins with shared native scene',()=>{
 const scene=ev('coop-shared-scene',1,{mutualVisibility:true,pilots:[
   {characterID:101,shipID:1001,shipExists:true},
   {characterID:102,shipID:1002,shipExists:true}
 ]});
 const events=text([ev('space-login-attach',2,{characterID:101,shipID:1001}),ev('space-login-attach',2,{characterID:102,shipID:1002}),scene]);
 const raw=summarizeParty(events,{now,windowMinutes:30});
 assert.equal(raw.serverMutualVisibility,true);
 const audit=checkParty(events,meta,now,30);
 assert.equal(audit.status,'PASS_SERVER');
});
test('actual Party reporter rejects a pilot who disconnected after shared scene',()=>{
 const scene=ev('coop-shared-scene',1,{mutualVisibility:true,pilots:[
   {characterID:101,shipID:1001,shipExists:true},
   {characterID:102,shipID:1002,shipExists:true}
 ]});
 const events=text([ev('space-login-attach',2,{characterID:101,shipID:1001}),ev('space-login-attach',2,{characterID:102,shipID:1002}),scene,ev('disconnect-after-persist',0.5,{characterID:102})]);
 assert.equal(checkParty(events,meta,now,30).status,'BLOCKED');
});