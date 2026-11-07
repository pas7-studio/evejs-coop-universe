#!/usr/bin/env python3
"""Native-only correction: original EveJS characterState stores one SQLite row per character.

PF53/PF57 archive fixture was an aggregate map under characters/characters.
PF52 reserve and PF55 native orders must include original individual
characters rows for same-transaction paid hull and friendly ship witnesses.
Patch exact PF62-staged WORK modules using PF62 manifest SHA256 pins.
Output is REVIEW ONLY; no engine writes, no PLAY and no new feature flags.
"""
from __future__ import annotations
import argparse
import difflib
import hashlib
import json
from pathlib import Path
import subprocess
import sys

SPACE='Code/server/src/space/'
MODULES={
'coopPersonalFleetHangarBridge.js': [
 ("   const result=transact([TABLE,ITEM_TABLE],tx=>{",
  "   const result=transact([TABLE,ITEM_TABLE,'characters'],tx=>{"),
],
'coopPersonalFleetNativeOrders.js':[
 ("  try{admission=atomic.transact([TABLE,ITEMS],tx=>{",
  "  try{admission=atomic.transact([TABLE,ITEMS,'characters'],tx=>{"),
 ("  try{return atomic.transact([TABLE,ITEMS],tx=>{",
  "  try{return atomic.transact([TABLE,ITEMS,'characters'],tx=>{"),
],
'coopPersonalFleetPaidHiring.js':[
 (" const characters=tx.get(CHARACTERS,CHARACTERS);\n const c=characters?.[String(receipt.ownerCharacterID)];",
  " const c=tx.get(CHARACTERS,String(receipt.ownerCharacterID));"),
 ("    const chars=tx.get(CHARACTERS,CHARACTERS),owner=chars?.[String(command.ownerCharacterID)];",
  "    const owner=tx.get(CHARACTERS,String(command.ownerCharacterID));"),
 ("    if(!obj(chars)||!obj(owner)||owner.characterID!==command.ownerCharacterID||",
  "    if(!obj(owner)||owner.characterID!==command.ownerCharacterID||"),
 ("    tx.put(CHARACTERS,CHARACTERS,{...chars,[String(command.ownerCharacterID)]:updatedOwner});",
  "    tx.put(CHARACTERS,String(command.ownerCharacterID),updatedOwner);"),
],
'coopPersonalFleetContractLifecycle.js':[
 ("    const rec=old.receipt,chars=tx.get(CHAR,CHAR),ch=chars?.[String(c.ownerCharacterID)],",
  "    const rec=old.receipt,ch=tx.get(CHAR,String(c.ownerCharacterID)),"),
 ("   const chars=tx.get(CHAR,CHAR),owner=chars?.[String(c.ownerCharacterID)],before=cents(owner?.balance);",
  "   const owner=tx.get(CHAR,String(c.ownerCharacterID)),before=cents(owner?.balance);"),
 ("   if(!obj(chars)||!obj(owner)||owner.characterID!==c.ownerCharacterID||",
  "   if(!obj(owner)||owner.characterID!==c.ownerCharacterID||"),
 ("   tx.put(CHAR,CHAR,{...chars,[String(c.ownerCharacterID)]:{...owner,balance:isk(after),\n    balanceChange:isk(-quote.amountCents),walletJournal:[debit,...owner.walletJournal].slice(0,100)}});",
  "   tx.put(CHAR,String(c.ownerCharacterID),{...owner,balance:isk(after),\n    balanceChange:isk(-quote.amountCents),walletJournal:[debit,...owner.walletJournal].slice(0,100)});"),
],
}

def sha256(path:Path)->str:return hashlib.sha256(path.read_bytes()).hexdigest()

def transform(module:str,text:str)->str:
 if module not in MODULES:raise ValueError('PF_NATIVE_WALLET_UNKNOWN_MODULE')
 if '\r\n' in text:raise ValueError('PF_NATIVE_WALLET_UNEXPECTED_EOL')
 changed=text
 for before,after in MODULES[module]:
  if changed.count(before)!=1:raise ValueError('PF_NATIVE_WALLET_SOURCE_ANCHOR_DRIFT:'+module)
  changed=changed.replace(before,after,1)
 if changed==text:raise ValueError('PF_NATIVE_WALLET_NO_CHANGE')
 if 'tx.get(CHAR,CHAR)' in changed or 'tx.put(CHAR,CHAR' in changed or \
    'tx.get(CHARACTERS,CHARACTERS)' in changed or 'tx.put(CHARACTERS,CHARACTERS' in changed:
  raise ValueError('PF_NATIVE_WALLET_UNREPLACED_AGGREGATE_CHARACTER_ACCESS')
 return changed

def build(work:Path,manifest:Path)->str:
 data=json.loads(manifest.read_text(encoding='utf-8'))
 if data.get('name')!='PF62_NATIVE_REVIEW_BUNDLE' or data.get('featureEnabled') is not False:
  raise ValueError('PF_NATIVE_WALLET_UNTRUSTED_PF62_MANIFEST')
 diffs=[]
 for name in MODULES:
  relative=SPACE+name;file=work/relative
  expected=data.get('files',{}).get(relative,{}).get('sha256')
  if not isinstance(expected,str) or len(expected)!=64 or not file.is_file() or sha256(file)!=expected:
   raise ValueError('PF_NATIVE_WALLET_STAGE_SOURCE_HASH_DRIFT:'+relative)
  before=file.read_text(encoding='utf-8')
  after=transform(name,before)
  block=list(difflib.unified_diff(before.splitlines(keepends=True),after.splitlines(keepends=True),
    fromfile='a/'+relative,tofile='b/'+relative))
  if not block:raise ValueError('PF_NATIVE_WALLET_EMPTY_PATCH:'+relative)
  diffs.extend(block)
 patch=''.join(diffs)
 if not patch.endswith('\n') or patch.count('--- a/')!=4 or patch.count('+++ b/')!=4:
  raise ValueError('PF_NATIVE_WALLET_REVIEW_DIFF_INCOMPLETE')
 return patch

def main():
 a=argparse.ArgumentParser(description=__doc__)
 a.add_argument('--worktree',required=True,type=Path)
 a.add_argument('--pf62-manifest',required=True,type=Path)
 a.add_argument('--output',required=True,type=Path)
 v=a.parse_args();root=v.worktree.resolve(strict=True)
 patch=build(root,v.pf62_manifest.resolve(strict=True))
 check=subprocess.run(['git','-C',str(root),'apply','--check','--whitespace=error','-'],
   input=patch,text=True,capture_output=True)
 if check.returncode:raise ValueError('PF_NATIVE_WALLET_APPLY_CHECK_FAILED:'+check.stderr[:250])
 if v.output.exists():raise ValueError('PF_NATIVE_WALLET_REVIEW_OUTPUT_EXISTS')
 v.output.parent.mkdir(parents=True,exist_ok=True)
 v.output.write_text(patch,encoding='utf-8',newline='\n')
 print('PF_NATIVE_CHARACTER_ROW_WALLET_PF52_PF55_WITNESS_REVIEW_READY sha256='+hashlib.sha256(patch.encode()).hexdigest())
 print('Do not apply to original source or PLAY; review and commit in isolated WORK only.')

if __name__=='__main__':
 try:main()
 except (OSError,ValueError) as exc:
  print(str(exc),file=sys.stderr);sys.exit(1)
