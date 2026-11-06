#!/usr/bin/env python3
"""PF80: compose PF62 and PF55 patches into exactly one isolated native WORK.

Review-only. Never starts a server, deploys, enables feature flags, pushes or
merges code, or changes PLAY. Actual native bootstrap must be implemented
separately. Original source inputs must be clean/source-pinned Git branches.
"""
from __future__ import annotations
import argparse
import hashlib
from types import ModuleType
import sys
import json
import os
from pathlib import Path
import shutil
import subprocess

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
RECEIPT='PF80-COMPLETE-WORK-REVIEW.json'
PATCH55='PF55-NATIVE-OWNER.patch'
EXPECTED_PF62=20
EXPECTED_PF55=(
 'Code/server/src/space/coopNpcOrderArbiter.js',
 'Code/server/src/space/coopNpcOrderBridge.js',
)


def import_local(path:Path,name:str):
    # Import exact source without creating __pycache__ in a source checkout.
    if not path.is_file():
        raise ValueError('PF80_DEPENDENCY_NOT_READABLE: '+str(path))
    module=ModuleType(name)
    module.__file__=str(path)
    exec(compile(path.read_bytes(),str(path),'exec'),module.__dict__)
    return module


def verify_pf55_patch(patch:str,paths=EXPECTED_PF55):
    if not isinstance(patch,str) or not patch.endswith('\n'):
        raise ValueError('PF80_PF55_PATCH_INVALID')
    # PF55's source-pinned builder intentionally emits plain unified diffs,
    # not git-style `diff --git` headers. Require exactly two paired paths.
    before=[line[6:] for line in patch.splitlines() if line.startswith('--- a/')]
    after=[line[6:] for line in patch.splitlines() if line.startswith('+++ b/')]
    if len(before)!=2 or before!=after:
        raise ValueError('PF80_PF55_DIFF_PATH_TAMPERED')
    actual=before
    if set(actual)!=set(paths) or len(set(actual))!=2:
        raise ValueError('PF80_PF55_PATCH_NOT_EXACT_TWO_ORIGINAL_FILES')
    if '\nnew file mode ' in patch or '\ndeleted file mode ' in patch:
        raise ValueError('PF80_PF55_UNEXPECTED_FILE_OPERATION')
    return actual


def git_apply(root:Path,patch:str,*,apply=False):
    args=['git','-C',str(root),'apply','--whitespace=error']
    if not apply:args.append('--check')
    args.append('-')
    subprocess.run(args,input=patch,text=True,check=True,capture_output=True)


def native_changed_paths(root:Path):
    # Include ignored content: otherwise a native test can write e.g. ignored
    # JS/log artifacts after validation without changing the final Git set.
    # All eighteen newly added modules are visible as untracked files.
    proc=subprocess.run(['git','-C',str(root),'status','--porcelain=v1',
      '--untracked-files=all','--ignored=matching'],
      check=True,capture_output=True,text=True)
    result=[]
    for line in proc.stdout.splitlines():
        if line.startswith('!! '):
            raise ValueError('PF81_IGNORED_NATIVE_ARTIFACT: '+line[3:])
        if not line.startswith((' M ','?? ')):
            raise ValueError('PF80_UNEXPECTED_WORKTREE_GIT_STATUS: '+line)
        result.append(line[3:])
    return result


def verify_complete_worktree(root:Path, expected_hashes:dict[str,str]):
    """PF81: attest the *final*, post-PF77 WORK state, not just pre-test bytes.

    Native verification runs user-space JS against its own worktree. A green
    test process cannot be allowed to change the files that the receipt claims
    were just verified. Both the file set and exact contents are mandatory.
    """
    expected=set(expected_hashes)
    observed=native_changed_paths(root)
    if len(observed)!=len(expected) or set(observed)!=expected:
        raise ValueError('PF81_NATIVE_FILE_SET_MUTATED_AFTER_TEST')
    for relative,expected_digest in expected_hashes.items():
        path=root/relative
        if path.is_symlink() or not path.is_file():
            raise ValueError('PF81_NATIVE_FILE_REPLACED_AFTER_TEST: '+relative)
        actual=hashlib.sha256(path.read_bytes()).hexdigest()
        if actual!=expected_digest:
            raise ValueError('PF81_NATIVE_CONTENT_MUTATED_AFTER_TEST: '+relative)
    return True


