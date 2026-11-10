#!/usr/bin/env python3
"""PF97 source-pinned true applied NPC->player damage hook for native GUARD.

The callback cannot authorize a command by itself, only capture real source
evidence AFTER the original killmailTracker has accepted applied damage.
"""
from __future__ import annotations
import difflib
import hashlib
from pathlib import Path

PATH='Code/server/src/space/combat/killmailTracker.js'
BLOB='48f256de1219b12c0a62abfa3d82e25c6f2b9b22'
ANCHOR='''  if (process.env.EVEJS_COOP_PLAYER_DAMAGE_EVIDENCE === "1") {
    try { require("../coopPlayerCombatWitness").note(attackerEntity, targetEntity, damageAmount); }
    catch (error) { console.warn("[CoopPlayerCombatWitness]", error.message); }
  }'''
ADDITION='''  if (process.env.EVEJS_COOP_PERSONAL_FLEET_NATIVE === "1") {
    try { require("../coopPersonalFleetOriginalGuardAggression").note(
      attackerEntity, targetEntity, damageAmount); }
    catch (error) { console.warn("[PersonalFleet] native guard damage witness", error.message); }
  }'''

def git_blob(data:bytes)->str:
 return hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()

def transform(src:str)->str:
 if src.count(ANCHOR)!=1 or src.count(ADDITION)!=0 or not src.endswith('\n') or '\r' in src:
  raise ValueError('PF97_ORIGINAL_DAMAGE_NATIVE_SOURCE_DRIFT')
 return src.replace(ANCHOR,ANCHOR+'\n'+ADDITION,1)

def build(work:Path)->str:
 native=work/PATH
 if not native.is_file() or native.is_symlink():
  raise ValueError('PF97_ORIGINAL_DAMAGE_SOURCE_MISSING')
 raw=native.read_bytes()
 if git_blob(raw)!=BLOB:raise ValueError('PF97_ORIGINAL_DAMAGE_BLOB_DRIFT')
 before=raw.decode('utf-8')
 after=transform(before)
 result=''.join(difflib.unified_diff(
  before.splitlines(keepends=True),after.splitlines(keepends=True),
  fromfile='a/'+PATH,tofile='b/'+PATH))
 if result.count('--- a/')!=1 or result.count('+++ b/')!=1:
  raise ValueError('PF97_ORIGINAL_DAMAGE_PATCH_INCOMPLETE')
 return result
