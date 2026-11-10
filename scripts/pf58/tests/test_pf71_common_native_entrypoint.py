"""PF71: both original native runtime callsites must be covered by a shared PF guard.

Tests the exact PF58 transformer on an original-shaped native service source, then
executes the injected low-level materializer in Node's VM with side-effect counters.
This does NOT boot the real EveJS server or authorize an actual ship deployment.
"""
from pathlib import Path
import importlib.util
import subprocess
import tempfile
import unittest

BASE=Path(__file__).resolve().parents[1]
SPEC=importlib.util.spec_from_file_location('pf71_real_patch',BASE/'build_native_stock_fittings_patch.py')
PATCH=importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PATCH)

# The native source has both a fresh spawn branch and an existing runtime branch.
# Distinct original read entrypoint must not be sufficient to protect these.
SOURCE='''const path=require('path');
const nativeNpcStore={};
const spaceRuntime={};
function buildNativeRuntimeShipSpec(entityRecord) {
  return {
    fittedItems: nativeNpcStore.buildNativeFittedItems(entityRecord.entityID),
    nativeCargoItems: nativeNpcStore.buildNativeCargoItems(entityRecord.entityID),
    modules: nativeNpcStore.buildNativeSlimModuleTuples(entityRecord.entityID),
  };
}
function applyNativeRuntimeNpcPresentation(entity,entityRecord) {
  entity.fittedItems = nativeNpcStore.buildNativeFittedItems(entityRecord.entityID);
  entity.nativeCargoItems = nativeNpcStore.buildNativeCargoItems(entityRecord.entityID);
  entity.modules = nativeNpcStore.buildNativeSlimModuleTuples(entityRecord.entityID);
  return entity;
}
function materializeNativeRuntimeEntity(scene, entityRecord, controllerRecord, definition, options = {}) {
  const runtimeKind = String(controllerRecord && controllerRecord.runtimeKind || "nativeAmbient").trim() || "nativeAmbient";
  const existingEntity = scene.getEntityByID(entityRecord.entityID);
  if (existingEntity) {
    const controller = registerNativeRuntimeController(entityRecord, controllerRecord, definition);
    return {success:true,data:{entity:existingEntity,controller}};
  }
  const spawned = spaceRuntime.spawnDynamicShip(scene.systemID, {itemID:entityRecord.entityID});
  if (!spawned.success) return spawned;
  const controller = registerNativeRuntimeController(entityRecord, controllerRecord, definition);
  return {success:true,data:{entity:spawned.data.entity,controller}};
}
function materializeStoredNativeController(scene, entityID, options = {}) {
  const normalizedEntityID=entityID;
  const entityRecord = nativeNpcStore.getNativeEntity(normalizedEntityID);
  const controllerRecord = nativeNpcStore.getNativeController(normalizedEntityID);
  if (!entityRecord || !controllerRecord) return {success:false};
  return materializeNativeRuntimeEntity(scene, entityRecord, controllerRecord, {}, options);
}
module.exports = {
  isNativeAmbientRuleOptions,
};
'''

