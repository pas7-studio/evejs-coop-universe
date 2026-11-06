"""PF91 source hash manifest validation; never writes original EveJS."""
from pathlib import Path, PurePosixPath
import hashlib
import re
import unittest

ROOT=Path(__file__).resolve().parents[1]
LINE=re.compile(r'^([0-9a-f]{64})  (.+)$')

class PF91ArchiveIntegrity(unittest.TestCase):
    def test_all_pf91_archive_files_hash_to_manifest(self):
        lines=(ROOT/'SHA256SUMS.txt').read_text(encoding='utf8').splitlines()
        self.assertGreaterEqual(len(lines),4)
        seen=set()
        for line in lines:
            match=LINE.fullmatch(line)
            self.assertIsNotNone(match,'PF91_BAD_SHA256SUMS_LINE')
            digest,rel=match.groups()
            name=PurePosixPath(rel)
            self.assertFalse(name.is_absolute())
            self.assertNotIn('..',name.parts)
            self.assertNotIn(rel,seen)
            seen.add(rel)
            file=ROOT.joinpath(*name.parts)
            self.assertTrue(file.is_file() and not file.is_symlink(),
                            'PF91_MISSING_SOURCE: '+rel)
            self.assertEqual(hashlib.sha256(file.read_bytes()).hexdigest(),
                             digest,'PF91_CHANGED_SOURCE: '+rel)

if __name__=='__main__':
    unittest.main()
