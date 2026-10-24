import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {summarize}=require("../scripts/coop-world-report.cjs");
const now=Date.parse("2026-10-25T09:00:00Z");
const event=(name,offset,extra={})=>JSON.stringify({
 at:new Date(now+offset*1000).toISOString(),event:name,
 systemID:30000144,...extra
});
const baseline=[
 event("living-headless-boot-requested",0,{systems:[30000144]}),
 event("living-world-topology",1,{realWaypoints:19,realAsteroidBelts:3,realStations:3,realStargates:2}),
 event("living-native-system-site-readiness",2,{
  status:"REAL_BELT_PRESENT",
  stockMiningStartup:{status:"MINING_STARTUP_ELIGIBLE",startupEnabled:true}
 })
];
test("World names the genuine EveJS native spawn failure",()=>{
 const events=[...baseline,event("living-native-mining-startup-slot",3,{
  status:"FAILED",fleetSlot:1,error:"NPC_POOL_NOT_FOUND"
 })].join("\n");
 const r=summarize(events,{now:now+10000,systemID:30000144});
 assert.equal(r.status,"NO_NATIVE_MINING_FLEET");
 assert.equal(r.nativeMiningStartupOutcome.status,"FAILED");
 assert.equal(r.nativeMiningStartupOutcome.error,"NPC_POOL_NOT_FOUND");
 assert.match(r.blockers.join(" "),/NPC_POOL_NOT_FOUND/);
});
test("later seeded slot replaces stale spawn failure, not proof of physical ship",()=>{
 const events=[...baseline,event("living-native-mining-startup-slot",3,{
  status:"FAILED",fleetSlot:1,error:"TEMPORARY_FAILURE"
 }),event("living-native-mining-startup-slot",5,{
  status:"SEEDED",fleetSlot:1,miners:2,haulers:1
 })].join("\n");
 const r=summarize(events,{now:now+10000,systemID:30000144});
 assert.equal(r.status,"NO_NATIVE_MINING_FLEET");
 assert.equal(r.nativeMiningStartupOutcome.status,"SEEDED");
 assert.equal(r.nativeMiningStartupOutcome.miners,2);
 assert.doesNotMatch(r.blockers.join(" "),/TEMPORARY_FAILURE/);
 assert.match(r.blockers.join(" "),/no complete physical miner\/hauler fleet/);
});
test("World never borrows mining failure evidence from Jita",()=>{
 const events=[...baseline,JSON.stringify({
  at:new Date(now+3000).toISOString(),event:"living-native-mining-startup-slot",
  systemID:30000142,status:"FAILED",fleetSlot:1,error:"FOREIGN_SYSTEM"
 })].join("\n");
 const r=summarize(events,{now:now+10000,systemID:30000144});
 assert.equal(r.nativeMiningStartupOutcome,null);
 assert.doesNotMatch(r.blockers.join(" "),/FOREIGN_SYSTEM/);
});
