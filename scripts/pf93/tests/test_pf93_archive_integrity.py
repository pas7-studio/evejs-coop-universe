"""PF93 candidate native original witness archive integrity, no engine writes."""
from pathlib import Path, PurePosixPath
import hashlib
import re
import unittest

ROOT=Path(__file__).resolve().parents[1]
LINE=re.compile(r'^([0-9a-f]{64})  (.+)$')

class PF93ArchiveIntegrity(unittest.TestCase):
    def test_local_witness_source_hashes_are_exact(self):
        lines=(ROOT/'SHA256SUMS.txt').read_text(encoding='utf8').splitlines()
        self.assertGreaterEqual(len(lines),4)
        seen=set()
        for line in lines:
            m=LINE.fullmatch(line)
            self.assertIsNotNone(m,'PF93_SHA256_ENTRY_INVALID')
            expected,rel=m.groups()
            p=PurePosixPath(rel)
            self.assertFalse(p.is_absolute())
            self.assertNotIn('..',p.parts)
            self.assertNotIn(rel,seen)
            seen.add(rel)
            file=ROOT.joinpath(*p.parts)
            self.assertTrue(file.is_file() and not file.is_symlink(),
                            'PF93_SOURCE_MISSING: '+rel)
            self.assertEqual(hashlib.sha256(file.read_bytes()).hexdigest(),
                             expected,'PF93_SOURCE_HASH_MISMATCH: '+rel)

if __name__=='__main__':
    unittest.main()
