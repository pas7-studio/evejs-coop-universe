"""PF80: actual 22-path Git WORK assembly on a disposable synthetic native repo.

Never contacts Github, starts EVE or modifies a real checkout. Tests the same
source-pinned PF68 orchestration and the PF55 separately applied patch contract.
"""
import importlib.util
from pathlib import Path
import hashlib
import json
import subprocess
import tempfile
import textwrap
import unittest

SCRIPT=Path(__file__).resolve().parents[1]/'prepare_complete_native_work.py'
spec=importlib.util.spec_from_file_location('pf80_complete_work',SCRIPT)
pf80=importlib.util.module_from_spec(spec)
spec.loader.exec_module(pf80)

STOCK_ONE='Code/server/src/space/npc/nativeNpcService.js'
STOCK_TWO='Code/server/src/space/npc/nativeNpcStore.js'
ARB='Code/server/src/space/coopNpcOrderArbiter.js'
BRIDGE='Code/server/src/space/coopNpcOrderBridge.js'


def run(*args):
    return subprocess.run(args,check=True,text=True,capture_output=True).stdout.strip()


def write(root,rel,content):
    dest=root/rel;dest.parent.mkdir(parents=True,exist_ok=True)
    dest.write_text(content,encoding='utf8')


FAKE_PF62=r'''from pathlib import Path
import hashlib
import json
import difflib
import subprocess
NATIVE_DIR=Path('Code/server/src/space')
MODULE_FILES=tuple('pf55/native/coopFakeModule%d.cjs'%i for i in range(18))
STOCK=('Code/server/src/space/npc/nativeNpcService.js',
       'Code/server/src/space/npc/nativeNpcStore.js')

def build(engine,repo,review):
    files={};patch=[]
    review.mkdir(parents=True,exist_ok=True)
    pins={}
    for rel in STOCK:
        old=(engine/rel).read_text();new=old.replace('old','pf62')
        pins[rel]=subprocess.check_output(['git','-C',str(engine),'hash-object',rel],text=True).strip()
        write(review/rel,new,files,rel)
        patch.append('diff --git a/'+rel+' b/'+rel+'\n')
        patch.extend(difflib.unified_diff(old.splitlines(keepends=True),new.splitlines(keepends=True),fromfile='a/'+rel,tofile='b/'+rel))
    for i,src in enumerate(MODULE_FILES):
        rel=str(NATIVE_DIR/('coopFakeModule%d.js'%i))
        new="'use strict';module.exports={item:%d};\n"%i
        write(review/rel,new,files,rel)
        patch.append('diff --git a/'+rel+' b/'+rel+'\nnew file mode 100644\n')
        patch.extend(difflib.unified_diff([],new.splitlines(keepends=True),fromfile='/dev/null',tofile='b/'+rel))
    full=''.join(patch)
    write(review/'PF62-NATIVE-REVIEW.patch',full,files,'PF62-NATIVE-REVIEW.patch')
    result={'status':'NOT_INSTALLED_IN_EVEJS','featureEnabled':False,
      'stockBlobs':pins,'files':files}
    (review/'PF62-MANIFEST.json').write_text(json.dumps(result))
    return result

def write(path,contents,files,rel):
    path.parent.mkdir(parents=True,exist_ok=True);path.write_text(contents)
    files[rel]={'sha256':hashlib.sha256(contents.encode()).hexdigest()}
'''

FAKE_PF55=r'''from pathlib import Path
import difflib
PREFIX='Code/server/src/space/'
FILES={'coopNpcOrderArbiter.js':'source-pin', 'coopNpcOrderBridge.js':'source-pin'}
def change(source,name):
    return source.replace('old','pf55')
def build(engine):
    chunks=[]
    for name in FILES:
        rel=PREFIX+name;old=(engine/rel).read_text();new=change(old,name)
        chunks.extend(difflib.unified_diff(old.splitlines(keepends=True),new.splitlines(keepends=True),fromfile='a/'+rel,tofile='b/'+rel,n=4))
    return ''.join(chunks)
'''

FAKE_PF77=r'''const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');
test('PF80 worktree original stock PF55 patch present',()=>{
 const w=process.env.PF77_NATIVE_WORKTREE;
 for(const name of ['coopNpcOrderArbiter.js','coopNpcOrderBridge.js']) {
  const text=fs.readFileSync(path.join(w,'Code/server/src/space',name),'utf8');
  assert.match(text,/pf55/);
 }
});
'''

