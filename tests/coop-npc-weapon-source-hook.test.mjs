import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createAmmoGate}=require("../integration/coopNpcWeaponAmmoGate.cjs");
const {specs,transform,classifyFile}=require("../scripts/patch-evejs-coop.cjs");
const spec=specs.find(x=>x.file==="server/src/space/npc/npcBehaviorLoop.js");
const fixture=[
 // npcBehaviorLoop.js carries six hook sites the spec patches; the fixture has to
 // model each anchor or transform() correctly refuses the synthetic file.
 'function clearNpcTargetLocks(scene, entity) { return null; }',
 'function canAttack(entity, target, sourceClass, targetClass) {',
 '  if (sourceClass === "npc" && targetClass === "npc") {',
 '    return false;',
 '  }',
 '  if (sourceClass === "npc") {',
 '    return targetClass === "npc";',
 '  }',
 '  return false;',
 '}',
 'function launchMissile(entity, target, entityMissileSource) {',
 '  const launchResult = {success:true};',
 '      if (launchResult && launchResult.success) {',
 '        return launchResult;',
 '      }',
 '  return null;',
 '}',
 'function exampleSyncNpcWeapons(entity,modules,scene,activeEffect,options={}){',
 ' const pseudoSession={characterID:0};',
 ' const bankModuleIDs=modules.map(m=>m.itemID);',
 ' for(const moduleItem of modules){',
 '    if (activeEffect) {',
 '      logNpcCombatDebug("npc.weapons.module-already-active", () => ({}));',
 '      continue;',
 '    }',
 '    const activationOutcome = scene.activateGenericModule(pseudoSession,moduleItem);',
 '    logNpcCombatDebug("npc.weapons.module-activate", () => ({',
 '      moduleID: moduleItem.itemID,',
 '    }));',
 ' }',
 // npcBehaviorLoop.js carries a second hook site the spec patches: the mining
 // target-lock guard inside the clearTargets branch.
 '  if (options.clearTargets !== false) {',
 '    clearNpcTargetLocks(scene, entity);',
 '  }',
 '}'
].join("\n");
function runtime({hasAmmo=true,strict=true,active=false}={}){
 const cargo=hasAmmo?[{cargoID:501,entityID:101,ownerID:900,
  moduleID:401,typeID:35,categoryID:8,quantity:2}]:[];
 const store={getNativeEntity:()=>({entityID:101,ownerID:900,systemID:30000144}),
  listNativeModulesForEntity:()=>[{moduleID:401,entityID:101,
   ownerID:900,typeID:12001,categoryID:7,flagID:27}],
  listNativeCargoForEntity:()=>cargo};
 const policy=createAmmoGate({store,
  dogma:{resolveWeaponFamily:()=>"projectileTurret",
   isChargeOptionalTurretWeapon:()=>false},
  capability:{isNpcChargeCompatibleWithModule:()=>true},
  env:{EVEJS_COOP_NPC_STRICT_AMMO:strict?"1":"0"}});
 const events=[];
 const scene={
  activateGenericModule:()=>{events.push("ACTIVATE");return {success:true};},
  deactivateGenericModule:()=>{events.push("DEACTIVATE");return {success:true};}
 };
 const native={kind:"ship",nativeNpc:true,itemID:101,ownerID:900};
 const moduleItem={itemID:401,typeID:12001,flagID:27};
 const code=transform(fixture,spec,false);
 const sync=new Function("require","logNpcCombatDebug",
  code+"\nreturn exampleSyncNpcWeapons;")(
   path=>path.includes("coopNpcWeaponAmmoGate")?{check:policy.check}:null,
   ()=>{});
 return {sync,scene,native,moduleItem,events,activeEffect:active?{moduleID:401}:null};
}
test("source hook blocks native weapon activation when no loaded source ammo",()=>{
 const f=runtime({hasAmmo:false});
 f.sync(f.native,[f.moduleItem],f.scene,null);
 assert.deepEqual(f.events,[]);
});
test("source hook deactivates an already-running module with depleted ammo",()=>{
 const f=runtime({hasAmmo:false,active:true});
 f.sync(f.native,[f.moduleItem],f.scene,f.activeEffect);
 assert.deepEqual(f.events,["DEACTIVATE"]);
});
test("valid native charge permits vanilla activation and maintaining effect",()=>{
 const initial=runtime();
 initial.sync(initial.native,[initial.moduleItem],initial.scene,null);
 assert.deepEqual(initial.events,["ACTIVATE"]);
 const active=runtime({active:true});
 active.sync(active.native,[active.moduleItem],active.scene,active.activeEffect);
 assert.deepEqual(active.events,[]);
});
test("strict feature is OFF by default and never changes old activation",()=>{
 const f=runtime({hasAmmo:false,strict:false});
 f.sync(f.native,[f.moduleItem],f.scene,null);
 assert.deepEqual(f.events,["ACTIVATE"]);
});
test("pinned native weapon activation hook is single, idempotent, reversible",()=>{
 assert.ok(spec);
 assert.equal(classifyFile(fixture,spec),"PRISTINE");
 const patched=transform(fixture,spec,false);
 assert.equal((patched.match(/coopNpcWeaponAmmoGate/g)||[]).length,1);
 assert.equal(transform(patched,spec,false),patched);
 assert.equal(transform(patched,spec,true),fixture);
 assert.equal(classifyFile(patched,spec),"PATCHED");
});
