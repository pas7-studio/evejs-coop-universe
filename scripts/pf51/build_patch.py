#!/usr/bin/env python3
"""PF51: create a source-pinned REVIEW patch; NEVER mutate a native checkout."""
from __future__ import annotations
import argparse
import difflib
import hashlib
from pathlib import Path

REL = 'Code/server/src/space/coopNativeMiningFleetDurable.js'
GUARD_REL = 'Code/server/src/space/coopPersonalFleetMiningStartupFence.js'
EXPECTED_GIT_BLOB = '2162c82ccdc358b47ef622308de26b7345eeaf43'
BASE = Path(__file__).resolve().parent


def change_once(text: str, old: str, new: str) -> str:
    n = text.count(old)
    if n != 1:
        raise ValueError(f'PF51_ANCHOR_AMBIGUOUS: count={n}, anchor={old[:72]!r}')
    return text.replace(old, new, 1)


def modify_source(source: str) -> str:
    """Pinned substitutions. Tested against exact fork snippets; actual file is pinned by SHA."""
    source = change_once(
        source,
        'function createService({db,store,nativeService,ensureState,spawn,register,destroy=null,\n'
        '  getFleets,auditStartupCargo=null,log=()=>{}}={}){',
        'function createService({db,store,nativeService,ensureState,spawn,register,destroy=null,\n'
        '  getFleets,auditStartupCargo=null,log=()=>{},startupFence=null}={}){',
    )
    source = change_once(source,
        '  if(busy.has(systemID))return {status:"BLOCKED",reason:"ALIFE08_REENTRANT",slots:[]};\n'
        '  busy.add(systemID);',
        '''  if(busy.has(systemID))return {status:"BLOCKED",reason:"ALIFE08_REENTRANT",slots:[]};
  // PF-51. No native spawn, repair or controller materialization until a
  // durable mining startup admission exists in the ORIGINAL GameStore.
  const pf51=process.env.EVEJS_COOP_PERSONAL_FLEET_MINING_STARTUP_FENCE==="1";
  let pf51Admission=null;
  if(pf51){
   if(typeof startupFence?.admit!=="function"||typeof startupFence?.finish!=="function")
    return {status:"BLOCKED",reason:"PF51_TRUSTED_NATIVE_ADMISSION_UNAVAILABLE",slots:[]};
   try{pf51Admission=startupFence.admit({systemID,fleetCount,
      operationID:require("node:crypto").randomUUID()});}
   catch(_error){return {status:"BLOCKED",reason:"PF51_ADMISSION_OUTCOME_UNKNOWN",slots:[]};}
   if(pf51Admission?.status!=="ADMITTED"||!pf51Admission.operationID)
    return {status:"BLOCKED",reason:"PF51_STARTUP_NOT_ADMITTED",slots:[]};
  }
  busy.add(systemID);''')
    source = change_once(source,
        '''   return {status:reports.some(x=>x.status==="NEEDS_OPERATOR_REPAIR")?
    "NEEDS_OPERATOR_REPAIR":"OK",systemID,slots:reports};''',
        '''   const outcome={status:reports.some(x=>x.status==="NEEDS_OPERATOR_REPAIR")?
    "NEEDS_OPERATOR_REPAIR":"OK",systemID,slots:reports};
   if(pf51){
    // Every partial/unknown physical outcome keeps IN_FLIGHT permanently.
    // Never allow restart retry to repair/reseed the same slot automatically.
    if(outcome.status!=="OK")return {...outcome,reason:"PF51_NATIVE_STARTUP_UNVERIFIED"};
    let finished=null;
    try{finished=startupFence.finish({systemID,
      operationID:pf51Admission.operationID});}
    catch(_error){return {...outcome,status:"NEEDS_OPERATOR_REPAIR",
      reason:"PF51_NATIVE_FINISH_OUTCOME_UNKNOWN"};}
    if(finished?.status!=="VERIFIED")return {...outcome,
      status:"NEEDS_OPERATOR_REPAIR",reason:"PF51_NATIVE_EVIDENCE_UNPROVEN"};
   }
   return outcome;''')
    source = change_once(source,
        '''function start(args){
 const {scene,spawn,register,getFleets,ensureState,fleetCount,destroy}=args||{};
 const db=require("../gameStore"),store=require("./npc/nativeNpcStore");''',
        '''function start(args){
 const {scene,spawn,register,getFleets,ensureState,fleetCount,destroy}=args||{};
 const db=require("../gameStore"),store=require("./npc/nativeNpcStore");
 // The public wrapper deliberately cannot accept a user-supplied authority.
 // Native owner must install the trusted PF44/45/46 binding in a separate PR.
 if(process.env.EVEJS_COOP_PERSONAL_FLEET_MINING_STARTUP_FENCE==="1")
  return {status:"BLOCKED",reason:"PF51_TRUSTED_BINDINGS_NOT_INSTALLED",slots:[]};''')
    return source


def git_blob_sha(raw: bytes) -> str:
    return hashlib.sha1(b'blob ' + str(len(raw)).encode() + b'\0' + raw).hexdigest()


def make_patch(original: str, updated: str, guard: str) -> str:
    path=REL
    lines=['diff --git a/'+path+' b/'+path+'\n']
    lines.extend(difflib.unified_diff(original.splitlines(keepends=True),updated.splitlines(keepends=True),
        fromfile='a/'+path,tofile='b/'+path,n=3))
    newpath=GUARD_REL
    lines.extend(['diff --git a/'+newpath+' b/'+newpath+'\n','new file mode 100644\n'])
    lines.extend(difflib.unified_diff([],guard.splitlines(keepends=True),
        fromfile='/dev/null',tofile='b/'+newpath,n=3))
    return ''.join(lines)


def main() -> None:
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--fork-root',type=Path,required=True)
    p.add_argument('--output',type=Path,default=BASE/'patches'/'PF51-native-startup-fence.patch')
    a=p.parse_args()
    native=a.fork_root/REL
    if not native.is_file():raise SystemExit('PF51_FORK_SOURCE_NOT_FOUND: '+str(native))
    raw=native.read_bytes();actual=git_blob_sha(raw)
    if actual!=EXPECTED_GIT_BLOB:
        raise SystemExit('PF51_FORK_SOURCE_DRIFT: expected '+EXPECTED_GIT_BLOB+', got '+actual)
    original=raw.decode('utf-8')
    updated=modify_source(original)
    guard=(BASE/'native'/'coopPersonalFleetMiningStartupFence.js').read_text('utf-8')
    if (a.fork_root/GUARD_REL).exists():raise SystemExit('PF51_EXISTING_NATIVE_FENCE_FILE_REFUSED')
    patch=make_patch(original,updated,guard)
    a.output.parent.mkdir(parents=True,exist_ok=True)
    a.output.write_text(patch,'utf-8')
    print('PF51_CREATED_REVIEW_PATCH',str(a.output),'source='+actual)
    print('PF51_NOT_APPLIED: inspect patch and run git apply --check in native WORK checkout')

if __name__=='__main__':main()