NODE=r'''const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const js=fs.readFileSync(process.argv[2],'utf8');
const base={entityID:1001,systemID:300,ownerID:202,profileID:'profile1',loadoutID:'stock',
 behaviorProfileID:'peaceful',entityType:'personalFleet',selectionKind:'PERSONAL_FLEET',
 selectionID:'assignment-1',personalFleetOriginal:true,operatorKind:'PERSONAL_FLEET',
 personalFleetGeneration:3,personalFleetAssignmentID:'assignment-1',personalFleetPilotID:'coop-pilot-123'};
const entity={...base,nativeNpc:true};
const controller={...base,runtimeKind:'nativeAmbient'};
let count=0;
function execute(e,c,opts={}){
 const effects={spawn:0,register:0,authorize:0,permitIssuing:null};
 const originalActor={itemID:1001,kind:'ship',nativeNpc:true,nativeNpcOccupied:true,
 npcEntityType:'personalFleet',operatorKind:'PERSONAL_FLEET',selectionKind:'PERSONAL_FLEET',
 selectionID:'assignment-1',ownerID:202,characterID:0,pilotCharacterID:0,session:null};
 const scene={systemID:opts.sceneSystem??300,getEntityByID:()=>opts.existing?originalActor:null};
 const store={getNativeEntity:()=>e,getNativeController:()=>c};
 const source=js.replace('const path=require(\'path\');','')
   .replace('const nativeNpcStore={};','').replace('const spaceRuntime={};','');
 const sandbox={__dirname:'/synthetic/space/npc',module:{exports:{}},
  path:{join:()=>'/synthetic/space/coopPersonalFleetNativeBindings'},
  process:{env:{EVEJS_COOP_PERSONAL_FLEET_NATIVE_SHIP_ADOPTION:opts.flag??'1'}},
  require:()=>({authorize:(_row,x)=>{effects.authorize++;effects.permitIssuing=x.allowIssuing;return opts.permit!==false;}}),
  nativeNpcStore:store,
  spaceRuntime:{spawnDynamicShip:()=>{effects.spawn++;return {success:true,data:{entity:{itemID:1001}}}}},
  registerNativeRuntimeController:()=>{effects.register++;return {entityID:1001}},
  isNativeAmbientRuleOptions(){}
 };
 vm.runInNewContext(source,sandbox,{timeout:1000});
 const result=sandbox.materializeNativeRuntimeEntity(scene,e,c,{}, {personalFleetIssuing:opts.issuing===true});
 count++;
 return {result,effects};
}
function denied(e,c,opts={}){
 const {result,effects}=execute(e,c,opts);
 assert.equal(result.success,false);
 assert.equal(result.errorMsg,'PF71_LOW_LEVEL_NATIVE_PERMIT_NOT_VERIFIED');
 assert.equal(effects.spawn,0);assert.equal(effects.register,0);
 return effects;
}
let r=execute(entity,controller,{issuing:true});
assert.equal(r.result.success,true);assert.equal(r.effects.spawn,1);
assert.equal(r.effects.register,1);assert.equal(r.effects.authorize,1);
assert.equal(r.effects.permitIssuing,true);
r=execute(entity,controller,{existing:true});
assert.equal(r.result.success,true);assert.equal(r.effects.spawn,0);
assert.equal(r.effects.register,1);assert.equal(r.effects.authorize,1);
r=denied(entity,controller,{permit:false});assert.equal(r.authorize,1);
r=denied(entity,controller,{flag:'0'});assert.equal(r.authorize,0);
r=denied(entity,controller,{sceneSystem:999});assert.equal(r.authorize,0);
r=denied({...entity,personalFleetOriginal:false},controller);assert.equal(r.authorize,0);
r=denied(entity,{...controller,personalFleetOriginal:false});assert.equal(r.authorize,0);
r=denied(entity,{...controller,entityID:2222});assert.equal(r.authorize,0);
r=denied(entity,{...controller,personalFleetGeneration:4});assert.equal(r.authorize,0);
r=denied(entity,{...controller,selectionID:'other'});assert.equal(r.authorize,0);
r=denied(entity,{...controller,runtimeKind:'nativeCustom'});assert.equal(r.authorize,0);
r=denied({...entity,operatorKind:'wrong'},controller);assert.equal(r.authorize,0);
r=denied({...entity,personalFleetOriginal:false}, {...controller});assert.equal(r.authorize,0);
r=denied({entityID:42,systemID:300,selectionKind:'PERSONAL_FLEET'}, {entityID:42,systemID:300});assert.equal(r.authorize,0);
r=denied({entityID:42,systemID:300}, {entityID:42,systemID:300,personalFleetAssignmentID:'stray'});assert.equal(r.authorize,0);
r=denied({entityID:42,systemID:300}, {entityID:42,systemID:300,personalFleetGeneration:null});assert.equal(r.authorize,0);
r=denied({...entity}, {...controller,selectionKind:'wrong'},{existing:true});assert.equal(r.register,0);
r=execute({entityID:42,systemID:300}, {entityID:42,systemID:300});
assert.equal(r.result.success,true);assert.equal(r.effects.authorize,0);assert.equal(r.effects.spawn,1);
assert.equal(count,18);console.log('PF71 low-level native materialization: 18/18 scenarios PASS');
'''

class PF71CommonEntrypoint(unittest.TestCase):
    def test_exact_materializer_anchor_applied_once_before_side_effects(self):
        patched=PATCH.transform(SOURCE)
        self.assertEqual(patched.count('PF71: every native runtime materialization path'),1)
        i=patched.index('PF71: every native runtime materialization path')
        self.assertLess(i,patched.index('const existingEntity = scene.getEntityByID'))
        self.assertLess(i,patched.index('const controller = registerNativeRuntimeController'))
        self.assertLess(i,patched.index('spaceRuntime.spawnDynamicShip'))
        self.assertIn('PF58_ORIGINAL_NATIVE_PERMIT_NOT_VERIFIED',patched)
        self.assertIn('PF71_LOW_LEVEL_NATIVE_PERMIT_NOT_VERIFIED',patched)

    def test_direct_lowlevel_replay_and_unmarked_normal_npcs(self):
        with tempfile.TemporaryDirectory(prefix='pf71-') as tmp:
            root=Path(tmp)
            (root/'service.js').write_text(PATCH.transform(SOURCE))
            (root/'test.cjs').write_text(NODE)
            p=subprocess.run(['node',str(root/'test.cjs'),str(root/'service.js')],capture_output=True,text=True,timeout=18)
            self.assertEqual(p.returncode,0,p.stderr+'\n'+p.stdout)
            self.assertIn('18/18 scenarios PASS',p.stdout)

    def test_source_drift_and_double_transform_are_fail_closed(self):
        corrupted=SOURCE.replace('function materializeNativeRuntimeEntity(', 'function renamedMaterializer(')
        with self.assertRaisesRegex(ValueError,'PF58_NATIVE_ANCHOR_DRIFT'):
            PATCH.transform(corrupted)
        with self.assertRaisesRegex(ValueError,'PF58_NATIVE_ANCHOR_DRIFT'):
            PATCH.transform(PATCH.transform(SOURCE))

if __name__=='__main__':unittest.main()
