#!/usr/bin/env python3
"""PF68: manual local WORK-only native patch preparation, NEVER deployment.

Default mode generates a read-only, fully source-pinned PF62 review bundle.
Only explicit --apply --confirm-work-only WORK-NOT-PLAY creates a separate
LOCAL Git worktree and applies that review patch for manual code inspection.
Does not wire real authorities, enable flags, commit, push, launch, or deploy.
"""
from __future__ import annotations
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import subprocess

EXPECTED_REPO_BRANCH='docs/personal-fleet-contract-freeze-v1-4-20261104'
EXPECTED_NATIVE_BRANCH='coop/pas7std'
REVIEW_PATCH='PF62-NATIVE-REVIEW.patch'
FORBIDDEN={'play','prod','production','deployment','deploy'}
WORK_BRANCH=re.compile(r'^work/pf-[a-z0-9][a-z0-9._/-]{1,70}$')


def git(root:Path,*args:str)->str:
    x=subprocess.run(['git','-C',str(root),*args],check=True,capture_output=True,text=True)
    return x.stdout.strip()


def controlled_path(path:Path,role:str):
    root=path.expanduser().resolve()
    if root == Path(root.anchor):
        raise ValueError(f'PF68_UNSAFE_{role}_ROOT')
    if any(p.lower() in FORBIDDEN for p in root.parts):
        raise ValueError(f'PF68_UNSAFE_{role}_PLAY_OR_PRODUCTION_PATH')
    return root


def overlap(a:Path,b:Path)->bool:
    return a==b or a.is_relative_to(b) or b.is_relative_to(a)


def validate(engine:Path,repo:Path,review:Path,worktree:Path,branch:str,
             apply:bool,confirmation:str):
    engine=controlled_path(engine,'ENGINE')
    repo=controlled_path(repo,'REPO')
    review=controlled_path(review,'REVIEW')
    worktree=controlled_path(worktree,'WORKTREE')
    roots=[engine,repo,review,worktree]
    for i in range(len(roots)):
        for j in range(i+1,len(roots)):
            if overlap(roots[i],roots[j]):
                raise ValueError('PF68_PATH_COLLISION_OR_PARENT_WRITE_FORBIDDEN')
    if not WORK_BRANCH.fullmatch(branch) or '..' in branch or '//' in branch or branch.endswith('/'):
        raise ValueError('PF68_WORK_BRANCH_INVALID')
    if apply and confirmation!='WORK-NOT-PLAY':
        raise ValueError('PF68_EXPLICIT_WORK_ONLY_CONFIRMATION_REQUIRED')
    if review.exists() and any(review.iterdir()):
        raise ValueError('PF68_REVIEW_OUTPUT_MUST_BE_EMPTY')
    if worktree.exists():
        raise ValueError('PF68_WORKTREE_MUST_NOT_EXIST')
    if Path(git(engine,'rev-parse','--show-toplevel')).resolve()!=engine:
        raise ValueError('PF68_ENGINE_GIT_ROOT_REQUIRED')
    if Path(git(repo,'rev-parse','--show-toplevel')).resolve()!=repo:
        raise ValueError('PF68_ORCHESTRATION_GIT_ROOT_REQUIRED')
    if git(engine,'branch','--show-current')!=EXPECTED_NATIVE_BRANCH:
        raise ValueError('PF68_WRONG_ENGINE_BRANCH')
    if git(repo,'branch','--show-current')!=EXPECTED_REPO_BRANCH:
        raise ValueError('PF68_WRONG_ORCHESTRATION_PR_BRANCH')
    if git(engine,'status','--porcelain','--untracked-files=normal'):
        raise ValueError('PF68_NATIVE_SOURCE_NOT_CLEAN')
    if git(repo,'status','--porcelain','--untracked-files=normal'):
        raise ValueError('PF68_ORCHESTRATION_SOURCE_NOT_CLEAN')
    path=repo/'scripts/pf62/build_native_review_bundle.py'
    if not path.is_file():
        raise ValueError('PF68_PF62_BUILDER_NOT_FOUND')
    # Ensure branch cannot be used as a previously created local work branch.
    if apply and git(engine,'branch','--list',branch):
        raise ValueError('PF68_WORK_BRANCH_ALREADY_EXISTS')
    return engine,repo,review,worktree


