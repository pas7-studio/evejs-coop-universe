"""PF86: manually verify every PF58 source archive hash before native WORK review."""
import hashlib
from pathlib import Path, PurePosixPath
import re
import unittest

ROOT=Path(__file__).resolve().parents[1]
MANIFEST=ROOT/'SHA256SUMS.txt'
ENTRY=re.compile(r'^([0-9a-f]{64})  (.+)$')

class PF86ArchiveManifestTests(unittest.TestCase):
    def test_all_pf58_source_files_match_recorded_sha256(self):
        rows=[line for line in MANIFEST.read_text(encoding='utf8').splitlines() if line.strip()]
        self.assertGreaterEqual(len(rows),34,'PF86_MANIFEST_INCOMPLETE')
        seen=set()
        for line in rows:
            match=ENTRY.fullmatch(line)
            self.assertIsNotNone(match,'PF86_INVALID_MANIFEST_LINE: '+line)
            expected,relative=match.groups()
            parts=PurePosixPath(relative)
            self.assertFalse(parts.is_absolute(),'PF86_MANIFEST_ABSOLUTE_PATH')
            self.assertNotIn('..',parts.parts,'PF86_MANIFEST_TRAVERSAL')
            self.assertNotIn(relative,seen,'PF86_MANIFEST_DUPLICATE_PATH')
            seen.add(relative)
            target=ROOT.joinpath(*parts.parts)
            self.assertTrue(target.is_file() and not target.is_symlink(),
                            'PF86_MANIFEST_SOURCE_MISSING: '+relative)
            actual=hashlib.sha256(target.read_bytes()).hexdigest()
            self.assertEqual(actual,expected,'PF86_SOURCE_HASH_DRIFT: '+relative)

if __name__=='__main__':
    unittest.main()
