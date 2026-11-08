#!/usr/bin/env python3
"""Review or explicitly install the 46-path Personal Fleet first-play WORK delta.

Requires PF80's already prepared, isolated, source-pinned WORK git worktree.
This code never starts Docker, contacts PLAY, edits the original native checkout,
installs business authority callbacks, or enables feature flags.
"""
from __future__ import annotations
import argparse
import hashlib
import importlib.util
import json
import difflib
from pathlib import Path
import subprocess
import sys

HERE=Path(__file__).resolve().parent
ROOT=HERE.parent
STOCK_ROOT=Path('Code/server/src/space')
ADDITIONS={
 STOCK_ROOT/'coopPersonalFleetWorkCommandOwner.js': ROOT/'native/coopPersonalFleetWorkCommandOwner.js',
 STOCK_ROOT/'coopPersonalFleetOriginalOfferAuthority.js': ROOT/'native/coopPersonalFleetOriginalOfferAuthority.js',
 STOCK_ROOT/'coopPersonalFleetOriginalSourceBindings.js': ROOT/'native/coopPersonalFleetOriginalSourceBindings.js',
 STOCK_ROOT/'coopPersonalFleetOriginalWorkBootstrap.js': ROOT/'native/coopPersonalFleetOriginalWorkBootstrap.js',
 STOCK_ROOT/'coopPersonalFleetOriginalWorkStarter.js': ROOT/'native/coopPersonalFleetOriginalWorkStarter.js',
 STOCK_ROOT/'coopPersonalFleetOriginalWorkConfiguration.js': ROOT/'native/coopPersonalFleetOriginalWorkConfiguration.js',
 STOCK_ROOT/'coopPersonalFleetOriginalNativeWriterBoundary.js': ROOT/'native/coopPersonalFleetOriginalNativeWriterBoundary.js',
 STOCK_ROOT/'coopPersonalFleetOriginalAuthoredPolicy.js': ROOT/'native/coopPersonalFleetOriginalAuthoredPolicy.js',
 STOCK_ROOT/'coopPersonalFleetOriginalClaimsPolicy.js': ROOT/'native/coopPersonalFleetOriginalClaimsPolicy.js',
 STOCK_ROOT/'coopPersonalFleetOriginalForeignItemWriterGateway.js': ROOT/'native/coopPersonalFleetOriginalForeignItemWriterGateway.js',
 STOCK_ROOT/'coopPersonalFleetOriginalWarClaim.js': ROOT/'native/coopPersonalFleetOriginalWarClaim.js',
 STOCK_ROOT/'coopPersonalFleetOriginalCatalogProof.js': ROOT/'native/coopPersonalFleetOriginalCatalogProof.js',
 STOCK_ROOT/'coopPersonalFleetOriginalWalletAuthority.js': ROOT/'native/coopPersonalFleetOriginalWalletAuthority.js',
 STOCK_ROOT/'coopPersonalFleetOriginalOrderWitness.js': ROOT/'native/coopPersonalFleetOriginalOrderWitness.js',
 STOCK_ROOT/'coopPersonalFleetOriginalOrderExecutor.js': ROOT/'native/coopPersonalFleetOriginalOrderExecutor.js',
 STOCK_ROOT/'coopPersonalFleetOriginalDurableOrderAck.js': ROOT/'native/coopPersonalFleetOriginalDurableOrderAck.js',
 STOCK_ROOT/'coopPersonalFleetNativeEntityIsolation.js': ROOT/'native/coopPersonalFleetNativeEntityIsolation.js',
 STOCK_ROOT/'coopPersonalFleetOriginalDockCompletionWitness.js': ROOT/'native/coopPersonalFleetOriginalDockCompletionWitness.js',
 STOCK_ROOT/'coopPersonalFleetOriginalTerminalDockSources.js': ROOT/'native/coopPersonalFleetOriginalTerminalDockSources.js',
 STOCK_ROOT/'coopPersonalFleetOriginalDockCoordinator.js': ROOT/'native/coopPersonalFleetOriginalDockCoordinator.js',
 STOCK_ROOT/'coopPersonalFleetOriginalStationDwell.js': ROOT/'native/coopPersonalFleetOriginalStationDwell.js',
 STOCK_ROOT/'coopPersonalFleetOriginalLossRows.js': ROOT/'native/coopPersonalFleetOriginalLossRows.js',
 STOCK_ROOT/'coopPersonalFleetOriginalPhysicalRecovery.js': ROOT/'native/coopPersonalFleetOriginalPhysicalRecovery.js',
 STOCK_ROOT/'coopPersonalFleetOriginalSalaryTerms.js': ROOT/'native/coopPersonalFleetOriginalSalaryTerms.js',
 STOCK_ROOT/'coopPersonalFleetOriginalPayrollConsent.js': ROOT/'native/coopPersonalFleetOriginalPayrollConsent.js',
 STOCK_ROOT/'coopPersonalFleetOriginalPayrollScheduler.js': ROOT/'native/coopPersonalFleetOriginalPayrollScheduler.js',
 STOCK_ROOT/'coopPersonalFleetOriginalIngressProof.js': ROOT/'native/coopPersonalFleetOriginalIngressProof.js',
 STOCK_ROOT/'coopPersonalFleetOriginalIngressRecovery.js': ROOT/'native/coopPersonalFleetOriginalIngressRecovery.js',
 STOCK_ROOT/'coopPersonalFleetOriginalCombatAuthority.js': ROOT/'native/coopPersonalFleetOriginalCombatAuthority.js',
 STOCK_ROOT/'coopPersonalFleetOriginalCombatReceipt.js': ROOT/'native/coopPersonalFleetOriginalCombatReceipt.js',
 STOCK_ROOT/'coopPersonalFleetOriginalCombatRecovery.js': ROOT/'native/coopPersonalFleetOriginalCombatRecovery.js',
 STOCK_ROOT/'coopPersonalFleetOriginalGuardAggression.js': ROOT/'native/coopPersonalFleetOriginalGuardAggression.js',
 STOCK_ROOT/'coopPersonalFleetOriginalGuardReaction.js': ROOT/'native/coopPersonalFleetOriginalGuardReaction.js',
 STOCK_ROOT/'coopPersonalFleetOriginalStationTickDriver.js': ROOT/'native/coopPersonalFleetOriginalStationTickDriver.js',
}
PATCH_NAME='PERSONAL-FLEET-FIRST-PLAY-WORK.patch'
RECEIPT='PERSONAL-FLEET-FIRST-PLAY-REVIEW.json'
EXPECTED_PATCH_PATHS={
 str(STOCK_ROOT/'coopPersonalFleetHangarBridge.js'),
 str(STOCK_ROOT/'coopPersonalFleetPaidHiring.js'),
 str(STOCK_ROOT/'coopPersonalFleetNativeOrders.js'),
 str(STOCK_ROOT/'coopPersonalFleetContractLifecycle.js'),
 str(STOCK_ROOT/'coopPersonalFleetChatGateway.js'),
 str(STOCK_ROOT/'coopPersonalFleetWorkCommandOwner.js'),
 str(STOCK_ROOT/'coopPersonalFleetOriginalOfferAuthority.js'),
 str(STOCK_ROOT/'coopPersonalFleetOriginalSourceBindings.js'),
 str(STOCK_ROOT/'coopPersonalFleetOriginalWorkBootstrap.js'),
 str(STOCK_ROOT/'coopPersonalFleetOriginalWorkStarter.js'),
 str(STOCK_ROOT/'coopPersonalFleetOriginalWorkConfiguration.js'),
 str(STOCK_ROOT/'coopPersonalFleetOriginalNativeWriterBoundary.js'),
 str(STOCK_ROOT/'coopPersonalFleetOriginalAuthoredPolicy.js'),
 str(STOCK_ROOT/'coopPersonalFleetOriginalClaimsPolicy.js'),
 str(STOCK_ROOT/'coopPersonalFleetOriginalForeignItemWriterGateway.js'),
 str(STOCK_ROOT/'coopPersonalFleetOriginalWarClaim.js'),
 str(STOCK_ROOT/'coopPersonalFleetOriginalCatalogProof.js'),
 'Code/server/index.js',
 str(STOCK_ROOT/'coopPersonalFleetOriginalWalletAuthority.js'),
 str(STOCK_ROOT/'coopPersonalFleetOriginalOrderWitness.js'),
 str(STOCK_ROOT/'coopPersonalFleetOriginalOrderExecutor.js'),
 str(STOCK_ROOT/'coopPersonalFleetOriginalDurableOrderAck.js'),
 str(STOCK_ROOT/'coopPersonalFleetNativeEntityIsolation.js'),
 str(STOCK_ROOT/'coopGameStoreAtomic.js'),
 str(STOCK_ROOT/'coopPersonalFleetOriginalDockCompletionWitness.js'),
 str(STOCK_ROOT/'coopPersonalFleetOriginalTerminalDockSources.js'),
 str(STOCK_ROOT/'coopPersonalFleetOriginalDockCoordinator.js'),
 str(STOCK_ROOT/'coopPersonalFleetOriginalStationDwell.js'),
 str(STOCK_ROOT/'coopPersonalFleetOriginalLossRows.js'),
 str(STOCK_ROOT/'coopPersonalFleetOriginalPhysicalRecovery.js'),
 str(STOCK_ROOT/'coopPersonalFleetOriginalSalaryTerms.js'),
 str(STOCK_ROOT/'coopPersonalFleetOriginalPayrollConsent.js'),
 str(STOCK_ROOT/'coopPersonalFleetOriginalPayrollScheduler.js'),
 str(STOCK_ROOT/'coopPersonalFleetOriginalIngressProof.js'),
 str(STOCK_ROOT/'coopPersonalFleetOriginalIngressRecovery.js'),
 str(STOCK_ROOT/'coopPersonalFleetOriginalCombatAuthority.js'),
 str(STOCK_ROOT/'coopPersonalFleetOriginalCombatReceipt.js'),
 str(STOCK_ROOT/'coopPersonalFleetOriginalCombatRecovery.js'),
 str(STOCK_ROOT/'coopPersonalFleetOriginalGuardAggression.js'),
 str(STOCK_ROOT/'coopPersonalFleetOriginalGuardReaction.js'),
 str(STOCK_ROOT/'coopPersonalFleetOriginalStationTickDriver.js'),
 'Code/server/src/services/chat/chatCommands.js',
 'Code/server/src/space/combat/killmailTracker.js',
 'Code/server/src/space/npc/npcBehaviorLoop.js',
 'Code/server/src/space/coopNpcOrderArbiter.js',
 'Code/server/src/space/coopNpcOrderBridge.js',
}

