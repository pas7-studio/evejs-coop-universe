"""PF69 executable original-native startup admission regression, isolated source fixture.

This test imports the *actual* PF58 patch transformer and runs its patched
materializer entrypoint in Node. It does not boot/install the EveJS server.
"""
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

BUILDER = Path(__file__).resolve().parents[1] / 'build_native_stock_fittings_patch.py'
spec=importlib.util.spec_from_file_location('pf69_real_builder',BUILDER)
pf58=importlib.util.module_from_spec(spec)
spec.loader.exec_module(pf58)

# Original source anchors, no unrelated synthetic patch markers.
SOURCE='''function buildNativeRuntimeShipSpec(entityRecord) {
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
function materializeStoredNativeController(scene, entityID, options = {}) {
  const normalizedEntityID = entityID;
  const entityRecord = nativeNpcStore.getNativeEntity(normalizedEntityID);
  const controllerRecord = nativeNpcStore.getNativeController(normalizedEntityID);
  if (!entityRecord || !controllerRecord) return {success:false};
  return {success:true,data:{entityRecord,controllerRecord}};
}
module.exports = {
  isNativeAmbientRuleOptions,
};
'''

NODE_TEST=r'''const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const code=fs.readFileSync(process.argv[2],'utf8');
const base={entityID:1001,systemID:300,ownerID:202,profileID:'p',loadoutID:'l',
 behaviorProfileID:'b',entityType:'personalFleet',selectionKind:'PERSONAL_FLEET',selectionID:'job-9',personalFleetOriginal:true,operatorKind:'PERSONAL_FLEET',
 personalFleetGeneration:2,personalFleetAssignmentID:'job-9',
 personalFleetPilotID:'coop-pilot-123'};
function check(entity,controller,{flag='1',binding=true,issuing=false}={}){
 let authorizations=0;
 const sandbox={__dirname:"/synthetic/space/npc",module:{exports:{}},process:{env:{EVEJS_COOP_PERSONAL_FLEET_NATIVE_SHIP_ADOPTION:flag}},
 path:{join:()=>'bindings'},require:()=>({authorize:()=>{authorizations++;return binding;}}),
 nativeNpcStore:{getNativeEntity:()=>entity,getNativeController:()=>controller},
 isNativeAmbientRuleOptions(){}};
 vm.runInNewContext(code,sandbox,{timeout:1000});
 const result=sandbox.materializeStoredNativeController({},1001,{personalFleetIssuing:issuing});
 return {success:result.success,errorMsg:result.errorMsg,authorizations};
}
const expectedEntity={...base,nativeNpc:true};
const expectedController={...base,runtimeKind:'nativeAmbient'};
assert.equal(check(expectedEntity,expectedController,{issuing:true}).success,true);
assert.equal(check(expectedEntity,expectedController).success,true);
assert.equal(check({...base,personalFleetOriginal:false},expectedController).success,false);
assert.equal(check(expectedEntity,{...expectedController,personalFleetOriginal:false}).success,false);
assert.equal(check(expectedEntity,{...expectedController,entityID:999}).success,false);
assert.equal(check(expectedEntity,{...expectedController,systemID:302}).success,false);
assert.equal(check(expectedEntity,{...expectedController,personalFleetGeneration:3}).success,false);
assert.equal(check(expectedEntity,{...expectedController,personalFleetAssignmentID:'foreign'}).success,false);
assert.equal(check(expectedEntity,{...expectedController,personalFleetPilotID:'coop-pilot-999'}).success,false);
assert.equal(check(expectedEntity,{...expectedController,profileID:'other'}).success,false);
assert.equal(check(expectedEntity,{...expectedController,entityType:'nativeAmbient'}).success,false);
assert.equal(check(expectedEntity,{...expectedController,selectionID:'wrong'}).success,false);
assert.equal(check({...expectedEntity,selectionKind:'other'},expectedController).success,false);
assert.equal(check(expectedEntity,{...expectedController,selectionKind:'other'}).success,false);
assert.equal(check({...expectedEntity,profileID:undefined},{...expectedController,profileID:undefined}).success,false);
assert.equal(check(expectedEntity,{...expectedController,loadoutID:'other'}).success,false);
assert.equal(check(expectedEntity,{...expectedController,behaviorProfileID:'other'}).success,false);
assert.equal(check(expectedEntity,{...expectedController,runtimeKind:'other'}).success,false);
assert.equal(check({...base,entityID:0},expectedController).success,false);
assert.equal(check({...base,ownerID:0},expectedController).success,false);
assert.equal(check({...base,personalFleetGeneration:0},expectedController).success,false);
assert.equal(check(expectedEntity,expectedController,{flag:'0'}).success,false);
assert.equal(check(expectedEntity,expectedController,{binding:false}).success,false);
// Controller-only marker must never take the ordinary NPC route.
const unmarked={entityID:1001,systemID:300,ownerID:202};
assert.equal(check(unmarked,expectedController).success,false);
assert.equal(check(unmarked,{...unmarked,operatorKind:'PERSONAL_FLEET'}).success,false);
// Ordinary non-personal NPC rows remain untouched and do not consult PF bindings.
const ordinary=check(unmarked,{...unmarked},{flag:'0',binding:false});
assert.equal(ordinary.success,true);assert.equal(ordinary.authorizations,0);
// Invalid pair must not touch the original durable permit reader.
const corrupt=check(unmarked,expectedController);
assert.equal(corrupt.authorizations,0);
console.log('PF69/PF70 VM: 28 scenario assertions PASS');
'''

class NativePairAdmissionTests(unittest.TestCase):
    def test_source_pin_and_single_materializer_injection(self):
        self.assertEqual(pf58.EXPECTED_SHA1,'ca039daaaad2839d17f7109de2f3834cec0373a8')
        patched=pf58.transform(SOURCE)
        self.assertEqual(patched.count('PF58_ORIGINAL_ITEMSTORE_BRIDGE_V1: true'),1)
        self.assertEqual(patched.count('function pf58OriginalNativePairValid('),1)
        self.assertEqual(patched.count('function pf58IsPersonalFleetRecord('),1)
        self.assertEqual(patched.count('PF69: inspect BOTH stock rows'),1)
        self.assertLess(patched.index('PF69: inspect BOTH stock rows'),patched.index('if (!entityRecord || !controllerRecord)'))

    def test_patched_native_entrypoint_vm_real_node(self):
        with tempfile.TemporaryDirectory(prefix='pf69-') as d:
            root=Path(d)
            (root/'patched.js').write_text(pf58.transform(SOURCE),encoding='utf-8')
            (root/'check.cjs').write_text(NODE_TEST,encoding='utf-8')
            result=subprocess.run(['node',str(root/'check.cjs'),str(root/'patched.js')],
                capture_output=True,text=True,timeout=15)
            self.assertEqual(result.returncode,0,result.stderr)
            self.assertIn('28 scenario assertions PASS',result.stdout)

    def test_patch_rejects_source_anchor_drift_and_double_injection(self):
        with self.assertRaisesRegex(ValueError,'ANCHOR_DRIFT'):
            pf58.transform(SOURCE.replace('function buildNativeRuntimeShipSpec(entityRecord) {','function renamed(entityRecord) {'))
        with self.assertRaisesRegex(ValueError,'ANCHOR_DRIFT'):
            pf58.transform(pf58.transform(SOURCE))

if __name__=='__main__':unittest.main()
