'use strict';
// Isolated child process deliberately killed at a precisely persisted boundary.
const {setup,nativeRow}=require('../../pf60/tests/fixture.cjs');
const {createScopedNativeCleanup}=require('../native/coopPersonalFleetScopedNativeCleanup.cjs');
const [dir,when]=process.argv.slice(2);
const f=setup({dir,afterCommit:result=>{
 if(when==='after-commit'&&result==='COMMITTED')process.kill(process.pid,'SIGKILL');
}});
const base=f.create();
if(base.prepare(f.c).status!=='PREPARED')throw Error('PF64_SETUP_PREPARE_FAIL');
const row=f.read('corporationRuntime',f.terminalKey(f.c.assignmentID));
f.put('corporationRuntime',f.terminalKey(f.c.assignmentID),{...row,phase:'ISSUING',dispatchCount:1});
let authority;
const store={PF61_SCOPED_ORIGINAL_NATIVE_CLEANUP_V1:true,
 installScopedOriginalTerminalCleanupAuthority:o=>{authority=o;return true;},
 removeScopedPersonalFleetTerminalNativeRows({command,capability}){
  if(authority.capability!==capability||authority.authorize(command)!==true)
   return {success:false};
  const original=nativeRow(f.c);
  if(original.entityID!==command.shipItemID)throw Error('FOREIGN_NATIVE_ROW');
  if(when==='during-native-write')process.kill(process.pid,'SIGKILL');
  throw Error('PF64_EXPECTED_SIGKILL_NOT_TRIGGERED');
 }};
const a=createScopedNativeCleanup({nativeStore:store,gameStore:f.root,enabled:()=>true,
 allWritersFenced:()=>true,verifyOriginalSceneVacant:()=>true,
 verifyExclusiveOwnership:()=>true,verifyOriginalTerminalWitness:()=>structuredClone(f.proof),
 clock:()=>1_800_000_000_000});
a.execute(f.c);
throw Error('PF64_EXPECTED_SIGKILL_NOT_TRIGGERED');
