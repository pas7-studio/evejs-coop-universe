import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createNativeMiningWitness}=require("../integration/coopAlifeNativeMiningWitness.cjs");
const SYSTEM=30000144,SHIP=501,ROCK=7001,OWNER=100035,STOCK=600;
function fixture(){
 let now=1000000;
 const ship={itemID:SHIP,kind:"ship",nativeNpc:true,transient:false,
  activeModuleEffects:new Map([[901,{targetID:ROCK}]]),
  position:{x:0,y:0,z:0},mode:"ORBIT"};
 const rock={itemID:ROCK,kind:"asteroid",position:{x:2000,y:0,z:0}};
 const byID=new Map([[SHIP,ship],[ROCK,rock]]);
 const cargo=[];
 let locks=[ROCK];
 const scene={systemID:SYSTEM,sessions:new Map(),
  getEntityByID:id=>byID.get(id)||null,getTargetsForEntity:()=>locks};
 let native={entityID:SHIP,ownerID:OWNER,systemID:SYSTEM,transient:false};
 let remain=1500;
 const fleet={fleetID:22,source:"startup",state:"mining",
  systemID:SYSTEM,minerEntityIDs:[SHIP],haulerEntityIDs:[],
  assignedAsteroidIDsByMinerID:{[SHIP]:ROCK}};
 const witness=createNativeMiningWitness();
 const tick=(overrides={})=>witness.tick({scene,fleets:[fleet],
  getNativeEntity:()=>native,listNativeCargo:()=>cargo,
  isMineableStaticEntity:x=>x===rock,
  getMineableState:()=>({remainingQuantity:remain}),
  now,...overrides});
 const put=(quantity,extra={})=>{cargo.splice(0,cargo.length,{
  cargoID:STOCK,entityID:SHIP,ownerID:OWNER,transient:false,
  moduleID:0,typeID:34,categoryID:25,quantity,...extra})};
 return {ship,rock,byID,cargo,scene,fleet,tick,put,witness,
  updateLocks:x=>locks=x,updateNative:x=>native=x,updateRemain:x=>remain=x,
  clock:x=>now=x,advance:ms=>now+=ms};
}
const status=f=>f.tick().results[0].status;
test("stock mining controller with real lock, rock effect and cargoID growth is proven over two ticks",()=>{
 const f=fixture();assert.equal(status(f),"NATIVE_MINING_ACTIVE_NO_YIELD_DELTA");
 f.advance(30000);f.put(12);
 const r=f.tick();
 assert.equal(r.status,"OBSERVED");assert.equal(r.confirmed,1);
 assert.equal(r.results[0].status,"NATIVE_ORE_GROWTH_CONFIRMED");
 assert.equal(r.results[0].targetID,ROCK);
 assert.deepEqual(r.results[0].cargoIDs,[STOCK]);
 assert.equal(r.results[0].quantityDelta,12);
 assert.equal(r.results[0].proof,"TWO_SAMPLES_NATIVE_LOCK_EFFECT_CARGOID_DELTA");
});
test("controller.currentTargetID zero is not mining failure: actual target lock and effect are canonical",()=>{
 const f=fixture();f.ship.currentTargetID=0;
 assert.equal(status(f),"NATIVE_MINING_ACTIVE_NO_YIELD_DELTA");
 f.advance(30000);f.put(3);
 assert.equal(status(f),"NATIVE_ORE_GROWTH_CONFIRMED");
});
test("an unchanged cargo row on repeated tick is never reported as another yield",()=>{
 const f=fixture();f.put(4);
 assert.equal(status(f),"NATIVE_MINING_ACTIVE_NO_YIELD_DELTA");
 f.advance(30000);
 assert.equal(f.tick().confirmed,0);
 f.put(9);f.advance(30000);
 assert.equal(f.tick().results[0].quantityDelta,5);
 f.advance(30000);
 assert.equal(f.tick().confirmed,0);
});
test("ore already in the hull at first observation is not fabricated yield",()=>{
 const f=fixture();f.put(900);
 assert.equal(f.tick().confirmed,0);
});
test("no target lock blocks yield proof even if actual cargo grows",()=>{
 const f=fixture();f.tick();f.advance(30000);f.put(10);
 f.updateLocks([]);
 assert.equal(status(f),"NATIVE_MINING_ROCK_NOT_TARGET_LOCKED");
 f.updateLocks([ROCK]);f.advance(30000);
 assert.equal(f.tick().confirmed,0,"after failed lock we need new baseline");
});
test("no active mining module target never counts ore as mined",()=>{
 const f=fixture();f.tick();f.ship.activeModuleEffects.clear();f.put(50);
 f.advance(30000);
 assert.equal(status(f),"NATIVE_MINING_ACTIVE_ROCK_EFFECT_MISSING");
});
test("active module targeting something other than a genuine rock does not prove mining",()=>{
 const f=fixture();f.ship.activeModuleEffects.set(901,{targetID:9999});
 assert.equal(status(f),"NATIVE_MINING_ACTIVE_ROCK_EFFECT_MISSING");
});
test("conflicting active rock effects and inconsistent fleet assignment fail closed",()=>{
 const f=fixture();const another={itemID:ROCK+1,kind:"asteroid"};
 f.byID.set(another.itemID,another);f.ship.activeModuleEffects.set(902,{targetID:another.itemID});
 const s=f.tick({isMineableStaticEntity:x=>x===f.rock||x===another});
 assert.equal(s.results[0].status,"NATIVE_MINING_ACTIVE_ROCK_TARGET_AMBIGUOUS");
 f.ship.activeModuleEffects.delete(902);f.fleet.assignedAsteroidIDsByMinerID[SHIP]=9999;
 assert.equal(status(f),"NATIVE_MINING_FLEET_TARGET_CONFLICT");
});
test("wrong owner, wrong entity and transient ore rows are never treated as native growth",()=>{
 for(const override of [{ownerID:OWNER+1},{entityID:SHIP+1},{transient:true},
  {cargoID:-1},{typeID:0},{quantity:-1}]){
  const f=fixture();f.put(10,override);
  assert.equal(status(f),"NATIVE_MINING_ORE_CUSTODY_INVALID");
 }
});
test("duplicate same cargoID in native store cannot create artificial positive delta",()=>{
 const f=fixture();f.put(10);f.cargo.push({...f.cargo[0]});
 assert.equal(status(f),"NATIVE_MINING_ORE_CUSTODY_INVALID");
});
test("human-controlled ship or transient NPC cannot prove mined output",()=>{
 for(const mutate of [f=>f.ship.nativeNpc=false,
  f=>f.ship.session={characterID:12},
  f=>f.ship.transient=true,
  f=>f.scene.sessions.set(1,{_space:{shipID:SHIP}}),
  f=>f.updateNative({entityID:SHIP,ownerID:OWNER,systemID:SYSTEM,transient:true}),
  f=>f.updateNative(null)]){
  const f=fixture();mutate(f);
  assert.equal(status(f),"NATIVE_MINING_DURABLE_HULL_NOT_VERIFIED");
 }
});
test("non-mining fleet states and wrong scene cannot claim progress",()=>{
 for(const state of ["hauling","haulereturn","panic","depleted"]){
  const f=fixture();f.fleet.state=state;
  assert.equal(status(f),"NATIVE_MINING_FLEET_NOT_MINING");
 }
 const f=fixture();assert.equal(f.tick({scene:{systemID:30000142}}).status,
  "NATIVE_MINING_WITNESS_CONTEXT_INVALID");
});
test("sampling after long silence re-baselines instead of attributing stale cargo growth",()=>{
 const f=fixture();f.tick();f.advance(400000);f.put(100);
 assert.equal(f.tick().confirmed,0);
});
test("amount reduction from genuine miner cargo transfer to hauler is not fresh mining",()=>{
 const f=fixture();f.put(200);f.tick();f.advance(30000);f.put(3);
 assert.equal(status(f),"NATIVE_ORE_CARGO_MOVED_OR_DECREASED");
});
test("bounds reject huge fleets and cannot create read-only observer side effects",()=>{
 const f=fixture();
 assert.equal(f.tick({fleets:[{...f.fleet,minerEntityIDs:Array(15).fill(SHIP)}]}).status,
  "NATIVE_MINING_PROOF_BUDGET_EXCEEDED");
 assert.equal(f.tick({getNativeEntity:null}).status,"NATIVE_MINING_WITNESS_CONTEXT_INVALID");
 assert.equal(f.tick({fleets:[]}).status,"NO_NATIVE_MINING_FLEET");
 assert.throws(()=>createNativeMiningWitness({maxMiners:0}),/CONFIG_INVALID/);
});
