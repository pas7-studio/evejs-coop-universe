import sys
import subprocess
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import build_native_removal_patch as pf59

SERVICE_FIXTURE='''const path=require("path");
function dematerializeNativeController(controller, options = {}) {
  const entityID=controller.entityID;
  const scene = spaceRuntime.ensureScene(systemID);
  sideEffects();
}
function destroyNativeNpcController(controller, options = {}) {
  const entityID=controller.entityID;
  const scene = spaceRuntime.ensureScene(systemID);
  deleteThings();
}
'''
STORE_FIXTURE='''const path=require("path");
function removeNativeEntity(entityID) {
  return removeCollectionRow(TABLE.ENTITIES, "entities", entityID);
}
function removeNativeController(entityID) {
  const removeResult = removeCollectionRow(TABLE.CONTROLLERS, "controllers", entityID);
}
function removeNativeEntityCascade(entityID) {
  const normalizedEntityID=entityID;
  for (const moduleRecord of listNativeModulesForEntity(normalizedEntityID)) {
  }
}
'''
class NativePatchTests(unittest.TestCase):
    def test_service_hooks_precede_all_side_effects(self):
        s=pf59.service_transform(SERVICE_FIXTURE)
        self.assertEqual(s.count('pf59.checkOriginalRemoval'),2)
        self.assertLess(s.index('pf59.checkOriginalRemoval'),s.index('  sideEffects();'))
        self.assertLess(s.rindex('pf59.checkOriginalRemoval'),s.index('  deleteThings();'))
    def test_store_hooks_protect_direct_callers_and_cascade(self):
        s=pf59.store_transform(STORE_FIXTURE)
        self.assertEqual(s.count('pf59.checkOriginalRemoval'),3)
        for token in ('removeCollectionRow(TABLE.ENTITIES',
                      'removeCollectionRow(TABLE.CONTROLLERS',
                      'listNativeModulesForEntity(normalizedEntityID)'):
            self.assertLess(s.rfind('pf59.checkOriginalRemoval',0,s.index(token)),s.index(token))
    def test_fail_closed_on_drift(self):
        with self.assertRaisesRegex(ValueError,'SIGNATURE_DRIFT'):
            pf59.service_transform(SERVICE_FIXTURE.replace('function destroyNativeNpcController','function x'))
        with self.assertRaisesRegex(ValueError,'BODY_DRIFT'):
            pf59.store_transform(STORE_FIXTURE.replace('  for (const moduleRecord', '  for(const moduleRecord'))
        with self.assertRaisesRegex(ValueError,'SIGNATURE_DRIFT'):
            pf59.store_transform(STORE_FIXTURE+'function removeNativeEntity(entityID) {}')
    def test_pin_is_real_git_blob_sha_and_mismatch_aborts_before_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); service=root/pf59.SERVICE; store=root/pf59.STORE
            service.parent.mkdir(parents=True);service.write_text(SERVICE_FIXTURE)
            store.parent.mkdir(parents=True, exist_ok=True);store.write_text(STORE_FIXTURE)
            self.assertEqual(len(pf59.git_blob_sha(service.read_bytes())),40)
            out=root/'patch.diff'
            with self.assertRaisesRegex(ValueError,'SOURCE_PIN_MISMATCH'):
                pf59.build(root,out)
            self.assertFalse(out.exists())
    def test_output_has_normal_git_patch_paths(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); service=root/pf59.SERVICE; store=root/pf59.STORE
            service.parent.mkdir(parents=True);service.write_text(SERVICE_FIXTURE)
            store.parent.mkdir(parents=True, exist_ok=True);store.write_text(STORE_FIXTURE)
            saved=pf59.PINS.copy()
            try:
                pf59.PINS[pf59.SERVICE]=pf59.git_blob_sha(service.read_bytes())
                pf59.PINS[pf59.STORE]=pf59.git_blob_sha(store.read_bytes())
                out=root/'patch.diff'; patch=pf59.build(root,out)
                self.assertTrue(out.exists())
                self.assertIn('--- a/'+pf59.SERVICE,patch)
                self.assertIn('+++ b/'+pf59.STORE,patch)
                subprocess.run(['git','-C',str(root),'init','-q'],check=True)
                subprocess.run(['git','-C',str(root),'apply','--check',str(out)],check=True)
                subprocess.run(['git','-C',str(root),'apply',str(out)],check=True)
                self.assertEqual(service.read_text().count('pf59.checkOriginalRemoval'),2)
                self.assertEqual(store.read_text().count('pf59.checkOriginalRemoval'),3)
            finally:pf59.PINS.clear();pf59.PINS.update(saved)

if __name__=='__main__':unittest.main()
