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

function createSourceBoundPlayerShipActivation({
 gameStore,pf52,enabled=()=>false,allWritersFenced=()=>false
}={}){
 return permit.createOriginalPlayerShipActivation({
  gameStore,pf52,enabled,allWritersFenced,
  verifyOriginalDockedPlayerSession:source.verifyOriginalDockedPlayerSession
 });
}

function createSourceBoundCharacterRecordWriteBarrier({pf52}={}){
 return permit.createOriginalCharacterRecordWriteBarrier({
  pf52,verifyOriginalSessionLease:source.verifyOriginalSessionLease
 });
}

module.exports=Object.freeze({
 createSourceBoundPlayerShipActivation,
 createSourceBoundCharacterRecordWriteBarrier
});
