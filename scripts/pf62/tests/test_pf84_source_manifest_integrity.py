"""PF84: manual fail-closed validation of the PF62 SHA256 source manifest."""
import hashlib
from pathlib import Path, PurePosixPath
import re
import unittest

ROOT = Path(__file__).resolve().parents[3]
MANIFEST = ROOT / 'scripts' / 'pf62' / 'SHA256SUMS.txt'
ENTRY = re.compile(r'^([0-9a-f]{64})  (.+)

class NativeManifestIntegrityTests(unittest.TestCase):
    def test_sha256_manifest_matches_all_checked_in_files(self):
        lines = [line for line in MANIFEST.read_text(encoding='utf-8').splitlines()
                 if line.strip()]
        self.assertGreaterEqual(len(lines), 17, 'PF84_MANIFEST_UNEXPECTEDLY_SHORT')
        seen = set()
        for line in lines:
            match = ENTRY.fullmatch(line)
            self.assertIsNotNone(match, 'PF84_MANIFEST_ENTRY_INVALID: ' + line)
            expected, relative = match.groups()
            path = PurePosixPath(relative)
            self.assertFalse(path.is_absolute(), 'PF84_ABSOLUTE_MANIFEST_PATH')
            self.assertNotIn('..', path.parts, 'PF84_MANIFEST_TRAVERSAL')
            self.assertNotIn(relative, seen, 'PF84_DUPLICATE_MANIFEST_PATH')
            seen.add(relative)
            absolute = ROOT.joinpath(*path.parts)
            self.assertTrue(absolute.is_file() and not absolute.is_symlink(),
                            'PF84_SOURCE_MISSING_OR_SYMLINK: ' + relative)
            actual = hashlib.sha256(absolute.read_bytes()).hexdigest()
            self.assertEqual(expected, actual, 'PF84_SOURCE_DRIFT: ' + relative)

if __name__ == '__main__':
    unittest.main()
)

class NativeManifestIntegrityTests(unittest.TestCase):
    def test_sha256_manifest_matches_all_checked_in_files(self):
        lines = [line for line in MANIFEST.read_text(encoding='utf-8').splitlines()
                 if line.strip()]
        self.assertGreaterEqual(len(lines), 17, 'PF84_MANIFEST_UNEXPECTEDLY_SHORT')
        seen = set()
        for line in lines:
            match = ENTRY.fullmatch(line)
            self.assertIsNotNone(match, 'PF84_MANIFEST_ENTRY_INVALID: ' + line)
            expected, relative = match.groups()
            path = PurePosixPath(relative)
            self.assertFalse(path.is_absolute(), 'PF84_ABSOLUTE_MANIFEST_PATH')
            self.assertNotIn('..', path.parts, 'PF84_MANIFEST_TRAVERSAL')
            self.assertNotIn(relative, seen, 'PF84_DUPLICATE_MANIFEST_PATH')
            seen.add(relative)
            absolute = ROOT.joinpath(*path.parts)
            self.assertTrue(absolute.is_file() and not absolute.is_symlink(),
                            'PF84_SOURCE_MISSING_OR_SYMLINK: ' + relative)
            actual = hashlib.sha256(absolute.read_bytes()).hexdigest()
            self.assertEqual(expected, actual, 'PF84_SOURCE_DRIFT: ' + relative)

if __name__ == '__main__':
    unittest.main()
