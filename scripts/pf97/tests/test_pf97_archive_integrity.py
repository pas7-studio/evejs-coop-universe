"""PF97 original character & ItemStore review-only source archive invariants."""
from pathlib import Path, PurePosixPath
import hashlib
import json
import re
import unittest

ROOT=Path(__file__).resolve().parents[1]
REPO=ROOT.parents[1]
ENTRY=re.compile(r'^([0-9a-f]{64})  (.+)$')

class PF97ReviewOnlyIntegrity(unittest.TestCase):
    def test_manifest_attests_every_read_only_source(self):
        rows=(ROOT/'SHA256SUMS.txt').read_text(encoding='utf8').splitlines()
        self.assertGreaterEqual(len(rows),6)
        seen=set()
        for row in rows:
            match=ENTRY.fullmatch(row)
            self.assertIsNotNone(match,'PF97_BAD_MANIFEST_ENTRY')
            digest,name=match.groups()
            posix=PurePosixPath(name)
            self.assertFalse(posix.is_absolute())
            self.assertNotIn('..',posix.parts)
            self.assertNotIn(name,seen)
            seen.add(name)
            file=ROOT.joinpath(*posix.parts)
            self.assertTrue(file.is_file() and not file.is_symlink(),
                            'PF97_SOURCE_MISSING: '+name)
            self.assertEqual(hashlib.sha256(file.read_bytes()).hexdigest(),
                             digest,'PF97_SOURCE_HASH_MISMATCH: '+name)

    def test_original_character_and_item_patches_are_review_only(self):
        registry=json.loads((REPO/'patches/upstream/MANIFEST.json').read_text(encoding='utf8'))
        names=[p['file'] for p in registry['patches']]
        self.assertFalse(any('pf97' in n.lower() for n in names))
        for file in ['characterState.pf97.review-only.patch',
                     'itemStore.pf97.review-only.patch']:
            patch=(ROOT/'review'/file).read_text(encoding='utf8')
            self.assertEqual(patch.count('diff --git '),1)
            self.assertIn('@@ -',patch)
            self.assertEqual(patch.count('\n--- a/'),1)

    def test_character_writer_atomically_fences_all_stock_record_updates(self):
        patch=(ROOT/'review/characterState.pf97.review-only.patch').read_text(encoding='utf8')
        for token in [
          'PF97_PROTECTED_SHIP_FIELDS',
          'PF97_SHIP_IDENTITY_REQUIRES_NATIVE_CUSTODY',
          'PF97_CHARACTER_BEFORE_IMAGE_STALE',
          'coopAtomicNativeRows',
          'atomic.transact(["characters"],',
          'PF97_CHARACTER_DELETE_REQUIRES_NATIVE_OWNER',
          'NATIVE_GAMESTORE_COMMITTED_BUT_CACHE_UNSAFE',
          'const saved = writeCharacterRecord(charId, normalizedRecord)',
          'return null;',
        ]:
            self.assertIn(token,patch)
        self.assertIn('JSON.stringify(present) !== JSON.stringify(before)',patch)
        self.assertNotIn('supportsAtomicInstall:true',patch)

    def test_itemstore_does_not_provision_hulls_before_character_title_gate(self):
        patch=(ROOT/'review/itemStore.pf97.review-only.patch').read_text(encoding='utf8')
        for token in [
          'function ensureCharacterActiveShipItem(',
          'PF97_ITEMSTORE_SHIP_SYNC_REQUIRES_NATIVE_CUSTODY',
          'PF97_ITEMSTORE_ACTIVATION_REQUIRES_NATIVE_CUSTODY',
          'return null;',
        ]:
            self.assertIn(token,patch)
        self.assertIn('EVEJS_COOP_PERSONAL_FLEET_NATIVE_WITNESS',patch)

    def test_local_source_runner_requires_exact_pins_and_temp_apply(self):
        char=(ROOT/'tests/pf97-character-writer-source.test.cjs').read_text(encoding='utf8')
        item=(ROOT/'tests/pf97-itemstore-source.test.cjs').read_text(encoding='utf8')
        self.assertIn('8a002d190899b6cb1e1068a565451e6d1d808401',char)
        self.assertIn('e992d56ee9cff1911d54247bf46d44d01e5d8060',item)
        for source in [char,item]:
            self.assertIn("spawnSync('git',['apply','--check',",source)
            self.assertIn("fs.mkdtempSync(",source)
            self.assertIn("fs.rmSync(",source)
            self.assertIn("PF97_NATIVE_WORKTREE",source)
        self.assertEqual(char.count("test('"),18)
        self.assertEqual(item.count("test('"),7)
        run=(ROOT/'Test-PF97-Local.ps1').read_text(encoding='utf8')
        self.assertIn('PF97_NATIVE_WORKTREE',run)
        self.assertIn('PF97_ORIGINAL_CHARACTER_ITEMSTORE_SOURCE_TEST_FAILED',run)

if __name__=='__main__':
    unittest.main()
