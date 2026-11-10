#!/usr/bin/env python3
"""PF97 source-pin a narrow original NPC-vs-NPC GUARD retaliation exception."""
from __future__ import annotations
import difflib
import hashlib
from pathlib import Path

PATH='Code/server/src/space/npc/npcBehaviorLoop.js'
BLOB='43225cd72240e98e480e94088d3a457377eb5af6'
ANCHOR='''  if (sourceClass === "npc") {
    return targetClass === "npc";
  }'''
INSERT='''  // PF97: ONLY a genuinely injured owner's claimed Personal Fleet NPC
  // may engage the exact native aggressor, and only while the original
  // PF55 ISSUING/ACKED combat operation and real applied-damage proof agree.
  if (sourceClass === "npc" && targetClass === "npc" &&
      entity?.personalFleetOriginal === true &&
      process.env.EVEJS_COOP_PERSONAL_FLEET_NATIVE === "1") {
    try {
      if (require("../coopPersonalFleetOriginalGuardAggression")
          .allowsRetaliation(entity, target)) return false;
    } catch (_pfGuardEvidence) { /* fail closed to stock NPC safety */ }
  }'''

def git_blob(raw:bytes)->str:
 return hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest()

def transform(source:str)->str:
 if source.count(ANCHOR)!=1 or source.count(INSERT)!=0 or '\r' in source or not source.endswith('\n'):
  raise ValueError('PF97_ORIGINAL_NPC_HOSTILITY_SOURCE_DRIFT')
 return source.replace(ANCHOR,INSERT+'\n'+ANCHOR,1)

def build(work:Path)->str:
 file=work/PATH
 if not file.is_file() or file.is_symlink():
  raise ValueError('PF97_ORIGINAL_NPC_HOSTILITY_MISSING')
 raw=file.read_bytes()
 if git_blob(raw)!=BLOB:
  raise ValueError('PF97_ORIGINAL_NPC_HOSTILITY_BLOB_DRIFT')
 before=raw.decode('utf-8');after=transform(before)
 patch=''.join(difflib.unified_diff(
  before.splitlines(keepends=True),after.splitlines(keepends=True),
  fromfile='a/'+PATH,tofile='b/'+PATH))
 if patch.count('--- a/')!=1 or patch.count('+++ b/')!=1:
  raise ValueError('PF97_ORIGINAL_NPC_HOSTILITY_PATCH_INCOMPLETE')
 return patch
