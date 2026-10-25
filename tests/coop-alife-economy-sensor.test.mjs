import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {readEconomySnapshot}=require("../integration/coopAlifeEconomySensor.cjs");
const SYS=30000142,STATION=60000001,SHIP=100101,OWNER=1000010;
function fixture(){
 const ship={kind:"ship",nativeNpc:true,itemID:SHIP,hpRatio:0.95,
  position:{x:100,y:0,z:0},mode:"IDLE",radius:10};
 let cargo=[{entityID:SHIP,ownerID:OWNER,categoryID:25,quantity:120,typeID:1230}];
 const scene={systemID:SYS,staticEntities:[
  {kind:"station",itemID:STATION,position:{x:0,y:0,z:0},radius:500}],
  getEntityByID:id=>id===SHIP?ship:null};
 const link={pilotID:"coop-pilot-101",entityID:SHIP,systemID:SYS};
 const roles=new Map([["coop-pilot-101","hauler"]]);
 const cfg={systemID:SYS,scene,links:[link],roles,
  getController:id=>({entityID:id,systemID:SYS,currentTargetID:0}),
  getStation:id=>({stationID:id,solarSystemID:SYS}),
  getNativeEntity:id=>({entityID:id,systemID:SYS,ownerID:OWNER}),
  listNativeCargo:()=>cargo,readStationEconomy:()=>null,clock:()=>1000000};
 return{cfg,ship,setCargo:v=>{cargo=v}};
}
test("real scene + controller + native owner + native ore produces station-bound haul data",()=>{
 const f=fixture(),r=readEconomySnapshot(f.cfg);
 assert.equal(r.authoritativeNative,true);assert.equal(r.source,"NATIVE_SCENE_CONTROLLER_CARGO_SDE");
 assert.equal(r.pilots.length,1);assert.equal(r.pilots[0].cargoOreQuantity,120);
 assert.equal(r.pilots[0].stationID,STATION);
 assert.equal(r.pilots[0].atStation,true);
});
test("remote native hauler is not misclassified as physically delivered",()=>{
 const f=fixture();f.ship.position.x=300000000000;
 const r=readEconomySnapshot(f.cfg);
 assert.equal(r.pilots[0].atStation,false);
});
test("a fake player ship cannot become an economic NPC",()=>{
 const f=fixture();f.ship.nativeNpc=false;
 const r=readEconomySnapshot(f.cfg);
 assert.equal(r.pilots.length,0);assert.equal(r.omitted[0].reason,"NATIVE_HULL_OR_CONTROLLER_NOT_VERIFIED");
});
test("unknown native store owner invalidates matching cargo proof",()=>{
 const f=fixture();f.cfg.getNativeEntity=()=>({entityID:SHIP,systemID:SYS,ownerID:99});
 const r=readEconomySnapshot(f.cfg);
 assert.equal(r.pilots.length,0);assert.equal(r.omitted[0].reason,"NATIVE_CARGO_PROVENANCE_INVALID");
});
test("non-scalar native cargo quantity cannot seed factory stock",()=>{
 const f=fixture();f.setCargo([{entityID:SHIP,ownerID:OWNER,categoryID:25,quantity:3.5}]);
 const r=readEconomySnapshot(f.cfg);
 assert.equal(r.pilots.length,0);assert.equal(r.omitted[0].reason,"NATIVE_CARGO_PROVENANCE_INVALID");
});
test("missing native hull HP evidence refuses optimistic 100 percent health",()=>{
 const f=fixture();delete f.ship.hpRatio;
 const r=readEconomySnapshot(f.cfg);
 assert.equal(r.pilots.length,0);
});
test("a forged station in another solar system is never selected",()=>{
 const f=fixture();f.cfg.getStation=id=>({stationID:id,solarSystemID:SYS+1});
 const r=readEconomySnapshot(f.cfg);
 assert.equal(r.stations.length,0);assert.equal(r.pilots[0].stationID,null);
});
test("duplicate pilot attached to distinct native hulls blocks whole scene proof",()=>{
 const f=fixture();f.cfg.links.push({...f.cfg.links[0],entityID:SHIP+1});
 const r=readEconomySnapshot(f.cfg);
 assert.equal(r.authoritativeNative,false);assert.equal(r.reason,"NATIVE_PILOT_LINK_COLLISION");
});
test("missing physical scene returns blocked instead of virtual actor projection",()=>{
 const f=fixture();f.cfg.scene={systemID:SYS};
 const r=readEconomySnapshot(f.cfg);
 assert.equal(r.authoritativeNative,false);assert.equal(r.reason,"NATIVE_SCENE_SENSOR_DEPENDENCIES");
});
test("station factory data stays unavailable until independently native verified",()=>{
 const f=fixture();f.cfg.readStationEconomy=()=>({factoryOnline:true,productShortage:500});
 const r=readEconomySnapshot(f.cfg);
 assert.equal(r.stations[0].economy,null);
});
test("explicitly verified station finance evidence passes through without writes",()=>{
 const f=fixture();const info={authoritativeNative:true,factoryOnline:true};
 f.cfg.readStationEconomy=()=>info;
 assert.deepEqual(readEconomySnapshot(f.cfg).stations[0].economy,info);
});
test("ship actively targeting a player is marked combat-busy for A-Life prioritization",()=>{
 const f=fixture();f.cfg.getController=id=>({entityID:id,systemID:SYS,currentTargetID:77});
 const r=readEconomySnapshot(f.cfg);
 assert.equal(r.pilots[0].underAttack,true);
});


test("ammo state comes only from existing proven native ammo inspector",()=>{
 const f=fixture();f.cfg.inspectNativeAmmo=()=>({status:"AMMO_EXHAUSTED"});
 assert.equal(readEconomySnapshot(f.cfg).pilots[0].ammoState,"AMMO_EXHAUSTED");
 f.cfg.inspectNativeAmmo=()=>({status:"UNKNOWN"});
 assert.equal(readEconomySnapshot(f.cfg).pilots[0].ammoState,"UNVERIFIED");
});
test("failed native ammo read is never interpreted as available free ammunition",()=>{
 const f=fixture();f.cfg.inspectNativeAmmo=()=>{throw Error("UNAVAILABLE")};
 assert.equal(readEconomySnapshot(f.cfg).pilots[0].ammoState,"UNVERIFIED");
});
