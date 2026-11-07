import importlib.util
import hashlib
from pathlib import Path
import tempfile
import subprocess
import unittest

FILE=Path(__file__).resolve().parents[1]/'tools/build_native_chat_patch.py'
spec=importlib.util.spec_from_file_location('native_builder',FILE)
b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)
SOURCE=Path(__file__).resolve().parents[1]/'native/coopPersonalFleetChatGateway.js'
ORIG='''// synthetic original source for source-pinned patch tests
const AVAILABLE_SLASH_COMMANDS = [
  "jobs",
];
function executeChatCommand(session, rawMessage, chatHub, options = {}) {
  const command = rawMessage;
  const argumentText = '';
  if (command === "events" || command === "alerts") {
    return true;
  }
  return false;
}
function handledResult(){return {handled:true};}
'''

def cmd(cwd,*argv):
 return subprocess.run(['git','-C',str(cwd),*argv],check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)

class PatchTest(unittest.TestCase):
 def setup(self):
  temp=tempfile.TemporaryDirectory();root=Path(temp.name)
  cmd(root.parent,'init',str(root));cmd(root,'config','user.email','test@example.test');cmd(root,'config','user.name','Test')
  file=root/b.STOCK;file.parent.mkdir(parents=True)
  file.write_text(ORIG,encoding='utf8')
  cmd(root,'add','-A');cmd(root,'commit','-m','original')
  return temp,root
 def test_source_pinned_combined_patch_actually_applies_on_git_worktree(self):
  tmp,root=self.setup()
  try:
   patch=b.build(root,SOURCE,expected_blob=b.blob(ORIG.encode('utf8')))
   self.assertTrue(b.check(root,patch))
   patchFile=root/'review.diff';patchFile.write_text(patch)
   cmd(root,'apply','--whitespace=error',str(patchFile))
   self.assertIn('command === "pf"',(root/b.STOCK).read_text())
   self.assertEqual((root/b.GATEWAY).read_text(),SOURCE.read_text())
   cmd(root,'status','--short')
   subprocess.run(['node','--check',str(root/b.GATEWAY)],check=True,capture_output=True)
  finally:tmp.cleanup()
 def test_reject_source_revision_drift(self):
  tmp,root=self.setup()
  try:
   with self.assertRaisesRegex(ValueError,'SOURCE_DRIFT'):
    b.build(root,SOURCE)
  finally:tmp.cleanup()
 def test_reject_double_hook_and_missing_original_anchor(self):
  with self.assertRaisesRegex(ValueError,'ANCHOR'):
   b.transformed(ORIG.replace('"jobs",','"pf",\n  "jobs",'))
  with self.assertRaisesRegex(ValueError,'ANCHOR'):
   b.transformed('hello')
 def test_reject_preexisting_native_gateway_without_touching_it(self):
  tmp,root=self.setup()
  try:
   file=root/b.GATEWAY;file.parent.mkdir(parents=True);file.write_text('already installed')
   with self.assertRaisesRegex(ValueError,'ALREADY_PRESENT'):
    b.build(root,SOURCE,expected_blob=b.blob(ORIG.encode()))
   self.assertEqual(file.read_text(),'already installed')
  finally:tmp.cleanup()
 def test_require_explicit_existing_original_source(self):
  tmp,root=self.setup()
  try:
   (root/b.STOCK).unlink()
   with self.assertRaisesRegex(ValueError,'SOURCE_NOT_FOUND'):
    b.build(root,SOURCE,expected_blob=b.blob(ORIG.encode()))
  finally:tmp.cleanup()

if __name__=='__main__':unittest.main()
