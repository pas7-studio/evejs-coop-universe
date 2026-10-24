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

test("headless physical NPC evidence is playable-world server readiness, not real client success",()=>{
 const input=[
  event("living-headless-boot-requested",{status:"SCHEDULED_NOT_VERIFIED"}),
  event("living-world-topology",{realWaypoints:5,realAsteroidBelts:1,
   realStargates:2,sceneReady:true,evidenceSource:"HEADLESS_NATIVE_SCENE"}),
  event("living-native-industry",{fleets:[{fleetID:11,minerIDs:[1001],haulerIDs:[1002]}]}),
  event("virtual-world-materialization",{livingShips:[
   {pilotID:"coop-pilot-001",entityID:1001,role:"miner"},
   {pilotID:"coop-pilot-005",entityID:1003,role:"pirate"}
  ]}),
  event("living-headless-boot-system",{status:"NATIVE_SCENE_READY",
   physicalMiningShips:2,actualNamedNpcShips:2})
 ].join("\n");
 const result=summarize(input,{now});
 assert.equal(result.status,"READY_FOR_CLIENT_PLAYTEST");
 assert.equal(result.evidenceSource,"HEADLESS_NATIVE_SCENE");
 assert.equal(result.headlessBootStatus,"NATIVE_SCENE_READY");
 assert.ok(result.limits.some(x=>x.includes("headless evidence")));
});
test("headless boot flags alone cannot count as real NPC materialization",()=>{
 const input=[
  event("living-headless-boot-requested",{status:"SCHEDULED_NOT_VERIFIED"}),
  event("living-headless-boot-system",{status:"PENDING_NATIVE_SCENE",
   physicalMiningShips:0,actualNamedNpcShips:0})
 ].join("\n");
 assert.notEqual(summarize(input,{now}).status,"READY_FOR_CLIENT_PLAYTEST");
});

test("strict World gate rejects physical ships without sampled motion and interaction",()=>{
 const input=[
  event("living-world-topology",{realWaypoints:7,realAsteroidBelts:2}),
  event("living-native-industry",{fleets:[{fleetID:7,minerIDs:[10],haulerIDs:[20]}]}),
  event("virtual-world-materialization",{livingShips:[{pilotID:"coop-pilot-001",entityID:10,role:"miner"}]})
 ].join("\n");
 const loose=summarize(input,{now});
 const strict=summarize(input,{now,requireActivity:true});
 assert.equal(loose.status,"READY_FOR_CLIENT_PLAYTEST");
 assert.equal(strict.status,"AWAITING_NATIVE_ACTIVITY");
 assert.equal(strict.activity.status,"NO_PHYSICAL_ACTIVITY_EVIDENCE");
});
test("strict World gate accepts only movement AND native ore or targeting evidence",()=>{
 const input=[
  event("living-headless-boot-requested",{status:"SCHEDULED_NOT_VERIFIED"}),
  event("living-world-topology",{realWaypoints:7,realAsteroidBelts:2,evidenceSource:"HEADLESS_NATIVE_SCENE"}),
  event("living-native-industry",{fleets:[{fleetID:7,minerIDs:[10],haulerIDs:[20]}]}),
  event("virtual-world-materialization",{livingShips:[{pilotID:"coop-pilot-001",entityID:10,role:"miner"}]}),
  event("living-native-activity",{status:"SAMPLED",physicalNpcShips:2,observedMovement:1,
   oreGrowth:0,engagedNativeNpcs:1})
 ].join("\n");
 const result=summarize(input,{now,requireActivity:true});
 assert.equal(result.status,"READY_FOR_CLIENT_PLAYTEST");
 assert.equal(result.activity.status,"MOVEMENT_AND_INTERACTION_OBSERVED");
 assert.equal(result.activity.movedShips,1);
 assert.equal(result.activity.targetingSamples,1);
});
test("strict World refuses moving ships without any real interaction",()=>{
 const input=[
  event("living-world-topology",{realWaypoints:7,realAsteroidBelts:2}),
  event("living-native-industry",{fleets:[{minerIDs:[10],haulerIDs:[20]}]}),
  event("virtual-world-materialization",{livingShips:[{pilotID:"coop-pilot-001",entityID:10}]}),
  event("living-native-activity",{status:"SAMPLED",observedMovement:2,oreGrowth:0,engagedNativeNpcs:0})
 ].join("\n");
 assert.equal(summarize(input,{now,requireActivity:true}).status,"AWAITING_NATIVE_ACTIVITY");
});
test("strict World does not accept previous-boot native evidence",()=>{
 const earlier=(name,extra={})=>JSON.stringify({at:new Date(now-90000).toISOString(),
  event:name,systemID:30000142,...extra});
 const newer=(name,extra={})=>JSON.stringify({at:new Date(now-10000).toISOString(),
  event:name,systemID:30000142,...extra});
 const input=[
  earlier("living-world-topology",{realWaypoints:7,realAsteroidBelts:2}),
  earlier("living-native-industry",{fleets:[{minerIDs:[10],haulerIDs:[20]}]}),
  earlier("virtual-world-materialization",{livingShips:[{pilotID:"coop-pilot-001",entityID:10}]}),
  earlier("living-native-activity",{status:"SAMPLED",observedMovement:1,oreGrowth:1}),
  newer("living-headless-boot-requested",{status:"SCHEDULED_NOT_VERIFIED"})
 ].join("\n");
 const result=summarize(input,{now,requireActivity:true});
 assert.equal(result.status,"AWAITING_INGAME_ARRIVAL");
 assert.equal(result.activity.movedShips,0);
});

