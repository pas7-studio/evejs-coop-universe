'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../native/coopPersonalFleetOriginalDockCoordinator.js'),'utf8');
function fixture(cb){
 const row={version:1,phase:'DOCK_ISSUING',dockDispatchCount:1,
  operationID:'pf-return-100',assignmentID:'assignment-100',pilotID:'coop-pilot-100',
  shipItemID:800100,ownerCharacterID:900100,systemID:30000142,stationID:60000142,
  typeID:587,actorGeneration:2,reservationGeneration:3};
 const events=[],state={enabled:true,fenced:true,fail:null,needsCleanup:true,
  inspectPhase:'NATIVE_CLEARED'};
 const term={
  prepare:c=>{events.push('prepare');assert.equal(c.mode,'DOCK');
   assert.equal(c.generation,3);return state.fail==='prepare'?{status:'BLOCKED'}:
    {status:'PREPARED',needsCleanup:state.needsCleanup};},
  issue:c=>{events.push('issue');return state.fail==='issue'?{status:'OUTCOME_UNKNOWN'}:
   {status:'NEEDS_RECONCILIATION'};},
  reconcile:c=>{events.push('reconcile');return state.fail==='reconcile'?{status:'BLOCKED'}:
   {status:'NATIVE_CLEARED'};},
  finalize:c=>{events.push('finalize');return state.fail==='finalize'?{status:'BLOCKED'}:
   {status:'FINALIZED',shipItemID:c.shipItemID};},
  inspect:c=>{events.push('inspect');return {status:state.inspectPhase};}
 };
 const scoped={execute:()=>{events.push('PF66');if(state.fail==='PF66')return {success:false};
   if(state.fail==='async')return Promise.resolve({success:true});
   return {success:true};}};
 const deps={'./coopPersonalFleetScopedDock':{valid:r=>r?.phase==='DOCK_ISSUING'&&r?.shipItemID===800100}};
 const ctx={module:{exports:{}},require:s=>{if(!deps[s])throw Error('UNKNOWN_IMPORT');return deps[s];},Object,Set};
 vm.runInNewContext(source,ctx,{filename:'coopPersonalFleetOriginalDockCoordinator.js'});
 const build=()=>ctx.module.exports.createOriginalDockCoordinator({
  scopedDock:scoped,terminalCustody:term,enabled:()=>state.enabled,
  allWritersFenced:()=>state.fenced});
 cb({row,events,state,term,scoped,build});
}
test('ordered real PF66 docking then PF60 preparation, one-shot cleanup, and reconciliation',()=>fixture(f=>{
 const a=f.build(),out=a.execute(f.row);assert.equal(out.success,true);
 assert.equal(out.data.shipItemID,800100);
 assert.deepEqual(f.events,['PF66','prepare','issue','reconcile']);
 assert.equal(a.finalizeAfterPf56Dock(f.row).status,'FINALIZED');
 assert.equal(f.events.at(-1),'finalize');
}));
test('already-cleaned PF60 skips a second native cleanup effect',()=>fixture(f=>{
 f.state.needsCleanup=false;const result=f.build().execute(f.row);
 assert.equal(result.success,true);
 assert.deepEqual(f.events,['PF66','prepare','reconcile']);
}));
test('failed original dock never performs PF60 cleanup',()=>fixture(f=>{
 f.state.fail='PF66';assert.equal(f.build().execute(f.row).success,false);
 assert.deepEqual(f.events,['PF66']);
}));
test('unknown postcommit PF60 preparation stops without cleanup retry',()=>fixture(f=>{
 f.state.fail='prepare';assert.equal(f.build().execute(f.row).success,false);
 assert.deepEqual(f.events,['PF66','prepare']);
}));
test('unknown PF61 result remains a no-retry failure',()=>fixture(f=>{
 f.state.fail='issue';const a=f.build();assert.match(a.execute(f.row).errorMsg,/NO_RETRY/);
 assert.deepEqual(f.events,['PF66','prepare','issue']);
 assert.equal(a.execute(f.row).success,false);
 assert.deepEqual(f.events,['PF66','prepare','issue']);
}));
test('native cleanup not independently reconciled never returns success',()=>fixture(f=>{
 f.state.fail='reconcile';assert.match(f.build().execute(f.row).errorMsg,/UNPROVEN/);
 assert.deepEqual(f.events,['PF66','prepare','issue','reconcile']);
}));
test('do not acknowledge an async original docking side effect',()=>fixture(f=>{
 f.state.fail='async';assert.match(f.build().execute(f.row).errorMsg,/NO_RETRY/);
 assert.deepEqual(f.events,['PF66']);
}));
test('second call cannot redispatch PF66, including after success',()=>fixture(f=>{
 const a=f.build();assert.equal(a.execute(f.row).success,true);
 assert.match(a.execute(f.row).errorMsg,/REDISPATCH_FORBIDDEN/);
 assert.deepEqual(f.events,['PF66','prepare','issue','reconcile']);
}));
test('reconcile-only readback invokes neither PF66 nor PF61 native cleanup',()=>fixture(f=>{
 f.state.inspectPhase='ISSUING';const result=f.build().reconcileNativeCleanup(f.row);
 assert.equal(result.status,'NATIVE_CLEARED');
 assert.deepEqual(f.events,['inspect','reconcile']);
}));
test('already-cleared native rows need no additional write or re-issue',()=>fixture(f=>{
 f.state.inspectPhase='NATIVE_CLEARED';const result=f.build().reconcileNativeCleanup(f.row);
 assert.equal(result.status,'NATIVE_CLEARED');assert.deepEqual(f.events,['inspect']);
}));
test('foreign terminal phase blocks even readback-only reconciliation',()=>fixture(f=>{
 f.state.inspectPhase='UNKNOWN';assert.equal(f.build().reconcileNativeCleanup(f.row).status,'BLOCKED');
 assert.deepEqual(f.events,['inspect']);
}));
test('fencing revocation denies execute, reconcile and finalize without side effects',()=>fixture(f=>{
 const a=f.build();f.state.fenced=false;
 assert.equal(a.execute(f.row).success,false);
 assert.equal(a.reconcileNativeCleanup(f.row).status,'BLOCKED');
 assert.equal(a.finalizeAfterPf56Dock(f.row).status,'BLOCKED');
 assert.equal(f.events.length,0);
}));
test('disabled native feature cannot touch PF66 or PF60',()=>fixture(f=>{
 const a=f.build();f.state.enabled=false;assert.equal(a.execute(f.row).success,false);
 assert.equal(f.events.length,0);
}));
test('invalid original dock row never triggers any native side effect',()=>fixture(f=>{
 f.row.shipItemID=900001;
 const a=f.build();assert.equal(a.execute(f.row).success,false);
 assert.equal(f.events.length,0);
}));
test('missing source-owned terminal custody methods reject constructor',()=>fixture(f=>{
 delete f.term.finalize;assert.throws(()=>f.build(),/ORIGINAL_AUTHORITIES_REQUIRED/);
}));
