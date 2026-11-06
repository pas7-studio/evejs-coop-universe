"""PF90 local source archive SHA256 integrity; no native source modifications."""
from pathlib import Path, PurePosixPath
import hashlib
import re
import unittest

ROOT=Path(__file__).resolve().parents[1]
ENTRY=re.compile(r'^([0-9a-f]{64})  (.+)$')

class PF90Archive(unittest.TestCase):
    def test_all_source_records_match_manifest(self):
        lines=(ROOT/'SHA256SUMS.txt').read_text(encoding='utf8').splitlines()
        self.assertGreaterEqual(len(lines),3)
        seen=set()
        for entry in lines:
            match=ENTRY.fullmatch(entry)
            self.assertIsNotNone(match,'PF90_MALFORMED_MANIFEST_ENTRY')
            digest,rel=match.groups()
            p=PurePosixPath(rel)
            self.assertFalse(p.is_absolute())
            self.assertNotIn('..',p.parts)
            self.assertNotIn(rel,seen,'PF90_DUPLICATE_SOURCE')
            seen.add(rel)
            raw=ROOT.joinpath(*p.parts)
            self.assertTrue(raw.is_file() and not raw.is_symlink(),
                            'PF90_UNAVAILABLE_SOURCE: '+rel)
            self.assertEqual(hashlib.sha256(raw.read_bytes()).hexdigest(),
                             digest,'PF90_SOURCE_HASH_MISMATCH: '+rel)

if __name__=='__main__':
    unittest.main()