def build(engine:Path,repo:Path,review:Path):
    f=repo/'scripts/pf62/build_native_review_bundle.py'
    spec=importlib.util.spec_from_file_location('pf68_original_bundle',f)
    module=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    manifest=module.build(engine,repo,review)
    if manifest.get('status')!='NOT_INSTALLED_IN_EVEJS' or manifest.get('featureEnabled') is not False:
        raise ValueError('PF68_UNSAFE_BUNDLE_ACTIVATION_STATUS')
    files=manifest.get('files')
    # Fail closed if ANY of the 19 original native module files is missing.
    # Do not trust a file count alone: a swapped path also invalidates review.
    stock={'Code/server/src/space/npc/nativeNpcService.js',
           'Code/server/src/space/npc/nativeNpcStore.js'}
    modules={str(module.NATIVE_DIR / Path(x).name.replace('.cjs','.js'))
             for x in module.MODULE_FILES}
    expected=stock|modules|{REVIEW_PATCH}
    if (len(modules)!=19 or not isinstance(files,dict) or
        set(files)!=expected or len(files)!=22):
        raise ValueError('PF68_INCOMPLETE_21_FILE_BUNDLE')
    pins=manifest.get('stockBlobs')
    if not isinstance(pins,dict) or set(pins)!=stock:
        raise ValueError('PF68_STOCK_SOURCE_PINS_MISSING')
    for rel in stock:
        actual=git(engine,'hash-object',rel)
        if pins[rel]!=actual:
            raise ValueError('PF68_STOCK_SOURCE_PIN_MISMATCH: '+rel)
    if not (review/REVIEW_PATCH).is_file():
        raise ValueError('PF68_PATCH_MISSING')
    # Cross-check the on-disk reviewed JSON receipt against the live returned
    # receipt. This detects stale, truncated or externally changed bundles.
    receipt=review/'PF62-MANIFEST.json'
    if not receipt.is_file() or json.loads(receipt.read_text(encoding='utf-8'))!=manifest:
        raise ValueError('PF68_REVIEW_RECEIPT_MISSING_OR_CHANGED')
    # The real PF62 builder pins both stock source blobs and runs a disposable
    # git-apply byte-equality roundtrip. No second source-specific rewriter here.
    for relative,meta in files.items():
        if not isinstance(meta,dict) or not re.fullmatch('[0-9a-f]{64}',str(meta.get('sha256',''))):
            raise ValueError('PF68_BUNDLE_MANIFEST_INVALID')
        rel=Path(relative)
        if rel.is_absolute() or '..' in rel.parts or (relative!=REVIEW_PATCH and
          not relative.startswith('Code/server/src/space/')):
            raise ValueError('PF68_BUNDLE_PATH_INVALID')
        if relative.endswith('.js'):
            contents=(review/rel).read_bytes()
        elif relative==REVIEW_PATCH:
            contents=(review/rel).read_bytes()
        else:
            raise ValueError('PF68_UNEXPECTED_BUNDLE_FILE')
        if hashlib.sha256(contents).hexdigest()!=meta['sha256']:
            raise ValueError('PF68_BUNDLE_SHA_MISMATCH')
    return manifest


def run(*,engine:Path,repo:Path,review:Path,worktree:Path,branch:str,
        apply:bool=False,confirmation:str=''):
    engine,repo,review,worktree=validate(engine,repo,review,worktree,branch,apply,confirmation)
    manifest=build(engine,repo,review)
    report={'status':'PREFLIGHT_ONLY','featureEnabled':False,
      'nativeCheckoutFilesChanged':False,'patch':str(review/REVIEW_PATCH),
      'totalPatchPaths':len(manifest['files'])-1,
      'worktree':None,'branch':None,'gameplayE2E':'NOT_RUN'}
    if not apply:return report
    # This explicit opt-in changes local Git worktree metadata and the NEW
    # separate worktree. It never checks out the original engine in-place.
    # A failure after creation leaves the worktree for owner inspection: no
    # automatic destructive rollback or unknown-effect retry is authorized.
    git(engine,'worktree','add','-b',branch,str(worktree),'HEAD')
    try:
        git(worktree,'apply','--check',str(review/REVIEW_PATCH))
        git(worktree,'apply',str(review/REVIEW_PATCH))
        for relative,metadata in manifest['files'].items():
            if relative==REVIEW_PATCH:continue
            got=hashlib.sha256((worktree/relative).read_bytes()).hexdigest()
            if got!=metadata['sha256']:
                raise ValueError('PF68_APPLIED_FILE_SHA_MISMATCH: '+relative)
    except Exception as exc:
        raise RuntimeError('PF68_INCOMPLETE_WORKTREE_REVIEW_MANUALLY_NO_RETRY: '+str(exc)) from exc
    report.update({'status':'WORKTREE_PATCH_APPLIED_REVIEW_ONLY',
      'worktree':str(worktree),'branch':branch})
    return report


def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--engine',type=Path,required=True,help='clean EveJS coop/pas7std Git checkout')
    ap.add_argument('--repo',type=Path,required=True,help='clean checked out PR #350 branch')
    ap.add_argument('--review',type=Path,required=True,help='empty out-of-tree review folder')
    ap.add_argument('--worktree',type=Path,required=True,help='absent, isolated local WORK directory')
    ap.add_argument('--branch',default='work/pf-native-review')
    ap.add_argument('--apply',action='store_true',help='explicitly create new LOCAL WORK worktree')
    ap.add_argument('--confirm-work-only',default='')
    args=ap.parse_args()
    report=run(engine=args.engine,repo=args.repo,review=args.review,
        worktree=args.worktree,branch=args.branch,apply=args.apply,
        confirmation=args.confirm_work_only)
    print(json.dumps(report,indent=2,sort_keys=True))
    print('NEVER START, ENABLE, MERGE, PUSH OR DEPLOY FROM THIS STEP; real native authority wiring NOT DONE.')

if __name__=='__main__':main()
