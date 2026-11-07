import importlib.util
import pathlib
import subprocess
import tempfile
import unittest
import sys
ROOT=pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
import build_native_dock_scene_patch as b

STOCK='''const spaceRuntime = {};
function destroyNativeNpcController(controller, options = {}) {
  return {success: true};
}
module.exports = {
  isNativeAmbientRuleOptions,
  destroyNativeNpcController,
};
'''

class OriginalScenePatchTests(unittest.TestCase):
 def test_exported_scoped_original_scene_authority_only(self):
  result=b.transform(STOCK)
  self.assertEqual(result.count('PF66_SCOPED_DOCK_SCENE_DETACH_V1:'),1)
  self.assertEqual(result.count('function detachScopedPersonalFleetDockSceneActor('),1)
  self.assertEqual(result.count('function installScopedPersonalFleetDockAuthority('),1)
  self.assertIn('pf66DockAuthority.authorize(row)',result)
  self.assertIn('pf66DockAuthority.consumeSceneDetach(row)',result)
  self.assertLess(result.index('pf66DockAuthority.consumeSceneDetach(row)'),result.index('spaceRuntime.removeDynamicEntity'))
  self.assertIn('spaceRuntime.removeDynamicEntity',result)
  self.assertIn('unregisterController(shipID)',result)
  self.assertIn('allowSessionOwned:false',result)
  self.assertIn('PF66_SCENE_DETACH_OFF',result)
 def test_pf58_composed_export_anchor_is_patched_once(self):
  original=STOCK.replace('module.exports = {\n  isNativeAmbientRuleOptions,',
    'module.exports = {\n  PF58_ORIGINAL_ITEMSTORE_BRIDGE_V1: true,\n  isNativeAmbientRuleOptions,')
  out=b.transform(original)
  self.assertEqual(out.count('PF58_ORIGINAL_ITEMSTORE_BRIDGE_V1:'),1)
  self.assertEqual(out.count('PF66_SCOPED_DOCK_SCENE_DETACH_V1:'),1)
 def test_stock_anchor_strict_on_missing_or_duplicate(self):
  with self.assertRaisesRegex(ValueError,'ANCHOR_DRIFT'):
   b.transform('module.exports = {\n  isNativeAmbientRuleOptions,')
  with self.assertRaisesRegex(ValueError,'ANCHOR_DRIFT'):
   b.transform(STOCK+STOCK)
  with self.assertRaisesRegex(ValueError,'EXPORT_ANCHOR_DRIFT'):
   b.transform(STOCK.replace('  isNativeAmbientRuleOptions,','  somethingElse,'))
 def test_review_patch_git_apply_synthetic_no_engine_write(self):
  with tempfile.TemporaryDirectory() as td:
   root=pathlib.Path(td)
   stock=root/b.REL;stock.parent.mkdir(parents=True)
   stock.write_text(STOCK)
   old=b.PIN
   try:
    b.PIN=b.blob(stock.read_bytes())
    patch=root/'patch.diff';b.build(root,patch)
    self.assertIn('detachScopedPersonalFleetDockSceneActor',patch.read_text())
    assert stock.read_text()==STOCK
    subprocess.run(['git','-C',td,'init','-q'],check=True)
    subprocess.run(['git','-C',td,'apply','--check',str(patch)],check=True)
    assert stock.read_text()==STOCK
   finally:b.PIN=old
 def test_real_blob_source_pin_fails_closed(self):
  with tempfile.TemporaryDirectory() as td:
   path=pathlib.Path(td)/b.REL;path.parent.mkdir(parents=True)
   path.write_text(STOCK)
   with self.assertRaisesRegex(ValueError,'SOURCE_PIN_MISMATCH'):
    b.build(pathlib.Path(td),pathlib.Path(td)/'review.patch')
   self.assertFalse((pathlib.Path(td)/'review.patch').exists())
 def test_runtime_source_does_not_use_generic_destroy_paths(self):
  source=b.INSERT
  self.assertNotIn('destroyNativeNpcController(',source)
  self.assertNotIn('dematerializeNativeController(',source)
  self.assertNotIn('removeNativeEntityCascade(',source)
  self.assertNotIn('removeInventoryItem(',source)
  self.assertNotIn('dockShipToLocation(',source)
  self.assertNotIn('unregisterController(shipID);\n  }',source)
  self.assertIn('nativeNpcStore.getNativeController',source)
  self.assertIn('nativeEntity.ownerID !== row.ownerCharacterID',source)

if __name__=='__main__':unittest.main()
