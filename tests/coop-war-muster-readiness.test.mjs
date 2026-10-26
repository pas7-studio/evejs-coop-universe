import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createWarMusterReadiness}=require("../integration/coopWarMusterReadiness.cjs");
function fixture(){
 const entityID=501,systemID=101,corporationID=31;
 const native={entityID,systemID,corporationID,ownerID:31};
 const ship={itemID:entityID,kind:"ship",nativeNpc:true,corporationID,
  ownerID:31};
 const modules=[{moduleID:800,entityID,ownerID:31,
  categoryID:7,flagID:27,typeID:900,moduleState:{online:true}}];
 const cargo=[{cargoID:1000,entityID,ownerID:31,moduleID:800,
  categoryID:8,typeID:901,quantity:10}];
 let optional=false,compatible=true,family="projectileTurret";
 const check=createWarMusterReadiness({
  store:{getNativeEntity:()=>native,
   listNativeModulesForEntity:()=>modules,
   listNativeCargoForEntity:()=>cargo},
  resolveFamily:()=>family,
  isOptional:()=>optional,
  compatible:()=>compatible
 });
 return {native,ship,modules,cargo,
  inspect:()=>check.inspect({entityID,systemID,corporationID,ship}),
  optional:v=>optional=v,compatible:v=>compatible=v,family:v=>family=v};
}
test("real native loaded weapon qualifies without changing inventory",()=>{
 const f=fixture(),original=structuredClone(f.cargo);
 const x=f.inspect();
 assert.equal(x.ready,true);assert.equal(x.armedModuleCount,1);
 assert.deepEqual(f.cargo,original);
});
test("no ammo, loose cargo, bogus ammo and incompatible charge all refuse",()=>{
 const f=fixture();f.cargo[0].quantity=0;
 assert.equal(f.inspect().ready,false);
 f.cargo[0].quantity=10;f.cargo[0].moduleID=0;
 assert.equal(f.inspect().ready,false);
 f.cargo[0].moduleID=800;f.compatible(false);
 assert.equal(f.inspect().ready,false);
 f.compatible(true);f.cargo[0].transient=true;
 assert.equal(f.inspect().ready,false);
});
test("charge-optional native fitted laser qualifies but not optional missile",()=>{
 const f=fixture();f.cargo.splice(0);
 f.optional(true);f.family("laserTurret");
 assert.equal(f.inspect().ready,true);
 f.family("missileLauncher");assert.equal(f.inspect().ready,false);
});
test("no synthetic-only military hull or duplicated fitting makes a warship",()=>{
 const f=fixture();f.modules.splice(0);
 assert.equal(f.inspect().ready,false);
 f.modules.push({moduleID:800,entityID:501,ownerID:31,
  categoryID:7,typeID:900,flagID:27}, {...f.modules[0]});
 assert.equal(f.inspect().reason,"WAR_FITTING_IDENTITY_CONFLICT");
});
test("native owner, corporation and physical NPC scene are mandatory",()=>{
 const f=fixture();f.native.ownerID=55;
 assert.equal(f.inspect().reason,"NATIVE_WAR_OWNER_MISMATCH");
 f.native.ownerID=31;f.ship.nativeNpc=false;
 assert.equal(f.inspect().reason,"PHYSICAL_WAR_HULL_NOT_VERIFIED");
});
