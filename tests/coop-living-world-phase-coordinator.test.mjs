import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createPhaseCoordinator}=require("../integration/coopLivingWorldPhaseCoordinator.cjs");

function fixture(options={}){
 const invoked=[],errors=[],cycles=[];
 const execute=(name,fn)=>{
  invoked.push(name);
  try{return fn()}catch(error){errors.push({name,message:error.message});return null}
 };
 let now=1000;
 const coordinator=createPhaseCoordinator({
  execute,clock:()=>++now,onCycle:row=>cycles.push(row),...options});
 return {coordinator,invoked,errors,cycles};
}
test("existing phase semantics remain sequential and preserve callback return values",()=>{
 const f=fixture(),effects=[];
 const output=f.coordinator.tick(run=>{
  assert.equal(run("virtual-travel",()=>{effects.push("travel");return 7}),7);
  assert.equal(run("virtual-economy",()=>{effects.push("economy");return 8}),8);
  assert.equal(run("native-depot",()=>{effects.push("depot");return 9}),9);
 });
 assert.equal(output.status,"COMPLETED");
 assert.equal(output.phaseCount,3);
 assert.deepEqual(effects,["travel","economy","depot"]);
 assert.deepEqual(f.invoked,effects.map(x=>x==="travel"?"virtual-travel":
  x==="economy"?"virtual-economy":"native-depot"));
 assert.deepEqual(f.coordinator.snapshot().last.phaseNames,
  ["virtual-travel","virtual-economy","native-depot"]);
 assert.equal(f.coordinator.snapshot().active,false);
 assert.equal(f.cycles.length,1);
});
test("legacy safeNpcPhase failure policy still isolates one phase from the next",()=>{
 const f=fixture(),effects=[];
 assert.equal(f.coordinator.tick(run=>{
  run("native-raid",()=>{effects.push("raid");throw Error("isolated")});
  run("native-patrol",()=>{effects.push("patrol")});
 }).status,"COMPLETED");
 assert.deepEqual(effects,["raid","patrol"]);
 assert.deepEqual(f.errors,[{name:"native-raid",message:"isolated"}]);
});
test("re-entrant tick is rejected with zero extra native operations or sequence growth",()=>{
 const f=fixture(),statuses=[];
 const output=f.coordinator.tick(run=>{
  run("native-depot",()=>{
   statuses.push(f.coordinator.tick(inner=>inner("native-raids",()=>statuses.push("DUPLICATE"))));
  });
 });
 assert.equal(output.status,"COMPLETED");
 assert.equal(statuses[0].status,"REENTRANT_SKIPPED");
 assert.equal(statuses.length,1);
 assert.deepEqual(f.invoked,["native-depot"]);
 assert.equal(f.coordinator.snapshot().sequence,1);
});
test("unguarded callback fault is not mislabeled as completed, next tick remains possible",()=>{
 const f=fixture();
 assert.throws(()=>f.coordinator.tick(()=>{throw Error("outside-phase")}),/outside-phase/);
 const last=f.coordinator.snapshot();
 assert.equal(last.active,false);
 assert.equal(last.last.status,"THREW");
 assert.equal(f.coordinator.tick(run=>run("virtual-travel",()=>true)).status,"COMPLETED");
 assert.equal(f.coordinator.snapshot().sequence,2);
});
test("onCycle diagnostic exceptions never change a result or repeat execution",()=>{
 const seen=[];
 const coordinator=createPhaseCoordinator({
  execute:(name,fn)=>{seen.push(name);return fn()},
  clock:()=>100,
  onCycle:()=>{throw Error("probe-unavailable")}});
 assert.equal(coordinator.tick(run=>run("native-gate-approach",()=>42)).status,"COMPLETED");
 assert.deepEqual(seen,["native-gate-approach"]);
});
test("invalid phase IDs or callbacks cannot dispatch untracked native operations",()=>{
 const f=fixture();
 assert.throws(()=>f.coordinator.tick(run=>run("",()=>{})),/PHASE_INVALID/);
 assert.throws(()=>f.coordinator.tick(run=>run("ship movement",()=>{})),/PHASE_INVALID/);
 assert.throws(()=>f.coordinator.tick(run=>run("native-depot",null)),/PHASE_INVALID/);
 assert.deepEqual(f.invoked,[]);
 assert.equal(f.coordinator.snapshot().last.status,"THREW");
});
test("diagnostics bound names, never truncate real phase execution",()=>{
 const f=fixture();
 const output=f.coordinator.tick(run=>{
  for(let i=0;i<180;i++)run("npc-reconcile:"+i,()=>i);
 });
 assert.equal(output.phaseCount,180);
 assert.equal(f.invoked.length,180);
 const last=f.coordinator.snapshot().last;
 assert.equal(last.phaseCount,180);
 assert.equal(last.phaseNames.length,128);
});
test("caller cannot mutate phase history returned from snapshot",()=>{
 const f=fixture();
 f.coordinator.tick(run=>run("virtual-travel",()=>{}));
 const view=f.coordinator.snapshot();
 view.last.phaseNames.push("forged");
 assert.deepEqual(f.coordinator.snapshot().last.phaseNames,["virtual-travel"]);
});
test("a promise-returning phase is not awaited or relabeled as a native settlement",()=>{
 const f=fixture();
 let settle;
 const pending=new Promise(resolve=>{settle=resolve});
 const result=f.coordinator.tick(run=>run("alife-native-economy-observe",()=>pending));
 assert.equal(result.status,"COMPLETED");
 assert.equal(f.coordinator.snapshot().active,false);
 settle({status:"SETTLED"});
 // The original async phase itself owns its single-flight lock and receipt.
 assert.equal(f.coordinator.snapshot().last.phaseNames[0],"alife-native-economy-observe");
});
test("existing Living World still has ONE 30s tick and separate observational sampler",()=>{
 const source=fs.readFileSync(new URL("../integration/coopVirtualWorldRuntime.cjs",import.meta.url),"utf8");
 const coordinator=fs.readFileSync(new URL("../integration/coopLivingWorldPhaseCoordinator.cjs",import.meta.url),"utf8");
 assert.match(source,/timer=setInterval\(\(\)=>worldPhaseCoordinator\.tick\(runPhase=>\{/);
 assert.match(source,/\}\),30000\);/);
 assert.match(source,/combatTimer=setInterval\(\(\)=>safeNpcPhase\("native-combat-evidence"/);
 assert.equal((source.match(/\b(?:timer|combatTimer)=setInterval\(/g)||[]).length,2);
 assert.doesNotMatch(coordinator,/\bsetInterval\s*\(/);
 assert.doesNotMatch(coordinator,/\bsetTimeout\s*\(/);
 assert.match(source,/livingWorldPhases\(\)/);
});
test("all legacy 30s phases are registered exactly once in unchanged source order",()=>{
 const source=fs.readFileSync(new URL("../integration/coopVirtualWorldRuntime.cjs",import.meta.url),"utf8");
 const start=source.indexOf("timer=setInterval(()=>worldPhaseCoordinator.tick(runPhase=>{");
 const end=source.indexOf(" }),30000);",start);
 assert.ok(start>0&&end>start);
 const block=source.slice(start,end);
 assert.doesNotMatch(block,/safeNpcPhase\(/);
 const actual=[...block.matchAll(/runPhase\("([^"]+)"/g)].map(x=>x[1]);
 const expected=[
  "courier-observe","courier-dispatch","virtual-travel","virtual-economy",
  "native-depot","alife-native-mining-proof","alife-native-economy-observe",
  "faction","native-ammo-readiness","native-ammo-survival",
  "native-ammo-supply","native-raids","native-tactics","native-ammo-observe",
  "native-wreck-recovery","native-salvage-rivals","native-salvage-market",
  "native-wreck-custody","native-loot-station-delivery",
  "native-gate-approach","native-patrols","npc-recognition",
  "native-civilians","native-market-schedule","economy-destination-ore",
  "native-activity","npc-reconcile:"
 ];
 assert.deepEqual(actual,expected);
 assert.equal(actual.length,27);
 assert.match(block,/EVEJS_COOP_ALIFE_SALVAGE_MARKET/);
 assert.match(block,/EVEJS_COOP_NATIVE_NPC_MARKET/);
 assert.match(block,/EVEJS_COOP_ALIFE_ECONOMY/);
});
