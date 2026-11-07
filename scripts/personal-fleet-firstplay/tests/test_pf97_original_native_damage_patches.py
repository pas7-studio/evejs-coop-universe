import importlib.util
from pathlib import Path
import tempfile
import unittest

BASE=Path(__file__).resolve().parents[1]/'tools'

def load(name,filename):
 spec=importlib.util.spec_from_file_location(name,BASE/filename)
 module=importlib.util.module_from_spec(spec)
 spec.loader.exec_module(module)
 return module

damage=load('pf97_original_damage','build_original_guard_damage_patch.py')
hostility=load('pf97_original_hostility','build_original_guard_hostility_patch.py')

class PF97OriginalDamagePatchTest(unittest.TestCase):
 def test_original_killmail_note_damage_adds_only_guard_evidence_hook(self):
  stock='"use strict";\n'+damage.ANCHOR+'\n'
  changed=damage.transform(stock)
  self.assertEqual(changed.count(damage.ANCHOR),1)
  self.assertEqual(changed.count(damage.ADDITION),1)
  self.assertEqual(changed.count('CoopPlayerCombatWitness'),0)
  self.assertIn('appliedDamage',changed)
  self.assertIn('attackerEntity, targetEntity, damageAmount',changed)
 def test_original_stock_npc_friendly_guard_only_allows_authorized_attacker(self):
  stock='"use strict";\n'+hostility.ANCHOR+'\n'
  changed=hostility.transform(stock)
  self.assertEqual(changed.count(hostility.ANCHOR),1)
  self.assertEqual(changed.count(hostility.INSERT),1)
  self.assertIn('allowsRetaliation(entity, target)',changed)
  self.assertIn('return targetClass === "npc"',changed)
 def test_both_source_hooks_fail_closed_on_absent_or_repeated_native_anchors(self):
  for mod in (damage,hostility):
   with self.assertRaisesRegex(ValueError,'SOURCE_DRIFT'):
    mod.transform('"use strict";\n')
   with self.assertRaisesRegex(ValueError,'SOURCE_DRIFT'):
    mod.transform('"use strict";\n'+mod.ANCHOR+'\n'+mod.ANCHOR+'\n')
   with self.assertRaisesRegex(ValueError,'SOURCE_DRIFT'):
    mod.transform('"use strict";\r\n'+mod.ANCHOR+'\r\n')
 def test_pinned_git_blob_is_mandatory_for_original_engine(self):
  for mod in (damage,hostility):
   with tempfile.TemporaryDirectory() as td:
    p=Path(td)/mod.PATH
    p.parent.mkdir(parents=True,exist_ok=True)
    p.write_text('"use strict";\n'+mod.ANCHOR+'\n')
    with self.assertRaisesRegex(ValueError,'BLOB_DRIFT'):
     mod.build(Path(td))
 def test_review_diffs_are_nonoverlapping_single_file_source_transformations(self):
  for mod in (damage,hostility):
   with tempfile.TemporaryDirectory() as td:
    p=Path(td)/mod.PATH
    p.parent.mkdir(parents=True,exist_ok=True)
    content='"use strict";\n'+mod.ANCHOR+'\n'
    p.write_text(content)
    previous=mod.BLOB
    try:
     mod.BLOB=mod.git_blob(content.encode())
     patch=mod.build(Path(td))
     self.assertEqual(patch.count('--- a/'),1)
     self.assertEqual(patch.count('+++ b/'),1)
     self.assertIn(mod.PATH,patch)
    finally:mod.BLOB=previous

if __name__=='__main__':unittest.main()
