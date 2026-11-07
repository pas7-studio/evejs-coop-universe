import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

SCRIPT=Path(__file__).resolve().parents[1]/'tools/prepare_firstplay_work.py'
spec=importlib.util.spec_from_file_location('pf_firstplay_work',SCRIPT)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class NativeFirstPlayAssemblyTest(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.dir=Path(self.temp.name)
  self.source=self.dir/'src';self.source.mkdir()
  gateway=self.source/'scripts/personal-fleet-firstplay/native/coopPersonalFleetChatGateway.js'
  gateway.parent.mkdir(parents=True);gateway.write_text("'use strict';\n")
  self.main=self.dir/'engine';self.main.mkdir()
  self.git(self.main,'init','-q');self.git(self.main,'config','user.email','test@example.test');self.git(self.main,'config','user.name','Test')
  (self.main/'base').write_text('original\n')
  self.git(self.main,'add','.');self.git(self.main,'commit','-m','base')
  self.work=self.dir/'work';self.git(self.main,'worktree','add','-b','work/firstplay',str(self.work))
  self.manifest=self.dir/'PF62-MANIFEST.json';self.manifest.write_text('{}')
  self.output=self.dir/'review'
 def tearDown(self):self.temp.cleanup()
 @staticmethod
 def git(work,*args):
  return subprocess.run(['git','-C',str(work),*args],check=True,capture_output=True,text=True).stdout
 def test_linked_worktree_validation_is_explicit(self):
  assert m.validate_paths(self.work,self.source,self.manifest,self.output,False,'')[0]==self.work
 def test_no_primary_native_checkout_accepted_even_if_work_branch(self):
  self.git(self.main,'switch','-c','work/unsafe')
  with self.assertRaisesRegex(ValueError,'LINKED_WORKTREE_REQUIRED'):
   m.validate_paths(self.main,self.source,self.manifest,self.output,True,'WORK-NOT-PLAY')
 def test_apply_to_work_requires_explicit_confirmation(self):
  with self.assertRaisesRegex(ValueError,'CONFIRMATION'):
   m.validate_paths(self.work,self.source,self.manifest,self.output,True,'')
 def test_play_path_forbidden_before_git_write(self):
  with self.assertRaisesRegex(ValueError,'PLAY_PATH_FORBIDDEN'):
   m.validate_paths(self.work,self.source,self.manifest,self.dir/'PLAY/review',False,'')
 def test_review_output_cannot_reside_in_work(self):
  with self.assertRaisesRegex(ValueError,'MUST_BE_SEPARATE'):
   m.validate_paths(self.work,self.source,self.manifest,self.work/'review',False,'')
 def test_validates_exact_staged_git_file_inventory(self):
  baseline=m.read_changed_paths(self.work)
  self.assertEqual(baseline,set())
  (self.work/'untracked').write_text('hello')
  self.assertEqual(m.read_changed_paths(self.work),{'untracked'})
 def test_expected_native_patch_inventory_is_five_paths(self):
  self.assertEqual(len(m.EXPECTED_PATCH_PATHS),5)
  self.assertTrue(m.EXPECTED_PATCH_PATHS.issuperset(str(x) for x in m.ADDITIONS))
 def test_worktree_branch_must_be_isolated(self):
  self.git(self.work,'switch','-c','unsafe')
  with self.assertRaisesRegex(ValueError,'ISOLATED_WORK_BRANCH_REQUIRED'):
   m.validate_paths(self.work,self.source,self.manifest,self.output,False,'')

if __name__=='__main__':unittest.main()
