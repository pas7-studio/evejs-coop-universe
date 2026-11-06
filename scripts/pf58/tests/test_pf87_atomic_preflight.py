"""PF87 source-level guard: strict title+permit transaction must be enforced."""
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[2]
HANDOFF=ROOT/'pf58/native/coopPersonalFleetOriginalShipHandoff.cjs'
BOOT=ROOT/'pf58/native/coopPersonalFleetNativeBootstrap.cjs'
PF58=ROOT/'pf58/Test-PF58-Local.ps1'
PF80=ROOT/'pf62/Prepare-PF80-CompleteNativeWork.ps1'
TEST=ROOT/'pf58/tests/pf87-atomic-handoff.test.cjs'

class PF87OriginalAtomicGate(unittest.TestCase):
    def test_atomic_rows_and_permit_are_one_original_transaction(self):
        s=HANDOFF.read_text(encoding='utf8')
        self.assertIn("requireAtomicOriginalTransfer===true?",s)
        self.assertIn("[T,ITEMS,'characters']",s)
        self.assertIn('native.moveOriginalShipToSpaceAtomically',s)
        self.assertIn("tx.put(T,key(row.assignmentID),record);",s)
        self.assertLess(s.index('native.moveOriginalShipToSpaceAtomically(clone(row)'),
                        s.index("tx.put(T,key(row.assignmentID),record);"))
        self.assertIn('PF87_ORIGINAL_SHIP_ACTIVE_FOR_CHARACTER',s)
        self.assertIn('throw Error(\'PF87_ORIGINAL_ATOMIC_STOCK_MOVE_UNPROVEN\')',s)
        self.assertIn('if(requireAtomicOriginalTransfer!==true){',s)
        self.assertIn('stockMovedAtomically:requireAtomicOriginalTransfer===true',s)

    def test_source_bound_bootstrap_cannot_turn_atomic_transfer_off(self):
        s=BOOT.read_text(encoding='utf8')
        self.assertIn('atomicOriginalTransfer:true});',s)
        self.assertIn('PF87_LEGACY_POSTCOMMIT_MOVE_DISABLED',s)
        self.assertIn("tx.put('items','items'",s)
        self.assertIn('PF87_ATOMIC_HANGAR_TITLE_CHANGED',s)
        self.assertIn('originalOwnershipWitness(row,tx)',s)
        self.assertIn('originalNoActiveSession(row)',s)
        self.assertIn('originalNoPhysicalActor(row)',s)

    def test_work_runner_checks_atomic_contract_before_any_native_apply(self):
        s=PF80.read_text(encoding='utf8')
        self.assertIn('PF87_ATOMIC_HANDOFF_GATE_FAILED',s)
        self.assertLess(s.index('& $node --test --test-concurrency=1 $pf87Test'),
                        s.index('& $python $script @argsForPython'))
        local=PF58.read_text(encoding='utf8')
        self.assertIn('pf87-atomic-handoff.test.cjs',local)
        self.assertIn('PF58_NODE_REGRESSION_FAILED',local)
        self.assertGreaterEqual(TEST.read_text(encoding='utf8').count("test('"),9)

if __name__=='__main__':
    unittest.main()
