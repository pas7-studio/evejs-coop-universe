"""PF94 standalone SQLite owner epoch code and handoff files integrity."""
from pathlib import Path, PurePosixPath
import hashlib
import re
import unittest

ROOT=Path(__file__).resolve().parents[1]
LINE=re.compile(r'^([0-9a-f]{64})  (.+)$')

class PF94SourceIntegrity(unittest.TestCase):
    def test_manifest_matches_every_source(self):
        rows=(ROOT/'SHA256SUMS.txt').read_text(encoding='utf8').splitlines()
        self.assertGreaterEqual(len(rows),5)
        visited=set()
        for row in rows:
            match=LINE.fullmatch(row)
            self.assertIsNotNone(match,'PF94_SHA256_ENTRY_INVALID')
            checksum,relative=match.groups()
            p=PurePosixPath(relative)
            self.assertFalse(p.is_absolute())
            self.assertNotIn('..',p.parts)
            self.assertNotIn(relative,visited)
            visited.add(relative)
            file=ROOT.joinpath(*p.parts)
            self.assertTrue(file.is_file() and not file.is_symlink(),
                            'PF94_SOURCE_MISSING: '+relative)
            self.assertEqual(hashlib.sha256(file.read_bytes()).hexdigest(),
                             checksum,'PF94_SOURCE_HASH_MISMATCH: '+relative)

if __name__=='__main__':
    unittest.main()