def import_builder(path:Path,name:str):
 spec=importlib.util.spec_from_file_location(name,path)
 if spec is None or spec.loader is None:raise ValueError('PF_FIRSTPLAY_BUILDER_NOT_FOUND: '+str(path))
 old=sys.dont_write_bytecode
 try:
  sys.dont_write_bytecode=True
  mod=importlib.util.module_from_spec(spec)
  spec.loader.exec_module(mod)
  return mod
 finally:sys.dont_write_bytecode=old

def git(root:Path,*args,input=None):
 return subprocess.run(['git','-C',str(root),*args],check=True,input=input,
  text=True,capture_output=True).stdout.strip()

def sha(raw:bytes)->str:return hashlib.sha256(raw).hexdigest()

def read_changed_paths(root:Path)->set[str]:
 raw=git(root,'status','--porcelain=v1','--untracked-files=all')
 result=set()
 for line in raw.splitlines():
  if len(line)<4 or not line.startswith((' M ','?? ')):
   raise ValueError('PF_FIRSTPLAY_WORKTREE_UNEXPECTED_GIT_STATUS: '+line[:130])
  path=line[3:]
  if path in result:raise ValueError('PF_FIRSTPLAY_DUPLICATE_PATH')
  result.add(path)
 return result

def validate_paths(work:Path,source:Path,manifest:Path,out:Path,apply:bool,confirm:str):
 work=work.resolve(strict=True);source=source.resolve(strict=True)
 manifest=manifest.resolve(strict=True);out=out.resolve()
 for path in [work,source,out]:
  if any(x.lower() in ('play','production','prod') for x in path.parts):
   raise ValueError('PF_FIRSTPLAY_PLAY_PATH_FORBIDDEN')
 if source==work or work in source.parents or source in work.parents:
  raise ValueError('PF_FIRSTPLAY_SOURCE_AND_WORK_COLLIDE')
 if out==work or work in out.parents or out in work.parents or out==source or source in out.parents:
  raise ValueError('PF_FIRSTPLAY_REVIEW_OUTPUT_MUST_BE_SEPARATE')
 if out.exists():raise ValueError('PF_FIRSTPLAY_OUTPUT_ALREADY_EXISTS')
 if (source/'scripts/personal-fleet-firstplay/native/coopPersonalFleetChatGateway.js').is_file() is False:
  raise ValueError('PF_FIRSTPLAY_ORCHESTRATION_SOURCE_MISSING')
 if Path(git(work,'rev-parse','--show-toplevel')).resolve()!=work:
  raise ValueError('PF_FIRSTPLAY_WORK_NOT_GIT_ROOT')
 if not (work/'.git').is_file():
  raise ValueError('PF_FIRSTPLAY_LINKED_WORKTREE_REQUIRED')
 if not git(work,'branch','--show-current').startswith('work/'):
  raise ValueError('PF_FIRSTPLAY_ISOLATED_WORK_BRANCH_REQUIRED')
 if apply and confirm!='WORK-NOT-PLAY':
  raise ValueError('PF_FIRSTPLAY_EXPLICIT_WORK_ONLY_CONFIRMATION_REQUIRED')
 if not manifest.is_file():raise ValueError('PF_FIRSTPLAY_PF62_MANIFEST_UNAVAILABLE')
 return work,source,manifest,out

