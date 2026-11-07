"""PF89: verify original inventory mutation evidence package hashes locally."""
import hashlib
from pathlib import Path, PurePosixPath
import re
import unittest

ROOT=Path(__file__).resolve().parents[1]
ENTRY=re.compile(r'^([0-9a-f]{64})  (.+)$')

class PF89Manifest(unittest.TestCase):
    def test_package_hashes_match_all_original_references(self):
        lines=(ROOT/'SHA256SUMS.txt').read_text(encoding='utf8').splitlines()
        self.assertGreaterEqual(len(lines),2)
        seen=set()
        for line in lines:
            match=ENTRY.fullmatch(line)
            self.assertIsNotNone(match,'PF89_INVALID_MANIFEST_ENTRY')
            expected,relative=match.groups()
            posix=PurePosixPath(relative)
            self.assertFalse(posix.is_absolute())
            self.assertNotIn('..',posix.parts)
            self.assertNotIn(relative,seen)
            seen.add(relative)
            source=ROOT.joinpath(*posix.parts)
            self.assertTrue(source.is_file() and not source.is_symlink(),
                            'PF89_SOURCE_MISSING: '+relative)
            self.assertEqual(hashlib.sha256(source.read_bytes()).hexdigest(),
                             expected,'PF89_SOURCE_DRIFT: '+relative)

if __name__=='__main__':
    unittest.main()