class Fixture:
    def __init__(self):
        self.tmp=tempfile.TemporaryDirectory(prefix='pf80-test-')
        self.root=Path(self.tmp.name);self.engine=self.root/'native';self.repo=self.root/'orchestrator'
        self.review=self.root/'review';self.worktree=self.root/'native-work'
        for p in (self.engine,self.repo):p.mkdir()
        for rel in (STOCK_ONE,STOCK_TWO):write(self.engine,rel,"module.exports = {old:true};\n")
        for rel in (ARB,BRIDGE):write(self.engine,rel,"module.exports = {old:true};\n")
        run('git','-C',str(self.engine),'init','-b','coop/pas7std')
        run('git','-C',str(self.engine),'config','user.email','synthetic@example.com')
        run('git','-C',str(self.engine),'config','user.name','PF80 Synthetic')
        run('git','-C',str(self.engine),'add','.')
        run('git','-C',str(self.engine),'commit','-qm','synthetic native original')
        # PF68 reads the actual builder from this clean synthetic orchestration branch.
        write(self.repo,'scripts/pf62/build_native_review_bundle.py',FAKE_PF62)
        write(self.repo,'scripts/pf55/build_native_owner_patch.py',FAKE_PF55)
        write(self.repo,'scripts/pf55/integration/pf77-native-work-arbiter.test.cjs',FAKE_PF77)
        run('git','-C',str(self.repo),'init','-b','docs/personal-fleet-contract-freeze-v1-4-20261104')
        run('git','-C',str(self.repo),'config','user.email','synthetic@example.com')
        run('git','-C',str(self.repo),'config','user.name','PF80 Synthetic')
        run('git','-C',str(self.repo),'add','.')
        run('git','-C',str(self.repo),'commit','-qm','synthetic orchestration')

    def close(self):self.tmp.cleanup()
    def prepare(self,apply=False,confirmation='',**kwargs):
        params=dict(engine=self.engine,repo=self.repo,review=self.review,
          worktree=self.worktree,branch='work/pf-native-review',apply=apply,
          confirmation=confirmation);params.update(kwargs)
        return pf80.prepare(**params)

class CompleteNativeWorkTests(unittest.TestCase):
 def test_diff_validator_accepts_original_two_file_unified_diff_only(self):
    p='--- a/'+ARB+'\n+++ b/'+ARB+'\n@@ -1 +1 @@\n-old\n+new\n'+\
      '--- a/'+BRIDGE+'\n+++ b/'+BRIDGE+'\n@@ -1 +1 @@\n-old\n+new\n'
    self.assertEqual(pf80.verify_pf55_patch(p),list(pf80.EXPECTED_PF55))
    with self.assertRaisesRegex(ValueError,'PATH_TAMPERED'):
      pf80.verify_pf55_patch(p.replace('+++ b/'+BRIDGE,'+++ b/Code/server/src/space/FOREIGN.js'))
    with self.assertRaisesRegex(ValueError,'EXACT_TWO'):
      pf80.verify_pf55_patch(p.replace('--- a/'+ARB,'--- a/Code/server/src/space/FOREIGN.js').replace('+++ b/'+ARB,'+++ b/Code/server/src/space/FOREIGN.js'))

 def test_read_only_preflight_stages_two_source_pinned_review_patches(self):
    f=Fixture()
    try:
        original=run('git','-C',str(f.engine),'rev-parse','HEAD')
        out=f.prepare()
        self.assertEqual(out['status'],'PREFLIGHT_ONLY')
        self.assertEqual(out['totalNativePaths'],22)
        self.assertEqual(out['pf62Paths'],20)
        self.assertTrue((f.review/'PF62-NATIVE-REVIEW.patch').is_file())
        self.assertTrue((f.review/'PF55-NATIVE-OWNER.patch').is_file())
        self.assertTrue((f.review/'PF80-COMPLETE-WORK-REVIEW.json').is_file())
        self.assertFalse(f.worktree.exists())
        self.assertEqual(run('git','-C',str(f.engine),'rev-parse','HEAD'),original)
        self.assertEqual(run('git','-C',str(f.engine),'status','--porcelain'),'')
        self.assertFalse(out['featureEnabled'])
    finally:f.close()

 def test_actual_disposable_worktree_has_exactly_22_original_native_paths(self):
    f=Fixture()
    try:
        original=run('git','-C',str(f.engine),'rev-parse','HEAD')
        out=f.prepare(apply=True,confirmation='WORK-NOT-PLAY')
        self.assertEqual(out['status'],'WORKTREE_PATCH_APPLIED_REVIEW_ONLY')
        self.assertEqual(out['pf77NativeArbiterGate'],'PASS')
        self.assertEqual(out['totalNativePaths'],22)
        self.assertEqual(len(pf80.native_changed_paths(f.worktree)),22)
        self.assertEqual(run('git','-C',str(f.engine),'status','--porcelain'),'')
        self.assertEqual(run('git','-C',str(f.engine),'rev-parse','HEAD'),original)
        self.assertEqual(run('git','-C',str(f.repo),'status','--porcelain'),'')
        self.assertFalse(out['featureEnabled'])
        self.assertEqual(out['gameplayE2E'],'NOT_RUN')
    finally:f.close()

 def test_apply_requires_explicit_work_only_confirmation(self):
    f=Fixture()
    try:
        with self.assertRaisesRegex(ValueError,'EXPLICIT_WORK_ONLY_CONFIRMATION_REQUIRED'):
          f.prepare(apply=True,confirmation='no')
        self.assertFalse(f.worktree.exists())
        self.assertFalse(f.review.exists())
    finally:f.close()

 def test_play_destination_rejected_without_writes(self):
    f=Fixture()
    try:
        with self.assertRaisesRegex(ValueError,'PLAY_OR_PRODUCTION_PATH'):
          f.prepare(worktree=f.root/'PLAY'/'native-work')
        self.assertFalse(f.review.exists())
    finally:f.close()

if __name__=='__main__':unittest.main()
