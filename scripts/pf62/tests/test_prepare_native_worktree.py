"""PF68: synthetic Git/worktree tests; never the actual EveJS game instance."""
from __future__ import annotations
import contextlib
import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest

SCRIPT=Path(__file__).resolve().parents[1]/'prepare_native_worktree.py'
spec=importlib.util.spec_from_file_location('pf68_work_review',SCRIPT)
pf=importlib.util.module_from_spec(spec)
spec.loader.exec_module(pf)
SERVICE='Code/server/src/space/npc/nativeNpcService.js'
STORE='Code/server/src/space/npc/nativeNpcStore.js'
NATIVE_DIR='Code/server/src/space'
BUILDER=r'''from pathlib import Path
import hashlib
import difflib
import json
NATIVE_DIR=Path('Code/server/src/space')
MODULE_FILES=tuple(f'pf66/native/coopFakeModule{i}.cjs' for i in range(18))
def blob(raw):return hashlib.sha1(f'blob {len(raw)}\0'.encode()+raw).hexdigest()
def sha(raw):return hashlib.sha256(raw).hexdigest()
def build(engine,repo,output):
    output.mkdir(parents=True,exist_ok=True)
    service='Code/server/src/space/npc/nativeNpcService.js'
    store='Code/server/src/space/npc/nativeNpcStore.js'
    parts=[];created={};pins={}
    for rel in (service,store):
        raw=(engine/rel).read_bytes();pins[rel]=blob(raw)
        old=raw.decode();new=old.replace('OLD','NEW')
        p=output/rel;p.parent.mkdir(parents=True,exist_ok=True)
        p.write_text(new);created[rel]={'sha256':sha(new.encode()),'bytes':len(new)}
        parts.append(f'diff --git a/{rel} b/{rel}\n')
        parts.extend(difflib.unified_diff(old.splitlines(keepends=True),new.splitlines(keepends=True),fromfile='a/'+rel,tofile='b/'+rel))
    for name in MODULE_FILES:
        rel=str(NATIVE_DIR/Path(name).name.replace('.cjs','.js'))
        data='module.exports = true;\n'; p=output/rel;p.parent.mkdir(parents=True,exist_ok=True)
        p.write_text(data);created[rel]={'sha256':sha(data.encode()),'bytes':len(data)}
        parts.append(f'diff --git a/{rel} b/{rel}\nnew file mode 100644\n')
        parts.extend(difflib.unified_diff([],data.splitlines(keepends=True),fromfile='/dev/null',tofile='b/'+rel))
    full=''.join(parts)
    patch=output/'PF62-NATIVE-REVIEW.patch';patch.write_text(full)
    created[patch.name]={'sha256':sha(full.encode()),'bytes':len(full)}
    result={'status':'NOT_INSTALLED_IN_EVEJS','featureEnabled':False,
            'files':created,'stockBlobs':pins,'gameplayE2E':'NOT_RUN'}
    (output/'PF62-MANIFEST.json').write_text(json.dumps(result,indent=2,sort_keys=True)+'\n')
    return result
'''


def cmd(root,*args):
    return subprocess.run(['git','-C',str(root),*args],check=True,
                          capture_output=True,text=True).stdout.strip()

