"""PF92: generic original characterState owner write must be reciprocal and atomic."""
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[2]
NATIVE=ROOT/'pf58/native/coopPersonalFleetOriginalNativePermit.cjs'
BOOT=ROOT/'pf58/native/coopPersonalFleetNativeBootstrap.cjs'
PF92=ROOT/'pf58/tests/pf92-character-record-barrier.test.cjs'
ORIGINAL=ROOT/'pf92/tests/pf92-original-stock-character-routes.test.cjs'
PF80=ROOT/'pf62/Prepare-PF80-CompleteNativeWork.ps1'
PF58=ROOT/'pf58/Test-PF58-Local.ps1'

class PF92CharacterOwnerGate(unittest.TestCase):
    def test_generic_writer_accepts_only_actual_original_before_image(self):
        source=NATIVE.read_text(encoding='utf8')
        for clause in [
            'function createOriginalCharacterRecordWriteBarrier({pf52,',
            "const current=tx.get('characters',String(characterID));",
            'PF92_CHARACTER_BEFORE_IMAGE_STALE',
            'PF92_CHARACTER_OWNER_IDENTITY_INVALID',
            'PF92_CHARACTER_SNAPSHOT_UNSERIALIZABLE',
            "tx.put('characters',String(characterID),after);",
            'PF92_CHARACTER_WRITE_READBACK_FAILED_ROLLBACK']:
            self.assertIn(clause,source)
        self.assertLess(source.index('PF92_CHARACTER_BEFORE_IMAGE_STALE'),
                        source.index("tx.put('characters',String(characterID),after);"))

    def test_every_sensitive_original_active_ship_alias_is_guarded(self):
        source=NATIVE.read_text(encoding='utf8')
        for field in ["'shipID'","'shipid'","'activeShipID'",
                      "'shipTypeID'","'shipName'","'storedShips'"]:
            self.assertIn(field,source)
        self.assertIn('PF92_CHARACTER_ACTIVE_SHIP_ALIAS_INVALID',source)
        self.assertIn('PF92_ORIGINAL_ACTIVE_SHIP_ALIASES_CONFLICT',source)
        self.assertIn("fence.inTransaction({tx,writer:'PLAYER',shipItemID:id})",source)
        self.assertIn('allowOwnerAlreadyActive:prior.id===next.id',source)

    def test_session_witness_cannot_write_or_commit_after_mutation(self):
        source=NATIVE.read_text(encoding='utf8')
        self.assertIn('verifyOriginalSessionLease=()=>false',source)
        self.assertIn('const reader=Object.freeze({',source)
        self.assertIn('PF92_SESSION_WITNESS_MODIFIED_AUTHORITY_ROLLBACK',source)
        self.assertIn('PF92_ORIGINAL_OWNER_CHANGED_BY_SESSION_WITNESS_ROLLBACK',source)
        self.assertIn('PF92_CHARACTER_SESSION_LEASE_REVOKED',source)
        self.assertIn('throw Error(\'PF92_CHARACTER_TRANSACTION_ABORT:',source)
        self.assertLess(source.index('const finalLease=verifyOriginalSessionLease(witness,reader)'),
                        source.index("tx.put('characters',String(characterID),after);"))

    def test_native_bootstrap_binds_witness_at_construction_not_user_input(self):
        source=BOOT.read_text(encoding='utf8')
        self.assertIn('createOriginalCharacterRecordWriteBarrier({',source)
        self.assertIn('pf52,verifyOriginalSessionLease:verifyOriginalDockedPlayerSession',source)
        self.assertIn('commitStockCharacterRecordWithinOriginalTransaction(args)',source)
        self.assertIn('PF92_NATIVE_CHARACTER_OWNER_GATE_DISABLED',source)
        self.assertIn('nativeCharacterRecordBarrier.inTransaction(args)',source)
        self.assertIn('verifyOriginalDockedPlayerSession=()=>false',source)
        self.assertIn("typeof verifyOriginalWriterHooks==='function'",source)

    def test_manual_work_preflight_runs_pf92_and_real_original_owner_routes(self):
        self.assertIn('pf92-character-record-barrier.test.cjs',PF58.read_text(encoding='utf8'))
        ps=PF80.read_text(encoding='utf8')
        self.assertIn('PF92_ORIGINAL_CHARACTER_OWNER_WRITE_GATE_FAILED',ps)
        self.assertLess(ps.index('PF92_ORIGINAL_CHARACTER_OWNER_WRITE_GATE_FAILED'),
                        ps.index('& $python $script @argsForPython'))
        self.assertGreaterEqual(PF92.read_text(encoding='utf8').count("test('"),26)
        self.assertGreaterEqual(ORIGINAL.read_text(encoding='utf8').count("test('"),4)

if __name__=='__main__':
    unittest.main()
