import hashlib
import importlib.util
from pathlib import Path
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[1]
SCRIPT=ROOT/'tools/build_original_atomic_entity_contract_patch.py'
spec=importlib.util.spec_from_file_location('pf87_native_entity_atomic',SCRIPT)
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class OriginalAtomicEntityPatchTest(unittest.TestCase):
 def test_pinned_stock_blob_and_work_path_are_exact(self):
  self.assertEqual(m.ORIGINAL_GIT_BLOB,'2b28b48145f3fbc989ce7346384487ee75e52280')
  self.assertEqual(str(m.PATH),'Code/server/src/space/coopGameStoreAtomic.js')
 def test_existing_original_code_must_not_be_overwritten_on_drift(self):
  with tempfile.TemporaryDirectory() as temp:
   work=Path(temp)
   target=work/m.PATH
   target.parent.mkdir(parents=True)
   target.write_text('"use strict";\n// unreviewed original\n',encoding='utf-8')
   before=target.read_bytes()
   with self.assertRaisesRegex(ValueError,'ORIGINAL_ATOMIC_BLOB_CHANGED'):
    m.build(work)
   self.assertEqual(target.read_bytes(),before)
 def test_patch_transform_rejects_missing_source_anchor(self):
  with self.assertRaisesRegex(ValueError,'STOCK_ATOMIC_PATCH_SOURCE_DRIFT'):
   m.one('source','missing','replacement')
 def test_patch_transforms_one_anchor_only(self):
  self.assertEqual(m.one('a\nb\nc\n','b\n','B\n'),'a\nB\nc\n')
  with self.assertRaisesRegex(ValueError,'STOCK_ATOMIC_PATCH_SOURCE_DRIFT'):
   m.one('a\na\n','a\n','z\n')

if __name__=='__main__':
 unittest.main()
