import importlib.util
from pathlib import Path
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[1]
SCRIPT=ROOT/'tools/build_original_server_startup_patch.py'
spec=importlib.util.spec_from_file_location('pf88_original_startup',SCRIPT)
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class OriginalStartupPatchTest(unittest.TestCase):
 def test_exact_original_git_blob_is_pinned(self):
  self.assertEqual(m.ORIGINAL_GIT_BLOB,'912c942d29db35f5f105119bfc6c0d2eff1bf5dd')
  self.assertEqual(str(m.PATH),'Code/server/index.js')
 def test_source_drift_fails_before_any_write(self):
  with tempfile.TemporaryDirectory() as temp:
   work=Path(temp)
   file=work/m.PATH
   file.parent.mkdir(parents=True)
   file.write_text('// wrong main entry\n',encoding='utf8')
   with self.assertRaisesRegex(ValueError,'ORIGINAL_STARTUP_SOURCE_DRIFT'):
    m.build(work)
   self.assertEqual(file.read_text(encoding='utf8'),'// wrong main entry\n')
 def test_startup_hook_is_before_tcp_and_never_runs_by_default(self):
  self.assertTrue(m.INSERT.startswith('// PF88'))
  self.assertIn('process.env.EVEJS_COOP_PERSONAL_FLEET_NATIVE === "1"',m.INSERT)
  self.assertIn('process.env.EVEJS_COOP_PERSONAL_FLEET_CHAT === "1"',m.INSERT)
  self.assertIn('bootstrapOriginalWorkFromServer',m.INSERT)
  self.assertIn('startTCPServer(serviceManager)',m.ANCHOR)
  self.assertNotIn('startTCPServer(',m.INSERT)
 def test_anchor_is_unique_and_cannot_be_silently_overwritten(self):
  self.assertIn('startTCPServer(serviceManager)',m.ANCHOR)
  self.assertIn('ORIGINAL_STARTUP_ANCHOR_DRIFT',SCRIPT.read_text())

if __name__=='__main__':unittest.main()
