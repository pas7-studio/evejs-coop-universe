'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {setup,nativeRow}=require('../../pf60/tests/fixture.cjs');
const {createScopedNativeCleanup}=require('../native/coopPersonalFleetScopedNativeCleanup.cjs');
const run=(fn,options)=>{const f=setup(options);try{fn(f);}finally{f.close();}};
function makeStore(f){
 let authority=null;const state={entity:nativeRow(f.c),controller:nativeRow(f.c,true),
  modules:[],cargo:[],writes:0,failAfterController:false};
 const store={PF61_SCOPED_ORIGINAL_NATIVE_CLEANUP_V1:true,
  installScopedOriginalTerminalCleanupAuthority({capability,authorize}){
   if(authority)throw Error('ALREADY_INSTALLED');
   assert.equal(typeof capability,'symbol');
   authority={capability,authorize};return true;
  },
  removeScopedPersonalFleetTerminalNativeRows({command,capability}){
   if(!authority||authority.capability!==capability||!authority.authorize(command))
    return {success:false,errorMsg:'UNAUTHORIZED'};
   const match=row=>!row||(row.entityID===command.shipItemID&&
    row.personalFleetOriginal===true&&row.personalFleetAssignmentID===command.assignmentID&&
    row.personalFleetGeneration===command.generation&&
    row.personalFleetPilotID===command.pilotID);
   if(!match(state.entity)||!match(state.controller)||state.modules.length||state.cargo.length)
    return {success:false,errorMsg:'FOREIGN_NATIVE_ASSET'};
   state.writes++;state.controller=null;
   if(state.failAfterController)throw Error('NATIVE_WRITE_UNKNOWN');
   state.entity=null;
   return {success:true};
  },state,getCapability:()=>authority?.capability};
 return store;
}
function admit(f){const a=f.create();
 assert.equal(a.prepare(f.c).status,'PREPARED');
 const row=f.read('corporationRuntime',f.terminalKey(f.c.assignmentID));
 f.put('corporationRuntime',f.terminalKey(f.c.assignmentID),
  {...row,phase:'ISSUING',dispatchCount:1});
}
const create=(f,s)=>createScopedNativeCleanup({nativeStore:s,gameStore:f.root,
 enabled:()=>f.flags.enabled,allWritersFenced:()=>f.flags.writers,
 verifyOriginalSceneVacant:()=>f.physical.sceneAbsent,
 verifyExclusiveOwnership:()=>f.flags.exclusive,
 verifyOriginalTerminalWitness:()=>structuredClone(f.proof)});
test('exact PF60 durable ISSUING permits ONE original entity/controller cleanup',()=>run(f=>{
 admit(f);const s=makeStore(f),a=create(f,s);
 assert.deepEqual(a.execute(f.c),{success:true,data:{shipItemID:f.c.shipItemID,requiresPF60Reconcile:true}});
 assert.equal(s.state.writes,1);assert.equal(s.state.entity,null);assert.equal(s.state.controller,null);
 assert.equal(a.execute(f.c).errorMsg,'PF61_EXECUTOR_ALREADY_ATTEMPTED');
 assert.equal(s.state.writes,1);
}));
test('no PF60 ISSUING intent cannot install unauthorized cleanup',()=>run(f=>{
 const s=makeStore(f),a=create(f,s);
 assert.equal(a.execute(f.c).errorMsg,'PF61_DURABLE_INTENT_OR_NATIVE_WITNESS_UNVERIFIED');
 assert.equal(s.state.writes,0);
}));
test('PF60 PREPARED cannot authorize cleanup before committed issue',()=>run(f=>{
 f.create().prepare(f.c);const s=makeStore(f),a=create(f,s);
 assert.equal(a.execute(f.c).success,false);
 assert.equal(s.state.writes,0);
}));
test('PF60 terminal command identity, generation, signature cannot be substituted',()=>run(f=>{
 admit(f);const s=makeStore(f),a=create(f,s);
 for(const alter of [{operationID:'forged'},{ownerCharacterID:987},
  {pilotID:'coop-pilot-999'},{generation:100},{actorGeneration:100},
  {assignmentID:'foreign'},{systemID:600},{typeID:55}]){
  assert.equal(a.execute({...f.c,...alter}).success,false);
 }
 assert.equal(s.state.writes,0);
}));
test('missing original scene vacancy or changed witness blocks cleanup',()=>run(f=>{
 admit(f);const s=makeStore(f),a=create(f,s);
 f.physical.sceneAbsent=false;assert.equal(a.execute(f.c).success,false);
 f.physical.sceneAbsent=true;f.proof.receiptHash='b'.repeat(64);
 assert.equal(a.execute(f.c).success,false);assert.equal(s.state.writes,0);
}));
test('durable PF58 handoff ship lock cannot be missing or changed',()=>run(f=>{
 admit(f);const s=makeStore(f),a=create(f,s);
 f.put('corporationRuntime',f.LOCK+f.c.shipItemID,{assignmentID:'other',sourcePF54Hash:'bad'});
 assert.equal(a.execute(f.c).success,false);
 assert.equal(s.state.writes,0);
}));
test('writer lease revoked and poisoned GameStore block all scoped operations',()=>run(f=>{
 admit(f);const s=makeStore(f),a=create(f,s);
 f.flags.writers=false;assert.equal(a.execute(f.c).success,false);
 f.flags.writers=true;f.root.coopAtomicNativeRows.poison=true;
 assert.equal(a.execute(f.c).success,false);assert.equal(s.state.writes,0);
}));
test('capability is a per-process opaque symbol; direct method without it blocked',()=>run(f=>{
 admit(f);const s=makeStore(f),a=create(f,s);
 assert.equal(s.removeScopedPersonalFleetTerminalNativeRows({command:f.c,capability:Symbol('other')}).errorMsg,'UNAUTHORIZED');
 assert.equal(a.execute(f.c).success,true);assert.equal(s.state.writes,1);
}));
test('native partial write is UNKNOWN and never retried by this executor',()=>run(f=>{
 admit(f);const s=makeStore(f),a=create(f,s);s.state.failAfterController=true;
 assert.equal(a.execute(f.c).errorMsg,'PF61_NATIVE_WRITE_OUTCOME_UNKNOWN');
 assert.ok(s.state.entity);assert.equal(s.state.controller,null);
 assert.equal(a.execute(f.c).errorMsg,'PF61_EXECUTOR_ALREADY_ATTEMPTED');
 assert.equal(s.state.writes,1);
}));
test('native store refusal is not treated as successful deletion',()=>run(f=>{
 admit(f);const s=makeStore(f),a=create(f,s);s.state.cargo.push({cargoID:10});
 assert.equal(a.execute(f.c).errorMsg,'PF61_NATIVE_WRITE_OUTCOME_UNKNOWN');
 assert.equal(s.state.writes,0);
}));
test('no native patched source marker or incorrect authority causes boot failure',()=>run(f=>{
 const s=makeStore(f);delete s.PF61_SCOPED_ORIGINAL_NATIVE_CLEANUP_V1;
 assert.throws(()=>create(f,s),/AUTHORITIES_REQUIRED/);
}));
test('a separate trusted auth owner cannot reinstall in same patched store',()=>run(f=>{
 const s=makeStore(f);create(f,s);
 assert.throws(()=>create(f,s),/ALREADY_INSTALLED/);
}));
