'use strict';
/**
 * Single composition point for the FIRST playable EveJS Personal Fleet.
 * This is original-server-only code: no client/HTTP API can provide hooks,
 * receipts, NPC profiles or a replacement GameStore.
 *
 * The module creates the real original server adaptors in dependency order,
 * and publishes /pf LAST. If any constructor fails, the shared ready gate
 * stays false even when an older PF58 singleton has been partially installed.
 *
 * The original fork MUST implement and install real writer, wallet, actor,
 * native-order and docking hooks. No arbitrary success functions are supplied.
 */
const core=require('./coopPersonalFleetOriginalSourceBindings');
const originalWalletAuthority=require('./coopPersonalFleetOriginalWalletAuthority');
const originalOrderAck=require('./coopPersonalFleetOriginalDurableOrderAck');
const originalDockCompletion=require('./coopPersonalFleetOriginalDockCompletionWitness');
const nativeScopedDock=require('./coopPersonalFleetScopedDock');
const originalTerminalSources=require('./coopPersonalFleetOriginalTerminalDockSources');
const originalDockCoordinator=require('./coopPersonalFleetOriginalDockCoordinator');
const originalNativeCleanup=require('./coopPersonalFleetScopedNativeCleanup');
const originalTerminalCustody=require('./coopPersonalFleetTerminalCustody');
const offers=require('./coopPersonalFleetOriginalOfferAuthority');
const commands=require('./coopPersonalFleetWorkCommandOwner');
const originalOrderWitness=require('./coopPersonalFleetOriginalOrderWitness');
const originalOrderExecutor=require('./coopPersonalFleetOriginalOrderExecutor');
const originalStationDwell=require('./coopPersonalFleetOriginalStationDwell');
const originalStationTickDriver=require('./coopPersonalFleetOriginalStationTickDriver');
const chat=require('./coopPersonalFleetChatGateway');
const pf52=require('./coopPersonalFleetHangarBridge');
const pf53=require('./coopPersonalFleetPaidHiring');
const pf54=require('./coopPersonalFleetOriginalDeployment');
const pf55=require('./coopPersonalFleetNativeOrders');
const pf56=require('./coopPersonalFleetReturnDock');
const pf58=require('./coopPersonalFleetNativeBootstrap');
const stockItemStore=require('../services/inventory/itemStore');
const originalNpcStore=require('./npc/nativeNpcStore');
const originalNpcService=require('./npc/nativeNpcService');
const originalNpcRegistry=require('./npc/npcRegistry');
const originalSessionRegistry=require('../services/chat/sessionRegistry');
const originalRuntime=require('./runtime');

const positive=x=>Number.isSafeInteger(x)&&x>0;
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const HOOKS=Object.freeze([
 'verifyOriginalWriterHooks','allWritersFenced','allWalletWritersFenced',
 'verifyShipAvailable','verifyRelease','verifyOriginalEquipment',
 'verifyOriginalDeploymentAuthority','verifyExclusiveOwnership',
 'verifyOriginalActor','independentOriginalActorWitness',
 'originalStationUndockPoint','originalOwnershipWitness',
 'verifyNativeFlight','verifyOriginalReturnOrder',
 'verifyOriginalManifest','verifyFinalOriginalManifest',
 'verifyOriginalDockedPlayerSession',
 'readOriginalWarShipClaim',
]);
let booted=false;
let attempted=false;
let startupInProgress=false;

