import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createAmmoGate}=require("../integration/coopNpcWeaponAmmoGate.cjs");
const SYSTEM=30000144;
function fixture(){
 const entity={kind:"ship",nativeNpc:true,itemID:101,ownerID:900};
 const moduleItem={itemID:401,typeID:12001,flagID:27};
 const native={entityID:101,ownerID:900,systemID:SYSTEM};
 const modules=[{moduleID:401,entityID:101,ownerID:900,categoryID:7,
  typeID:12001,flagID:27,moduleState:{online:true}}];
 const cargo=[{cargoID:501,entityID:101,ownerID:900,moduleID:401,
  categoryID:8,typeID:35,quantity:7,transient:false}];
 let family="projectileTurret",opt=false,compatible=true,throwStore=false;
 const store={
  getNativeEntity:()=>{if(throwStore)throw Error("DISCONNECTED_DB");return native;},
  listNativeModulesForEntity:()=>modules,
  listNativeCargoForEntity:()=>cargo
 };
 const dogma={resolveWeaponFamily:()=>family,isChargeOptionalTurretWeapon:()=>opt};
 const capability={isNpcChargeCompatibleWithModule:()=>compatible};
 const env={EVEJS_COOP_NPC_STRICT_AMMO:"1"};
 const gate=createAmmoGate({store,dogma,capability,env});
 return {entity,moduleItem,native,modules,cargo,store,env,gate,
  check:(input={})=>gate.check({entity,moduleItem,...input}),
  family:x=>family=x,optional:x=>opt=x,compatible:x=>compatible=x,
  fault:x=>throwStore=x};
}
test("default world mode and human ships keep vanilla native weapon behaviour",()=>{
 const f=fixture();f.env.EVEJS_COOP_NPC_STRICT_AMMO="0";f.cargo.splice(0);
 assert.equal(f.check().allowed,true);
 f.env.EVEJS_COOP_NPC_STRICT_AMMO="1";
 f.entity.nativeNpc=false;
 assert.equal(f.check().allowed,true);
});
test("native physical charge in exact owner module allows activation",()=>{
 const f=fixture();const out=f.check();
 assert.equal(out.allowed,true);assert.equal(out.status,"NATIVE_LOADED_AMMO_VERIFIED");
 assert.equal(out.modules,1);
});
test("missing real loaded ammo refuses both initial and repeated activation",()=>{
 const f=fixture();f.cargo.splice(0);
 const a=f.check(),b=f.check();
 assert.equal(a.status,"NATIVE_AMMO_EMPTY_OR_AMBIGUOUS");
 assert.equal(a.allowed,false);assert.deepEqual(a,b);
});
test("loose ammo in cargo is not permission to fire before native reload",()=>{
 const f=fixture();f.cargo[0].moduleID=0;
 assert.equal(f.check().allowed,false);
});
test("zero, fractional, negative and transient charge stacks cannot fire",()=>{
 const f=fixture();
 for(const quantity of [0,-1,1.5,NaN]){
  f.cargo[0].quantity=quantity;
  assert.equal(f.check().allowed,false);
 }
 f.cargo[0].quantity=2;f.cargo[0].transient=true;
 assert.equal(f.check().allowed,false);
});
test("wrong type or owner cannot spoof loaded native weapon ammo",()=>{
 const f=fixture();f.compatible(false);
 assert.equal(f.check().allowed,false);
 f.compatible(true);f.cargo[0].ownerID=901;
 assert.equal(f.check().allowed,false);
 f.cargo[0].ownerID=900;f.entity.ownerID=901;
 assert.equal(f.check().status,"NATIVE_SHIP_CUSTODY_MISSING");
});
test("unverified module, duplicate module and ambiguous double-loaded ammo deny firing",()=>{
 const f=fixture();f.modules.splice(0);
 assert.equal(f.check().status,"NATIVE_WEAPON_MODULE_NOT_VERIFIED");
 f.modules.push({moduleID:401,entityID:101,ownerID:900,categoryID:7,flagID:27},
  {moduleID:401,entityID:101,ownerID:900,categoryID:7,flagID:27});
 assert.equal(f.check().allowed,false);
 f.modules.splice(1);f.cargo.push({...f.cargo[0],cargoID:502});
 assert.equal(f.check().status,"NATIVE_AMMO_EMPTY_OR_AMBIGUOUS");
});
test("grouped native weapon bank needs real ammo for every fitted barrel",()=>{
 const f=fixture();
 f.modules.push({moduleID:402,entityID:101,ownerID:900,
  categoryID:7,flagID:28,typeID:12001});
 assert.equal(f.check({bankModuleIDs:[401,402]}).allowed,false);
 f.cargo.push({...f.cargo[0],cargoID:502,moduleID:402});
 const out=f.check({bankModuleIDs:[401,402]});
 assert.equal(out.allowed,true);assert.equal(out.modules,2);
 f.cargo[1].quantity=0;
 assert.equal(f.check({bankModuleIDs:[401,402]}).allowed,false);
});
test("bad bank identity cannot bypass verified physical weapon checking",()=>{
 const f=fixture();
 assert.equal(f.check({bankModuleIDs:[402,403]}).status,
  "NATIVE_BANK_MEMBERSHIP_INVALID");
 assert.equal(f.check({bankModuleIDs:[401,0]}).status,
  "NATIVE_BANK_MEMBERSHIP_INVALID");
});
test("genuine charge-optional turret and native hull weapon remain usable",()=>{
 const f=fixture();f.cargo.splice(0);
 f.optional(true);
 assert.equal(f.check().status,"CHARGE_OPTIONAL_WEAPON");
 f.optional(false);
 assert.equal(f.check({moduleItem:{...f.moduleItem,
  npcSyntheticHullWeapon:true}}).status,"SYNTHETIC_HULL_WEAPON");
});
test("unknown weapon class never bypasses strict ammo economy",()=>{
 const f=fixture();f.family("unknown");
 assert.equal(f.check().status,"UNKNOWN_NATIVE_WEAPON_FAMILY");
});
test("native source unavailable fails closed; no mutation or fabricated events",()=>{
 const f=fixture();f.fault(true);
 assert.equal(f.check().status,"NATIVE_AMMO_PROOF_UNAVAILABLE");
 assert.equal(f.cargo.length,1);
 assert.equal(f.cargo[0].quantity,7);
});
test("non-matching persisted system and wrong ship entity identity fail closed",()=>{
 const f=fixture();f.entity.systemID=SYSTEM+1;
 assert.equal(f.check().status,"NATIVE_SHIP_CUSTODY_MISSING");
 f.entity.systemID=SYSTEM;f.native.entityID=999;
 assert.equal(f.check().allowed,false);
});
