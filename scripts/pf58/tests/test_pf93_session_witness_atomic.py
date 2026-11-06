"""PF93: complete SQLite witness read set and fail-closed original writer."""
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[2]
NATIVE=ROOT/'pf58/native/coopPersonalFleetOriginalNativePermit.cjs'
PF93TEST=ROOT/'pf58/tests/pf93-native-session-tx-isolation.test.cjs'
SOURCE=ROOT/'pf93/tests/pf93-original-sqlite-writer-source.test.cjs'
PF80=ROOT/'pf62/Prepare-PF80-CompleteNativeWork.ps1'
PF58=ROOT/'pf58/Test-PF58-Local.ps1'

class PF93SessionWitnessAtomic(unittest.TestCase):
    def test_three_original_native_sqlite_owner_tables_are_fingerprinted(self):
        s=NATIVE.read_text(encoding='utf8')
        self.assertIn("ORIGINAL_WITNESS_TABLES=Object.freeze([T,'items','characters'])",s)
        self.assertIn('function fingerprintOriginalWitnessRows(tx)',s)
        self.assertIn("const rows=tx.scan(table)",s)
        self.assertIn("hash=crypto.createHash('sha256')",s)
        self.assertIn("PF93_ORIGINAL_WITNESS_SCAN_LIMIT",s)
        self.assertIn("PF93_ORIGINAL_ROWSET_SCAN_REQUIRED",s)

    def test_failed_witness_mutating_any_original_row_rolls_back(self):
        s=NATIVE.read_text(encoding='utf8')
        self.assertIn('function verifyOriginalWitnessCannotWrite(tx,callback,request)',s)
        self.assertIn('const before=fingerprintOriginalWitnessRows(tx)',s)
        self.assertIn('const after=fingerprintOriginalWitnessRows(tx)',s)
        self.assertIn('PF93_SESSION_WITNESS_MUTATED_ORIGINAL_SQLITE_ROLLBACK',s)
        self.assertIn("PF93_ASYNC_SESSION_WITNESS_FORBIDDEN",s)
        self.assertIn('const reader=Object.freeze({',s)
        self.assertIn('if(issue)throw issue;',s)
        self.assertLess(s.index('const after=fingerprintOriginalWitnessRows(tx)'),
                        s.index('if(issue)throw issue;'))

    def test_pf91_original_player_activation_uses_same_witness_gate_twice(self):
        s=NATIVE.read_text(encoding='utf8')
        scope=s[s.index('function createOriginalPlayerShipActivation({'):
                s.index('function createOriginalCharacterRecordWriteBarrier({')]
        self.assertEqual(scope.count('verifyOriginalWitnessCannotWrite(tx,'),2)
        self.assertIn('PF91_ORIGINAL_CHARACTER_TRANSACTION_FAILED',scope)
        self.assertNotIn('verifyOriginalDockedPlayerSession({session,characterID,stationID},tx)',scope)

    def test_pf92_generic_character_writer_uses_same_gate_twice(self):
        s=NATIVE.read_text(encoding='utf8')
        scope=s[s.index('function createOriginalCharacterRecordWriteBarrier({'):]
        self.assertEqual(scope.count('verifyOriginalWitnessCannotWrite(tx,verifyOriginalSessionLease,witness)'),2)
        self.assertIn('PF92_CHARACTER_TRANSACTION_ABORT:',scope)
        self.assertIn('PF92_CHARACTER_SESSION_LEASE_REVOKED',scope)

    def test_manual_work_preflight_runs_original_sqlite_session_rollback_cases(self):
        p=PF80.read_text(encoding='utf8')
        self.assertIn('PF93_ORIGINAL_SQLITE_WITNESS_GATE_FAILED',p)
        self.assertIn('PF93_NATIVE_WORKTREE',p)
        self.assertLess(p.index('PF93_ORIGINAL_SQLITE_WITNESS_GATE_FAILED'),
                        p.index('& $python $script @argsForPython'))
        self.assertIn('pf93-native-session-tx-isolation.test.cjs',
                      PF58.read_text(encoding='utf8'))
        self.assertGreaterEqual(PF93TEST.read_text(encoding='utf8').count("test('"),14)
        self.assertGreaterEqual(SOURCE.read_text(encoding='utf8').count("test('"),3)

if __name__=='__main__':
    unittest.main()
