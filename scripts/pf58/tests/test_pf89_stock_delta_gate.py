"""PF89 original ItemStore delta gateway must enforce actual, not declared IDs."""
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[2]
POLICY=ROOT/'pf58/native/coopPersonalFleetOriginalNativePermit.cjs'
BOOT=ROOT/'pf58/native/coopPersonalFleetNativeBootstrap.cjs'
PF58=ROOT/'pf58/Test-PF58-Local.ps1'
PF80=ROOT/'pf62/Prepare-PF80-CompleteNativeWork.ps1'
TEST=ROOT/'pf58/tests/pf89-actual-item-delta.test.cjs'

class PF89StockDeltaSafety(unittest.TestCase):
    def test_actual_before_after_set_is_proven(self):
        text=POLICY.read_text(encoding='utf8')
        for contract in [
            'mutateOriginalItemsInTransaction({tx,writer,buildNext,',
            "const keys=new Set([...beforeKeys,...nextKeys]),changed=[];",
            'if(!isDeepStrictEqual(a,z))changed.push(Number(key));',
            'if(declaredItemIDs!==null&&',
            'PF89_UNDECLARED_STOCK_ITEM_MUTATION',
            'const oldParent=containingShip(before,id);',
            'const newParent=containingShip(next,id);',
            "inTransaction({tx,writer,shipItemID:ship})",
            'PF89_SHIP_CREATION_REQUIRES_ORIGINAL_ITEMSTORE',
            "tx.put('items','items',next);"
        ]:
            self.assertIn(contract,text,'PF89_DELTA_CONTRACT_MISSING: '+contract)
        self.assertLess(text.index('inTransaction({tx,writer,shipItemID:ship})'),
                        text.index("tx.put('items','items',next);"))

    def test_failed_builder_or_stock_tx_bypass_cannot_commit(self):
        text=POLICY.read_text(encoding='utf8')
        self.assertIn('PF89_STOCK_ITEMS_CHANGED_DURING_BUILDER_ROLLBACK',text)
        self.assertIn("if(ack!==true)return fail('PF89_BUILDER_NOT_SYNCHRONOUSLY_ACKED')",text)
        self.assertIn('PF89_NON_JSON_INVENTORY_MUTATION',text)
        self.assertIn('PF89_MUTATION_SIZE_EXCEEDS_CAP',text)
        self.assertIn('PF89_NEXT_ITEMS_AUDIT_CAP',text)

    def test_sourcebound_bootstrap_exposes_actual_delta_authority(self):
        text=BOOT.read_text(encoding='utf8')
        self.assertIn('mutateForeignOriginalItemsWithinTransaction:',text)
        self.assertIn('foreignWriterFence.mutateOriginalItemsInTransaction',text)
        self.assertIn("typeof verifyOriginalWriterHooks==='function'",text)
        self.assertIn('atomicOriginalTransfer:true',text)

    def test_manual_work_preflights_run_regression_before_applying_patch(self):
        ps=PF80.read_text(encoding='utf8')
        self.assertIn('PF89_ACTUAL_ITEMS_DELTA_GATE_FAILED',ps)
        self.assertLess(ps.index('& $node --test --test-concurrency=1 $pf89Test'),
                        ps.index('& $python $script @argsForPython'))
        self.assertIn('pf89-actual-item-delta.test.cjs',PF58.read_text(encoding='utf8'))
        self.assertGreaterEqual(TEST.read_text(encoding='utf8').count("test('"),20)

if __name__=='__main__':
    unittest.main()
