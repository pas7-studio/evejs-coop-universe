import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createService,roleMarker,slotKey}=require("../integration/coopNativeMiningFleetDurable.cjs");

// The live failure: every durable "hauler" slot held a Mining Venture (50 m3) while the
// miners were Hulks and Skiffs, so the strict transfer refused every stack as "full"
// and ore never left the belt. The repair must be additive: the mis-roled hull keeps its
// identity and becomes an extra miner, and a real hauler is spawned beside it.
const SYSTEM=30000144;

function fixture(t,{haulerProfile="ore_mining_venture",haulerCargo=0,spawnedHaulerProfile=null,
 composition=true}={}){
 const flags={EVEJS_COOP_NATIVE_MINING_FLEET_DURABLE:"1",
  EVEJS_COOP_FLEET_COMPOSITION:composition?"1":"0"};
 const old={};
 for(const key of Object.keys(flags)){
  old[key]=process.env[key];
  process.env[key]=flags[key];
  t.after(()=>{if(old[key]===undefined)delete process.env[key];else process.env[key]=old[key];});
 }
 const world={slots:new Map(),entities:new Map(),controllers:new Map(),
  cargo:new Map(),modules:new Map()};
 const physical=new Map();
 let spawnCalls=0,fleets=[];
 const scene={systemID:SYSTEM,getEntityByID:id=>physical.get(id)||null};
 let spawnHook=()=>spawnedHaulerProfile;
 const db={
  read(t,p){const key=p.split("/").at(-1);return world.slots.has(key)?
    {success:true,data:structuredClone(world.slots.get(key))}:
    {success:false,errorMsg:"ENTRY_NOT_FOUND"};},
  write(t,p,v){world.slots.set(p.split("/").at(-1),structuredClone(v));return{success:true};},
  flushTableSync(){return{success:true};},
  flushTablesSync(){return{success:true};},
 };
 const store={
  listNativeEntitiesForSystem:s=>[...world.entities.values()].filter(x=>x.systemID===s),
  getNativeEntity:id=>world.entities.get(id)||null,
  getNativeController:id=>world.controllers.get(id)||null,
  listNativeCargoForEntity:id=>[...world.cargo.values()].filter(x=>x.entityID===id),
  listNativeModulesForEntity:id=>[...world.modules.values()].filter(x=>x.entityID===id),
  upsertNativeEntity(row){world.entities.set(row.entityID,structuredClone(row));return{success:true};},
  upsertNativeController(row){world.controllers.set(row.entityID,structuredClone(row));return{success:true};},
 };
 const nativeService={materializeStoredNativeController(scene,id){
  const row=world.entities.get(id);
  if(!row)return{success:false,errorMsg:"NOT_FOUND"};
  physical.set(id,{kind:"ship",nativeNpc:true,itemID:id,ownerID:row.ownerID});
  return{success:true};
 }};
 const register=(slot,data)=>{const fleet={startupKey:SYSTEM+":"+slot,fleetID:SYSTEM*32+slot,...data};
  fleets.push(fleet);return fleet;};
 function spawn(slot,wing={}){
  spawnCalls++;
  const miners=[],haulers=[];
  const count=Number(wing.miners===undefined?1:wing.miners);
  const haul=Number(wing.haulers===undefined?1:wing.haulers);
  for(let i=0;i<count;i++)miners.push(76000+spawnCalls*10+i);
  for(let i=0;i<haul;i++)haulers.push(77000+spawnCalls*10+i);
  for(const [role,ids] of [["miner",miners],["hauler",haulers]]){
   const profile=role==="hauler"?(spawnHook()||"ore_mining_badger_hauler"):"ore_mining_skiff";
   for(const id of ids){
    const marker=roleMarker(SYSTEM,slot,role);
    world.entities.set(id,{entityID:id,systemID:SYSTEM,ownerID:950,typeID:1,
     operatorKind:marker,nativeNpc:true,transient:false,profileID:profile});
    world.controllers.set(id,{entityID:id,systemID:SYSTEM,operatorKind:marker,
     profileID:profile,transient:false,startupRuleID:null});
    physical.set(id,{kind:"ship",nativeNpc:true,itemID:id,ownerID:950});
   }
  }
  return{success:true,data:{minerEntityIDs:miners,haulerEntityIDs:haulers,
   originAnchor:{position:{x:1,y:2,z:3}}}};
 }
 // Seed one slot exactly the way the live world looks: two mining hulls plus a
 // "hauler" that is a mining hull, every one of them durable with a real profile.
 function seed(){
  const miners=[90001,90002],haulers=[90003];
  for(const [role,ids,profile] of [["miner",miners,"ore_mining_skiff"],
   ["hauler",haulers,haulerProfile]]){
   for(const id of ids){
    const marker=roleMarker(SYSTEM,1,role);
    world.entities.set(id,{entityID:id,systemID:SYSTEM,ownerID:950,typeID:1,
     operatorKind:marker,nativeNpc:true,transient:false,profileID:profile});
    world.controllers.set(id,{entityID:id,systemID:SYSTEM,operatorKind:marker,
     profileID:profile,transient:false,startupRuleID:null});
    world.modules.set(id*10,{moduleID:id*10,entityID:id,transient:false});
    physical.set(id,{kind:"ship",nativeNpc:true,itemID:id,ownerID:950});
   }
  }
  if(haulerCargo>0){
   world.cargo.set(980001,{cargoID:980001,entityID:90003,ownerID:950,typeID:34,
    quantity:haulerCargo,transient:false});
  }
  world.slots.set(slotKey(SYSTEM,1),{version:1,status:"ACTIVE",systemID:SYSTEM,slot:1,
   fleetID:SYSTEM*32+1,minerEntityIDs:miners,haulerEntityIDs:haulers});
 }
 const log=[];
 const create=()=>createService({db,store,nativeService,ensureState:()=>{},spawn,register,
  getFleets:()=>fleets,log:s=>log.push(s)});
 return {world,scene,log,seed,
  start:()=>create().start({scene,fleetCount:1}),
  getSpawnCalls:()=>spawnCalls,
  setSpawnHook:fn=>spawnHook=fn,
  witness:()=>world.slots.get(slotKey(SYSTEM,1))};
}

