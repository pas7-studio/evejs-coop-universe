"""PF92 original character owner candidate package SHA256 integrity."""
from pathlib import Path, PurePosixPath
import hashlib
import re
import unittest

ROOT=Path(__file__).resolve().parents[1]
LINE=re.compile(r'^([0-9a-f]{64})  (.+)$')

class PF92Archive(unittest.TestCase):
    def test_all_pf92_archive_items_have_expected_sha256(self):
        entries=(ROOT/'SHA256SUMS.txt').read_text(encoding='utf8').splitlines()
        self.assertGreaterEqual(len(entries),4)
        seen=set()
        for line in entries:
            match=LINE.fullmatch(line)
            self.assertIsNotNone(match,'PF92_BAD_SHA256_MANIFEST_LINE')
            expected,rel=match.groups()
            name=PurePosixPath(rel)
            self.assertFalse(name.is_absolute())
            self.assertNotIn('..',name.parts)
            self.assertNotIn(rel,seen)
            seen.add(rel)
            source=ROOT.joinpath(*name.parts)
            self.assertTrue(source.is_file() and not source.is_symlink(),
                            'PF92_ARCHIVE_SOURCE_MISSING: '+rel)
            self.assertEqual(hashlib.sha256(source.read_bytes()).hexdigest(),
                             expected,'PF92_ARCHIVE_SOURCE_CHANGED: '+rel)

if __name__=='__main__':
    unittest.main()
