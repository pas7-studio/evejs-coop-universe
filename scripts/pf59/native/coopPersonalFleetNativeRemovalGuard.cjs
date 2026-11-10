'use strict';
/** PF59: prevent generic NPC cleanup from releasing original player ship custody.
 * NO native record, ItemStore item, wallet balance or PF claim is changed here.
 * This must be installed inside the original server before enabling PF58.
 */
const POSITIVE_ID = n => Number.isSafeInteger(n) && n > 0;
const originalMarker = row => !!row && typeof row === 'object' && (
  row.personalFleetOriginal === true ||
  row.operatorKind === 'PERSONAL_FLEET' ||
  row.entityType === 'personalFleet' ||
  row.npcEntityType === 'personalFleet'
);
const deny = reason => ({success:false,errorMsg:reason});
const featureEnabled = () => process.env.EVEJS_COOP_PERSONAL_FLEET_NATIVE_SHIP_ADOPTION === '1';
const LOCK_PREFIX='coop-personal-fleet\u001fhandoff-ship-v1:';
function createOriginalGameStoreLockReader(gameStore){
  const a=gameStore?.coopAtomicNativeRows;
  if(a?.mode!=='SERVER_INTERNAL_FLAGGED' ||
     typeof a.transact!=='function' || typeof a.isPoisoned!=='function')
    throw Error('PF59_ORIGINAL_GAMESTORE_AUTHORITY_REQUIRED');
  return entityID=>{
    if(a.isPoisoned())return {known:false};
    return a.transact(['corporationRuntime'],tx=>{
      const lock=tx.get('corporationRuntime',LOCK_PREFIX+entityID);
      return lock===undefined?{known:false}:{known:true,lock};
    });
  };
}

/** readShipLock MUST read the original corporationRuntime handoff-ship-v1 key,
 * and return {known:true, lock:null|object}. null = proven absent, undefined
 * = unreadable. Native Store alone cannot detect a partially deleted PF row.
 * PF56/PF57 still do not provide a validated terminal native cleanup permit:
 * even a 'lost' or 'docked' PF ship stays blocked from generic NPC cleanup.
 */
function createNativeRemovalGuard({readShipLock=null, enabled=featureEnabled}={}) {
  if (readShipLock!==null && typeof readShipLock!=='function')
    throw Error('PF59_ORIGINAL_LOCK_READER_INVALID');
  if(typeof enabled!=='function')throw Error('PF59_FEATURE_GATE_INVALID');
  function checkOriginalRemoval(entityID,nativeStore) {
    if(!POSITIVE_ID(entityID))return deny('PF59_ENTITY_ID_INVALID');
    if(typeof nativeStore?.getNativeEntity!=='function' ||
       typeof nativeStore?.getNativeController!=='function')
      return deny('PF59_NATIVE_STORE_UNAVAILABLE');
    let entity,controller;
    try {
      entity=nativeStore.getNativeEntity(entityID);
      controller=nativeStore.getNativeController(entityID);
    } catch { return deny('PF59_NATIVE_IDENTITY_READ_UNKNOWN'); }
    const marked=originalMarker(entity)||originalMarker(controller);
    // If the feature is on, the original durable lease/lock authority must
    // exist. Do not interpret a read failure as a missing lock.
    if(readShipLock===null) {
      if(marked)return deny('PF59_ORIGINAL_SHIP_GENERIC_CLEANUP_FORBIDDEN');
      try {return enabled()===true
        ?deny('PF59_ORIGINAL_LOCK_AUTHORITY_NOT_INSTALLED')
        :{success:true};}
      catch{return deny('PF59_FEATURE_GATE_UNKNOWN');}
    }
    let result;
    try {result=readShipLock(entityID);} catch {
      return deny('PF59_ORIGINAL_SHIP_LOCK_READ_UNKNOWN');
    }
    if(!result || result.known!==true ||
       !Object.prototype.hasOwnProperty.call(result,'lock') ||
       (result.lock!==null && (typeof result.lock!=='object'||Array.isArray(result.lock))))
      return deny('PF59_ORIGINAL_SHIP_LOCK_READ_UNKNOWN');
    if(marked || result.lock!==null)
      return deny('PF59_ORIGINAL_SHIP_GENERIC_CLEANUP_FORBIDDEN');
    // Recheck the feature gate even for ordinary entities. A malformed
    // feature callback must never silently authorize removal.
    try {if(typeof enabled()!=='boolean')return deny('PF59_FEATURE_GATE_UNKNOWN');}
    catch{return deny('PF59_FEATURE_GATE_UNKNOWN');}
    return {success:true};
  }
  return Object.freeze({checkOriginalRemoval});
}

let installed=null;
function installOriginalRemovalAuthority({gameStore}={}) {
  if(installed!==null)throw Error('PF59_AUTHORITY_ALREADY_INSTALLED');
  const readShipLock=createOriginalGameStoreLockReader(gameStore);
  installed=createNativeRemovalGuard({readShipLock});
  return true;
}
function checkOriginalRemoval(entityID,nativeStore) {
  return (installed || createNativeRemovalGuard()).checkOriginalRemoval(entityID,nativeStore);
}
module.exports={createNativeRemovalGuard,createOriginalGameStoreLockReader,
 installOriginalRemovalAuthority,checkOriginalRemoval};
