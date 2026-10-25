"use strict";
/**
 * LW-03 phase control plane for the EXISTING 30-second Living World clock.
 *
 * Not a scheduler, game authority, inventory ledger, wallet or executor.
 * This only names and orders the phases already invoked by the world tick.
 * It intentionally does not await promises returned by native phases:
 * the original owner of a native async transaction remains responsible for
 * its own single-flight lock, journal and outcome reconciliation.
 */
const VALID_PHASE=/^[a-z][a-z0-9:-]{0,95}$/;
function createPhaseCoordinator({execute,clock=()=>Date.now(),onCycle=()=>{}}={}){
 if(typeof execute!=="function"||typeof clock!=="function"||
    typeof onCycle!=="function")
  throw Error("LIVING_WORLD_PHASE_COORDINATOR_DEPENDENCIES_REQUIRED");
 let active=false,sequence=0,last=null;
 function snapshot(){
  return {active,sequence,last:last?{
   ...last,phaseNames:last.phaseNames.slice()
  }:null};
 }
 function tick(run){
  if(typeof run!=="function")throw Error("LIVING_WORLD_TICK_CALLBACK_REQUIRED");
  // No second clock and no nested/duplicate phase dispatch if another
  // callback tries to enter the same native owner synchronously.
  if(active)return {status:"REENTRANT_SKIPPED",sequence,nativeMutation:false};
  const startedAt=clock();
  active=true;sequence++;
  const names=[];let phaseCount=0,status="COMPLETED";
  const phase=(name,fn)=>{
   if(typeof name!=="string"||!VALID_PHASE.test(name)||typeof fn!=="function")
    throw Error("LIVING_WORLD_PHASE_INVALID");
   phaseCount++;
   // Observability is bounded; execution is NOT truncated.
   if(names.length<128)names.push(name);
   // Preserve exactly the old safeNpcPhase error boundary and sync order.
   return execute(name,fn);
  };
  try{
   run(phase);
   return {status:"COMPLETED",sequence,phaseCount};
  }catch(error){
   status="THREW";
   // Do not convert an unhandled world error into a false successful tick.
   throw error;
  }finally{
   active=false;
   let endedAt=startedAt;
   try{endedAt=clock()}catch(_ignored){}
   last=Object.freeze({sequence,status,startedAt,
    durationMs:Number.isFinite(endedAt-startedAt)?
     Math.max(0,endedAt-startedAt):0,phaseCount,
    phaseNames:Object.freeze(names.slice())});
   // Operator telemetry is diagnostic only: never change a game outcome.
   try{onCycle(snapshot().last)}catch(_ignored){}
  }
 }
 return Object.freeze({tick,snapshot});
}
module.exports={createPhaseCoordinator};