def make_patch(work:Path,source:Path,manifest:Path):
 wallet=import_builder(ROOT/'tools/build_original_character_wallet_patch.py','pf_firstplay_wallet')
 chat=import_builder(ROOT/'tools/build_native_chat_patch.py','pf_firstplay_chat')
 arbiter=import_builder(ROOT/'tools/build_original_order_arbiter_patch.py','pf_firstplay_order_arbiter')
 atomic=import_builder(ROOT/'tools/build_original_atomic_entity_contract_patch.py','pf_firstplay_entity_atomic')
 startup=import_builder(ROOT/'tools/build_original_server_startup_patch.py','pf_firstplay_startup')
 damage=import_builder(ROOT/'tools/build_original_guard_damage_patch.py','pf_firstplay_guard_damage')
 hostility=import_builder(ROOT/'tools/build_original_guard_hostility_patch.py','pf_firstplay_guard_hostility')
 w=wallet.build(work,manifest)
 c=chat.build(work,source/'scripts/personal-fleet-firstplay/native/coopPersonalFleetChatGateway.js')
 result=w+c+arbiter.build(work)+atomic.build(work)+startup.build(work)+damage.build(work)+hostility.build(work)
 target_files={}
 for relative,src in ADDITIONS.items():
  if not src.is_file():raise ValueError('PF_FIRSTPLAY_SOURCE_MODULE_MISSING: '+str(src))
  target=work/relative
  if target.exists() or target.is_symlink():
   raise ValueError('PF_FIRSTPLAY_TARGET_ALREADY_EXISTS: '+str(relative))
  content=src.read_text(encoding='utf-8')
  if not content.startswith("'use strict';\n") or not content.endswith('\n'):
   raise ValueError('PF_FIRSTPLAY_MODULE_SOURCE_INVALID')
  result+=''.join(difflib.unified_diff([],content.splitlines(keepends=True),
    fromfile='/dev/null',tofile='b/'+str(relative)))
  target_files[str(relative)]=content
 patch_paths=[p[6:] for p in result.splitlines() if p.startswith('+++ b/')]
 if len(patch_paths)!=len(set(patch_paths)):
  raise ValueError('PF_FIRSTPLAY_DUPLICATE_NATIVE_PATCH_PATH')
 if set(patch_paths)!=EXPECTED_PATCH_PATHS:
  raise ValueError('PF_FIRSTPLAY_INCOMPLETE_FORTY_SIX_FILE_PATCH')
 return result,target_files