class PF68WorktreeTests(unittest.TestCase):
    def setUp(self):
        self.td=tempfile.TemporaryDirectory(prefix='pf68-')
        self.root=Path(self.td.name)
        self.engine=self.root/'engine'
        self.repo=self.root/'repo'
        self.review=self.root/'review'
        self.worktree=self.root/'work-fleet'
        for folder,branch in ((self.engine,pf.EXPECTED_NATIVE_BRANCH),
                              (self.repo,pf.EXPECTED_REPO_BRANCH)):
            folder.mkdir()
            cmd(folder,'init','-q','-b',branch)
            cmd(folder,'config','user.email','test@example.invalid')
            cmd(folder,'config','user.name','PF68 unit tests')
            cmd(folder,'config','core.autocrlf','false')
        for rel in (SERVICE,STORE):
            file=self.engine/rel
            file.parent.mkdir(parents=True,exist_ok=True)
            file.write_text('module.exports = "OLD";\n')
        cmd(self.engine,'add','.')
        cmd(self.engine,'commit','-qm','synthetic upstream native fixture')
        builder=self.repo/'scripts/pf62/build_native_review_bundle.py'
        builder.parent.mkdir(parents=True,exist_ok=True)
        builder.write_text(BUILDER)
        cmd(self.repo,'add','.')
        cmd(self.repo,'commit','-qm','synthetic PF62 package fixture')

    def tearDown(self):
        self.td.cleanup()

    def run_review(self,*,apply=False,confirmation='',**kwargs):
        data={'engine':self.engine,'repo':self.repo,'review':self.review,
              'worktree':self.worktree,'branch':'work/pf-test-native',
              'apply':apply,'confirmation':confirmation}
        data.update(kwargs)
        return pf.run(**data)

    def test_default_never_creates_worktree_and_only_stages_review(self):
        result=self.run_review()
        self.assertEqual(result['status'],'PREFLIGHT_ONLY')
        self.assertEqual(result['totalPatchPaths'],20)
        self.assertFalse(self.worktree.exists())
        self.assertTrue((self.review/pf.REVIEW_PATCH).is_file())
        self.assertEqual((self.engine/SERVICE).read_text(),'module.exports = "OLD";\n')
        self.assertEqual(cmd(self.engine,'status','--porcelain'),'')
        self.assertFalse(cmd(self.engine,'branch','--list','work/pf-test-native'))

    def test_explicit_work_confirmation_creates_only_separate_local_worktree(self):
        result=self.run_review(apply=True,confirmation='WORK-NOT-PLAY')
        self.assertEqual(result['status'],'WORKTREE_PATCH_APPLIED_REVIEW_ONLY')
        self.assertEqual(result['branch'],'work/pf-test-native')
        self.assertEqual((self.worktree/SERVICE).read_text(),'module.exports = "NEW";\n')
        self.assertEqual((self.engine/SERVICE).read_text(),'module.exports = "OLD";\n')
        self.assertTrue((self.worktree/NATIVE_DIR/'coopFakeModule0.js').is_file())
        self.assertTrue((self.worktree/NATIVE_DIR/'coopFakeModule16.js').is_file())
        self.assertEqual(cmd(self.engine,'status','--porcelain'),'')
        self.assertIn(str(self.worktree),cmd(self.engine,'worktree','list'))
        self.assertEqual(cmd(self.worktree,'branch','--show-current'),'work/pf-test-native')

    def test_apply_without_exact_confirmation_fails_before_output(self):
        with self.assertRaisesRegex(ValueError,'CONFIRMATION_REQUIRED'):
            self.run_review(apply=True,confirmation='yes')
        self.assertFalse(self.review.exists())
        self.assertFalse(self.worktree.exists())

    def test_dirty_original_native_checkout_refused(self):
        (self.engine/SERVICE).write_text('malicious mutation\n')
        with self.assertRaisesRegex(ValueError,'NATIVE_SOURCE_NOT_CLEAN'):
            self.run_review()
        self.assertFalse(self.review.exists())

    def test_untracked_original_native_checkout_refused(self):
        (self.engine/'junk.txt').write_text('untracked')
        with self.assertRaisesRegex(ValueError,'NATIVE_SOURCE_NOT_CLEAN'):
            self.run_review()
        self.assertFalse(self.review.exists())

    def test_wrong_engine_branch_cannot_apply(self):
        cmd(self.engine,'switch','-c','main')
        with self.assertRaisesRegex(ValueError,'WRONG_ENGINE_BRANCH'):
            self.run_review(apply=True,confirmation='WORK-NOT-PLAY')

    def test_worktree_under_play_or_parent_checkout_blocked(self):
        with self.assertRaisesRegex(ValueError,'PLAY_OR_PRODUCTION_PATH'):
            self.run_review(worktree=self.root/'PLAY'/'work')
        with self.assertRaisesRegex(ValueError,'COLLISION'):
            self.run_review(worktree=self.engine/'new-work')
        with self.assertRaisesRegex(ValueError,'COLLISION'):
            self.run_review(review=self.root)
        self.assertFalse(self.review.exists())

    def test_existing_worktree_or_local_branch_cannot_be_overwritten(self):
        self.worktree.mkdir()
        with self.assertRaisesRegex(ValueError,'WORKTREE_MUST_NOT_EXIST'):
            self.run_review()
        self.worktree.rmdir()
        cmd(self.engine,'branch','work/pf-test-native')
        with self.assertRaisesRegex(ValueError,'WORK_BRANCH_ALREADY_EXISTS'):
            self.run_review(apply=True,confirmation='WORK-NOT-PLAY')

    def test_rejects_incomplete_manifest_before_worktree_mutation(self):
        builder=self.repo/'scripts/pf62/build_native_review_bundle.py'
        # Give the fixture an otherwise clean Git commit containing a
        # deliberately incomplete manifest. The wrapper MUST refuse it.
        content=builder.read_text().replace("    created[patch.name]={'sha256':sha(full.encode()),'bytes':len(full)}",
          "    created.pop(str(NATIVE_DIR/'coopFakeModule16.js'))\n    created[patch.name]={'sha256':sha(full.encode()),'bytes':len(full)}")
        self.assertNotEqual(content,builder.read_text())
        builder.write_text(content)
        cmd(self.repo,'add','.')
        cmd(self.repo,'commit','-qm','intentional incomplete source test')
        with self.assertRaisesRegex(ValueError,'INCOMPLETE_20_FILE_BUNDLE'):
            self.run_review(apply=True,confirmation='WORK-NOT-PLAY')
        self.assertFalse(self.worktree.exists())

    def test_rejects_stale_mismatched_manifest_receipt(self):
        builder=self.repo/'scripts/pf62/build_native_review_bundle.py'
        source=builder.read_text()
        source=source.replace('    return result\n',
          "    (output/'PF62-MANIFEST.json').write_text('{}')\n    return result\n")
        self.assertNotEqual(source,builder.read_text())
        builder.write_text(source)
        cmd(self.repo,'add','.')
        cmd(self.repo,'commit','-qm','intentional receipt mismatch fixture')
        with self.assertRaisesRegex(ValueError,'REVIEW_RECEIPT_MISSING_OR_CHANGED'):
            self.run_review(apply=True,confirmation='WORK-NOT-PLAY')
        self.assertFalse(self.worktree.exists())

    def test_refuses_uncommitted_orchestration_checkout(self):
        builder=self.repo/'scripts/pf62/build_native_review_bundle.py'
        builder.write_text(builder.read_text()+'\n# uncommitted\n')
        with self.assertRaisesRegex(ValueError,'ORCHESTRATION_SOURCE_NOT_CLEAN'):
            self.run_review()

    def test_rejects_insecure_git_branch_names(self):
        for branch in ['main','play/pf-test','work/pf-../bad','work/pf-//bad']:
            with self.assertRaisesRegex(ValueError,'WORK_BRANCH_INVALID'):
                self.run_review(branch=branch)

if __name__=='__main__':unittest.main()
