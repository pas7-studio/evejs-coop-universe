import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {decideNativeEconomy,createAlifeEconomyObserver}=require("../integration/coopAlifeEconomy.cjs");
const SYS=30000142,STATION=60000001,AT=1000000;
const factory=()=>({authoritativeNative:true,oreAtStation:80,mineralStock:120,
 materialShortage:0,productShortage:60,nativeOutputQty:0,nativeReadyJobs:0,
 nativeOreToRefine:0,nativeActiveJobs:0,factoryOnline:true,marketOnline:true});
const pilot=(n,role,extra={})=>({pilotID:"coop-pilot-"+n,entityID:100000+n,
 systemID:SYS,role,nativeVerified:true,playerControlled:false,health:1,
 underAttack:false,inWarp:false,activeNativeOrder:false,cargoOreQuantity:0,
 cargoAmmoQuantity:0,stationID:STATION,atStation:true,...extra});
const sample=(pilots=[pilot(101,"trader")],economy=factory())=>({
 authoritativeNative:true,systemID:SYS,observedAt:AT,pilots,
 stations:[{stationID:STATION,systemID:SYS,nativeVerified:true,economy}]});
const decide=(s,params={})=>decideNativeEconomy(s,{now:AT,...params});
test("verified native shortage plans ONE corporation manufacturing intent, no wallet writes",()=>{
 const r=decide(sample());
 assert.equal(r.status,"OBSERVED");assert.equal(r.intents.length,1);
 assert.equal(r.intents[0].stage,"MANUFACTURE");
 assert.equal(r.intents[0].nativeMutation,false);
 assert.equal(r.intents[0].provenance,"NATIVE_READ_ONLY");
});
test("verified unlisted manufactured output takes priority over starting a new job",()=>{
 const e={...factory(),nativeOutputQty:100,nativeReadyJobs:1};
 assert.equal(decide(sample(undefined,e)).intents[0].stage,"LIST_OUTPUT");
});
test("READY native job comes before raw manufacturing",()=>{
 const e={...factory(),nativeReadyJobs:1};
 assert.equal(decide(sample(undefined,e)).intents[0].stage,"COMPLETE_JOB");
});
test("real ore for mineral shortage causes REFINE, not virtual mineral minting",()=>{
 const e={...factory(),materialShortage:200,nativeOreToRefine:400};
 assert.equal(decide(sample(undefined,e)).intents[0].stage,"REFINE");
});
test("missing real minerals produces BUY_SUPPLIES intent, never free materials",()=>{
 const e={...factory(),materialShortage:200,nativeOreToRefine:0};
 assert.equal(decide(sample(undefined,e)).intents[0].stage,"BUY_SUPPLIES");
});
test("no shortage leaves an explicit idle reason",()=>{
 const e={...factory(),productShortage:0};
 const r=decide(sample(undefined,e));
 assert.equal(r.intents.length,0);assert.equal(r.blockers[0].reason,"ENOUGH_REAL_STOCK");
});
test("two traders at same station cannot claim same manufacturing resource",()=>{
 const r=decide(sample([pilot(101,"trader"),pilot(102,"trader")]));
 assert.equal(r.intents.length,1);
 assert.equal(r.blockers.find(x=>x.reason==="ALIFE_ECONOMY_RESOURCE_RESERVED").pilotID,"coop-pilot-102");
});
test("survival priority holds native combat and blocks economic dispatch",()=>{
 const r=decide(sample([pilot(101,"trader",{underAttack:true})]));
 assert.equal(r.intents.length,0);assert.equal(r.blockers[0].stage,"YIELD_SURVIVAL");
});
test("native warp or committed action has precedence over economy",()=>{
 const r=decide(sample([pilot(101,"trader",{inWarp:true})]));
 assert.equal(r.blockers[0].stage,"YIELD_COMMITTED");
});
test("hauler intent is based on real cargo, and arrival only after native position evidence",()=>{
 const before=decide(sample([pilot(103,"hauler",{cargoOreQuantity:42,atStation:false})]));
 const after=decide(sample([pilot(103,"hauler",{cargoOreQuantity:42,atStation:true})]));
 assert.equal(before.intents[0].stage,"HAUL");assert.equal(after.intents[0].stage,"DELIVER");
});
test("miner intent never claims mining laser output or creates items",()=>{
 const r=decide(sample([pilot(104,"miner")]));
 assert.equal(r.intents[0].stage,"MINE");
 assert.match(r.intents[0].reason,/NATIVE_FLEET_AUTHORITY/);
});
test("trader cannot manufacture from absent authoritative factory state",()=>{
 const r=decide(sample(undefined,null));assert.equal(r.intents.length,0);
 assert.equal(r.blockers[0].reason,"NATIVE_FACTORY_MARKET_PROOF_REQUIRED");
});
test("stale or fabricated inventory/world cannot become a valid A-Life intent",()=>{
 const stale=sample();stale.authoritativeNative=false;
 assert.equal(decide(stale).reason,"NATIVE_WORLD_SNAPSHOT_UNVERIFIED");
 assert.equal(decide(sample(),{now:AT+300000}).reason,"NATIVE_WORLD_SNAPSHOT_UNVERIFIED");
});
test("ambiguous identity/duplicate ship cannot issue a second economic intent",()=>{
 const wrong=sample([pilot(101,"trader"),pilot(102,"trader",{entityID:100101})]);
 assert.equal(decide(wrong).reason,"NATIVE_PILOT_IDENTITY_OR_CARGO_UNVERIFIED");
});
test("explicit unreadable native hull evidence becomes a blocker",()=>{
 const s=sample([]);s.omitted=[{pilotID:"coop-pilot-101",reason:"NATIVE_HULL_OR_CONTROLLER_NOT_VERIFIED"}];
 const r=decide(s);assert.ok(r.blockers.some(x=>x.reason==="NATIVE_HULL_OR_CONTROLLER_NOT_VERIFIED"));
});
test("intent count is bounded and deterministic across independently ordered snapshots",()=>{
 const p=[pilot(101,"miner"),pilot(102,"miner"),pilot(103,"miner")];
 const a=decide(sample(p),{maxIntents:2});
 const b=decide(sample(p.reverse()),{maxIntents:2});
 assert.deepEqual(a.intents.map(x=>x.pilotID),b.intents.map(x=>x.pilotID));
 assert.equal(a.intents.length,2);assert.equal(a.blockers.at(-1).reason,"ALIFE_INTENT_BUDGET_EXHAUSTED");
});
async function withFlags(fn){const a=process.env.EVEJS_COOP_ALIFE,b=process.env.EVEJS_COOP_ALIFE_ECONOMY;
 process.env.EVEJS_COOP_ALIFE="1";process.env.EVEJS_COOP_ALIFE_ECONOMY="1";
 try{return await fn()}finally{
  if(a===undefined)delete process.env.EVEJS_COOP_ALIFE;else process.env.EVEJS_COOP_ALIFE=a;
  if(b===undefined)delete process.env.EVEJS_COOP_ALIFE_ECONOMY;else process.env.EVEJS_COOP_ALIFE_ECONOMY=b;
 }}
