#!/usr/bin/env python3
"""PF87: pin and patch ORIGINAL EveJS GameStore atomic writer in isolated WORK."""
from __future__ import annotations
import difflib
import hashlib
from pathlib import Path

PATH=Path('Code/server/src/space/coopGameStoreAtomic.js')
ORIGINAL_GIT_BLOB='2b28b48145f3fbc989ce7346384487ee75e52280'

def one(src:str,before:str,after:str)->str:
 if src.count(before)!=1:
  raise ValueError('PF87_STOCK_ATOMIC_PATCH_SOURCE_DRIFT: '+before[:90])
 return src.replace(before,after,1)

def build(work:Path)->str:
 raw=(work/PATH).read_bytes()
 git_blob=hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest()
 if git_blob!=ORIGINAL_GIT_BLOB:
  raise ValueError('PF87_ORIGINAL_ATOMIC_BLOB_CHANGED: '+git_blob)
 old=raw.decode('utf-8')
 s=old
 s=one(s,'  let cargoWitness=null;\n',
  '  let cargoWitness=null,entityWitness=null,entityPolicy=null,entityIsolation=null;\n')
 s=one(s,'  try{\n    ensureSqliteReady();\n','''  try{
    // PF87 applies ONLY to a source-owned one-NPC receipt contract.
    // Invalid policies are rejected before any SQLite/native side effect.
    if(options?.contract==='personal-fleet-entity-receipt-v1'){
      entityIsolation=require('./coopPersonalFleetNativeEntityIsolation');
      entityPolicy=entityIsolation.policyFor(tables,options,process.env);
      if(!entityPolicy||!Array.isArray(sqliteStore.rowGroupsFor?.('npcEntities'))||
         sqliteStore.rowGroupsFor('npcEntities').join(',')!=='entities'||
         typeof sqliteStore.applyRowToObject!=='function'||
         typeof advanceFlushBaseline!=='function')
        throw Error('PF87_ORIGINAL_NPC_ROW_SHAPE_UNAVAILABLE');
    }
    ensureSqliteReady();
''')
 s=one(s,'     if(activeTransient&&!mixedMode)\n',
  '     if(activeTransient&&!mixedMode&&!(entityPolicy&&t==="npcEntities"))\n')
 s=one(s,'''     if(activeTransient){
       cargoWitness=isolation.capture({paths:transientPaths[t],
         live:cache[t],durable:sqliteStore.loadTableObject(t)});
     }
''','''     if(activeTransient){
       if(entityPolicy&&t==='npcEntities')
         entityWitness=entityIsolation.capture({paths:transientPaths[t],
           live:cache[t],durable:sqliteStore.loadTableObject(t),
           shipItemID:entityPolicy.shipItemID});
       else cargoWitness=isolation.capture({paths:transientPaths[t],
         live:cache[t],durable:sqliteStore.loadTableObject(t)});
     }
''')
 s=one(s,'''    const outcome=sqliteWriter.transact(tables,cargoWitness?
      tx=>{
       const guarded=isolation.guardMutation(tx,cargoWitness,cargoContract);
       const returned=mutation(guarded);
       guarded.assertWriteSetComplete();
       return returned;
      }:mutation);
''','''    const outcome=sqliteWriter.transact(tables,cargoWitness||entityPolicy?
      tx=>{
       const guarded=entityPolicy?
         entityIsolation.guardMutation(tx,entityPolicy):
         isolation.guardMutation(tx,cargoWitness,cargoContract);
       const returned=mutation(guarded);
       guarded.assertWriteSetComplete();
       return returned;
      }:mutation);
''')
 s=one(s,'    committed=true;\n','''    committed=true;
    if(entityWitness)entityIsolation.verifyShadow({witness:entityWitness,
      paths:transientPaths.npcEntities,live:cache.npcEntities});
''')
 s=one(s,'''    const writeSets=outcome&&outcome.writes&&typeof outcome.writes==="object"?outcome.writes:null;
''','''    const writeSets=outcome&&outcome.writes&&typeof outcome.writes==="object"?outcome.writes:null;
    if(entityPolicy&&(!writeSets||
       (writeSets.npcEntities||[]).some(([key])=>
         key!=='entities'+SEP+entityPolicy.shipItemID)))
      throw Error('PF87_UNSCOPED_OR_UNKNOWN_POSTCOMMIT_NPC_WRITES');
''')
 s=one(s,'''    if(accountsTouched&&invalidateNativeAccounts("commit",tables)!==true)
      throw Error("NATIVE_ACCOUNT_CACHE_INVALIDATION_FAILED");
''','''    if(accountsTouched&&invalidateNativeAccounts("commit",tables)!==true)
      throw Error("NATIVE_ACCOUNT_CACHE_INVALIDATION_FAILED");
    if(entityWitness)entityIsolation.verifyShadow({witness:entityWitness,
      paths:transientPaths.npcEntities,live:cache.npcEntities});
''')
 return ''.join(difflib.unified_diff(old.splitlines(keepends=True),
  s.splitlines(keepends=True),fromfile='a/'+str(PATH),tofile='b/'+str(PATH)))
