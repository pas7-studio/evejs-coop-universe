"""PF88 original writer coverage: no stock hook may be inferred from a mock."""
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[2]
PERMIT=ROOT/'pf58/native/coopPersonalFleetOriginalNativePermit.cjs'
BOOT=ROOT/'pf58/native/coopPersonalFleetNativeBootstrap.cjs'
PF62=ROOT/'pf62/build_native_review_bundle.py'
PF80=ROOT/'pf62/Prepare-PF80-CompleteNativeWork.ps1'
RUNNER=ROOT/'pf58/Test-PF58-Local.ps1'
AUDIT=ROOT/'pf88/inspect-original-writer-hooks.cjs'

class PF88ReciprocalOriginalWriterGates(unittest.TestCase):
    def test_writer_policy_is_bundled_with_existing_native_permit(self):
        source=PERMIT.read_text(encoding='utf8')
        bundle=PF62.read_text(encoding='utf8')
        self.assertIn('createReciprocalWriterFence',source)
        self.assertIn('createReciprocalWriterFence};',source)
        self.assertIn('pf58/native/coopPersonalFleetOriginalNativePermit.cjs',bundle)
        self.assertIn('PF88_ONE_SHOT_OR_TERMINAL_CUSTODY',source)
        self.assertIn('PF88_PF52_SHIP_RESERVED',source)
        self.assertIn('PF88_NATIVE_ACTOR_CLAIMED',source)
        self.assertIn('CLEAR_IN_SAME_TRANSACTION',source)
        self.assertIn('externalDestination',source)

    def test_missing_original_hooks_default_disable_source_bound_bootstrap(self):
        source=BOOT.read_text(encoding='utf8')
        self.assertIn("typeof verifyOriginalWriterHooks==='function'",source)
        self.assertIn('verifyOriginalWriterHooks()===true',source)
        self.assertIn('allWritersFenced:fenced',source)
        self.assertIn('checkForeignWriterWithinTransaction:',source)
        self.assertIn('atomicOriginalTransfer:true',source)

    def test_manual_preflight_tests_writer_denials_before_native_work_tree(self):
        code=PF80.read_text(encoding='utf8')
        self.assertIn('PF88_RECIPROCAL_WRITER_GATE_FAILED',code)
        self.assertLess(code.index('& $node --test --test-concurrency=1 @pf88Tests'),
                        code.index('& $python $script @argsForPython'))
        local=RUNNER.read_text(encoding='utf8')
        self.assertIn('pf88-reciprocal-writers.test.cjs',local)
        self.assertIn('pf88-sourcebound-gating.test.cjs',local)

    def test_original_source_audit_does_not_issue_release_authority(self):
        source=AUDIT.read_text(encoding='utf8')
        self.assertIn("status:'BLOCKED_FOR_ACTIVATION'",source)
        self.assertIn('releaseAuthority:false',source)
        self.assertIn('process.exitCode=2',source)
        self.assertIn('PF88_TWO_CLIENT_GAMEPLAY_NOT_RUN',source)
        self.assertIn('PF88_LIVE_OR_DEPLOYMENT_ROOT_FORBIDDEN',source)

if __name__=='__main__':
    unittest.main()
