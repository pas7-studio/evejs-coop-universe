"""PF99 exact source-bound live session witness / bindings archive tests."""
from pathlib import Path, PurePosixPath
import hashlib
import json
import re
import unittest

ROOT=Path(__file__).resolve().parents[1]
REPO=ROOT.parents[1]
WITNESS=ROOT/'native/coopPersonalFleetOriginalSessionWitness.js'
BINDINGS=ROOT/'native/coopPersonalFleetOriginalSessionBindings.js'
AUTH_TEST=ROOT/'tests/pf99-authenticated-original-session.test.cjs'
SQL_TEST=ROOT/'tests/pf99-source-bound-pf91-pf92-sqlite.test.cjs'
ENTRY=re.compile(r'^([0-9a-f]{64})  (.+)$')

class PF99NativeSessionIntegrity(unittest.TestCase):
    def test_archive_hashes_and_unique_paths(self):
        lines=(ROOT/'SHA256SUMS.txt').read_text(encoding='utf8').splitlines()
        self.assertGreaterEqual(len(lines),6)
        seen=set()
        for line in lines:
            match=ENTRY.fullmatch(line)
            self.assertIsNotNone(match,'PF99_SHA256_MANIFEST_BAD_LINE')
            digest,relative=match.groups()
            name=PurePosixPath(relative)
            self.assertFalse(name.is_absolute())
            self.assertNotIn('..',name.parts)
            self.assertNotIn(relative,seen)
            seen.add(relative)
            f=ROOT.joinpath(*name.parts)
            self.assertTrue(f.is_file() and not f.is_symlink())
            self.assertEqual(hashlib.sha256(f.read_bytes()).hexdigest(),
                             digest,'PF99_SOURCE_HASH_MISMATCH: '+relative)

    def test_real_original_session_registry_and_docking_are_source_bound(self):
        s=WITNESS.read_text(encoding='utf8')
        self.assertIn("require('../services/chat/sessionRegistry')",s)
        self.assertIn("require('../services/structure/structureLocation')",s)
        self.assertIn('registry.getSessions()',s)
        self.assertIn('registry.findSessionByCharacterID(characterID)!==session',s)
        self.assertIn("row.accountId",s)
        self.assertIn('session.userid',s)
        self.assertIn("reader.get('characters',String(characterID))",s)
        self.assertIn('socket.destroyed!==false',s)
        self.assertIn('request.stationID',s)
        self.assertIn('previousShipItemID',s)
        self.assertNotIn('createOriginalSessionWitness({',s)

    def test_pf91_pf92_can_only_use_canonical_production_callback(self):
        s=BINDINGS.read_text(encoding='utf8')
        self.assertIn("require('./coopPersonalFleetOriginalNativePermit.cjs')",s)
        self.assertIn("require('./coopPersonalFleetOriginalSessionWitness.js')",s)
        self.assertIn('verifyOriginalDockedPlayerSession:source.verifyOriginalDockedPlayerSession',s)
        self.assertIn('verifyOriginalSessionLease:source.verifyOriginalSessionLease',s)
        self.assertIn('PF99_NATIVE_SESSION_OWNER_DISABLED',s)
        self.assertNotIn('verifyOriginalDockedPlayerSession=()=>true',s)
        self.assertNotIn('verifyOriginalSessionLease=()=>true',s)
        self.assertNotIn('process.env.NODE_TEST_CONTEXT',s)

    def test_source_witness_never_registered_in_legacy_patch_applier(self):
        m=json.loads((REPO/'patches/upstream/MANIFEST.json').read_text(encoding='utf8'))
        names=[v.get('file','') for v in m.get('patches',[])]
        self.assertFalse(any('pf99' in name.lower() for name in names))

    def test_original_source_pins_and_sqlite_cases_are_in_native_tests(self):
        s=AUTH_TEST.read_text(encoding='utf8')
        self.assertIn('01892cb8f6e35ef46268eae5f2909fd96c4a2a51',s)
        self.assertIn('0e12ae00721359d526c4453529c81a16f337df22',s)
        self.assertIn('c1159a66622370cd1fd3f5963cddd5de7fe6a52e',s)
        self.assertIn('PF99_NATIVE_WORKTREE',s)
        self.assertEqual(s.count("test('"),22)
        sq=SQL_TEST.read_text(encoding='utf8')
        self.assertIn("require('../../pf58/tests/pf54-fixture.cjs')",sq)
        self.assertIn("require('../../pf58/native/coopPersonalFleetOriginalNativePermit.cjs')",sq)
        self.assertEqual(sq.count("test('"),11)
        runner=(ROOT/'Test-PF99-Local.ps1').read_text(encoding='utf8')
        self.assertIn('PF99_NATIVE_WORKTREE',runner)
        self.assertIn('PF99_SOURCE_BOUND_AUTHENTICATED_SESSION_TEST_FAILED',runner)

if __name__=='__main__':
    unittest.main()
