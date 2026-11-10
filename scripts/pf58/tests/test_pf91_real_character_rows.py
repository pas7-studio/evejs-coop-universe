"""PF91 cross-checks the *actual* EveJS SQLite character row contract."""
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[2]
PERMIT=ROOT/'pf58/native/coopPersonalFleetOriginalNativePermit.cjs'
HANDOFF=ROOT/'pf58/native/coopPersonalFleetOriginalShipHandoff.cjs'
BOOT=ROOT/'pf58/native/coopPersonalFleetNativeBootstrap.cjs'
PF87=ROOT/'pf58/tests/pf87-atomic-handoff.test.cjs'
PF91=ROOT/'pf58/tests/pf91-original-character-rows.test.cjs'
PF80=ROOT/'pf62/Prepare-PF80-CompleteNativeWork.ps1'
PF58=ROOT/'pf58/Test-PF58-Local.ps1'
PF90_AUDIT=ROOT/'pf90/inspect-original-owner-writes.cjs'

class PF91OriginalCharacterRowContract(unittest.TestCase):
    def test_pf87_no_longer_reads_nonexistent_synthetic_characters_row(self):
        source=HANDOFF.read_text(encoding='utf8')
        self.assertNotIn("tx.get('characters','characters')",source)
        self.assertIn('inspectOriginalCharacterShipRows(tx,{',source)
        self.assertIn('PF58_PF54_ISSUING_DURABLE_MISMATCH',source)
        self.assertIn('requireAtomicOriginalTransfer===true',source)

    def test_pf91_scan_checks_canonical_original_per_character_rows(self):
        source=PERMIT.read_text(encoding='utf8')
        for expected in [
            "tx.scan('characters')", "tx.get('characters',String(ownerCharacterID))",
            'PF91_ORIGINAL_CHARACTER_ROW_INVALID',
            'PF91_ORIGINAL_CHARACTER_OWNER_MISSING',
            'PF91_ORIGINAL_CHARACTER_OWNER_DRIFT',
            'PF91_ORIGINAL_SHIP_ACTIVE_FOR_CHARACTER',
            "record.characterID!==Number(key)"
        ]:
            self.assertIn(expected,source)

    def test_original_player_switch_is_single_transaction_owner_update(self):
        source=PERMIT.read_text(encoding='utf8')
        for expected in [
            "a.transact([T,'items','characters'],tx=>",
            "tx.put('characters',String(characterID),updated)",
            'PF91_CHARACTER_OWNER_SNAPSHOT_STALE',
            'PF91_ORIGINAL_PLAYER_SESSION_REVOKED',
            "fence.inTransaction({tx,writer:'PLAYER'",
            'PF91_ORIGINAL_CHARACTER_WRITE_READBACK_FAILED',
            'PF91_PLAYER_ACTIVATION_DISABLED',
        ]:
            self.assertIn(expected,source)
        self.assertLess(source.index("const present=inspectOriginalCharacterShipRows(tx,"),
                        source.index("tx.put('characters',String(characterID),updated)"))

    def test_source_bound_bootstrap_remains_default_off(self):
        source=BOOT.read_text(encoding='utf8')
        self.assertIn('activateStockPlayerShipWithinOriginalTransaction:',source)
        self.assertIn('stockPlayerShipActivation.activate',source)
        self.assertIn('verifyOriginalDockedPlayerSession=()=>false',source)
        self.assertIn("typeof verifyOriginalWriterHooks==='function'",source)
        self.assertIn('atomicOriginalTransfer:true',source)

    def test_genuine_original_source_pins_already_cover_character_owner(self):
        source=PF90_AUDIT.read_text(encoding='utf8')
        self.assertIn("role:'STOCK_CHARACTERS_OWNER'",source)
        self.assertIn('8a002d190899b6cb1e1068a565451e6d1d808401',source)
        self.assertIn('f3fbd1ed17223f601ba1c145b13fb77bcd98c27f',source)

    def test_local_preflight_checks_pf87_and_pf91_before_work_staging(self):
        local=PF58.read_text(encoding='utf8')
        self.assertIn('pf91-original-character-rows.test.cjs',local)
        check=PF80.read_text(encoding='utf8')
        self.assertIn('PF91_ORIGINAL_CHARACTER_RACE_GATE_FAILED',check)
        self.assertLess(check.index('& $node --test --test-concurrency=1 $pf87Test $pf91'),
                        check.index('& $python $script @argsForPython'))
        self.assertIn('DELETE FROM "characters"',PF87.read_text(encoding='utf8'))
        self.assertGreaterEqual(PF91.read_text(encoding='utf8').count("test('"),22)

if __name__=='__main__':
    unittest.main()
