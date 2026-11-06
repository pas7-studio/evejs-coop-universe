"""PF85: manual WORK wrapper must gate source-bound original NPC API first."""
from pathlib import Path
import re
import unittest

ROOT=Path(__file__).resolve().parents[3]
SCRIPT=ROOT/'scripts/pf55/integration/pf85-original-npc-runtime.test.cjs'
WRAPPER=ROOT/'scripts/pf62/Prepare-PF80-CompleteNativeWork.ps1'
DOC=ROOT/'scripts/pf62/PF85_ORIGINAL_RUNTIME_GATE.md'

class OriginalNpcRuntimeGateTests(unittest.TestCase):
    def test_original_runtime_source_is_pinned_and_fail_closed(self):
        text=SCRIPT.read_text(encoding='utf8')
        self.assertIn('8ee3d4f82db1600094df8de1060a9aa8e575af1a',text)
        self.assertIn('PF85_ORIGINAL_NPC_RUNTIME_SOURCE_DRIFT',text)
        self.assertIn('fs.realpathSync',text)
        self.assertIn('vm.Script(source',text)
        self.assertIn('PF85_PLAY_OR_PROD_FORBIDDEN',text)
        self.assertIn('PF85_ABSOLUTE_NATIVE_WORKTREE_REQUIRED',text)
        for method in ('follow','stop','issueAttackOrder','warpToPoint','warpToEntity'):
            self.assertIn("'"+method+"'",text)

    def test_manual_powershell_preflight_precedes_any_work_application(self):
        text=WRAPPER.read_text(encoding='utf8')
        self.assertIn('if ($ApplyToWork.IsPresent)',text)
        self.assertIn('$env:PF85_NATIVE_WORKTREE',text)
        self.assertIn('PF85_ORIGINAL_RUNTIME_SOURCE_GATE_FAILED',text)
        self.assertIn('[Environment]::SetEnvironmentVariable',text)
        native=text.index('& $node --test --test-concurrency=1 $pf85Test')
        application=text.index('& $python $script @argsForPython')
        self.assertLess(native,application,'PF85 must run before any PF80 outputs')
        self.assertIn('PF85_ORIGINAL_RUNTIME_GATE.md',DOC.name)

    def test_no_remote_ci_or_fake_live_acceptance_claim(self):
        doc=DOC.read_text(encoding='utf8')
        self.assertIn('not',doc.lower())
        self.assertIn('controlled doubles',doc)
        self.assertIn('not** a live physics',doc)
        self.assertIn('Personal\nFleet OFF',doc)

if __name__=='__main__':
    unittest.main()
