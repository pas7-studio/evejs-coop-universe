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
 def test_expected_native_patch_inventory_is_twenty_eight_paths(self):
  self.assertEqual(len(m.EXPECTED_PATCH_PATHS),46)
  self.assertTrue(m.EXPECTED_PATCH_PATHS.issuperset(str(x) for x in m.ADDITIONS))
 def test_unique_original_native_patch_sources(self):
  source=(Path(__file__).resolve().parents[1]/'tools/prepare_firstplay_work.py').read_text()
  self.assertEqual(source.count('arbiter.build(work)'),1)
  self.assertEqual(source.count('atomic.build(work)'),1)
  self.assertEqual(source.count('startup.build(work)'),1)
  self.assertEqual(source.count('build_original_server_startup_patch.py'),1)
  self.assertEqual(source.count('build_original_atomic_entity_contract_patch.py'),1)
  self.assertEqual(source.count('build_original_order_arbiter_patch.py'),1)
  self.assertIn('PF_FIRSTPLAY_DUPLICATE_NATIVE_PATCH_PATH',source)
  self.assertEqual(len(m.EXPECTED_PATCH_PATHS),46)
 def test_source_bound_dock_readback_must_be_in_complete_work_bundle(self):
  self.assertIn('Code/server/src/space/coopPersonalFleetOriginalDockCompletionWitness.js',m.EXPECTED_PATCH_PATHS)
  self.assertEqual(len(m.ADDITIONS),34)
 def test_terminal_cleanup_coordinator_is_in_native_patch_inventory(self):
  self.assertIn('Code/server/src/space/coopPersonalFleetOriginalTerminalDockSources.js',m.EXPECTED_PATCH_PATHS)
  self.assertIn('Code/server/src/space/coopPersonalFleetOriginalDockCoordinator.js',m.EXPECTED_PATCH_PATHS)
 def test_original_station_tick_dwell_is_part_of_native_patch(self):
  self.assertIn('Code/server/src/space/coopPersonalFleetOriginalStationDwell.js',m.EXPECTED_PATCH_PATHS)
  self.assertEqual(len(m.ADDITIONS),34)
 def test_source_owned_station_server_tick_driver_is_part_of_exact_work_delta(self):
  self.assertIn('Code/server/src/space/coopPersonalFleetOriginalStationTickDriver.js',m.EXPECTED_PATCH_PATHS)
  self.assertEqual(len(m.ADDITIONS),34)
 def test_source_pinned_native_entity_isolation_is_in_work_bundle(self):
  self.assertIn('Code/server/src/space/coopPersonalFleetNativeEntityIsolation.js',m.EXPECTED_PATCH_PATHS)
  self.assertIn('Code/server/src/space/coopGameStoreAtomic.js',m.EXPECTED_PATCH_PATHS)
  self.assertNotIn('Code/server/src/gameStore/index.js',m.EXPECTED_PATCH_PATHS)
  self.assertEqual(len(m.ADDITIONS),34)
 def test_original_entrypoint_is_source_pinned_and_in_firstplay_patch(self):
  self.assertIn('Code/server/index.js',m.EXPECTED_PATCH_PATHS)
  self.assertIn('Code/server/src/space/coopPersonalFleetOriginalWorkStarter.js',m.EXPECTED_PATCH_PATHS)
  self.assertEqual(len(m.ADDITIONS),34)
  self.assertEqual(len(m.EXPECTED_PATCH_PATHS),46)
 def test_pf89_native_wreck_loss_source_is_part_of_original_bundle(self):
  self.assertIn('Code/server/src/space/coopPersonalFleetOriginalLossRows.js',m.EXPECTED_PATCH_PATHS)
  self.assertEqual(len(m.ADDITIONS),34)
 def test_pf90_original_durable_physical_restore_is_staged(self):
  self.assertIn('Code/server/src/space/coopPersonalFleetOriginalPhysicalRecovery.js',m.EXPECTED_PATCH_PATHS)
  self.assertEqual(len(m.ADDITIONS),34)
 def test_pf91_authoritative_original_salary_source_included(self):
  self.assertIn('Code/server/src/space/coopPersonalFleetOriginalSalaryTerms.js',m.EXPECTED_PATCH_PATHS)
  self.assertEqual(len(m.ADDITIONS),34)
 def test_pf92_original_payroll_consent_is_included_in_native_work_patch(self):
  self.assertIn('Code/server/src/space/coopPersonalFleetOriginalPayrollConsent.js',m.EXPECTED_PATCH_PATHS)
  self.assertEqual(len(m.ADDITIONS),34)
 def test_pf93_native_salary_scheduler_uses_original_work_source(self):
  self.assertIn('Code/server/src/space/coopPersonalFleetOriginalPayrollScheduler.js',m.EXPECTED_PATCH_PATHS)
  self.assertEqual(len(m.ADDITIONS),34)
 def test_pf94_original_warp_proof_and_resumer_are_included(self):
  self.assertIn('Code/server/src/space/coopPersonalFleetOriginalIngressProof.js',m.EXPECTED_PATCH_PATHS)
  self.assertIn('Code/server/src/space/coopPersonalFleetOriginalIngressRecovery.js',m.EXPECTED_PATCH_PATHS)
  self.assertEqual(len(m.ADDITIONS),34)
 def test_pf95_stock_combat_target_and_receipt_are_in_native_work(self):
  self.assertIn('Code/server/src/space/coopPersonalFleetOriginalCombatAuthority.js',m.EXPECTED_PATCH_PATHS)
  self.assertIn('Code/server/src/space/coopPersonalFleetOriginalCombatReceipt.js',m.EXPECTED_PATCH_PATHS)
  self.assertEqual(len(m.ADDITIONS),34)
 def test_pf96_original_combat_recovery_is_in_native_work(self):
  self.assertIn('Code/server/src/space/coopPersonalFleetOriginalCombatRecovery.js',m.EXPECTED_PATCH_PATHS)
  self.assertEqual(len(m.ADDITIONS),34)
 def test_pf97_original_applied_damage_and_native_friendly_guard_hooks_in_work(self):
  self.assertIn('Code/server/src/space/coopPersonalFleetOriginalGuardAggression.js',m.EXPECTED_PATCH_PATHS)
  self.assertIn('Code/server/src/space/coopPersonalFleetOriginalGuardReaction.js',m.EXPECTED_PATCH_PATHS)
  self.assertIn('Code/server/src/space/combat/killmailTracker.js',m.EXPECTED_PATCH_PATHS)
  self.assertIn('Code/server/src/space/npc/npcBehaviorLoop.js',m.EXPECTED_PATCH_PATHS)
  self.assertEqual(len(m.ADDITIONS),34)
 def test_pf102_catalog_proof_must_ship_in_exact_native_source_inventory(self):
  self.assertIn('Code/server/src/space/coopPersonalFleetOriginalCatalogProof.js',
    m.EXPECTED_PATCH_PATHS)
  self.assertIn(Path('Code/server/src/space/coopPersonalFleetOriginalCatalogProof.js'),
    m.ADDITIONS)
  self.assertEqual(len(m.ADDITIONS),34)
  self.assertEqual(len(m.EXPECTED_PATCH_PATHS),46)
 def test_pf102b_real_original_configuration_is_in_native_work_patch(self):
  self.assertIn('Code/server/src/space/coopPersonalFleetOriginalWorkConfiguration.js',
    m.EXPECTED_PATCH_PATHS)
  self.assertIn(Path('Code/server/src/space/coopPersonalFleetOriginalWorkConfiguration.js'),
    m.ADDITIONS)
  self.assertEqual(len(m.ADDITIONS),34)
  self.assertEqual(len(m.EXPECTED_PATCH_PATHS),46)
 def test_pf103_native_original_war_claim_and_writer_boundary_installed(self):
  self.assertIn('Code/server/src/space/coopPersonalFleetOriginalWarClaim.js',
    m.EXPECTED_PATCH_PATHS)
  self.assertIn('Code/server/src/space/coopPersonalFleetOriginalNativeWriterBoundary.js',
    m.EXPECTED_PATCH_PATHS)
  self.assertIn(Path('Code/server/src/space/coopPersonalFleetOriginalWarClaim.js'),
    m.ADDITIONS)
  self.assertIn(Path('Code/server/src/space/coopPersonalFleetOriginalNativeWriterBoundary.js'),
    m.ADDITIONS)
  self.assertEqual(len(m.ADDITIONS),34)
  self.assertEqual(len(m.EXPECTED_PATCH_PATHS),46)
 def test_pf104_authored_real_sde_policy_in_native_package(self):
  self.assertIn('Code/server/src/space/coopPersonalFleetOriginalAuthoredPolicy.js',
    m.EXPECTED_PATCH_PATHS)
  self.assertIn(Path('Code/server/src/space/coopPersonalFleetOriginalAuthoredPolicy.js'),
    m.ADDITIONS)
  self.assertEqual(len(m.ADDITIONS),34)
  self.assertEqual(len(m.EXPECTED_PATCH_PATHS),46)
 def test_pf105_canonical_original_claims_parser_is_in_native_package(self):
  self.assertIn('Code/server/src/space/coopPersonalFleetOriginalClaimsPolicy.js',
    m.EXPECTED_PATCH_PATHS)
  self.assertIn(Path('Code/server/src/space/coopPersonalFleetOriginalClaimsPolicy.js'),
    m.ADDITIONS)
  self.assertEqual(len(m.ADDITIONS),34)
  self.assertEqual(len(m.EXPECTED_PATCH_PATHS),46)
 def test_pf106_original_foreign_item_mutation_gate_source_pinned(self):
  self.assertIn('Code/server/src/space/coopPersonalFleetOriginalForeignItemWriterGateway.js',
    m.EXPECTED_PATCH_PATHS)
  self.assertIn(Path('Code/server/src/space/coopPersonalFleetOriginalForeignItemWriterGateway.js'),
    m.ADDITIONS)
  self.assertEqual(len(m.ADDITIONS),34)
  self.assertEqual(len(m.EXPECTED_PATCH_PATHS),46)
 def test_worktree_branch_must_be_isolated(self):
  self.git(self.work,'switch','-c','unsafe')
  with self.assertRaisesRegex(ValueError,'ISOLATED_WORK_BRANCH_REQUIRED'):
   m.validate_paths(self.work,self.source,self.manifest,self.output,False,'')

if __name__=='__main__':unittest.main()
