'use strict';
/**
 * PF99: only authoritative source-wired entrypoints for PF91/PF92.
 *
 * Intended original path Code/server/src/space/coopPersonalFleetOriginalSessionBindings.js
 * alongside the original staged native permit and PF99 original session
 * witness. These entrypoints deliberately do NOT accept session verifier,
 * auth provider or docking proof callbacks from the caller.
 *
 * This is a review candidate; do NOT enable without original WORK E2E.
 */
const permit=require('./coopPersonalFleetOriginalNativePermit.cjs');
const source=require('./coopPersonalFleetOriginalSessionWitness.js');
const nativeEnabled=()=>process.env.EVEJS_COOP_PERSONAL_FLEET_NATIVE_WITNESS==='1';
const disabled=()=>Object.freeze({
 status:'BLOCKED',reason:'PF99_NATIVE_SESSION_OWNER_DISABLED',mayCommit:false
});

function createSourceBoundPlayerShipActivation({
 gameStore,pf52,enabled=()=>false,allWritersFenced=()=>false
}={}){
 const activation=permit.createOriginalPlayerShipActivation({
  gameStore,pf52,enabled:()=>nativeEnabled()&&enabled()===true,
  allWritersFenced,
  verifyOriginalDockedPlayerSession:source.verifyOriginalDockedPlayerSession
 });
 return Object.freeze({
  activate:request=>nativeEnabled()?activation.activate(request):disabled()
 });
}

function createSourceBoundCharacterRecordWriteBarrier({pf52}={}){
 const barrier=permit.createOriginalCharacterRecordWriteBarrier({
  pf52,verifyOriginalSessionLease:source.verifyOriginalSessionLease
 });
 return Object.freeze({
  inTransaction:request=>{
   if(!nativeEnabled())throw Error('PF99_NATIVE_SESSION_OWNER_DISABLED');
   return barrier.inTransaction(request);
  }
 });
}

module.exports=Object.freeze({
 createSourceBoundPlayerShipActivation,
 createSourceBoundCharacterRecordWriteBarrier
});