def prepare(*,engine:Path,repo:Path,review:Path,worktree:Path,
            branch='work/pf-native-review',apply=False,confirmation=''):
    pf68=import_local(HERE/'prepare_native_worktree.py','pf80_pf68')
    engine,repo,review,worktree=pf68.validate(engine,repo,review,worktree,
        branch,apply,confirmation)
    pf55=import_local(repo/'scripts/pf55/build_native_owner_patch.py','pf80_pf55')
    # Validate BOTH original source-specific patches before creating any WORK
    # branch or review artifacts. A stale native PF55 blob fails closed.
    patch=pf55.build(engine)
    verify_pf55_patch(patch)
    git_apply(engine,patch)
    # The PF62 builder is imported by PF68; suppress bytecode writes so a
    # pure review cannot dirty the Git checkout (a false positive safe gate).
    old_bytecode=sys.dont_write_bytecode
    try:
        sys.dont_write_bytecode=True
        out=pf68.run(engine=engine,repo=repo,review=review,worktree=worktree,
                     branch=branch,apply=apply,confirmation=confirmation)
    finally:
        sys.dont_write_bytecode=old_bytecode
    if out['totalPatchPaths']!=EXPECTED_PF62:
        raise ValueError('PF80_PF62_INCOMPLETE_SOURCE_INVENTORY')
    manifest=json.loads((review/'PF62-MANIFEST.json').read_text(encoding='utf8'))
    staged=set(manifest['files'])-{'PF62-NATIVE-REVIEW.patch'}
    if len(staged)!=EXPECTED_PF62 or staged.intersection(EXPECTED_PF55):
        raise ValueError('PF80_NATIVE_PATCH_OVERLAP_OR_MISSING_PATH')
    with (review/PATCH55).open('x',encoding='utf8') as f:f.write(patch)
    hashes={k:hashlib.sha256((review/k).read_bytes()).hexdigest() for k in staged}
    # Compute stock PF55 expected bytes from the exact pinned original source.
    # PF62 hashes come from the verified stage receipt; do not trust post-test
    # content as the expected value.
    expected_pf55_hashes={
        relative:hashlib.sha256(pf55.change(
            (engine/relative).read_text(encoding='utf8'),Path(relative).name
        ).encode('utf8')).hexdigest()
        for relative in EXPECTED_PF55
    }
    all_expected_hashes={**hashes,**expected_pf55_hashes}
    result={
      'status':'WORKTREE_PATCH_APPLIED_REVIEW_ONLY' if apply else 'PREFLIGHT_ONLY',
      'featureEnabled':False,'gameplayE2E':'NOT_RUN','serverBoot':'NOT_RUN',
      'originalNativeCheckoutModified':False,'appliedToPlay':False,
      'pf62Paths':EXPECTED_PF62,'pf55Paths':len(EXPECTED_PF55),
      'totalNativePaths':EXPECTED_PF62+len(EXPECTED_PF55),
      'nativePaths':sorted(staged|set(EXPECTED_PF55)),
      'pf62OutputHashes':hashes,
      'pf55ReviewPatchSha256':hashlib.sha256(patch.encode('utf8')).hexdigest(),
      'sourceBlobs':{**manifest['stockBlobs'],
        **{pf55.PREFIX+k:v for k,v in pf55.FILES.items()}},
      'worktree':str(worktree) if apply else None,
    }
    if apply:
        git_apply(worktree,patch)
        # Now apply only the same two pinned stock modifications, never mutate
        # the original native checkout's tracked files.
        git_apply(worktree,patch,apply=True)
        # Verify the native stock changes before running any JS acceptance.
        verify_complete_worktree(worktree,all_expected_hashes)
        node=shutil.which('node')
        if node is None:raise ValueError('PF80_NODE_REQUIRED')
        for relative in EXPECTED_PF55:
            subprocess.run([node,'--check',str(worktree/relative)],
                           check=True,capture_output=True,text=True)
        pf77_test=repo/'scripts/pf55/integration/pf77-native-work-arbiter.test.cjs'
        if not pf77_test.is_file():
            raise ValueError('PF80_PF77_TEST_NOT_FOUND')
        env={**os.environ,'PF77_NATIVE_WORKTREE':str(worktree)}
        subprocess.run([node,'--test','--test-concurrency=1',str(pf77_test)],
            check=True,capture_output=True,text=True,env=env)
        # PF81: a green PF77 process cannot add or mutate any native artifact.
        # The final receipt is written ONLY after a second, post-test readback.
        verify_complete_worktree(worktree,all_expected_hashes)
        if pf68.git(engine,'status','--porcelain','--untracked-files=all'):
            raise ValueError('PF81_ORIGINAL_NATIVE_SOURCE_DIRTY_AFTER_TEST')
        if pf68.git(repo,'status','--porcelain','--untracked-files=all'):
            raise ValueError('PF81_ORCHESTRATION_SOURCE_DIRTY_AFTER_TEST')
        result['pf77NativeArbiterGate']='PASS'
        result['postTestNativeIntegrity']='PASS'
    (review/RECEIPT).write_text(json.dumps(result,indent=2,sort_keys=True)+'\n',
        encoding='utf8')
    return result


def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--engine',type=Path,required=True)
    ap.add_argument('--repo',type=Path,required=True)
    ap.add_argument('--review',type=Path,required=True)
    ap.add_argument('--worktree',type=Path,required=True)
    ap.add_argument('--branch',default='work/pf-native-review')
    ap.add_argument('--apply',action='store_true')
    ap.add_argument('--confirm-work-only',default='')
    args=ap.parse_args()
    print(json.dumps(prepare(engine=args.engine,repo=args.repo,review=args.review,
      worktree=args.worktree,branch=args.branch,apply=args.apply,
      confirmation=args.confirm_work_only),indent=2,sort_keys=True))
    print('PF80 complete native review only. Never boot, deploy, enable or merge PLAY.')

if __name__=='__main__':main()
