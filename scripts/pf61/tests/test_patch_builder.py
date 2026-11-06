import sys
import subprocess
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import build_native_scoped_cleanup_patch as pf61

FIXTURE='''const path=require('path');
function removeNativeEntityCascade(entityID) {
  return {success:true};
}
module.exports = {
  TABLE,
  removeNativeEntityCascade,
};
'''
class PF61PatchTests(unittest.TestCase):
 def test_insert_before_generic_cascade(self):
  s=pf61.transform(FIXTURE)
  self.assertLess(s.index('function removeScopedPersonalFleetTerminalNativeRows'),s.index('function removeNativeEntityCascade'))
  self.assertEqual(s.count('PF61_SCOPED_ORIGINAL_NATIVE_CLEANUP_V1: true'),1)
 def test_fail_closed_on_signature_drift(self):
  with self.assertRaisesRegex(ValueError,'ANCHOR_DRIFT'):pf61.transform(FIXTURE.replace('function removeNativeEntityCascade','function renamed'))
  with self.assertRaisesRegex(ValueError,'EXPORT_ANCHOR_DRIFT'):pf61.transform(FIXTURE.replace('  TABLE,','  OTHER,'))
 def test_preserves_original_low_level_methods_and_adds_guard(self):
  s=pf61.transform(FIXTURE)
  self.assertIn("removeCollectionRow(TABLE.CONTROLLERS, 'controllers', entityID)",s)
  self.assertIn("removeCollectionRow(TABLE.ENTITIES, 'entities', entityID)",s)
  self.assertIn('PF61_CAPABILITY_MISSING',s)
  self.assertIn('PF61_DURABLE_ISSUE_REVOKED',s)
  self.assertIn('PF61_FOREIGN_NATIVE_IDENTITY_OR_ASSET_ROWS',s)
 def test_mismatched_source_blob_fails_before_writing_patch(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);file=root/pf61.REL;file.parent.mkdir(parents=True)
   file.write_text(FIXTURE);out=root/'candidate.patch'
   with self.assertRaisesRegex(ValueError,'PIN_MISMATCH'):pf61.build(root,out)
   self.assertFalse(out.exists())
 def test_review_patch_applies_to_matching_source_using_git_check(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);file=root/pf61.REL;file.parent.mkdir(parents=True)
   file.write_text(FIXTURE);out=root/'candidate.patch'
   original=pf61.PIN
   try:
    pf61.PIN=pf61.blob(file.read_bytes())
    patch=pf61.build(root,out)
    self.assertIn('+++ b/'+pf61.REL,patch)
    subprocess.run(['git','-C',str(root),'init','-q'],check=True)
    subprocess.run(['git','-C',str(root),'apply','--check',str(out)],check=True)
    subprocess.run(['git','-C',str(root),'apply',str(out)],check=True)
    self.assertIn('PF61_SCOPED_ORIGINAL_NATIVE_CLEANUP_V1: true',file.read_text())
   finally:pf61.PIN=original

if __name__=='__main__':unittest.main()
