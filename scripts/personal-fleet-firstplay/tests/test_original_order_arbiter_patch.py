import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest

PATH = Path(__file__).resolve().parents[1]/'tools/build_original_order_arbiter_patch.py'
spec = importlib.util.spec_from_file_location('pf_order_arbiter', PATH)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

def git(cwd, *args, input=None):
    return subprocess.run(['git','-C',str(cwd),*args],input=input,text=True,
                          capture_output=True,check=True).stdout

class NativeOrderOwnerPatchTest(unittest.TestCase):
    def sample(self, path):
        old, _ = mod.MARKERS[path]
        source='"use strict";\n'+old+'\n'
        if path == mod.BRIDGE:
            source+=(
             'function createOrderBridge({arbiter, assignments, sceneForSystem, getController,\n'
             ' warShipClaim=null}={}) {\n'
             ' if(warShipClaim!==null&&typeof warShipClaim!=="function")throw Error("WAR_SHIP_CLAIM_AUTHORITY_INVALID");\n'
             '  if((state.manualBusy||state.movementBusy)&&owner!=="TACTICS"&&\n'
             '   (!lease||lease.owner!==owner)&&!warOwnsItsPatrol)\n'
             '   return {success:false,errorMsg:"COOP_NPC_ORDER_NATIVE_COMMAND_ACTIVE"};\n'
             '}\n'
            )
        return source
    def test_transforms_arbitration_and_peaceful_guard(self):
        for path in mod.PINS:
            s = mod.transform(path,self.sample(path))
            self.assertEqual(s.count(mod.MARKERS[path][1]),1)
            if path == mod.ARB:
                self.assertEqual(s.count('"PERSONAL_FLEET"'),1)
            else:
                self.assertIn('personalFleetRecoveryProof?.(link)===true',s)
                self.assertIn('action==="pf-resume-guard"',s)
            self.assertNotIn(mod.MARKERS[path][0],s)
            self.assertIn(mod.MARKERS[path][1],s)
    def test_pf95_shared_arbiter_allows_owned_combat_but_stock_peaceful_directors_remain_safe(self):
        source=self.sample(mod.BRIDGE)
        changed=mod.transform(mod.BRIDGE,source)
        self.assertIn('"PERSONAL_FLEET" is NOT peaceful',changed)
        self.assertIn('const PEACEFUL=new Set(["PATROL","CIVILIAN","GATE","EXPEDITION"]);',changed)
        self.assertNotIn('"PERSONAL_FLEET"]);',changed)
    def test_source_pin_rejects_unrecognized_stock(self):
        for path in mod.PINS:
            with self.assertRaisesRegex(ValueError,'SOURCE_DRIFT'):
                mod.transform(path,'"use strict";\n')
    def test_rejects_previously_patched_source(self):
        for path in mod.PINS:
            with self.assertRaisesRegex(ValueError,'SOURCE_DRIFT'):
                mod.transform(path,mod.transform(path,self.sample(path)))
    def test_rejects_duplicate_owner_marker(self):
        for path in mod.PINS:
            with self.assertRaisesRegex(ValueError,'SOURCE_DRIFT'):
                mod.transform(path,self.sample(path)*2)
    def test_rejects_crlf(self):
        for path in mod.PINS:
            with self.assertRaisesRegex(ValueError,'LINE_ENDINGS'):
                mod.transform(path,self.sample(path).replace('\n','\r\n'))
    def test_two_file_git_apply_patch(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td)
            git(root.parent,'init','-q',str(root))
            original={}
            for path in mod.PINS:
                f=root/path
                f.parent.mkdir(parents=True,exist_ok=True)
                raw=self.sample(path).encode()
                f.write_bytes(raw)
                original[path]=mod.PINS[path]
                mod.PINS[path]=mod.git_blob(raw)
            try:
                patch=mod.build(root)
                self.assertEqual(patch.count('--- a/'),2)
                git(root,'apply','--check','-',input=patch)
                git(root,'apply','-',input=patch)
                for p in mod.PINS:
                    self.assertIn('"PERSONAL_FLEET"',(root/p).read_text())
            finally:
                mod.PINS.update(original)
    def test_rejects_modified_blob_even_with_correct_anchor(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td)
            for path in mod.PINS:
                f=root/path
                f.parent.mkdir(parents=True,exist_ok=True)
                f.write_text(self.sample(path))
            with self.assertRaisesRegex(ValueError,'BLOB_DRIFT'):
                mod.build(root)

if __name__ == '__main__': unittest.main()
