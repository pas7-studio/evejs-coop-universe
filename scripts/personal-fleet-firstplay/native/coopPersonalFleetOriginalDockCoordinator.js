'use strict';
/** One-shot PF66 -> PF60/PF61 cleanup -> PF56 reconcile -> PF60 finalize.
 * No implicit retries and no direct ItemStore or NPC row mutation here.
 * Must be constructed solely by the original native WORK bootstrap.
 */
const pf66=require('./coopPersonalFleetScopedDock');
const valid=pf66.valid;
const err=reason=>Object.freeze({success:false,errorMsg:reason});
function asTerminal(row){return Object.freeze({mode:'DOCK',
 operationID:row.operationID,assignmentID:row.assignmentID,
 pilotID:row.pilotID,shipItemID:row.shipItemID,
 ownerCharacterID:row.ownerCharacterID,systemID:row.systemID,
 generation:row.reservationGeneration,actorGeneration:row.actorGeneration,
 typeID:row.typeID,stationID:row.stationID});}
function createOriginalDockCoordinator({scopedDock,terminalCustody,
 enabled=()=>false,allWritersFenced=()=>false}={}){
 if(typeof valid!=='function'||typeof scopedDock?.execute!=='function'||
    ['prepare','issue','reconcile','finalize','inspect'].some(x=>typeof terminalCustody?.[x]!=='function')||
    typeof enabled!=='function'||typeof allWritersFenced!=='function')
  throw Error('PF_DOCK_COORDINATOR_ORIGINAL_AUTHORITIES_REQUIRED');
 const attempted=new Set();
 const on=()=>enabled()===true&&allWritersFenced()===true;
 function execute(row){
  if(!on()||!valid(row))return err('PF_DOCK_COORDINATOR_DISABLED_OR_INVALID');
  const id=row.assignmentID+':'+row.reservationGeneration;
  if(attempted.has(id))return err('PF_DOCK_COORDINATOR_REDISPATCH_FORBIDDEN');
  attempted.add(id); // Sticky even when a downstream original effect fails.
  const c=asTerminal(row);
  try{
   const dock=scopedDock.execute(row);
   if(dock?.then||dock?.success!==true)
    return err('PF66_DOCK_EFFECT_UNKNOWN_NO_RETRY');
   const prep=terminalCustody.prepare(c);
   if(prep?.then||prep?.status!=='PREPARED')
    return err('PF60_PREPARE_UNKNOWN_NO_RETRY');
   if(prep.needsCleanup===true){
    const issued=terminalCustody.issue(c);
    if(issued?.then||issued?.status!=='NEEDS_RECONCILIATION')
     return err('PF61_CLEANUP_OUTCOME_UNKNOWN_NO_RETRY');
   }else if(prep.needsCleanup!==false){
    return err('PF60_NATIVE_CLEANUP_STATE_UNKNOWN_NO_RETRY');
   }
   const final=terminalCustody.reconcile(c);
   if(final?.then||final?.status!=='NATIVE_CLEARED')
    return err('PF60_NATIVE_CLEAR_UNPROVEN_NO_RETRY');
   return {success:true,data:{shipItemID:row.shipItemID,
    requiresPF56DockReconcile:true,requiresPF60Finalize:true}};
  }catch{return err('PF_DOCK_ORIGINAL_EFFECT_OUTCOME_UNKNOWN_NO_RETRY');}
 }
 // Readback-only after crash; it MUST NOT invoke the PF66 dock writer or
 // PF61 cleanup writer again even if PF60 remains stuck ISSUING.
 function reconcileNativeCleanup(row){
  if(!on()||!valid(row))return {status:'BLOCKED',reason:'PF_DOCK_RECONCILE_INVALID'};
  const c=asTerminal(row);
  try{
   const state=terminalCustody.inspect({assignmentID:row.assignmentID});
   if(!state||!['PREPARED','ISSUING','NATIVE_CLEARED'].includes(state.status))
    return {status:'BLOCKED',reason:'PF_DOCK_TERMINAL_NOT_ELIGIBLE'};
   const result=state.status==='NATIVE_CLEARED'?state:terminalCustody.reconcile(c);
   return result?.status==='NATIVE_CLEARED'?{status:'NATIVE_CLEARED',shipItemID:row.shipItemID}:
    {status:'BLOCKED',reason:'PF_DOCK_NATIVE_CLEANUP_NOT_PROVEN'};
  }catch{return {status:'BLOCKED',reason:'PF_DOCK_NATIVE_RECONCILE_UNCERTAIN'};}
 }
 // PF60 itself verifies a committed PF56 DOCKED receipt, original ItemStore
 // custody, absent native rows, and lock signature before releasing the lock.
 function finalizeAfterPf56Dock(row){
  if(!on()||!valid(row))return {status:'BLOCKED',reason:'PF_DOCK_FINALIZE_INVALID'};
  try{return terminalCustody.finalize(asTerminal(row));}
  catch{return {status:'BLOCKED',reason:'PF_DOCK_FINALIZE_UNCERTAIN'};}
 }
 return Object.freeze({execute,reconcileNativeCleanup,finalizeAfterPf56Dock});
}
module.exports=Object.freeze({createOriginalDockCoordinator,asTerminal});
