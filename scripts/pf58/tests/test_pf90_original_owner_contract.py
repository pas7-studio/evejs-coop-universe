"""PF90 verifies original stock owner snapshot atomic constraints in candidate code."""
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[2]
POLICY=ROOT/'pf58/native/coopPersonalFleetOriginalNativePermit.cjs'
BOOT=ROOT/'pf58/native/coopPersonalFleetNativeBootstrap.cjs'
PF80=ROOT/'pf62/Prepare-PF80-CompleteNativeWork.ps1'
PF58=ROOT/'pf58/Test-PF58-Local.ps1'
PF90=ROOT/'pf90/inspect-original-owner-writes.cjs'
NATIVE_TEST=ROOT/'pf90/tests/pf90-original-owners.test.cjs'
SNAP_TEST=ROOT/'pf58/tests/pf90-owner-snapshot.test.cjs'

class PF90OriginalOwner(unittest.TestCase):
    def test_stale_original_snapshot_is_checked_within_native_transaction(self):
        s=POLICY.read_text(encoding='utf8')
        self.assertIn('function commitOriginalOwnerSnapshot({tx,writer,expectedBefore,nextItems,',s)
        self.assertIn("inputCurrent=tx.get('items','items')",s)
        self.assertIn('PF90_ORIGINAL_OWNER_STALE_SNAPSHOT',s)
        self.assertIn('PF90_NON_JSON_OWNER_SNAPSHOT',s)
        self.assertIn('mutateOriginalItemsInTransaction({tx,writer,declaredItemIDs,',s)
        self.assertIn('commitOriginalOwnerSnapshot});',s)

    def test_bootstrap_uses_original_single_owner_policy_without_legacy_fallback(self):
        s=BOOT.read_text(encoding='utf8')
        self.assertIn('commitStockOwnerSnapshotWithinTransaction:',s)
        self.assertIn('foreignWriterFence.commitOriginalOwnerSnapshot',s)
        self.assertIn("typeof verifyOriginalWriterHooks==='function'",s)
        self.assertIn('atomicOriginalTransfer:true',s)

    def test_native_source_audit_refuses_release_and_covers_both_writer_owners(self):
        s=PF90.read_text(encoding='utf8')
        for name in ['STOCK_ITEMS_OWNER','STOCK_CHARACTERS_OWNER',
                     'GAMESTORE_CACHE_AND_FLUSH','GAMESTORE_OWNER_REPOSITORY',
                     'GAMESTORE_NATIVE_ATOMIC']:
            self.assertIn(name,s)
        self.assertIn("status:'BLOCKED_FOR_ACTIVATION'",s)
        self.assertIn('releaseAuthority:false',s)
        self.assertIn('process.exitCode=2',s)
        self.assertIn('PF90_STOCK_OWNER_COMMIT_AND_CACHE_ROLLBACK_NOT_PROVEN',s)

    def test_work_preflight_runs_owner_cache_proof_before_native_patch(self):
        ps=PF80.read_text(encoding='utf8')
        self.assertIn('PF90_ORIGINAL_OWNER_SOURCE_REGRESSION_FAILED',ps)
        self.assertIn('PF90_ORIGINAL_OWNER_INTEGRATION_REVIEW_REQUIRED',ps)
        self.assertLess(ps.index('& $node --test --test-concurrency=1 $pf90Owner $pf90Sources'),
                        ps.index('& $python $script @argsForPython'))
        self.assertIn('pf90-owner-snapshot.test.cjs',PF58.read_text(encoding='utf8'))
        self.assertGreaterEqual(SNAP_TEST.read_text(encoding='utf8').count("test('"),16)
        self.assertGreaterEqual(NATIVE_TEST.read_text(encoding='utf8').count("test('"),8)

if __name__=='__main__':
    unittest.main()
