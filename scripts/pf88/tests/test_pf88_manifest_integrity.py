"""PF88 portable archive integrity: every listed source must match SHA256."""
from pathlib import Path,PurePosixPath
import hashlib
import re
import unittest

ROOT=Path(__file__).resolve().parents[1]
ENTRY=re.compile(r'^([a-f0-9]{64})  (.+)$')

class PF88ArchiveIntegrity(unittest.TestCase):
    def test_all_sources_match_sha256_manifest(self):
        listing=(ROOT/'SHA256SUMS.txt').read_text(encoding='utf8').splitlines()
        self.assertGreaterEqual(len(listing),5)
        seen=set()
        for row in listing:
            match=ENTRY.fullmatch(row)
            self.assertIsNotNone(match,'PF88_BAD_MANIFEST_LINE: '+row)
            expected,relative=match.groups()
            path=PurePosixPath(relative)
            self.assertFalse(path.is_absolute())
            self.assertNotIn('..',path.parts)
            self.assertNotIn(relative,seen,'PF88_DUPLICATE_SOURCE')
            seen.add(relative)
            file=ROOT.joinpath(*path.parts)
            self.assertTrue(file.is_file() and not file.is_symlink(),
                            'PF88_SOURCE_MISSING: '+relative)
            self.assertEqual(hashlib.sha256(file.read_bytes()).hexdigest(),expected,
                             'PF88_SOURCE_DRIFT: '+relative)

if __name__=='__main__':
    unittest.main()
