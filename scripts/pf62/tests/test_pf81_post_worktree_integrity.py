"""PF81: a successful PF77 subprocess must not alter accepted WORK contents.

Use the same actual disposable Git worktree fixture as PF80 and substitute only
its late native test, keeping the source-pinned 22-file patch generation intact.
"""
import unittest
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent))
from test_prepare_complete_native_work import Fixture, FAKE_PF77, write, run

MUTATION_TEST=r'''const {test}=require('node:test');const fs=require('node:fs');const path=require('node:path');
const root=process.env.PF77_NATIVE_WORKTREE;
test('late verifier changes worktree after initial attestation',()=>{
 const target=path.join(root,CHANGE_PATH);
 fs.mkdirSync(path.dirname(target),{recursive:true});
 fs.writeFileSync(target,NEW_CONTENT);
});
'''

class NativeReviewPostVerificationTests(unittest.TestCase):
 def _run_mutator(self,relative,contents):
  f=Fixture()
  try:
   content=MUTATION_TEST.replace('CHANGE_PATH',repr(relative)).replace('NEW_CONTENT',repr(contents))
   test='scripts/pf55/integration/pf77-native-work-arbiter.test.cjs'
   write(f.repo,test,content)
   run('git','-C',str(f.repo),'add','.')
   run('git','-C',str(f.repo),'commit','-qm','pf81 synthetic late verifier change')
   with self.assertRaisesRegex((ValueError,RuntimeError,AssertionError),'PF81_'):
    f.prepare(apply=True,confirmation='WORK-NOT-PLAY')
   self.assertEqual(run('git','-C',str(f.engine),'status','--porcelain'),'')
  finally:f.close()

 def test_rogue_new_file_after_verification_must_block(self):
  self._run_mutator('Code/server/src/space/pf81-rogue.js','module.exports={unsafe:true};\n')

 def test_corrupted_pf62_stock_file_after_verification_must_block(self):
  self._run_mutator('Code/server/src/space/npc/nativeNpcService.js','module.exports={foreign:true};\n')

 def test_corrupted_pf55_stock_file_after_verification_must_block(self):
  self._run_mutator('Code/server/src/space/coopNpcOrderArbiter.js','module.exports={foreign:true};\n')

 def test_ignored_native_file_after_verification_must_block(self):
  f=Fixture()
  try:
   write(f.engine,'.gitignore','pf81-hidden.tmp\n')
   run('git','-C',str(f.engine),'add','.')
   run('git','-C',str(f.engine),'commit','-qm','mark hidden file ignored')
   test='scripts/pf55/integration/pf77-native-work-arbiter.test.cjs'
   payload=MUTATION_TEST.replace('CHANGE_PATH',repr('pf81-hidden.tmp')).replace('NEW_CONTENT',repr('invisible native artifact'))
   write(f.repo,test,payload)
   run('git','-C',str(f.repo),'add','.')
   run('git','-C',str(f.repo),'commit','-qm','pf81 synthetic ignored injection')
   with self.assertRaisesRegex(ValueError,'PF81_'):
    f.prepare(apply=True,confirmation='WORK-NOT-PLAY')
   self.assertEqual(run('git','-C',str(f.engine),'status','--porcelain'),'')
  finally:f.close()

 def test_successful_pf77_cannot_modify_orchestration_repo(self):
  f=Fixture()
  try:
   test='scripts/pf55/integration/pf77-native-work-arbiter.test.cjs'
   bad=str(f.repo/'scripts/pf55/build_native_owner_patch.py')
   injected=r"""const {test}=require('node:test');const fs=require('node:fs');
   test('pf77 invalid source modification',()=>{fs.appendFileSync(TARGET,'\n# marker\n')});""".replace('TARGET',repr(bad))
   write(f.repo,test,injected)
   run('git','-C',str(f.repo),'add','.')
   run('git','-C',str(f.repo),'commit','-qm','pf81 synthetic orchestration writer')
   with self.assertRaisesRegex(ValueError,'PF81_ORCHESTRATION_SOURCE_DIRTY_AFTER_TEST'):
    f.prepare(apply=True,confirmation='WORK-NOT-PLAY')
  finally:f.close()

if __name__=='__main__':unittest.main()
