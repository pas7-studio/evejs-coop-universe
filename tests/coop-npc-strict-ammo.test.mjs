import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {isStrict}=require("../integration/coopNpcAmmoConservation.cjs");
const {specs,transform,classifyFile}=require("../scripts/patch-evejs-coop.cjs");
const snippet=[
 "function isNativeNpcEntity(entity) {",
 ' return Boolean(entity && entity.kind === "ship" && entity.nativeNpc === true);',
 "}",
 "function toInt(x,fallback=0){return Number.isFinite(Number(x))?Math.trunc(Number(x)):fallback;}",
 "function canUseVirtualNativeNpcReloadReserve(entity, moduleItem, chargeTypeID) {",
 " return Boolean(",
 "  isNativeNpcEntity(entity) &&",
 "  moduleItem &&",
 "  toInt(moduleItem.itemID, 0) > 0 &&",
 "  chargeTypeID > 0,",
 " );",
 "}"
].join("\n");
function nativeFn(spec,env={}){
 const code=transform(snippet,spec,false);
 return new Function("require",code+"\nreturn canUseVirtualNativeNpcReloadReserve;")(
  id=>id.includes("coopNpcAmmoConservation")?{isStrict:e=>isStrict(e,env)}:null);
}
test("opt-in cannot affect players or the current default NPC world",()=>{
 assert.equal(isStrict({kind:"ship",nativeNpc:true},{}),false);
 assert.equal(isStrict({kind:"ship",nativeNpc:true},
  {EVEJS_COOP_NPC_STRICT_AMMO:"1"}),true);
 assert.equal(isStrict({kind:"ship",nativeNpc:false},
  {EVEJS_COOP_NPC_STRICT_AMMO:"1"}),false);
 assert.equal(isStrict({kind:"wreck",nativeNpc:true},
  {EVEJS_COOP_NPC_STRICT_AMMO:"1"}),false);
});
for(const target of [
 "server/src/space/modules/localCycleReloads.js",
 "server/src/space/combat/missiles/missileReloads.js"
]){
 const spec=specs.find(x=>x.file===target);
 test(target+": pinned source anchor is reversible and stable",()=>{
  assert.ok(spec);
  const patched=transform(snippet,spec,false);
  assert.equal((patched.match(/coopNpcAmmoConservation/g)||[]).length,1);
  assert.equal(transform(patched,spec,false),patched);
  assert.equal(transform(patched,spec,true),snippet);
  assert.equal(classifyFile(snippet,spec),"PRISTINE");
  assert.equal(classifyFile(patched,spec),"PATCHED");
 });
 test(target+": depleted ammo cannot reload from a virtual reserve",()=>{
  const npc={kind:"ship",nativeNpc:true,itemID:101},
   module={itemID:200,flagID:27,typeID:13784};
  assert.equal(nativeFn(spec)(npc,module,20783),true);
  const strict=nativeFn(spec,{EVEJS_COOP_NPC_STRICT_AMMO:"1"});
  assert.equal(strict(npc,module,20783),false);
  // Pinned queue and completion both invoke this exact helper.
  assert.equal(strict(npc,module,20783),false);
  assert.equal(strict(npc,module,0),false);
  assert.equal(strict(npc,{itemID:0},20783),false);
  assert.equal(strict({kind:"ship",nativeNpc:false},module,20783),false);
 });
}
test("only native missile and local/turret reload sources are modified",()=>{
 assert.deepEqual(specs.filter(s=>s.patches.some(p=>
  p.line.includes("coopNpcAmmoConservation"))).map(s=>s.file).sort(),[
  "server/src/space/combat/missiles/missileReloads.js",
  "server/src/space/modules/localCycleReloads.js"
 ]);
});