def build(work:Path,source:Path,manifest:Path,out:Path,*,apply=False,confirm=''):
 work,source,manifest,out=validate_paths(work,source,manifest,out,apply,confirm)
 baseline=read_changed_paths(work)
 if not baseline or len(baseline)!=22:
  raise ValueError('PF_FIRSTPLAY_EXPECTED_22_PF80_STAGED_PATHS: '+str(len(baseline)))
 # This is a REVIEW gate only for the PF80 candidate, not a claimed source install.
 native_patch,new_sources=make_patch(work,source,manifest)
 git(work,'apply','--whitespace=error','--check','-',input=native_patch)
 expected_added=EXPECTED_PATCH_PATHS-baseline
 if len(expected_added)!=42 or len(EXPECTED_PATCH_PATHS.intersection(baseline))!=4:
  raise ValueError('PF_FIRSTPLAY_PF80_OVERLAP_NOT_EXACT')
 result={'status':'REVIEW_ONLY','featureEnabled':False,'gameplayE2E':'NOT_RUN',
  'nativeInstall':'NOT_RUN','playTouched':False,'workBranch':git(work,'branch','--show-current'),
  'workHead':git(work,'rev-parse','HEAD'),
  'beforePaths':len(baseline),'afterPaths':None,
  'patchPaths':sorted(EXPECTED_PATCH_PATHS),
  'patchSha256':sha(native_patch.encode('utf-8')),
  'sourceModuleSha256':{k:sha(v.encode('utf-8')) for k,v in new_sources.items()},
  'nativeAuthorityWired':False,
  'pf87SourcePinned':True,
  'pf88OriginalServerStartupSourcePinned':True,
  'pf88StartupAuthorityImplemented':False,
  'pf87TransientIsolatedForSourceScopedNativeReceipts':True,
  'liveNpcOfferAuthorityWired':False}
 if apply:
  git(work,'apply','--whitespace=error','-',input=native_patch)
  final=read_changed_paths(work)
  if final!=baseline|expected_added:
   raise ValueError('PF_FIRSTPLAY_POST_APPLY_UNEXPECTED_FILE_SET')
  for relative,s in new_sources.items():
   if (work/relative).read_text(encoding='utf-8')!=s:
    raise ValueError('PF_FIRSTPLAY_NEW_SOURCE_BYTES_DRIFT')
  # Prefix-only flags remain OFF: installed candidate is not a runnable server.
  for relative in EXPECTED_PATCH_PATHS:
   check=subprocess.run(['node','--check',str(work/relative)],capture_output=True,text=True)
   if check.returncode:
    raise ValueError('PF_FIRSTPLAY_NATIVE_JS_SYNTAX_FAILED: '+relative+': '+check.stderr[:200])
  result.update(status='STAGED_IN_ISOLATED_WORK_NOT_GAMEPLAY',afterPaths=len(final),nativeInstall='STAGED_NOT_WIRED')
 out.mkdir(parents=True)
 (out/PATCH_NAME).write_text(native_patch,encoding='utf-8',newline='\n')
 (out/RECEIPT).write_text(json.dumps(result,indent=2,sort_keys=True)+'\n',encoding='utf-8')
 return result

def main():
 p=argparse.ArgumentParser(description=__doc__)
 p.add_argument('--worktree',required=True,type=Path)
 p.add_argument('--source-root',required=True,type=Path)
 p.add_argument('--pf62-manifest',required=True,type=Path)
 p.add_argument('--review-output',required=True,type=Path)
 p.add_argument('--apply-to-work',action='store_true')
 p.add_argument('--confirm-work-only',default='')
 a=p.parse_args()
 print(json.dumps(build(a.worktree,a.source_root,a.pf62_manifest,a.review_output,
  apply=a.apply_to_work,confirm=a.confirm_work_only),indent=2))
 print('Native runtime NOT wired; do not enable Personal Fleet or deploy to PLAY.')

if __name__=='__main__':
 try:main()
 except (ValueError,OSError,subprocess.CalledProcessError) as e:
  print(str(e),file=sys.stderr);sys.exit(1)