test("with the flag off a mis-composed slot is left exactly as it is",t=>{
 const f=fixture(t,{composition:false});f.seed();
 const r=f.start();
 assert.equal(r.status,"OK",JSON.stringify(r.slots[0]));
 assert.equal(f.getSpawnCalls(),0);
 assert.deepEqual(f.witness().haulerEntityIDs,[90003]);
 assert.equal(r.slots[0].recomposed,false);
});

test("a mining hull in the hauler role is demoted to an extra miner and a real hauler is added",t=>{
 const f=fixture(t);f.seed();
 const r=f.start();
 assert.equal(r.status,"OK");
 assert.equal(f.getSpawnCalls(),1,"exactly one hull is allocated");
 assert.equal(r.slots[0].recomposed,true);
 const slot=f.witness();
 assert.deepEqual(slot.minerEntityIDs,[90001,90002,90003],"the Venture keeps its ship and becomes a miner");
 assert.deepEqual(slot.haulerEntityIDs,[77010],"a real hauler is added, nothing is replaced");
 assert.deepEqual(slot.demotedHaulerIDs,[90003]);
 assert.deepEqual(slot.addedHaulerIDs,[77010]);
 assert.deepEqual(slot.keptMisroledHaulerIDs,[]);
 // The demoted hull keeps every row it owned; only its role marker changed.
 assert.equal(f.world.controllers.get(90003).operatorKind,roleMarker(SYSTEM,1,"miner"));
 assert.equal(f.world.entities.get(90003).operatorKind,roleMarker(SYSTEM,1,"miner"));
 assert.ok(f.world.modules.get(900030),"the demoted hull keeps its fitted modules");
 assert.equal(f.world.entities.get(90003).entityID,90003);
 // The added hull is a real industrial hull, and the event names the change.
 assert.equal(f.world.controllers.get(77010).profileID,"ore_mining_badger_hauler");
 assert.ok(f.log.some(line=>line.includes("composed")&&line.includes("addedHaulers=77010")&&
  line.includes("reason=MISROLED_HAULER_DEMOTED")));
});

