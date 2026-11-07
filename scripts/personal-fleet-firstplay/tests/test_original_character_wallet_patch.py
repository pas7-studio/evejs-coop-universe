import importlib.util
import hashlib
import json
from pathlib import Path
import tempfile
import subprocess
import unittest

FILE=Path(__file__).resolve().parents[1]/'tools/build_original_character_wallet_patch.py'
spec=importlib.util.spec_from_file_location('wallet_builder',FILE)
b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)

class WalletPatchTest(unittest.TestCase):
 def example(self,name):
  return "'use strict';\n"+'\n'.join(before for before,_ in b.MODULES[name])+"\n"
 def test_rewrites_both_original_stock_character_rows(self):
  for name in b.MODULES:
   out=b.transform(name,self.example(name))
   for before,after in b.MODULES[name]:
    self.assertIn(after,out)
    self.assertNotIn(before,out)
   if name!='coopPersonalFleetHangarBridge.js':self.assertIn('String(',out)
 def test_rejects_missing_and_duplicate_exact_original_snippets(self):
  for name in b.MODULES:
   with self.assertRaisesRegex(ValueError,'SOURCE_ANCHOR_DRIFT'):
    b.transform(name,'not original\n')
   before=self.example(name)
   with self.assertRaisesRegex(ValueError,'SOURCE_ANCHOR_DRIFT'):
    b.transform(name,before+before)
 def test_manifest_gates_real_three_file_native_work_patch(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);subprocess.run(['git','init','-q',str(root)],check=True,capture_output=True)
   files={}
   for name in b.MODULES:
    rel=b.SPACE+name;file=root/rel;file.parent.mkdir(parents=True,exist_ok=True)
    file.write_text(self.example(name),encoding='utf8')
    files[rel]={'sha256':b.sha256(file),'bytes':file.stat().st_size}
   manifest=root/'PF62-MANIFEST.json'
   manifest.write_text(json.dumps({'name':'PF62_NATIVE_REVIEW_BUNDLE','featureEnabled':False,'files':files}))
   diff=b.build(root,manifest)
   self.assertTrue(diff.count('--- a/')==3 and diff.count('+++ b/')==3)
   subprocess.run(['git','-C',str(root),'apply','--check','-'],input=diff,text=True,check=True,capture_output=True)
   subprocess.run(['git','-C',str(root),'apply','-'],input=diff,text=True,check=True,capture_output=True)
   for name in b.MODULES:
    s=(root/(b.SPACE+name)).read_text()
    self.assertNotIn('tx.get(CHAR,CHAR)',s)
    self.assertNotIn('tx.get(CHARACTERS,CHARACTERS)',s)
   if name=='coopPersonalFleetHangarBridge.js':
    self.assertIn("transact([TABLE,ITEM_TABLE,'characters'],tx=>",s)
 def test_rejects_staged_workfile_tampering(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);files={}
   for name in b.MODULES:
    rel=b.SPACE+name;file=root/rel;file.parent.mkdir(parents=True,exist_ok=True)
    file.write_text(self.example(name))
    files[rel]={'sha256':b.sha256(file)}
   m=root/'manifest.json';m.write_text(json.dumps({'name':'PF62_NATIVE_REVIEW_BUNDLE','featureEnabled':False,'files':files}))
   (root/(b.SPACE+list(b.MODULES)[0])).write_text('WRONG\n')
   with self.assertRaisesRegex(ValueError,'SOURCE_HASH_DRIFT'):b.build(root,m)
 def test_rejects_untrusted_manifest(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);m=root/'manifest.json'
   m.write_text(json.dumps({'name':'FORGED','featureEnabled':True,'files':{}}))
   with self.assertRaisesRegex(ValueError,'UNTRUSTED'):b.build(root,m)

if __name__=='__main__':unittest.main()