const combatFixture=({victim=102,loot=2,damage=true}={})=>[
 event("living-world-topology",{realWaypoints:7,realAsteroidBelts:2}),
 event("living-native-industry",{fleets:[{minerIDs:[101],haulerIDs:[102]}]}),
 event("virtual-world-materialization",{livingShips:[
  {pilotID:"coop-pilot-001",entityID:101,role:"miner"},
  {pilotID:"coop-pilot-002",entityID:102,role:"hauler"}
 ]}),
 ...(damage?[event("living-native-combat-damage",{events:[{
  systemID:30000142,victimEntityID:102,victimPilotID:"coop-pilot-002",
  healthLossHP:17,attackerPilotIDs:["coop-pilot-001"],
  attribution:"CORRELATED_TARGET_ONLY_NOT_KILL_CREDIT"
 }]})]:[]),
 event("living-native-wreck-evidence",{status:"PHYSICAL_NATIVE_WRECK_VERIFIED",
  victimEntityID:victim,victimPilotID:"coop-pilot-002",
  wreckID:900,storedItemCount:loot,lootStatus:loot?"ITEMS_STORED":"NATIVE_WRECK_EMPTY"})
].join("\n");
test("manual combat gate requires actual correlated named-NPC HP drop, wreck and native loot",()=>{
 const report=summarize(combatFixture(),{now,requireCombat:true});
 assert.equal(report.status,"READY_FOR_CLIENT_PLAYTEST");
 assert.equal(report.combat.status,"CORRELATED_DAMAGE_WRECK_AND_LOOT");
 assert.equal(report.combat.matchingWreckID,900);
 assert.ok(report.limits.some(x=>x.includes("do not identify the actual killer")));
});
test("native target without health loss does not pass combat gate",()=>{
 const report=summarize(combatFixture({damage:false}),{now,requireCombat:true});
 assert.equal(report.status,"AWAITING_NPC_COMBAT_LOOT");
 assert.equal(report.combat.status,"WRECK_ONLY");
});
test("wrong victim and empty actual wreck do not prove NPC kill plus loot",()=>{
 const mismatch=summarize(combatFixture({victim:103}),{now,requireCombat:true});
 assert.equal(mismatch.status,"AWAITING_NPC_COMBAT_LOOT");
 assert.equal(mismatch.combat.status,"UNMATCHED_DAMAGE_AND_WRECK");
 const empty=summarize(combatFixture({loot:0}),{now,requireCombat:true});
 assert.equal(empty.status,"AWAITING_NPC_COMBAT_LOOT");
 assert.equal(empty.combat.status,"CORRELATED_DAMAGE_WITH_EMPTY_WRECK");
});

test("strict weapon chain needs a genuine native launch/activation from same NPC attacker and victim",()=>{
 const launch=event("living-native-weapon-event",{
  status:"VERIFIED_NATIVE_WEAPON_EVENT",kind:"missile-launch",
  attackerEntityID:101,attackerPilotID:"coop-pilot-001",
  victimEntityID:102,victimPilotID:"coop-pilot-002",chargeTypeID:34
 });
 const good=summarize(combatFixture()+"\\n"+launch,{now,requireCombat:true,requireWeapon:true});
 assert.equal(good.status,"READY_FOR_CLIENT_PLAYTEST");
 assert.equal(good.combat.nativeWeaponDamageWreckLootID,900);
 assert.equal(good.combat.weaponCorrelatedDamageEvents,1);
 const missing=summarize(combatFixture(),{now,requireCombat:true,requireWeapon:true});
 assert.equal(missing.status,"AWAITING_NATIVE_WEAPON_CHAIN");
});
test("weapon activity of different NPC or victim does not claim a battle outcome",()=>{
 for(const changes of [
  {attackerPilotID:"coop-pilot-099"},
  {victimEntityID:103},
  {status:"IGNORED"},
  {kind:"attack-order"}
 ]){
  const witness=event("living-native-weapon-event",{
   status:"VERIFIED_NATIVE_WEAPON_EVENT",kind:"module-activation",
   attackerEntityID:101,attackerPilotID:"coop-pilot-001",
   victimEntityID:102,victimPilotID:"coop-pilot-002",
   moduleID:99,...changes
  });
  const r=summarize(combatFixture()+"\\n"+witness,{now,requireWeapon:true});
  assert.equal(r.status,"AWAITING_NATIVE_WEAPON_CHAIN");
 }
});
