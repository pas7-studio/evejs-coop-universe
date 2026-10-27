import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createGunRange}=require("../integration/coopNpcGunRange.cjs");

// Real dogma shapes: a turret snapshot carries maxRange as `optimalRange` plus
// `falloff`; a launcher carries its own missile range as `approxRange`.
const MODULES=[
 {moduleID:1,typeID:13884,flagID:27,family:"hybrid",optimalRange:4500,falloff:5000,chargeTypeID:20057},
 {moduleID:2,typeID:13884,flagID:28,family:"hybrid",optimalRange:4500,falloff:5000,chargeTypeID:20057},
 {moduleID:3,typeID:13773,flagID:29,family:"projectile",optimalRange:9000,falloff:6000,chargeTypeID:20767},
];
function fixture({modules=MODULES,snapshots=null}={}){
 return createGunRange({
  weaponModulesOf:()=>modules,
  snapshotOf:(_entity,moduleItem)=>{
   const hit=snapshots?snapshots(moduleItem):modules.find(m=>m.moduleID===moduleItem.moduleID);
   return hit||null;
  },
  isMissileFamily:family=>/missile/i.test(String(family||"")),
 });
}

test("a hull fights at its own furthest fitted weapon maxRange",()=>{
 const gun=fixture();
 const resolved=gun.rangeOf({itemID:501,typeID:1});
 assert.equal(resolved.status,"RESOLVED");
 assert.equal(resolved.meters,9000);
 assert.equal(resolved.source,"maxRange");
 assert.equal(resolved.typeID,13773);
 assert.equal(resolved.weaponCount,3);
});

test("a launcher resolves its own missile range, never a turret field",()=>{
 const gun=fixture({modules:[
  {moduleID:9,typeID:499,flagID:27,family:"missile",approxRange:21250,optimalRange:0,chargeTypeID:213},
 ]});
 const resolved=gun.rangeOf({itemID:601,typeID:2});
 assert.equal(resolved.status,"RESOLVED");
 assert.equal(resolved.meters,21250);
 assert.equal(resolved.source,"missileRange");
});

test("a hull with no fitted weapon resolves nothing instead of a made-up range",()=>{
 const gun=fixture({modules:[]});
 const resolved=gun.rangeOf({itemID:602,typeID:3});
 assert.equal(resolved.status,"REFUSED");
 assert.equal(resolved.reason,"NO_FITTED_WEAPON_RANGE");
});

test("a module whose native snapshot fails is never given a guessed range",()=>{
 const gun=fixture({modules:[
  {moduleID:1,typeID:13884,flagID:27,family:"hybrid",optimalRange:4500,falloff:5000},
  {moduleID:2,typeID:99999,flagID:28},
 ],snapshots:m=>m.moduleID===1?m:null});
 const resolved=gun.rangeOf({itemID:501,typeID:1});
 assert.equal(resolved.status,"RESOLVED");
 assert.equal(resolved.weaponCount,1);
 assert.equal(resolved.weapons.length,1);
});

test("a zero-range weapon cannot become the chosen range",()=>{
 const gun=fixture({modules:[
  {moduleID:1,typeID:13884,flagID:27,family:"hybrid",optimalRange:0,falloff:5000},
 ]});
 const resolved=gun.rangeOf({itemID:501,typeID:1});
 assert.equal(resolved.status,"REFUSED");
});

test("the module refuses to be built without its native authorities",()=>{
 assert.throws(()=>createGunRange({weaponModulesOf:()=>[]}).rangeOf({itemID:1,typeID:1}),
  /GUN_RANGE_AUTHORITIES_REQUIRED/);
});
