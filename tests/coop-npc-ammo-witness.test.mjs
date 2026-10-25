import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createAmmoWitness}=require("../integration/coopNpcAmmoWitness.cjs");
const SID=30000144,PILOT="coop-pilot-011";
function fixture(){
 const ship={itemID:101,nativeNpc:true,kind:"ship"},
  owner={entityID:101,systemID:SID,ownerID:900},
  modules=[{moduleID:1001,entityID:101,ownerID:900,categoryID:7}],
  cargo=[{cargoID:2001,entityID:101,ownerID:900,moduleID:1001,
    typeID:20783,categoryID:8,quantity:5,transient:false},
   {cargoID:2002,entityID:101,ownerID:900,moduleID:0,
    typeID:20783,categoryID:8,quantity:15,transient:false}];
 const scene={systemID:SID,getEntityByID:id=>id===101?ship:null};
 const assignments=[{pilotID:PILOT,systemID:SID,entityID:101}];
 const store={getNativeEntity:id=>id===101?owner:null,
  listNativeCargoForEntity:id=>id===101?cargo.map(c=>({...c})):[],
  listNativeModulesForEntity:id=>id===101?modules.map(x=>({...x})):[]};
 const witness=createAmmoWitness({store,maxEvents:10});
 const sample=(rows=assignments)=>witness.sample({scene,assignments:rows});
 return {ship,owner,modules,cargo,scene,assignments,store,witness,sample};
}
test("first native charge snapshot is baseline, a real persisted decrement is observable",()=>{
 const f=fixture();
 assert.equal(f.sample().events.length,0);
 f.cargo[0].quantity=4;
 const result=f.sample();
 assert.equal(result.events.length,1);
 assert.deepEqual(result.events[0],{status:"NATIVE_CHARGE_STOCK_DECREASED",
  pilotID:PILOT,systemID:SID,entityID:101,cargoID:2001,
  moduleID:1001,typeID:20783,before:5,after:4,unitsDebited:1,
  source:"NATIVE_NPC_CARGO_STORE",observedShot:false});
 assert.equal(f.sample().events.length,0);
});
test("depleted loaded cargo vanishing is counted once, never minted back",()=>{
 const f=fixture();f.sample();f.cargo.shift();
 assert.equal(f.sample().events[0].unitsDebited,5);
 assert.equal(f.sample().events.length,0);
});
test("ammo in unbound cargo cannot masquerade as loaded combat ammo",()=>{
 const f=fixture();f.sample();
 f.cargo[1].quantity=3;
 assert.equal(f.sample().events.length,0);
});
test("module removed, owner changed or ship missing reset/drop observations",()=>{
 const f=fixture();f.sample();
 f.modules.splice(0);f.cargo[0].quantity=1;
 assert.equal(f.sample().events.length,0);
 f.modules.push({moduleID:1001,entityID:101,ownerID:900,categoryID:7});
 f.owner.ownerID=777;
 assert.equal(f.sample().events.length,0);
 f.ship.nativeNpc=false;
 assert.equal(f.sample().events.length,0);
 f.ship.nativeNpc=true;f.owner.ownerID=900;f.cargo[0].quantity=5;
 assert.equal(f.sample().events.length,0);
});
test("loaded cargo changing module identity is NOT counted as shots",()=>{
 const f=fixture();f.sample();f.modules.push({moduleID:1002,
  entityID:101,ownerID:900,categoryID:7});
 f.cargo[0].moduleID=1002;f.cargo[0].quantity=1;
 assert.equal(f.sample().events.length,0);
});
test("conflicting pilot identity and duplicated links cannot produce evidence",()=>{
 const f=fixture();f.sample();
 f.cargo[0].quantity=1;
 const corrupt=[...f.assignments,{pilotID:"coop-pilot-015",entityID:101,systemID:SID}];
 assert.equal(f.sample(corrupt).events.length,0);
});
test("only legitimate fitted native category-7 module can support charge debit evidence",()=>{
 const f=fixture();f.sample();
 f.modules[0].categoryID=6;f.cargo[0].quantity=1;
 assert.equal(f.sample().events.length,0);
});
test("the witness never writes inventory or invents hit, target or kill claims",()=>{
 const f=fixture();f.store.removeNativeCargo=()=>{throw Error("unexpected write")};
 f.store.upsertNativeCargo=()=>{throw Error("unexpected write")};
 f.sample();f.cargo[0].quantity=2;
 const one=f.sample().events[0];
 assert.equal(one.unitsDebited,3);
 assert.equal(one.observedShot,false);
 assert.equal("targetID" in one,false);
 assert.equal("damage" in one,false);
});
test("invalid native scene and malformed assignments fail closed",()=>{
 const f=fixture();
 assert.equal(f.witness.sample({scene:null,assignments:f.assignments}).status,
  "INVALID_NATIVE_SCENE");
 assert.equal(f.witness.sample({scene:f.scene,assignments:null}).status,
  "INVALID_NATIVE_SCENE");
});
