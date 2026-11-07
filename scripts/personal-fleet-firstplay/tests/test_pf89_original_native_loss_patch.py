import importlib.util
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[1]
BUILDER=ROOT/'tools/build_original_character_wallet_patch.py'
ARCHIVE=ROOT.parent/'pf57/native/coopPersonalFleetContractLifecycle.cjs'
spec=importlib.util.spec_from_file_location('pf89_wreck_contract',BUILDER)
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class Pf89OriginalLossNativePatchTest(unittest.TestCase):
 def test_original_archive_is_not_mutated_to_look_like_native_sqlite(self):
  src=ARCHIVE.read_text(encoding='utf-8')
  self.assertIn('tx.get(NPC,NPC)',src)
  self.assertIn("tx.get('npcModules','npcModules')",src)
 def test_staged_pf57_native_reads_exact_original_row_sources(self):
  raw=ARCHIVE.read_text(encoding='utf-8')
  changed=m.transform('coopPersonalFleetContractLifecycle.js',raw)
  self.assertIn("require('./coopPersonalFleetOriginalLossRows')",changed)
  self.assertIn('originalRows.readWreckRoot(tx)',changed)
  self.assertIn('originalRows.readNativeAssets(tx,c.shipItemID)',changed)
  self.assertNotIn('tx.get(NPC,NPC)',changed)
  self.assertNotIn("tx.get(WRECK,WRECK)",changed)
  self.assertNotIn("tx.get('npcModules','npcModules')",changed)
  self.assertNotIn("tx.get(CHAR,CHAR)",changed)
  self.assertNotIn("tx.put(CHAR,CHAR",changed)
  self.assertEqual(changed.count('readWreckRoot(tx)'),2)
  self.assertEqual(changed.count('readNativeAssets(tx,c.shipItemID)'),1)
 def test_pf91_original_hire_avoids_unrelated_transient_npc_table(self):
  source=(ROOT.parent/'pf53/native/coopPersonalFleetPaidHiring.cjs').read_text(encoding='utf-8')
  changed=m.transform('coopPersonalFleetPaidHiring.js',source)
  self.assertIn('atomic.transact([CHARACTERS,TABLE],tx=>{',changed)
  self.assertNotIn("atomic.transact([CHARACTERS,TABLE,'npcEntities']",changed)
  self.assertNotIn("tx.get(CHARACTERS,CHARACTERS)",changed)
  self.assertNotIn("tx.put(CHARACTERS,CHARACTERS",changed)
 def test_pf92_paid_hire_requires_stored_authorized_salary_consent(self):
  source=(ROOT.parent/'pf53/native/coopPersonalFleetPaidHiring.cjs').read_text(encoding='utf-8')
  changed=m.transform('coopPersonalFleetPaidHiring.js',source)
  self.assertIn("require('./coopPersonalFleetOriginalPayrollConsent')",changed)
  self.assertIn('verifyPaidWageConsent(tx,receipt)',changed)
  self.assertIn('captureOfferWageConsent(offer,command,now)',changed)
  self.assertIn('tx.put(TABLE,originalPayrollConsent.consentKey(command.operationID),wageConsent);',changed)
  self.assertIn('payrollConsent:wageConsent',changed)
 def test_pf93_native_server_payroll_does_not_forge_player_login(self):
  raw=(ROOT.parent/'pf57/native/coopPersonalFleetContractLifecycle.cjs').read_text(encoding='utf-8')
  changed=m.transform('coopPersonalFleetContractLifecycle.js',raw)
  self.assertIn('function salaryServer(c,capability)',changed)
  self.assertIn("c.operationID!==originalPayrollConsent.salaryOperationID(c)",changed)
  self.assertIn("return salaryInternal(c,true);",changed)
  self.assertIn("function salary(c){return salaryInternal(c,false);}",changed)
  self.assertIn("owner.accountId!==c.accountID",changed)
  self.assertIn("typeof serverPayrollCapability!=='symbol'",changed)
 def test_unreviewed_root_reader_patch_drift_must_fail_closed(self):
  raw=ARCHIVE.read_text(encoding='utf-8')
  drift=raw.replace("tx.get('npcModules','npcModules')",
   "tx.get('npcModules','modules')")
  with self.assertRaisesRegex(ValueError,'PF_NATIVE_WALLET_SOURCE_ANCHOR_DRIFT'):
   m.transform('coopPersonalFleetContractLifecycle.js',drift)

if __name__=='__main__':
 unittest.main()
