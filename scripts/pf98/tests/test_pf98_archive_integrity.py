"""PF98 source-owned witness bridge and archive integrity."""
from pathlib import Path, PurePosixPath
import hashlib
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parents[1]
PERMIT = REPO/'scripts/pf58/native/coopPersonalFleetOriginalNativePermit.cjs'
ORIGINAL = REPO/'scripts/pf95/review/coopGameStoreAtomic.pf95.review-only.patch'
NATIVE_TEST = ROOT/'tests/pf98-native-owner-bridge.test.cjs'
RUNNER = ROOT/'Test-PF98-Local.ps1'
LINE = re.compile(r'^([a-f0-9]{64})  (.+)$')

class PF98OriginalSourceBridge(unittest.TestCase):
    def test_hashes_attest_every_source(self):
        lines = (ROOT/'SHA256SUMS.txt').read_text(encoding='utf-8').splitlines()
        self.assertGreaterEqual(len(lines),4)
        seen = set()
        for line in lines:
            match = LINE.fullmatch(line)
            self.assertIsNotNone(match, 'PF98_SHA256_MANIFEST_INVALID')
            digest,relative = match.groups()
            p=PurePosixPath(relative)
            self.assertFalse(p.is_absolute())
            self.assertNotIn('..',p.parts)
            self.assertNotIn(relative,seen)
            seen.add(relative)
            f=ROOT.joinpath(*p.parts)
            self.assertTrue(f.is_file() and not f.is_symlink(), 'PF98_SOURCE_MISSING: '+relative)
            self.assertEqual(hashlib.sha256(f.read_bytes()).hexdigest(),
                             digest,'PF98_SOURCE_HASH_MISMATCH: '+relative)

    def test_original_session_checks_require_native_owner_method_when_flag_on(self):
        source = PERMIT.read_text(encoding='utf-8')
        start=source.index('function verifyOriginalWitnessCannotWrite(')
        end=source.index('function createOriginalPlayerShipActivation(', start)
        bridge=source[start:end]
        self.assertIn("process.env.EVEJS_COOP_PERSONAL_FLEET_NATIVE_WITNESS==='1'",bridge)
        self.assertIn("tx?.verifyReadOnlySessionWitness",bridge)
        self.assertIn("PF98_ORIGINAL_SQLITE_OWNER_SESSION_WITNESS_REQUIRED",bridge)
        self.assertIn("tx.verifyReadOnlySessionWitness(callback,request)",bridge)
        self.assertIn("PF98_ASYNC_ORIGINAL_OWNER_WITNESS_FORBIDDEN",bridge)
        # Source-owned verification MUST be selected before PF93 hash fallback.
        self.assertLess(bridge.index("tx.verifyReadOnlySessionWitness(callback,request)"),
                        bridge.index('fingerprintOriginalWitnessRows(tx)'))
        self.assertIn('return verdict===true',bridge)

    def test_pf95_pf96_original_owner_review_has_sticky_commit_fence(self):
        source=ORIGINAL.read_text(encoding='utf-8')
        self.assertIn('verifyReadOnlySessionWitness(callback,request)',source)
        self.assertIn('PF96_ORIGINAL_SESSION_WITNESS_POISONED_BEFORE_COMMIT',source)
        self.assertIn('PF96_ORIGINAL_SESSION_WITNESS_DENIED_BEFORE_COMMIT',source)
        self.assertIn('witnessRunning',source)
        self.assertIn('EVEJS_COOP_PERSONAL_FLEET_NATIVE_WITNESS',source)

    def test_pf98_uses_real_node_sqlite_fixture_and_keeps_original_fork_untouched(self):
        source=NATIVE_TEST.read_text(encoding='utf-8')
        self.assertIn("require('../../pf58/tests/pf54-fixture.cjs')",source)
        self.assertIn("require('../../pf58/native/coopPersonalFleetOriginalNativePermit.cjs')",source)
        self.assertIn('PF98_ORIGINAL_SQLITE_OWNER_SESSION_WITNESS_REQUIRED',source)
        self.assertEqual(source.count("test('"),12)
        self.assertIn('PF98_NATIVE_SOURCE_WITNESS_BRIDGE_FAILED',RUNNER.read_text(encoding='utf-8'))

if __name__ == '__main__':
    unittest.main()