test("A-Life economy observer stays OFF without both flags",()=>withFlags(()=>{
 delete process.env.EVEJS_COOP_ALIFE_ECONOMY;
 const out=[];const observer=createAlifeEconomyObserver({clock:()=>AT,emit:x=>out.push(x)});
 assert.equal(observer.tick(sample()).status,"ALIFE_ECONOMY_DISABLED");
 assert.equal(out.length,0);assert.equal(observer.supportsNativeMutation,false);
}));
test("same real native intent is announced once per cooldown",()=>withFlags(()=>{
 let now=AT;const events=[],o=createAlifeEconomyObserver({clock:()=>now,emit:e=>events.push(e)});
 o.tick(sample());o.tick(sample());assert.equal(events.length,1);
 assert.equal(events[0].event,"alife-economy-intent");
 now+=300000;const s=sample();s.observedAt=now;o.tick(s);
 assert.equal(events.length,2);assert.equal(events[1].nativeMutation,false);
}));
test("missing native proof emits a named blocker, never a fake economic success",()=>withFlags(()=>{
 const out=[],o=createAlifeEconomyObserver({clock:()=>AT,emit:x=>out.push(x)});
 const s=sample(undefined,null);o.tick(s);
 assert.equal(out[0].event,"alife-economy-blocker");
 assert.equal(out[0].reason,"NATIVE_FACTORY_MARKET_PROOF_REQUIRED");
}));


test("real native missile exhaustion enters A-Life RESUPPLY, no synthetic ammo",()=>{
 const r=decide(sample([pilot(105,"pirate",{ammoState:"AMMO_EXHAUSTED"})]));
 assert.equal(r.intents.length,1);assert.equal(r.intents[0].stage,"RESUPPLY");
 assert.equal(r.intents[0].nativeMutation,false);
});
test("ammo status not proven or healthy does not cause unnecessary purchase",()=>{
 const r=decide(sample([pilot(105,"pirate",{ammoState:"UNVERIFIED"})]));
 assert.equal(r.intents.length,0);assert.equal(r.blockers[0].reason,"NPC_AMMO_NATIVE_EVIDENCE_REQUIRED");
 const s=decide(sample([pilot(105,"patrol",{ammoState:"AMMO_AVAILABLE"})]));
 assert.equal(s.blockers[0].reason,"NATIVE_AMMO_SUFFICIENT");
});
test("survival wins over resupply even if ammunition is exhausted",()=>{
 const r=decide(sample([pilot(105,"pirate",{ammoState:"AMMO_EXHAUSTED",underAttack:true})]));
 assert.equal(r.intents.length,0);assert.equal(r.blockers[0].stage,"YIELD_SURVIVAL");
});

test("A-Life startup without real pilots or stations emits named blockers",()=>{
 const s=sample([]);s.stations=[];
 const r=decide(s);
 assert.equal(r.intents.length,0);
 assert.ok(r.blockers.some(x=>x.reason==="NATIVE_ECONOMY_NO_VERIFIED_PILOTS"));
 assert.ok(r.blockers.some(x=>x.reason==="NATIVE_ECONOMY_NO_VERIFIED_STATIONS"));
});
