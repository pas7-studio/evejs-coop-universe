"""PF95 read-only original GameStore review-only diff and archive integrity."""
from pathlib import Path, PurePosixPath
import hashlib
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parents[1]
MANIFEST = ROOT / 'SHA256SUMS.txt'
PATCH = ROOT / 'review/coopGameStoreAtomic.pf95.review-only.patch'
SOURCE = ROOT / 'tests/pf95-original-game-store-epoch.test.cjs'
RUNNER = ROOT / 'Test-PF95-Local.ps1'
UPSTREAM = REPO / 'patches/upstream/MANIFEST.json'
LINE = re.compile(r'^([0-9a-f]{64})  (.+)$')

class PF95ReviewOnlyIntegrity(unittest.TestCase):
    def test_verified_sha256_archive_is_complete_and_unique(self):
        records = MANIFEST.read_text(encoding='utf8').splitlines()
        self.assertGreaterEqual(len(records),5)
        seen = set()
        for record in records:
            match = LINE.fullmatch(record)
            self.assertIsNotNone(match, 'PF95_MANIFEST_LINE_INVALID')
            digest, rel = match.groups()
            name = PurePosixPath(rel)
            self.assertFalse(name.is_absolute())
            self.assertNotIn('..', name.parts)
            self.assertNotIn(rel,seen)
            seen.add(rel)
            file = ROOT.joinpath(*name.parts)
            self.assertTrue(file.is_file() and not file.is_symlink())
            self.assertEqual(hashlib.sha256(file.read_bytes()).hexdigest(),digest)

    def test_patch_is_never_registered_with_legacy_upstream_installer(self):
        registry = UPSTREAM.read_text(encoding='utf8')
        self.assertNotIn('pf95-original-sqlite',registry)
        self.assertNotIn('coopGameStoreAtomic.pf95.review-only.patch',registry)

    def test_proposed_native_sqlite_owner_updates_only_one_file(self):
        patch = PATCH.read_text(encoding='utf8')
        self.assertEqual(patch.count('diff --git '),1)
        self.assertIn('a/server/src/space/coopGameStoreAtomic.js',patch)
        self.assertIn('PF95_ORIGINAL_SESSION_WITNESS_WRITE_ATTEMPT_ROLLBACK',patch)
        self.assertIn('PF95_NATIVE_TRANSACTION_CLOSED',patch)
        self.assertIn('EVEJS_COOP_PERSONAL_FLEET_NATIVE_WITNESS',patch)
        self.assertIn('mutationEpoch++',patch)
        self.assertIn('txLive=false',patch)

    def test_tests_are_exactly_source_pinned_and_worktree_read_only(self):
        source=SOURCE.read_text(encoding='utf8')
        self.assertIn('2b28b48145f3fbc989ce7346384487ee75e52280',source)
        self.assertIn("git',['apply','--check',patch]",source)
        self.assertIn("git',['apply',patch]",source)
        self.assertIn("fs.mkdtempSync(",source)
        self.assertIn("fs.rmSync(",source)
        self.assertIn("PF95_NATIVE_WORKTREE",source)
        self.assertGreaterEqual(source.count("test('"),12)
        self.assertIn("PF95_NATIVE_WORKTREE",RUNNER.read_text(encoding='utf8'))

if __name__=='__main__':
    unittest.main()
