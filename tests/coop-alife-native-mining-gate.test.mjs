import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {summarize}=require("../scripts/coop-world-report.cjs");
const systemID=30000144,now=1800000000000;
const row=(event,seconds,payload={})=>JSON.stringify({
 at:new Date(now+seconds*1000).toISOString(),event,systemID,...payload
});
function report(extras=[],options={}){
 const rows=[
  row("living-world-topology",-90,{realWaypoints:9,realAsteroidBelts:3,
   realStargates:2,realStations:2}),
  row("living-native-industry",-80,{status:"ACTIVE",
   fleets:[{fleetID:22,state:"mining",minerIDs:[501],haulerIDs:[502]}]}),
  row("virtual-world-materialization",-75,{livingShips:[{entityID:701,role:"pirate"}]}),
  ...extras
 ];
 return summarize(rows.join("\n"),{now,systemID,windowMinutes:20,
  requireMiningYield:true,...options});
}
const proof=(seconds,opts={})=>row("alife-native-mining-proof",seconds,{
 fleetID:22,entityID:501,targetID:7001,moduleIDs:[901],
 cargoIDs:[600],status:"NATIVE_ORE_GROWTH_CONFIRMED",
 proof:"TWO_SAMPLES_NATIVE_LOCK_EFFECT_CARGOID_DELTA",quantityDelta:12,...opts});
test("native fleet mining state alone is not ore production",()=>{
 const r=report();assert.equal(r.status,"AWAITING_NATIVE_MINING_YIELD");
 assert.equal(r.nativeMiningYield.confirmed,0);
 assert.equal(r.nativeMiningYield.status,"NO_NATIVE_MINING_PROOF_SAMPLES");
 assert.match(r.blockers.join(" "),/target/);
});
test("controllerTarget zero with actual native cargoID growth passes mining-only gate",()=>{
 const r=report([proof(-15,{controllerTarget:0})]);
 assert.equal(r.status,"READY_FOR_CLIENT_PLAYTEST");
 assert.equal(r.nativeMiningYield.confirmed,1);
 assert.equal(r.nativeMiningYield.quantityDelta,12);
});
test("an active native module with no real ore delta is still a blocker",()=>{
 const r=report([proof(-15,{status:"NATIVE_MINING_ACTIVE_NO_YIELD_DELTA",
  proof:"NO_YIELD_PROOF",quantityDelta:0,cargoIDs:[]})]);
 assert.equal(r.status,"AWAITING_NATIVE_MINING_YIELD");
 assert.match(r.blockers.join(" "),/NO_YIELD_DELTA/);
});
test("forged unbound native proof cannot pass mining gate",()=>{
 for(const options of [{quantityDelta:0},{targetID:0},{cargoIDs:[]},
  {moduleIDs:[]},{proof:"VIRTUAL_ORDERS"},{status:"NATIVE_ORE_PLAN"}]){
  const r=report([proof(-15,options)]);
  assert.equal(r.status,"AWAITING_NATIVE_MINING_YIELD");
  assert.equal(r.nativeMiningYield.confirmed,0);
 }
});
test("old ore increase from unrelated previous system does not pass Perimeter",()=>{
 const r=report([row("alife-native-mining-proof",-10,{
  fleetID:22,entityID:501,targetID:7001,moduleIDs:[901],
  cargoIDs:[600],status:"NATIVE_ORE_GROWTH_CONFIRMED",
  proof:"TWO_SAMPLES_NATIVE_LOCK_EFFECT_CARGOID_DELTA",
  quantityDelta:12,systemID:30000142})]);
 assert.equal(r.status,"AWAITING_NATIVE_MINING_YIELD");
});
test("virtual-ready behavior unchanged when strict mining-only acceptance not requested",()=>{
 const r=report([], {requireMiningYield:false});
 assert.equal(r.status,"READY_FOR_CLIENT_PLAYTEST");
 assert.equal(r.nativeMiningYield.confirmed,0);
});
