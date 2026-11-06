import importlib.util
from pathlib import Path
from types import SimpleNamespace
import tempfile
import unittest
import shutil
import subprocess
import sys

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
import build_native_review_bundle as b

NATIVE_PREVIEW_ROOT=Path(__file__).resolve().parents[2]

SERVICE_SRC='''const path=require('path');
function dematerializeNativeController(controller, options = {}) {
  const entityID=controller.entityID,systemID=controller.systemID;
  const scene = spaceRuntime.ensureScene(systemID);
  doDematerialize();
}
function destroyNativeNpcController(controller, options = {}) {
  const entityID=controller.entityID,systemID=controller.systemID;
  const scene = spaceRuntime.ensureScene(systemID);
  doDestroy();
}
module.exports = {fake:true};
'''
STORE_SRC='''const path=require('path');
function removeNativeEntity(entityID) {
  return removeCollectionRow(TABLE.ENTITIES, "entities", entityID);
}
function removeNativeController(entityID) {
  const removeResult = removeCollectionRow(TABLE.CONTROLLERS, "controllers", entityID);
}
function removeNativeEntityCascade(entityID) {
  const normalizedEntityID = entityID;
  for (const moduleRecord of listNativeModulesForEntity(normalizedEntityID)) {
  }
}
module.exports = {
  TABLE,
  removeNativeEntityCascade,
};
'''


def make_patches():
    # Imported original PF59/PF61 transforms, not copied pseudocode.
    mf=b.import_python(NATIVE_PREVIEW_ROOT/'pf59/build_native_removal_patch.py')
    ms=b.import_python(NATIVE_PREVIEW_ROOT/'pf61/build_native_scoped_cleanup_patch.py')
    fake58=SimpleNamespace(EXPECTED_SHA1=b.SERVICE_BLOB,transform=lambda source:source.replace(
        'module.exports = {fake:true};','module.exports = {PF58_ORIGINAL_ITEMSTORE_BRIDGE_V1: true};'))
    mf.PINS={b.SERVICE:b.SERVICE_BLOB,b.STORE:b.STORE_BLOB}
    ms.PIN=b.STORE_BLOB
    return fake58,mf,ms