function assertSourceHooks(hooks){
 if(!object(hooks)||hooks.source!=='ORIGINAL_EVEJS_PERSONAL_FLEET_BOOT_OWNER_V1'||
    !HOOKS.every(k=>typeof hooks[k]==='function')||
    !object(hooks.claimsPolicy)||
    hooks.claimsPolicy.KEY!=='coop-personal-fleet\u001factor-claims-v1'||
    typeof hooks.claimsPolicy.validate!=='function'||
    typeof hooks.claimsPolicy.empty!=='function'||
    !object(hooks.sharedOriginalNpcOrderArbiter)||
    !['issue','blocked','snapshot','retainWithNativeProof','blocksForSystem'].every(k=>
      typeof hooks.sharedOriginalNpcOrderArbiter[k]==='function'))
  throw Error('PF_FIRSTPLAY_ORIGINAL_BOOT_HOOKS_REQUIRED');
 // A fake read-only stand-in or caller-chosen stock module must not substitute
 // for the physical original EveJS objects. These must be module singletons.
 if(hooks.gameStore!==undefined||hooks.stockItemStore!==undefined||
    hooks.originalRuntime!==undefined||hooks.sessionRegistry!==undefined||
    hooks.nativeNpcStore!==undefined||hooks.nativeNpcService!==undefined||
    hooks.nativeNpcRegistry!==undefined||hooks.access!==undefined)
  throw Error('PF_FIRSTPLAY_NATIVE_OWNER_MODULE_OVERRIDE_FORBIDDEN');
}
function assertReadiness(hooks,original){
 const a=original.gameStore?.coopAtomicNativeRows;
 if(a?.mode!=='SERVER_INTERNAL_FLAGGED'||typeof a.transact!=='function'||
    a.isPoisoned?.()!==false||
    stockItemStore?.findItemById===undefined||
    typeof stockItemStore.moveShipToSpace!=='function'||
    originalNpcService.PF58_ORIGINAL_ITEMSTORE_BRIDGE_V1!==true||
    originalNpcService.PF66_SCOPED_DOCK_SCENE_DETACH_V1!==true||
    originalNpcStore.PF61_SCOPED_ORIGINAL_NATIVE_CLEANUP_V1!==true||
    typeof originalNpcStore.installScopedOriginalTerminalCleanupAuthority!=='function'||
    typeof originalNpcStore.removeScopedPersonalFleetTerminalNativeRows!=='function'||
    typeof originalRuntime.scenes?.get!=='function'||
    typeof originalNpcRegistry.getControllerByEntityID!=='function'||
    !positive(Date.now()))throw Error('PF_FIRSTPLAY_STOCK_NATIVE_BRIDGE_MISSING');
 // Flags are not evidence of writer fencing; all hooks must independently
 // attest that original player, ItemStore, Mining, WAR, Exploration and wallet
 // writers are under the original ownership boundary.
 if(hooks.verifyOriginalWriterHooks()!==true||
    hooks.allWritersFenced()!==true||
    hooks.allWalletWritersFenced()!==true)
  throw Error('PF_FIRSTPLAY_ORIGINAL_WRITER_HOOKS_NOT_INSTALLED');
}
function createOriginalWorkBootstrap({authoredCatalog,originalHooks}={}){
 if(booted||attempted||startupInProgress)throw Error('PF_FIRSTPLAY_ALREADY_BOOTED_OR_FAILED_STICKY');
 if(!Array.isArray(authoredCatalog)||authoredCatalog.length===0)
  throw Error('PF_FIRSTPLAY_REAL_NPC_CATALOG_EMPTY');
 assertSourceHooks(originalHooks);
 // A failed PF58 singleton/chat publication is not safe to retry in-process.
 attempted=true;
 startupInProgress=true;
 let ready=false;
 const enabled=()=>ready&&
   process.env.EVEJS_COOP_PERSONAL_FLEET_NATIVE==='1'&&
   process.env.EVEJS_COOP_PERSONAL_FLEET_CHAT==='1'&&
   process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS==='1'&&
   originalHooks.verifyOriginalWriterHooks()===true&&
   originalHooks.allWritersFenced()===true&&
   originalHooks.allWalletWritersFenced()===true;
 try{
  const original=core.createOriginalSourceBindings();
  assertReadiness(originalHooks,original);
  // The original EveJS ID issuer and wallet notification sources are now
  // native imports, not injectable callbacks from an operator or client.
  const wallet=originalWalletAuthority.createOriginalWalletAuthority();
  const gameStore=original.gameStore,access=original.access;
  const offer=offers.createSourceBoundOriginalOfferAuthority({gameStore,pf52,pf53,
    access,authoredCatalog,enabled,
    allWalletWritersFenced:originalHooks.allWalletWritersFenced});
  const paid=pf53.createPersonalFleetPaidHiring({gameStore,pf52,access,
    resolveNativeOffer:offer.resolveNativeOffer,
    verifyOriginalNpcPilot:offer.verifyOriginalNpcPilot,
    verifyNativeEmployer:offer.verifyNativeEmployer,
    originalTransactionID:wallet.originalTransactionID,
    verifyJournalID:wallet.verifyJournalID,
    notifyOriginalWallet:wallet.notifyOriginalWallet,
    allWalletWritersFenced:originalHooks.allWalletWritersFenced,enabled});
  const hangar=pf52.createPersonalFleetHangarBridge({gameStore,access,
    // PF53 is the only hire command here. Importing another paid hire through
    // PF52 is intentionally disallowed; it cannot mint employment twice.
    verifyPaidHire:()=>false,
    verifyShipAvailable:(c,tx)=>
      originalHooks.verifyShipAvailable(c,tx)===true&&
      offer.verifyHiredPilotHull({session:c.session,ownerCharacterID:c.ownerCharacterID,
        pilotID:c.pilotID,shipTypeID:c.stockItem?.typeID},tx)===true,
    verifyRelease:originalHooks.verifyRelease,
    enabled,allWritersFenced:originalHooks.allWritersFenced});
  let nativeHandoff=null;
  const deploy=pf54.createOriginalDeploymentBridge({gameStore,pf52,
    claimsPolicy:originalHooks.claimsPolicy,access,
    verifyOriginalEquipment:originalHooks.verifyOriginalEquipment,
    verifyOriginalDeploymentAuthority:(c,tx)=>
      originalHooks.verifyOriginalDeploymentAuthority(c,tx)===true&&
      offer.verifyHiredPilotHull({session:c.session,ownerCharacterID:c.ownerCharacterID,
        pilotID:c.pilotID,shipTypeID:c.stockItem?.typeID},tx)===true,
    verifyExclusiveOwnership:originalHooks.verifyExclusiveOwnership,
    executeOriginalHandoff:row=>{
      if(!nativeHandoff||!enabled())throw Error('PF_FIRSTPLAY_HANDOFF_NOT_INSTALLED');
      return nativeHandoff.executeOriginalHandoff(row);
    },
    verifyOriginalActor:originalHooks.verifyOriginalActor,
    enabled,allWritersFenced:originalHooks.allWritersFenced});
  // These are original-source read-only witnesses, not operator callbacks.
  // The native PF55 issue/reconcile transactions must include characters.
  const orderWitness=originalOrderWitness.createOriginalOrderWitness({
    enabled,allWritersFenced:originalHooks.allWritersFenced});
  // The physical command bridge uses the EXISTING shared stock order arbiter,
  // never creates a second independent arbiter for Personal Fleet.
  const durableOrderAck=originalOrderAck.createOriginalDurableOrderAck({
    orderWitness,enabled,allWritersFenced:originalHooks.allWritersFenced});
  const originalPhysicalOrders=originalOrderExecutor.createOriginalOrderExecutor({
    sharedOriginalArbiter:originalHooks.sharedOriginalNpcOrderArbiter,
    readOriginalWarShipClaim:originalHooks.readOriginalWarShipClaim,
    orderWitness,orderReceipt:durableOrderAck,enabled,allWritersFenced:originalHooks.allWritersFenced});
  // Original stock ItemStore, scene/registry and SDE station geometry must
  // agree on each tick. A process restart changes the unforgeable scene epoch;
  // no prior dwell can authorize the new process to dock.
  const stationDwell=originalStationDwell.createOriginalStationDwell({
    orderWitness,enabled,allWritersFenced:originalHooks.allWritersFenced});
  const orders=pf55.createPersonalFleetNativeOrders({gameStore,pf52,access,
    verifyExclusiveOwnership:originalHooks.verifyExclusiveOwnership,
    verifyNativeActor:orderWitness.verifyNativeActor,
    verifyTarget:orderWitness.verifyTarget,
    verifyOriginalControl:orderWitness.verifyOriginalControl,
    nativeExecutor:originalPhysicalOrders,
    verifyPersistedNativeOrder:durableOrderAck.verifyPersistedNativeOrder,
    enabled,allWritersFenced:originalHooks.allWritersFenced});
  // PF66 moves the ONE original ItemStore hull and consumes its original
  // scene-detach capability exactly once. PF60/PF61 later clean native rows;
  // the independent readback refuses PF56 release before that cleanup.
  const scopedDock=nativeScopedDock.createScopedDock({gameStore,
    originalItemStore:stockItemStore,nativeNpcService:originalNpcService,
    claimsPolicy:originalHooks.claimsPolicy,
    verifyOriginalDockReady:stationDwell.verifyOriginalDockReady,
    verifyExclusiveOwnership:originalHooks.verifyExclusiveOwnership,
    enabled,allWritersFenced:originalHooks.allWritersFenced});
  // PF60/PF61 are the ONLY original native cleanup writers after PF66's
  // one-use station dock. A crash never permits redispatching either writer.
  const terminalSources=originalTerminalSources.createOriginalTerminalDockSources({
    enabled,allWritersFenced:originalHooks.allWritersFenced,
    verifyExclusiveOwnership:originalHooks.verifyExclusiveOwnership,
    verifyFinalOriginalManifest:originalHooks.verifyFinalOriginalManifest});
  const scopedCleanup=originalNativeCleanup.createScopedNativeCleanup({
    nativeStore:originalNpcStore,gameStore,
    enabled,allWritersFenced:originalHooks.allWritersFenced,
    verifyOriginalSceneVacant:terminalSources.verifyOriginalSceneVacant,
    verifyExclusiveOwnership:originalHooks.verifyExclusiveOwnership,
    verifyOriginalTerminalWitness:terminalSources.verifyOriginalTerminalWitness});
  const terminalCustody=originalTerminalCustody.createTerminalCustody({
    gameStore,pf52,claimsPolicy:originalHooks.claimsPolicy,
    authenticateCommand:terminalSources.authenticateCommand,
    verifyExclusiveOwnership:originalHooks.verifyExclusiveOwnership,
    verifyOriginalTerminalWitness:terminalSources.verifyOriginalTerminalWitness,
    readNativeIdentity:terminalSources.readNativeIdentity,
    executeScopedNativeCleanup:scopedCleanup.execute,
    enabled,allWritersFenced:originalHooks.allWritersFenced});
  const dockCoordinator=originalDockCoordinator.createOriginalDockCoordinator({
    scopedDock,terminalCustody,enabled,
    allWritersFenced:originalHooks.allWritersFenced});
  const dockCompletion=originalDockCompletion.createOriginalDockCompletionWitness({
    enabled,allWritersFenced:originalHooks.allWritersFenced,
    verifyFinalOriginalManifest:originalHooks.verifyFinalOriginalManifest});
  const returnDock=pf56.createPersonalFleetReturnDock({gameStore,pf52,
    claimsPolicy:originalHooks.claimsPolicy,access,
    verifyExclusiveOwnership:originalHooks.verifyExclusiveOwnership,
    verifyNativeFlight:originalHooks.verifyNativeFlight,
    verifyOriginalReturnOrder:originalHooks.verifyOriginalReturnOrder,
    verifyStationArrival:stationDwell.verifyStationArrival,
    verifyContinuousDwell:stationDwell.verifyContinuousDwell,
    verifyOriginalManifest:originalHooks.verifyOriginalManifest,
    verifyServerReturnOwner:original.verifyServerReturnOwner,
    verifyOriginalDockReceipt:dockCompletion.verifyOriginalDockReceipt,
    verifyFinalOriginalManifest:originalHooks.verifyFinalOriginalManifest,
    executeNativeReturn:originalPhysicalOrders.executeNativeReturn,
    executeNativeDock:dockCoordinator.execute,
    enabled,allWritersFenced:originalHooks.allWritersFenced});
  // Native server continuation consumes only committed PF56 intents. On a
  // restart, cleanup is readback/reconcile only, never PF66/PF61 redispatch.
  const stationTickDriver=originalStationTickDriver.createOriginalStationTickDriver({
    stationDwell,enabled,allWritersFenced:originalHooks.allWritersFenced,
    advanceReturn:row=>{
      if(row.phase==='DOCK_ISSUING'){
        const cleanup=dockCoordinator.reconcileNativeCleanup(row);
        if(cleanup?.status!=='NATIVE_CLEARED')return cleanup;
      }
      const result=returnDock.advanceServer(row);
      if(['DOCKED','ALREADY_DOCKED'].includes(result?.status)){
        const finalized=dockCoordinator.finalizeAfterPf56Dock(row);
        return ['FINALIZED','ALREADY_FINALIZED'].includes(finalized?.status)?result:
          {status:'BLOCKED',reason:'PF84_TERMINAL_FINALIZE_UNPROVEN'};
      }
      return result;
    }});
  // First-play excludes recurring PF57 salary / dismiss until its ORIGINAL
  // wallet, loss and contract hook owners are present. The public command
  // conductor returns a blocked response for dismiss rather than a fake ACK.
  const dismissal=Object.freeze({dismiss:()=>({status:'BLOCKED',
    reason:'PF_FIRSTPLAY_DISMISS_REQUIRES_ORIGINAL_PF57_NATIVE_HOOKS'})});
  const commandOwner=commands.createOriginalWorkCommandOwner({gameStore,pf52,
    hangar,pf53:paid,pf54:deploy,pf55:orders,pf56:returnDock,pf57:dismissal,
    listNativeOffers:offer.listNativeOffers,
    lookupNativeOffer:offer.lookupNativeOffer,
    verifyNativePilotHull:offer.verifyHiredPilotHull,
    resolveOriginalDockContext:original.resolveOriginalDockContext,
    resolveOriginalFollowTarget:original.resolveOriginalFollowTarget,enabled});
  // This PF58 constructor installs an ORIGINAL server-owned permit singleton.
  // It must be LAST except for a pure JS chat publication. On failure ready
  // remains false so previously installed source-scoped bindings cannot act.
  nativeHandoff=pf58.createSourceBoundNativeBootstrap({gameStore,pf52,
    sessionRegistry:originalSessionRegistry,npcRegistry:originalNpcRegistry,
    originalItemStore:stockItemStore,nativeNpcStore:originalNpcStore,
    nativeNpcService:originalNpcService,spaceRuntime:originalRuntime,
    resolveNativeProfile:offer.resolvePaidNativeProfile,
    resolveOwnerCorporation:original.resolveOwnerCorporation,
    verifyOriginalWriterHooks:originalHooks.verifyOriginalWriterHooks,
    originalStationUndockPoint:originalHooks.originalStationUndockPoint,
    originalEquipmentWitness:originalHooks.verifyOriginalEquipment,
    originalOwnershipWitness:originalHooks.originalOwnershipWitness,
    independentOriginalActorWitness:originalHooks.independentOriginalActorWitness,
    verifyOriginalDockedPlayerSession:originalHooks.verifyOriginalDockedPlayerSession,
    enabled,allWritersFenced:originalHooks.allWritersFenced,atomicOriginalTransfer:true});
  if(chat.installServerAuthority(commandOwner)!==true)
    throw Error('PF_FIRSTPLAY_CHAT_AUTHORITY_ALREADY_INSTALLED');
  ready=true;
  // The timer is installed only after every original source and /pf authority
  // has finished initialization. A failed timer install revokes ready and the
  // process-sticky failed-bootstrap gate blocks a second side-effect attempt.
  if(stationTickDriver.start()!==true)
    throw Error('PF56_SOURCE_OWNED_STATION_TIMER_NOT_INSTALLED');
  booted=true;
  return Object.freeze({status:'INSTALLED_WORK_SOURCE_BOUND',
    mayEnable:enabled,originalHandoff:nativeHandoff,
    // Only trusted original WORK startup may call these; never publish in /pf.
    originalDockCoordinator:dockCoordinator,
    // Server-internal tick entry only: requires the original return intent;
    // it is not an in-game, chat or HTTP command handler.
    sampleOriginalStationDwell:stationDwell.sample,
    nativeStationTickStatus:stationTickDriver.getStatus,
    // Trusted WORK process shutdown only; never exposed via chat or HTTP.
    stopNativeStationTick:stationTickDriver.stop,
    getOperationalStatus:()=>Object.freeze({ready:enabled(),booted})});
 }catch(error){
  // Inability to install a required hook is NOT a partial success.
  ready=false;
  throw error;
 }finally{startupInProgress=false;}
}
module.exports=Object.freeze({createOriginalWorkBootstrap,HOOKS});