test("a mis-roled hull that already holds ore is never demoted",t=>{
 const f=fixture(t,{haulerCargo:1200});f.seed();
 const r=f.start();
 assert.equal(r.status,"OK");
 assert.equal(r.slots[0].recomposed,true);
 const slot=f.witness();
 assert.deepEqual(slot.demotedHaulerIDs,[],"its cargo would be orphaned");
 assert.deepEqual(slot.keptMisroledHaulerIDs,[90003]);
 assert.deepEqual(slot.haulerEntityIDs,[90003,77010],"it stays a hauler and a real one is added");
 assert.equal(f.world.controllers.get(90003).operatorKind,roleMarker(SYSTEM,1,"hauler"));
 assert.equal(f.world.cargo.get(980001).quantity,1200,"the ore is still on the hull that holds it");
});

test("a slot that already has a real hauler is not touched",t=>{
 const f=fixture(t,{haulerProfile:"ore_mining_mammoth_hauler"});f.seed();
 const r=f.start();
 assert.equal(r.status,"OK");
 assert.equal(f.getSpawnCalls(),0);
 assert.equal(r.slots[0].recomposed,false);
 assert.deepEqual(f.witness().haulerEntityIDs,[90003]);
});

test("a repair that spawns the wrong hull class blocks the slot instead of registering it",t=>{
 const f=fixture(t,{spawnedHaulerProfile:"ore_mining_venture"});f.seed();
 const r=f.start();
 assert.equal(r.status,"NEEDS_OPERATOR_REPAIR");
 assert.match(String(r.slots[0].reason),/ALIFE08_RECOMPOSE_BAD_HAULER_HULL/);
});

test("the repair is idempotent: a recomposed slot is stable on the next start",t=>{
 const f=fixture(t);f.seed();
 assert.equal(f.start().status,"OK");
 assert.deepEqual(f.witness().haulerEntityIDs,[77010]);
 const again=f.start();
 // The witness already names a real hauler, so nothing is allocated a second time and
 // the demoted hull stays a miner with its own identity.
 assert.equal(again.slots[0].recomposed,false);
 assert.equal(f.getSpawnCalls(),1);
 assert.deepEqual(f.witness().minerEntityIDs,[90001,90002,90003]);
 assert.deepEqual(f.witness().haulerEntityIDs,[77010]);
});

// The first live attempt spawned a hauler and then failed before writing the witness.
// The next start must ABSORB that real hull instead of spawning another one: an
// interrupted repair must converge, never accumulate.
test("a real hauler left by an interrupted attempt is absorbed, not duplicated",t=>{
 const f=fixture(t);f.seed();
 // A real hauler that wears this slot"s marker but is missing from the witness.
 const marker=roleMarker(SYSTEM,1,"hauler");
 f.world.entities.set(90009,{entityID:90009,systemID:SYSTEM,ownerID:950,typeID:1,
  operatorKind:marker,nativeNpc:true,transient:false,profileID:"ore_mining_badger_hauler"});
 f.world.controllers.set(90009,{entityID:90009,systemID:SYSTEM,operatorKind:marker,
  profileID:"ore_mining_badger_hauler",transient:false,startupRuleID:null});
 f.world.modules.set(900090,{moduleID:900090,entityID:90009,transient:false});
 const r=f.start();
 assert.equal(r.status,"OK");
 assert.equal(r.slots[0].recomposed,true);
 assert.equal(f.getSpawnCalls(),0,"the orphan real hauler already replaces the Venture");
 const slot=f.witness();
 assert.deepEqual(slot.minerEntityIDs,[90001,90002,90003]);
 assert.deepEqual(slot.haulerEntityIDs,[90009]);
 assert.deepEqual(slot.addedHaulerIDs,[]);
 assert.equal(slot.recomposedAtMs>0,true);
});

test("a witness that merely disagrees with the markers is reconciled without spawning",t=>{
 const f=fixture(t,{haulerProfile:"ore_mining_mammoth_hauler"});f.seed();
 const marker=roleMarker(SYSTEM,1,"hauler");
 f.world.entities.set(90019,{entityID:90019,systemID:SYSTEM,ownerID:950,typeID:1,
  operatorKind:marker,nativeNpc:true,transient:false,profileID:"ore_mining_mammoth_hauler"});
 f.world.controllers.set(90019,{entityID:90019,systemID:SYSTEM,operatorKind:marker,
  profileID:"ore_mining_mammoth_hauler",transient:false,startupRuleID:null});
 const r=f.start();
 assert.equal(r.status,"OK");
 assert.equal(f.getSpawnCalls(),0);
 assert.deepEqual(f.witness().haulerEntityIDs,[90003,90019]);
});