class PF62ReviewCompositionTests(unittest.TestCase):
 def test_pf66_native_scene_detach_is_composed_into_one_service_diff(self):
    original=SERVICE_SRC.replace('module.exports = {fake:true};',
      'module.exports = {\n  PF58_ORIGINAL_ITEMSTORE_BRIDGE_V1: true,\n  isNativeAmbientRuleOptions,\n};')
    pf66=b.import_python(NATIVE_PREVIEW_ROOT/'pf66/build_native_dock_scene_patch.py')
    pf66.PIN=b.SERVICE_BLOB
    patches=(*make_patches(),pf66)
    service,store=b.transform_original(original,STORE_SRC,patches)
    self.assertEqual(service.count('PF66_SCOPED_DOCK_SCENE_DETACH_V1:'),1)
    self.assertEqual(service.count('PF58_ORIGINAL_ITEMSTORE_BRIDGE_V1:'),1)
    self.assertEqual(service.count('pf59.checkOriginalRemoval('),2)
    self.assertEqual(store.count('PF61_SCOPED_ORIGINAL_NATIVE_CLEANUP_V1:'),1)
    self.assertEqual(len(b.MODULE_FILES),18)
    self.assertEqual(len(set(b.MODULE_FILES)),len(b.MODULE_FILES))
    self.assertIn('pf66/native/coopPersonalFleetScopedDock.cjs',b.MODULE_FILES)
    self.assertIn('pf56/native/coopPersonalFleetNativeReturnExecutor.cjs',b.MODULE_FILES)
    self.assertIn('pf55/native/coopPersonalFleetNativeActorProof.cjs',b.MODULE_FILES)
    old=pf66.PIN
    try:
      pf66.PIN='mismatch'
      with self.assertRaisesRegex(ValueError,'PF66_SERVICE_SOURCE_PIN_INCONSISTENT'):
        b.transform_original(original,STORE_SRC,patches)
    finally:pf66.PIN=old

 def test_real_pf59_pf61_compose_in_one_stock_source(self):
    service,store=b.transform_original(SERVICE_SRC,STORE_SRC,make_patches())
    self.assertEqual(service.count('pf59.checkOriginalRemoval('),2)
    self.assertEqual(store.count('pf59.checkOriginalRemoval('),3)
    self.assertEqual(store.count('PF61_SCOPED_ORIGINAL_NATIVE_CLEANUP_V1:'),1)
    self.assertIn('PF61_CAPABILITY_MISSING',store)
    self.assertEqual(store.count('function removeNativeEntityCascade'),1)
    self.assertLess(service.index('pf59.checkOriginalRemoval('),service.index('  doDematerialize();'))
    self.assertLess(service.rindex('pf59.checkOriginalRemoval('),service.index('  doDestroy();'))
    self.assertLess(store.index('pf59.checkOriginalRemoval('),store.index('return removeCollectionRow(TABLE.ENTITIES'))

 def test_native_pf61_flattening_resolves_original_import(self):
    original=(NATIVE_PREVIEW_ROOT/'pf61/native/coopPersonalFleetScopedNativeCleanup.cjs').read_text()
    changed=b.normalize_native_module(original,'coopPersonalFleetScopedNativeCleanup.cjs')
    self.assertIn("require('./coopPersonalFleetTerminalCustody.js')",changed)
    self.assertNotIn("require('../../pf60/",changed)
    with tempfile.TemporaryDirectory() as td:
      tmp=Path(td)
      (tmp/'coopPersonalFleetScopedNativeCleanup.js').write_text(changed)
      p=(NATIVE_PREVIEW_ROOT/'pf60/native/coopPersonalFleetTerminalCustody.cjs').read_text()
      (tmp/'coopPersonalFleetTerminalCustody.js').write_text(b.normalize_native_module(p,'coopPersonalFleetTerminalCustody.cjs'))
      subprocess.run(['node','--check',str(tmp/'coopPersonalFleetScopedNativeCleanup.js')],check=True)
      subprocess.run(['node','-e',f"require({str(tmp/'coopPersonalFleetScopedNativeCleanup.js')!r});"],check=True)

 def test_flatten_rejects_missing_files_and_local_dependencies(self):
    with tempfile.TemporaryDirectory() as td:
      repo=Path(td)
      with self.assertRaisesRegex(ValueError,'MODULE_MISSING'):
        b.plan_modules(repo)
      for rel in b.MODULE_FILES:
        file=repo/'scripts'/rel;file.parent.mkdir(parents=True,exist_ok=True)
        file.write_text("'use strict';\nmodule.exports = {};\n")
      d=repo/'scripts/pf61/native/coopPersonalFleetScopedNativeCleanup.cjs'
      d.write_text("'use strict';\nrequire('../../pf60/native/coopPersonalFleetTerminalCustody.cjs');\n")
      modules=b.plan_modules(repo)
      self.assertTrue(modules['coopPersonalFleetScopedNativeCleanup.js'].endswith(
        "require('./coopPersonalFleetTerminalCustody.js');\n"))
      other=repo/'scripts/pf55/native/coopPersonalFleetNativeOrders.cjs'
      other.write_text("require('./nonexistent.cjs');\n")
      with self.assertRaisesRegex(ValueError,'LOCAL_REQUIRE_MISSING'):
        b.plan_modules(repo)

 def test_integrated_diff_produces_only_two_native_stock_paths(self):
    service,store=b.transform_original(SERVICE_SRC,STORE_SRC,make_patches())
    diff=b.make_review_diff({b.SERVICE:(SERVICE_SRC,service),b.STORE:(STORE_SRC,store)})
    self.assertEqual(diff.count('--- a/'),2)
    self.assertEqual(diff.count('+++ b/'),2)
    self.assertIn('PF58_ORIGINAL_ITEMSTORE_BRIDGE_V1',diff)
    self.assertIn('PF61_SCOPED_ORIGINAL_NATIVE_CLEANUP_V1',diff)

 def test_generation_never_mutates_native_or_repo_and_compiles_staged_js(self):
    with tempfile.TemporaryDirectory() as td:
      root=Path(td);engine=root/'engine';repo=root/'repo';out=root/'review'
      engine_file=engine/b.SERVICE;engine_file.parent.mkdir(parents=True);engine_file.write_text(SERVICE_SRC)
      store=engine/b.STORE;store.parent.mkdir(parents=True,exist_ok=True);store.write_text(STORE_SRC)
      for rel in b.MODULE_FILES:
        file=repo/'scripts'/rel;file.parent.mkdir(parents=True,exist_ok=True)
        file.write_text("'use strict';\nmodule.exports = {};\n")
      # Read real PF61/PF60 modules and ensure flattened imports compile.
      for source_path in ['pf61/native/coopPersonalFleetScopedNativeCleanup.cjs',
                          'pf60/native/coopPersonalFleetTerminalCustody.cjs']:
        dest=repo/'scripts'/source_path
        dest.write_bytes((NATIVE_PREVIEW_ROOT/source_path).read_bytes())
      subprocess.run(['git','-C',str(engine),'init','-q'],check=True)
      old_service=b.SERVICE_BLOB;old_store=b.STORE_BLOB;old_load=b.load_patches
      try:
        b.SERVICE_BLOB=b.blob(engine_file.read_bytes())
        b.STORE_BLOB=b.blob(store.read_bytes())
        b.load_patches=lambda _repo:make_patches()
        report=b.build(engine,repo,out)
        self.assertEqual(report['status'],'NOT_INSTALLED_IN_EVEJS')
        self.assertEqual(report['featureEnabled'],False)
        self.assertEqual(len(report['files']),len(b.MODULE_FILES)+3)
        self.assertEqual(engine_file.read_text(),SERVICE_SRC)
        self.assertEqual(store.read_text(),STORE_SRC)
        self.assertEqual((out/b.SERVICE).read_text().count('pf59.checkOriginalRemoval('),2)
        self.assertEqual((out/b.STORE).read_text().count('pf59.checkOriginalRemoval('),3)
        self.assertTrue((out/'PF62-MANIFEST.json').is_file())
        self.assertTrue(report['patchIncludesAllModules'])
        self.assertTrue(report['patchAppliedOnlyInEphemeralVerifier'])
        full=(out/'PF62-NATIVE-REVIEW.patch').read_text()
        self.assertEqual(full.count('diff --git a/'),len(b.MODULE_FILES)+2)
        self.assertEqual(full.count('new file mode 100644'),len(b.MODULE_FILES))
        for name in b.MODULE_FILES:
            module=Path(name).name.replace('.cjs','.js')
            dest='Code/server/src/space/'+module
            self.assertIn('+++ b/'+dest,full)
            self.assertTrue((out/dest).is_file())
      finally:
        b.SERVICE_BLOB=old_service;b.STORE_BLOB=old_store;b.load_patches=old_load

 def test_source_pin_mismatch_blocks_before_writing(self):
    with tempfile.TemporaryDirectory() as td:
      root=Path(td);engine=root/'engine';repo=root/'repo';out=root/'preview'
      file=engine/b.SERVICE;file.parent.mkdir(parents=True);file.write_text(SERVICE_SRC)
      other=engine/b.STORE;other.parent.mkdir(parents=True,exist_ok=True);other.write_text(STORE_SRC)
      with self.assertRaisesRegex(ValueError,'SOURCE_PIN_MISMATCH'):
        b.build(engine,repo,out)
      self.assertFalse(out.exists())

 def test_rejects_in_place_and_parent_overwrite(self):
    with tempfile.TemporaryDirectory() as td:
      root=Path(td);engine=root/'engine';repo=root/'repo';(repo/'scripts').mkdir(parents=True)
      file=engine/b.SERVICE;file.parent.mkdir(parents=True);file.write_text(SERVICE_SRC)
      for out in [engine,engine/'overwrite',repo,repo/'overwrite',root]:
        with self.assertRaisesRegex(ValueError,'NEVER_WRITE'):
          b.validate_paths(engine,repo,out)

 def test_patch_is_complete_and_additions_are_git_apply_compatible(self):
    with tempfile.TemporaryDirectory() as tmp:
      root=Path(tmp)
      stock='Code/server/src/space/npc/nativeNpcStore.js'
      source={stock:('hello\n','hello world\n')}
      new={'Code/server/src/space/coopPersonalFleetExample.js':"'use strict';\nmodule.exports={};\n"}
      patch=b.make_review_diff(source,new)
      self.assertEqual(patch.count('diff --git a/'),2)
      self.assertIn('new file mode 100644',patch)
      self.assertIn('--- /dev/null',patch)
      (root/stock).parent.mkdir(parents=True)
      (root/stock).write_text('hello\n')
      pf=root/'complete.patch';pf.write_text(patch)
      subprocess.run(['git','-C',str(root),'init','-q'],check=True)
      subprocess.run(['git','-C',str(root),'apply','--check',str(pf)],check=True)
      subprocess.run(['git','-C',str(root),'apply',str(pf)],check=True)
      self.assertEqual((root/stock).read_text(),'hello world\n')
      self.assertEqual((root/next(iter(new))).read_text(),next(iter(new.values())))

 def test_module_collision_does_not_leave_partial_bundle(self):
    with tempfile.TemporaryDirectory() as tmp:
      root=Path(tmp);engine=root/'engine';repo=root/'repo';out=root/'review'
      service=engine/b.SERVICE;service.parent.mkdir(parents=True);service.write_text(SERVICE_SRC)
      store=engine/b.STORE;store.parent.mkdir(parents=True,exist_ok=True);store.write_text(STORE_SRC)
      collision=engine/b.NATIVE_DIR/'coopPersonalFleetHangarBridge.js'
      collision.parent.mkdir(parents=True,exist_ok=True)
      collision.write_text('foreign code\n')
      for rel in b.MODULE_FILES:
        file=repo/'scripts'/rel;file.parent.mkdir(parents=True,exist_ok=True)
        file.write_text("'use strict';\nmodule.exports = {};\n")
      imported=repo/'scripts/pf61/native/coopPersonalFleetScopedNativeCleanup.cjs'
      imported.write_text("require('../../pf60/native/coopPersonalFleetTerminalCustody.cjs');\n")
      subprocess.run(['git','-C',str(engine),'init','-q'],check=True)
      old_service=b.SERVICE_BLOB;old_store=b.STORE_BLOB;old_load=b.load_patches
      try:
        b.SERVICE_BLOB=b.blob(service.read_bytes());b.STORE_BLOB=b.blob(store.read_bytes())
        b.load_patches=lambda _:make_patches()
        with self.assertRaises(subprocess.CalledProcessError):b.build(engine,repo,out)
        self.assertFalse(out.exists())
        self.assertEqual(collision.read_text(),'foreign code\n')
      finally:
        b.SERVICE_BLOB=old_service;b.STORE_BLOB=old_store;b.load_patches=old_load

 def test_refuse_output_parent_of_native_checkout_even_when_repo_elsewhere(self):
    with tempfile.TemporaryDirectory() as tmp:
      root=Path(tmp);engine=root/'native-parent/engine';repo=root/'separate-repo'
      file=engine/b.SERVICE;file.parent.mkdir(parents=True,exist_ok=True)
      file.write_text('source')
      with self.assertRaisesRegex(ValueError,'NEVER_WRITE'):
        b.validate_paths(engine,repo,engine.parent)

 def test_archived_module_without_terminal_newline_is_staged_safely(self):
    original="'use strict';\nmodule.exports={ok:true};"
    staged=b.normalize_native_module(original,'coopPersonalFleetExample.cjs')
    self.assertEqual(staged,original+'\n')
    self.assertEqual(original[-1],';')
    self.assertIn('new file mode 100644',b.make_review_diff(
      {'Code/server/src/space/stock.js':('old\n','new\n')},
      {'Code/server/src/space/coopPersonalFleetExample.js':staged}))

 def test_patch_rejects_missing_newline_or_duplicate_paths(self):
    original={'Code/server/src/space/stock.js':('a\n','b\n')}
    with self.assertRaisesRegex(ValueError,'NEW_MODULE_CONTENT'):
      b.make_review_diff(original,{'Code/server/src/space/new.js':'no newline'})
    with self.assertRaisesRegex(ValueError,'INVALID_NEW_MODULE_PATH'):
      b.make_review_diff(original,{'Code/server/src/space/stock.js':'again\n'})
    with self.assertRaisesRegex(ValueError,'NEWLINE_REQUIRED'):
      b.make_review_diff({'Code/server/src/space/stock.js':('a','b')})

 def test_imports_without_dot_cjs_targets_remain_stdlib_safe(self):
    input="const a=require('./foo.cjs'); const b=require('node:crypto');"
    got=b.normalize_native_module(input,'bar.cjs')
    self.assertIn("require('./foo.js')",got)
    self.assertIn("require('node:crypto')",got)

if __name__=='__main__':unittest.main()
