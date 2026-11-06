import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('pf58builder', ROOT / 'build_native_stock_fittings_patch.py')
b = importlib.util.module_from_spec(spec)
spec.loader.exec_module(b)

STUB = '''const path=require('path');
const nativeNpcStore={};
function buildNativeRuntimeShipSpec(entityRecord) {
  return {
    fittedItems: nativeNpcStore.buildNativeFittedItems(entityRecord.entityID),
    nativeCargoItems: nativeNpcStore.buildNativeCargoItems(entityRecord.entityID),
    modules: nativeNpcStore.buildNativeSlimModuleTuples(entityRecord.entityID),
  };
}
function applyNativeRuntimeNpcPresentation(entity, entityRecord) {
  entity.fittedItems = nativeNpcStore.buildNativeFittedItems(entityRecord.entityID);
  entity.nativeCargoItems = nativeNpcStore.buildNativeCargoItems(entityRecord.entityID);
  entity.modules = nativeNpcStore.buildNativeSlimModuleTuples(entityRecord.entityID);
  return entity;
}
function materializeNativeRuntimeEntity(scene, entityRecord, controllerRecord, definition, options = {}) {
  const runtimeKind = String(controllerRecord && controllerRecord.runtimeKind || "nativeAmbient").trim() || "nativeAmbient";
  const existingEntity = scene.getEntityByID(entityRecord.entityID);
  if (existingEntity) { return {success:true,data:{existingEntity,runtimeKind}}; }
  return {success:true,data:{existingEntity,runtimeKind}};
}
function materializeStoredNativeController(scene, entityID, options={}) {
  const normalizedEntityID=entityID;
  const entityRecord = nativeNpcStore.getNativeEntity(normalizedEntityID);
  const controllerRecord = nativeNpcStore.getNativeController(normalizedEntityID);
  return {success:true};
}
module.exports = {
  isNativeAmbientRuleOptions,
};
'''

class TestNativeSourcePin(unittest.TestCase):
 def test_expected_blob_sha_is_original_native_npc_service(self):
  self.assertEqual(b.EXPECTED_SHA1,'ca039daaaad2839d17f7109de2f3834cec0373a8')
 def test_rejects_missing_native_anchor(self):
  with self.assertRaisesRegex(ValueError,'PF58_NATIVE_ANCHOR_DRIFT'):
   b.transform(STUB.replace('nativeCargoItems: nativeNpcStore.buildNativeCargoItems','nativeCargoItems: []'))
 def test_rejects_duplicate_native_anchor(self):
  with self.assertRaisesRegex(ValueError,'PF58_NATIVE_ANCHOR_DRIFT'):
   b.transform(STUB.replace('module.exports', 'function buildNativeRuntimeShipSpec(entityRecord) {}\nmodule.exports'))
 def test_rejects_reapply_to_changed_native_source(self):
  with self.assertRaisesRegex(ValueError,'PF58_NATIVE_ANCHOR_DRIFT'):
   b.transform(b.transform(STUB))
 def test_stock_fittings_and_guarded_materialize_only(self):
  s=b.transform(STUB)
  self.assertIn('pf58OriginalStockModules',s)
  self.assertIn('pf58OriginalStockSlimModules',s)
  self.assertIn('personalFleetIssuing === true',s)
  self.assertIn('PF58_ORIGINAL_ITEMSTORE_BRIDGE_V1: true',s)
  self.assertIn('PF58_ORIGINAL_NATIVE_PERMIT_NOT_VERIFIED',s)
  self.assertIn('PF71_LOW_LEVEL_NATIVE_PERMIT_NOT_VERIFIED',s)
  self.assertIn('PF71: every native runtime materialization path',s)
  self.assertIn('nativeCargoItems: entityRecord.personalFleetOriginal === true\n      ? []',s)
 def test_source_pin_rejects_changed_source_before_creating_patch(self):
  with tempfile.TemporaryDirectory() as td:
   p=Path(td)/b.REL
   p.parent.mkdir(parents=True)
   p.write_text(STUB)
   out=Path(td)/'should-not-exist.patch'
   result=subprocess.run(['python3',str(ROOT/'build_native_stock_fittings_patch.py'),td,'--output',str(out)],
      capture_output=True,text=True)
   self.assertNotEqual(result.returncode,0)
   self.assertIn('PF58_SOURCE_PIN_MISMATCH',result.stderr+result.stdout)
   self.assertFalse(out.exists())
 def test_synthetic_patch_git_apply_check_and_node_syntax(self):
  with tempfile.TemporaryDirectory() as td:
   root=Path(td);p=root/b.REL
   p.parent.mkdir(parents=True);p.write_text(STUB)
   s=b.transform(STUB)
   import difflib
   diff=''.join(difflib.unified_diff(STUB.splitlines(keepends=True),s.splitlines(keepends=True),
      fromfile='a/'+b.REL,tofile='b/'+b.REL))
   patch=root/'PF58.patch';patch.write_text(diff)
   subprocess.run(['git','init','-q'],cwd=root,check=True)
   check=subprocess.run(['git','apply','--check',str(patch)],cwd=root,capture_output=True,text=True)
   self.assertEqual(check.returncode,0,check.stderr)
   subprocess.run(['git','apply',str(patch)],cwd=root,check=True)
   syntax=subprocess.run(['node','--check',str(p)],capture_output=True,text=True)
   self.assertEqual(syntax.returncode,0,syntax.stderr)
   self.assertIn('PF58_ORIGINAL_ITEMSTORE_BRIDGE_V1',p.read_text())

if __name__=='__main__':unittest.main()
