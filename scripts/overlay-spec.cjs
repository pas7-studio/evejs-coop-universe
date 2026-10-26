"use strict";
// Declarative overlay data: module list, per-file patch specifications and the
// pinned source literals they replace. This file is pure data + tiny loops; it
// must never touch the filesystem. The engine is scripts/patch-evejs-coop.cjs.
//
// Editing rules: one entry per semantic hook, feature flags stay OFF by
// default, and a stock bug belongs in patches/upstream/ instead of here
// (docs/UPSTREAM_PATCH_SERIES.md).
const PIN="c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f";
const names=["coopAlifeStartupCargoAudit","coopAgentDialogue","coopAlifeEconomy","coopAlifeEconomySensor","coopAlifeNativeBuyerDispatch","coopAlifeNativeBuyerRuntime","coopAlifeNativeDeliveryEvidence","coopAlifeNativeEconomyAct","coopAlifeNativeMiningWitness","coopAlifeNativeResupplyBridge","coopAlifeNews","coopAlifeStationAuthority","coopAlifeStationAuthorityRuntime","coopCivilianOrders","coopCombatProbe","coopConvoyOperations","coopConvoyOutcomeProof","coopCourierDispatch","coopCourierFlight","coopCourierFlightDriver","coopCourierNativeAccept","coopCourierNotices","coopCourierRuntime","coopDroneFighterAuthority","coopDuoCoordinator","coopDuoPresence","coopDuoRaidTactics","coopEncounterDirector","coopEscortContractSettlement","coopEscortFlightGate","coopEscortNativeBinding","coopEscortNativeBootstrap","coopEscortNativeFunds","coopEscortNativeMount","coopEscortNativeRescue","coopEscortNativeTactics","coopEscortPricedOffers","coopEscortReputation","coopEscortRescueNavigation","coopEscortRuntime","coopEscortTacticalGame","coopEscortTerminalAttendance","coopEscortVolunteers","coopEscortWarpFence","coopEwarDogmaCorrections","coopFactionDirector","coopFactionPatrolRuntime","coopFleetDungeonCredit","coopFleetMissionJoin","coopFleetMissionTurnin","coopFleetTradeSafety","coopFleetWarpArrival","coopFleetWarpSafety","coopGameStoreAtomic","coopHeadlessScenePolicy","coopIdentityRegistry","coopIndustryPacing","coopMarketCatalog","coopMissionInstanceProvenance","coopNativeActivity","coopNativeAgentMotion","coopLivingAgentRuntime","coopAdminBridge","coopNativeCombatEvidence","coopNativeConsequences","coopNativeConvoyRenewal","coopNativeDepot","coopNativeFittingSlotGuard","coopNativeFittingSourceGuard","coopNativeFleetParty","coopNativeGateTransfer","coopNativeHaulCargo","coopNativeHaulManifest","coopNativeIndustry","coopNativeLootPickupEvidence","coopNativeLootQuarantine","coopNativeLpStandings","coopNativeMiningReadiness","coopNativeNpcDemo","coopNativeNpcMarket","coopNativePveObjectiveGuard","coopNativeRaidEligibility","coopNativeRaids","coopNativeRestore","coopNativeScanProof","coopNativeStationArrival","coopNativeStationOreSettlement","coopNativeTradeAtomic","coopNativeTradeCustody","coopNativeWarehouse","coopNpcAmmoConservation","coopNpcAmmoDebitJournal","coopNpcAmmoSupply","coopNpcAmmoWitness","coopNpcBuyerCoordinator","coopNpcBuyerNativeBindings","coopNpcBuyerRecoveryAudit","coopNpcBuyerAdminControl","coopNpcChatter","coopNpcCorporateBuyRuntime","coopNpcCorporateBuyerAtomic","coopNpcCorporateSettlement","coopNpcDemandAuthority","coopNpcDestructionAttacker","coopNpcEconomyScheduler","coopNpcEconomyUnknownRecovery","coopNpcFireDebitProof","coopNpcGateTravel","coopNpcHostility","coopNpcHuntPolicy","coopNpcIndustryGameStoreScope","coopNpcIndustryNativeBindings","coopNpcIndustryOfflineAtomic","coopNpcIndustryOfflineDelivery","coopNpcIndustryReady","coopNpcIntelLedger","coopNpcLife","coopNpcLootCommerce","coopNpcLossBridge","coopNpcManufacturingJournal","coopNpcManufacturingNative","coopNpcManufacturingPlanner","coopNpcMarketCompletionNotify","coopNpcMarketPolicy","coopNpcMaterializer","coopNpcMemory","coopNpcNativeEconomyDirector","coopNpcNativeRearm","coopNpcOpportunityPlanner","coopNpcOrderArbiter","coopNpcOrderBridge","coopNpcPartialFillAtomic","coopNpcPersonalGoals","coopNpcPresentation","coopNpcRecognition","coopNpcRefinery","coopNpcRefineryRuntime","coopNpcRolePriority","coopNpcRustOrderAuthority","coopNpcSellPricing","coopNpcSellerTaxAuthority","coopNpcSpawnPools","coopNpcSquadDirector","coopNpcStockWreckProof","coopNpcTactics","coopNpcTopology","coopNpcWeaponAmmoGate","coopNpcWeaponEvidence","coopNpcWreckClaims","coopNpcWreckCustody","coopNpcWreckRecovery","coopPartyNotices","coopPatrolNavigator","coopPatrolOrders","coopPlayerCombatWitness","coopPlayerTravelGuard","coopRescueContracts","coopRescueNativeGame","coopRescueNativeTransfer","coopRescueNativeWarehouse","coopRescueNpcDepot","coopRescueNpcRivalry","coopRuntimeProbe","coopSceneObserverIntegrity","coopSessionPresence","coopSkillGrant","coopStationShipGuard","coopStockFleetCombatEvidence","coopStockFleetWreckEvidence","coopStoryMissionGuard","coopStoryMissionSettlementFence","coopStuckWarpRecovery","coopSystemIntel","coopVirtualEconomy","coopVirtualWorld","coopVirtualWorldRuntime","coopWorldOpportunityBoard","coopWorldSignals"];
// Chat 19+21 P0-5B-2: native station itemStore and standing transaction custody.
names.splice(names.indexOf("coopPveDuoNativeRewardEvidence")+1,0,"coopPveDuoNativeRewardCustody");
// Chat 19+21 P0-5B: native wallet, LP, standing and mission history evidence.
names.splice(names.indexOf("coopPveDuoNativeRewardGuard")+1,0,"coopPveDuoNativeRewardEvidence");
// Chat 19+21 P0-5A: original two-person mission native reward authorization.
names.splice(names.indexOf("coopPveBossLootProfileAudit")+1,0,"coopPveDuoNativeRewardGuard");
// Chat 19+21 P0-4B-2: original NPC profile to loaded loot rule source audit.
names.splice(names.indexOf("coopPveBossLootClaim")+1,0,"coopPveBossLootProfileAudit");
// Chat 19+21 P0-4B: original boss item pre-grant durable custody fence.
names.splice(names.indexOf("coopPveBossLootPickup")+1,0,"coopPveBossLootClaim");
// Chat 19+21 P0-4B: exact original boss wreck item pickup witness (read-only).
names.splice(names.indexOf("coopPveNativeBossDirector")+1,0,"coopPveBossLootPickup");
// Chat 19+21 P0-4A: source-tagged native boss HP and original wreck witness.
names.splice(names.indexOf("coopPveObjectiveDoctrine")+1,0,"coopPveNativeBossDirector");
// Chat 19+21 P0-3B: exact native killable objective defend, regroup and retreat.
names.splice(names.indexOf("coopPveWaveReinforcements")+1,0,"coopPveObjectiveDoctrine");
// Chat 19+21 P0-3A: native authored-wave warp and physical arrival handoff.
names.splice(names.indexOf("coopPveNativeSiteDefense")+1,0,"coopPveWaveReinforcements");
// Chat 19+21 P0-2: native dungeon defender authority, independent OFF gate.
names.splice(names.indexOf("coopPveRetaliationGuard")+1,0,"coopPveNativeSiteDefense");
// Chat 19+21 stage 1: existing native tactics retaliate only on verified aggression.
names.splice(names.indexOf("coopNpcTactics")+1,0,"coopPveRetaliationGuard");
// Chat 29: source-level buy cancellation custody, default OFF.
// FW-001: source-only authoritative war state; default OFF.
names.splice(names.indexOf("coopFactionDirector")+1,0,"coopFactionWarCore","coopFactionWarStore");
// FW-002: native militia agent, default OFF.
names.splice(names.indexOf("coopFactionWarStore")+1,0,"coopFactionWarNativeProofs","coopFactionWarAgent");
// FW-003B: native combat proof on existing 30s world tick, no new timer.
names.splice(names.indexOf("coopWarFleetNativeProofs")+1,0,"coopWarCombatPolicy","coopWarCombatAuthority","coopWarBattleDirector");
// FW-003C: existing physical patrol mobilization on shared A-Life tick.
names.splice(names.indexOf("coopWarBattleDirector")+1,0,"coopWarMusterReadiness","coopWarMobilizer");
// FW-005A: source-bound native corporation military wallet escrow, OFF by default.
names.splice(names.indexOf("coopWarMobilizer")+1,0,"coopWarTreasury","coopWarTreasuryNative");
// FW-007A: physical war-gate approach only, no native fleet transfer.
names.splice(names.indexOf("coopWarTreasuryNative")+1,0,"coopWarGateStaging");
// FW-007B: physical warship handoff journal / two durable registry gates.
names.splice(names.indexOf("coopWarGateStaging")+1,0,"coopWarTransferLedger","coopWarGateHandoff");
// FW-007C: local-only verified repair console and protected Unix socket.
names.splice(names.indexOf("coopWarGateHandoff")+1,0,"coopWarRecoveryConsole","coopWarRecoverySocket");
// FW-008: terminal war-campaign demobilization and reuse via existing A-Life.
names.splice(names.indexOf("coopWarRecoverySocket")+1,0,"coopWarDemobilizer");
// FW-009A: native confirmed faction-war casualties, never synthetic victory.
names.splice(names.indexOf("coopWarDemobilizer")+1,0,"coopWarCasualtyLedger");
// FW-009B: source-gated real structure objectives; no GM/admin damage hook.
names.splice(names.indexOf("coopWarCasualtyLedger")+1,0,"coopWarObjectiveAdjudicator","coopWarNativeStructureControl","coopWarNativeStructureCombatProof");
// The world runtime requires this director from a live phase; leaving it out of
// the copy list produced "Cannot find module" on every world cycle.
names.splice(names.indexOf("coopWarObjectiveAdjudicator")+1,0,"coopWarObjectiveDirector");
// FW-009C: actor-scoped native militia briefing, read-only and reversible.
names.splice(names.indexOf("coopWarNativeStructureCombatProof")+1,0,"coopWarMilitiaIntel");
// FW-003: native-proof-only war hull custody; no added timer or native ship factory.
names.splice(names.indexOf("coopFactionWarAgent")+1,0,"coopWarFleetRegistry","coopWarFleetNativeProofs");
names.splice(names.indexOf("coopMarketCatalog")+1,0,"coopMarketCancelCustody","coopMarketSellCustody","coopPlayerMarketFill","coopPlayerMarketSettlementFence","coopPlayerMarketRustClaim","coopPlayerMarketAtomicSettlement","coopPlayerMarketAtomicRuntime","coopPlayerMarketBuyReserve","coopPlayerMarketBuyReserveRuntime","coopPlayerMarketBuySettlement","coopPlayerMarketBuyRefund","coopPlayerMarketBuyRefundRuntime");
// P0 staged modules registered separately to avoid conflicts in the shared list.
names.splice(names.indexOf("coopNpcAmmoDebitJournal")+1,0,"coopNpcAmmoBankAtomic");
// COOP-046: opt-in post-commit combat outcome witness for atomic ammo banks.
names.splice(names.indexOf("coopNpcAmmoBankAtomic")+1,0,"coopNpcFireOutcomeWitness");
names.splice(names.indexOf("coopNpcFireOutcomeWitness")+1,0,"coopEconomyDestination");
names.splice(names.indexOf("coopEconomyDestination")+1,0,"coopMiningTrace");
// Restart resilience: re-attach durable haul cargo orphans to the re-seeded
// hauler of the same system/slot (default OFF, never invents ore).
names.splice(names.indexOf("coopMiningTrace")+1,0,"coopHaulCargoAdoption");
names.splice(names.indexOf("coopMiningTrace")+1,0,"coopMiningCapacitorGate");
names.splice(names.indexOf("coopMiningTrace")+1,0,"coopMiningActivate");
// An idle native NPC must not clear a mining hull's target locks (default OFF).
names.splice(names.indexOf("coopMiningTrace")+1,0,"coopMiningTargetGuard");
// Guarded telemetry used by the restart-resilience modules.
names.splice(names.indexOf("coopHaulCargoAdoption")+1,0,"coopObserve");
// Single reader for our own EVEJS_* gates (default OFF, only "1" enables).
names.unshift("coopFlags");
// Stage J native salvage: preserve all currently deployed A-Life/industry modules.
names.splice(names.indexOf("coopNativeWarehouse")+1,0,"coopSalvageProvenance","coopSalvageAtomicCustody","coopSalvageDeathAtomic","coopSalvageNativeTransfer","coopSalvageGameAuthority","coopSalvageGameMount","coopSalvageNativeOffers","coopSalvageNativeConsent","coopSalvageNativeRewards","coopSalvageNpcRivals");
// Stage J: ship the already-used physical rival warehouse module and the
// existing native pending-order dependency together with opt-in salvage seller.
names.splice(names.indexOf("coopSalvageNpcRivals")+1,0,
 "coopSalvageNpcStationDelivery","coopNpcPendingMarketEscrow","coopSalvageNpcPendingMarket");
// Auto-listing is source-only and uses the existing living-world 30s tick.
names.splice(names.indexOf("coopSalvageNpcPendingMarket")+1,0,
 "coopAlifeSalvageMarket","coopAlifeSalvageMarketRuntime");
names.splice(names.indexOf("coopMiningTrace")+1,0,"coopNativeMiningCycleConservation");
names.splice(names.indexOf("coopNativeMiningCycleConservation")+1,0,"coopNativeMiningAtomic");
// ALIFE-08 durable native miner/hauler identity (opt-in).
names.splice(names.indexOf("coopNativeMiningAtomic")+1,0,"coopNativeMiningFleetDurable");
// Durable cargo write is the single owner of "make this row survive a restart".
names.splice(names.indexOf("coopNativeHaulCargo")+1,0,"coopDurableCargoWrite");
// ALIFE-10 strict native miner->hauler original cargoID atomic handoff.
names.splice(names.indexOf("coopNativeHaulCargo")+1,0,"coopNativeHaulTransferAtomic");
// ALIFE-11 cargo transient shadow restricted to original atomic miner-to-hauler mode.
names.splice(names.indexOf("coopNativeHaulTransferAtomic")+1,0,"coopNativeCargoTransientIsolation");
// ALIFE-12 original NPC station departure ACK and read-only route recovery.
names.splice(names.indexOf("coopNativeStationArrival")+1,0,"coopNativeStationTripJournal");
// COOP-048 native /jobs uses the existing authenticated Opportunity Board.
names.splice(names.indexOf("coopWorldOpportunityBoard")+1,0,"coopNpcJobBoard");
// Stock in-game agent dialogue for jobs, no /jobs text needed.
names.splice(names.indexOf("coopNpcJobBoard")+1,0,"coopNativeJobAgent");
// Native opt-in EVEmail notification bridge for priced corporate offers.
names.splice(names.indexOf("coopNativeJobAgent")+1,0,"coopNativeJobNotifications");
// Durable actor-agent source binding for ID-less native Accept button.
names.splice(names.indexOf("coopNativeJobAgent")+1,0,"coopNativeJobAgentSelection");
// Peaceful delivery uses the same native corporate escrow (feature OFF by default).
names.splice(names.indexOf("coopEscortContractSettlement")+1,0,"coopEscortPeacefulSettlement");
// COOP-055: strict, default-OFF native NPC motion-attested Escort.
names.splice(names.indexOf("coopEscortWarpFence")+1,0,"coopEscortDepartureWitness","coopEscortRouteWitness");
names.splice(names.indexOf("coopEscortRouteWitness")+1,0,"coopEscortNativeIngressSnapshot");
// Chat 36: opt-in Pochven Conduit Loop guard (native travel only).
names.splice(names.indexOf("coopNativeScanProof")+1,0,"coopPochvenConduit");
// CH23: native two-pilot wormhole mass/transition fence; default OFF.
names.splice(names.indexOf("coopNativeScanProof")+1,0,"coopWormholeJumpFence");
// Post-42 merge reconciliation: modules delivered after the original installer.
// Copy only; native hooks remain explicitly default-OFF until their own pinned
// source contracts and two-client acceptance are independently verified.
names.push(
 "coopCloneActionFence", "coopCloneNativeGuard", "coopCloneNativeReceipts", "coopEconomyConservationAudit", "coopFwEnlistmentGate", "coopFwInsurgencyVisibility", "coopMoonExtractionReadAccess", "coopMoonFuelOutputFence", "coopMoonNativeCycleAudit", "coopNativeContractMutationFence", "coopPiIntegrityGuard", "coopPlayerCorporationAccess", "coopPlayerIndustryFence", "coopPlayerIndustryGuard", "coopPlayerIndustryReceipts", "coopPlayerMiningCustody", "coopPlayerOreReprocessing", "coopPrivateHostSafety", "coopSkillEtaEvidence", "coopSkillRateCutover", "coopSocialRoomAuthority", "coopStructureAllianceAuthority"
);
// LW-04B: original A-Life native admission without live financial bindings.
names.splice(names.indexOf("coopAlifeNativeBuyerRuntime")+1,0,
 "coopAlifeNativeManufacturingRuntime");
// LW-04C: original GameStore/ItemStore/Rust read-only manufacturing
// recovery witness; does NOT turn manual industry bindings into live writers.
names.splice(names.indexOf("coopNpcIndustryNativeBindings")+1,0,
 "coopNpcIndustryRecoveryFence","coopNpcLiveFactoryReadiness",
 "coopNpcIndustryOriginalGameStorePreflight","coopNpcIndustryOriginalStageExecutor","coopNpcIndustryOriginalRustSell",
 "coopNpcIndustryOriginalSaleAudit","coopNpcIndustryOriginalWalletWitness","coopNpcIndustryOriginalBuyerSettlement","coopLivingWorldNativeChainProof","coopNpcOriginalWarehouseTitleTransfer");
names.splice(names.indexOf("coopPlayerIndustryFence")+1,0,"coopPlayerIndustryRuntime");
// Late native module reconciliation after parallel merges: copy-only.
// Keep NPE and Living World behavior behind their existing native hooks.
// Living Agent is already present in the initial native module list.
// Duplicate deployment records would overwrite/verify the same file twice.
names.push("coopNpeSafety");
// Chats 25/32/39: original native source hooks; all feature flags stay OFF.
const ORE_PATCH_PATHS=new Set([
 "server/src/services/inventory/itemStore.js",
 "server/src/services/reprocessing/reprocessingRuntime.js",
 "server/src/services/station/reprocessingService.js"
]);
const STRUCTURE_PATCH_PATHS=new Set([
 "server/src/services/corporation/allianceRegistryRuntime.js",
 "server/src/services/sovereignty/sovPlayerDeployment.js"
]);
const SOCIAL_PATCH_PATHS=new Set([
 "server/src/_secondary/chat/chatRuntime.js",
 "server/src/_secondary/chat/chatStore.js",
 "server/src/services/mail/mailState.js"
]);
names.splice(names.indexOf("coopVirtualWorldRuntime")+1,0,
 "coopLivingWorldPhaseCoordinator","coopLivingWorldPhaseRegistry");
const specs=[
 {file:"server/src/services/industry/industryManagerService.js",patches:[]},
 {file:"server/src/services/reprocessing/reprocessingRuntime.js",patches:[]},
 {file:"server/src/services/station/reprocessingService.js",patches:[]},
 {file:"server/src/services/corporation/allianceRegistryRuntime.js",patches:[]},
 {file:"server/src/services/sovereignty/sovPlayerDeployment.js",patches:[]},
 {file:"server/src/_secondary/chat/chatRuntime.js",patches:[]},
 {file:"server/src/_secondary/chat/chatStore.js",patches:[]},
 {file:"server/src/services/mail/mailState.js",patches:[]},
 {file:"server/src/services/exploration/wormholes/wormholeMgrService.js",patches:[]},
 {file:"server/src/services/industry/industryAccess.js",patches:[]},
 {file:"server/src/services/inventory/invBrokerService.js",patches:[]},
 {file:"server/src/services/corporation/corpRegistryRuntime.js",patches:[]},
 {file:"server/src/services/corporation/corpMemberActionState.js",patches:[]},
 {file:"server/src/services/corporation/officeManagerService.js",patches:[]},
 {file:"server/src/services/npe/airNpeService.js",patches:[]},
 {file:"server/src/services/npe/nesIntroService.js",patches:[]},
 {file:"server/src/services/account/tutorialSvcService.js",patches:[]},
 {file:"server/src/services/character/achievementTrackerMgrService.js",patches:[]},
 {file:"server/src/services/chat/sessionRegistry.js",patches:[
  {anchor:'    addToIndex(session, characterID);',line:"    if (process.env.EVEJS_COOP_NPC_BUY_NOTIFY_CATCHUP === \"1\") setImmediate(() => { if (isLiveSession(session) && resolveSessionCharacterID(session) === characterID) Promise.resolve().then(() => require(\"../../space/coopNpcMarketCompletionNotify\").notifyPendingSellerOnLogin(characterID)).catch(error => console.warn(\"[CoopMarketSellerCatchup]\", error.message)); });",after:true}
 ]},
 {file:"server/src/services/mining/miningRuntime.js",patches:[
    // The runtime stops a mining module with the reason the mining runtime
    // returned; "target" covers four different checks. Note the state they read
    // (rock present, ore left, real lock, pending locks) for native NPCs only.
    {anchor:'  const targetID = toInt(effectState.targetID, 0);\n  const targetEntity = scene.getEntityByID(targetID);\n  const mineableState = getMineableState(scene, targetID);',after:true,
     line:'  require("../../space/coopMiningTrace").noteCycleAttempt(scene, entity, effectState, {targetID, found: Boolean(targetEntity), remaining: mineableState && mineableState.remainingQuantity, locked: getTargetsForEntity(scene, entity).includes(targetID)}, cycleBoundaryMs);'}
  ]},
 {file:"server/src/services/mining/miningRuntimeState.js",patches:[]},
 {file:"server/src/services/chat/chatCommands.js",patches:[
   {anchor:'  "commands",',line:'  "events",',after:true},
   {anchor:'  "commands",',line:'  "jobs",',after:true},
   {anchor:'  "commandlist",',line:'  "alerts",',after:true},
   {anchor:'  if (command === "motd") {',line:'  if (command === "events" || command === "alerts") { const result=require("../../space/coopWorldOpportunityBoard").handleChat({session,command,argumentText}); return handledResult(chatHub,session,options,result.message); }'},
   {anchor:'  if (command === "motd") {',line:'  if (command === "jobs") { const result=require("../../space/coopNpcJobBoard").handleChat({session,argumentText}); return handledResult(chatHub,session,options,result.message); }'}
  ]},
 {"file":"server/src/space/modules/localCycleReloads.js","patches":[{"anchor":"function canUseVirtualNativeNpcReloadReserve(entity, moduleItem, chargeTypeID) {","line":"  if (require(\"../coopNpcAmmoConservation\").isStrict(entity)) return false;","after":true}]},
 {"file":"server/src/space/combat/missiles/missileReloads.js","patches":[{"anchor":"function canUseVirtualNativeNpcReloadReserve(entity, moduleItem, chargeTypeID) {","line":"  if (require(\"../../coopNpcAmmoConservation\").isStrict(entity)) return false;","after":true}]},
 {file:"server/src/space/runtime.js",patches:[
    // A co-op mining module stopped by anything (state change, cargo, warp, NPC
    // combat, sessionless finalize) is invisible in every other trace: the tick-end
    // snapshot only shows that no effect exists. These two entry hooks record the
    // caller's own reason string next to the module id.
    {anchor:'  deactivateGenericModule(session, moduleID, options = {}) {\n    const entity = this.getShipEntityForSession(session);',after:true,
     line:'   require("./coopMiningTrace").noteModuleStop(this,this.getShipEntityForSession(session),moduleID,(options&&options.reason)||"manual","session");'},
    {anchor:'function finalizeGenericModuleDeactivationWithoutSession(\n  scene,\n  entity,\n  effectState,\n  options = {},\n) {',after:true,
     line:'  require("./coopMiningTrace").noteModuleStop(scene,entity,effectState&&effectState.moduleID,(options&&options.reason)||"state","nosession");'}
  ]},
 {file:"server/src/space/movement/warp/movementWarpState.js",patches:[]},
 {file:"server/src/space/npc/nativeNpcService.js",patches:[]},
 {file:"server/index.js",patches:[]},
 {file:"server/src/gameStore/index.js",patches:[]},
 {file:"server/src/gameStore/sqliteStore.js",patches:[]},
 {file:"server/src/services/machoNet/machoNetService.js",patches:[]},
 {file:"server/src/services/contracts/contractRuntimeState.js",patches:[]},
 {file:"server/src/services/_other/contractProxyService.js",patches:[]},
 {file:"server/src/space/combat/killmailTracker.js",patches:[]},
 {file:"server/src/services/evermarks/lpStoreMgrService.js",patches:[]},
 {file:"server/src/space/npc/nativeNpcStore.js",patches:[]},
 {file:"server/src/services/_shared/sessionDisconnect.js",patches:[
  {anchor:"  persistCharacterLogoffState(session);",line:'  require("../../space/coopRuntimeProbe").observe("disconnect-after-persist", session, null);',after:true}
 ]},
 {file:"server/src/space/transitions.js",patches:[
  {anchor:"  const attachElapsedMs = Date.now() - attachStartedAtMs;",line:'  require("./coopRuntimeProbe").observe("space-login-attach", session, activeShip, { attached: Boolean(shipEntity) });',after:true},
  {anchor:"  const hydrationQueuedAtMs = Date.now();",line:'  require("./coopSessionPresence").schedule(session, activeShip, "login");',after:true},
  {anchor:"    queuePostSpaceAttachFittingHydration(session, moveResult.data.itemID, {",line:'    require("./coopSessionPresence").schedule(session, moveResult.data, "undock");'},
  {anchor:"  queuePostSpaceAttachFittingHydration(session, moveResult.data && moveResult.data.itemID, {",line:'  require("./coopSessionPresence").schedule(session, moveResult.data, "stargate");'}
 ]},
 {file:"server/src/services/industry/industryParityHelpers.js",patches:[]},
 {file:"server/src/services/agent/missionRuntimeState.js",patches:[]},
 {file:"server/src/services/agent/agentMissionRuntime.js",patches:[]},
 {file:"server/src/services/dungeon/dungeonUniverseSiteService.js",patches:[]},
 {file:"server/src/services/agent/agentMgrService.js",patches:[
  {anchor:'    const result = agentMissionRuntime.doAgentAction(\n      normalizePositiveInteger(session && session.characterID, 0),\n      agentID,\n      actionID,\n    );',line:"    const coopTicket = process.env.EVEJS_COOP_FLEET_MISSION_TURNIN === \"1\" ? require(\"../../space/coopFleetMissionTurnin\").prepare({session,agentID,actionID,fleetRuntime:require(\"../fleets/fleetRuntime\"),missionRuntime:agentMissionRuntime,sessions:require(\"../chat/sessionRegistry\").getSessions(),getDockedLocationID:require(\"../structure/structureLocation\").getDockedLocationID}) : null;"},
  {anchor:'    return buildDoActionResponsePayload(result);',line:"    if (coopTicket && coopTicket.ok) { try { const shared = require(\"../../space/coopFleetMissionTurnin\").finish({ticket:coopTicket,missionRuntime:agentMissionRuntime,leaderActionResult:result,fleetRuntime:require(\"../fleets/fleetRuntime\"),getDockedLocationID:require(\"../structure/structureLocation\").getDockedLocationID}); require(\"../../space/coopRuntimeProbe\").observe(\"coop-fleet-native-mission-turnin\",session,null,shared); } catch (error) { console.warn(\"[CoopFleetMission]\",error.message); } }"}
 ]},
 {file:"server/src/services/character/characterState.js",patches:[]},
 {file:"server/src/services/corporation/corporationRuntimeState.js",patches:[]},
 {file:"server/src/services/inventory/itemStore.js",patches:[]},
 {file:"server/src/services/market/marketProxyService.js",patches:[]},
 {file:"server/src/services/exploration/scanMgrService.js",patches:[]},
 {file:"server/src/services/trade/tradeMgrService.js",patches:[
  {anchor:'    const moneyTransferResult = this._completeMoneyTransfer(trade);',line:"    if (process.env.EVEJS_COOP_FLEET_TRADE_SAFETY === \"1\") { const peerID = trade.traders.find(x => Number(x) !== Number(session.characterID)); const peer = this._getParticipantSession(peerID, session); const fleet = require(\"../fleets/fleetRuntime\"); const fleetState = peer && require(\"../../space/coopNativeFleetParty\").membership({leaderSession:session,peerSession:peer,fleetRuntime:fleet}); if (fleetState && fleetState.ok) { const safe = require(\"../../space/coopFleetTradeSafety\").check({trade,session,peerSession:peer,items:this._listTradeItems(trade),getItem:findItemById,isTradable:isTradableInventoryItem,containedItems:id=>this._collectContainedItems(id),fleetRuntime:fleet,getDockedLocationID}); if (!safe.ok) { this._resetOfferState(trade); this._throwTradeError(\"Co-op trade blocked: \" + safe.reason); } } }"}
 ]},
 {file:"server/src/services/ship/beyonceService.js",patches:[
  {anchor:"      return !(",line:'      if (process.env.EVEJS_COOP_FLEET_WARP_SAFETY === "1" && !require("../../space/coopFleetWarpSafety").eligible({commanderSession,followerSession,spaceRuntime})) return false;'},
  {anchor:"      if (followerResult && followerResult.success) {",line:'      if (process.env.EVEJS_COOP_FLEET_WARP_SAFETY === "1") require("../../space/coopFleetWarpSafety").recordFollowerWarp({commanderSession,followerSession,spaceRuntime,result:followerResult,targetEntityID,minimumRange});'}
 ]},
 {file:"server/src/network/tcp/index.js",patches:[
  {anchor:"      tidiAutoscaler.init();",line:'      try { require("../../space/coopVirtualWorldRuntime").start(); } catch (error) { console.warn("[CoopVirtualWorld] startup", error.message); }',after:true}
 ]},
 {file:"server/src/services/mining/miningNpcOperations.js",patches:[
  // A module stopped for a target change and restarted next tick pays the
  // activation cost forever and never completes a cycle. Observation only.
  {anchor:"      if (activeEffect && toInt(activeEffect.targetID, 0) !== toInt(targetEntity.itemID, 0)) {",
   after:true,
   line:"require(\"../../space/coopMiningTrace\").noteTargetMismatch(fleetRecord,scene,minerEntity,entry,activeEffect,targetEntity);"},
  // Restart resilience: a previous process may leave durable haul cargo on a
  // hauler that no longer exists. Re-attach it once, then let the normal
  // loaded -> station -> sell pipeline continue. Telemetry never decides.
  {anchor:"function tickMiningFleet(scene, fleetRecord, now, hooks) {",after:true,
   line:'  if (process.env.EVEJS_COOP_HAUL_CARGO_ADOPTION === "1") { try { require("../../space/coopHaulCargoAdoption").adopt(scene, fleetRecord); } catch (_coopAdoptError) { console.warn("[CoopHaulCargoAdoption]", _coopAdoptError.message); } }'},
  // Why a "mining" fleet can produce nothing: the stock loop `continue`s
  // silently at each of these points. Trace-only, nothing destructive.
  {anchor:"    if (miningModules.length <= 0) {",after:true,
   line:'      require("../../space/coopMiningTrace").note("NO_MINING_MODULE",{fleetID:toInt(fleetRecord&&fleetRecord.fleetID,0),systemID:toInt(scene&&scene.systemID,0),minerID:toInt(minerEntity.itemID,0)});'},
  {anchor:"    if (!primarySnapshot) {",after:true,
   line:'      require("../../space/coopMiningTrace").note("NO_MINING_SNAPSHOT",{fleetID:toInt(fleetRecord&&fleetRecord.fleetID,0),systemID:toInt(scene&&scene.systemID,0),minerID:toInt(minerEntity.itemID,0),moduleTypeID:toInt(miningModules[0].moduleItem&&miningModules[0].moduleItem.typeID,0)});'},
  {anchor:"    if (distanceToTarget > engagementRangeMeters) {",after:true,
   line:'      require("../../space/coopMiningTrace").note("TARGET_OUT_OF_RANGE",{fleetID:toInt(fleetRecord&&fleetRecord.fleetID,0),systemID:toInt(scene&&scene.systemID,0),minerID:toInt(minerEntity.itemID,0),distanceMeters:Math.round(distanceToTarget),engagementMeters:Math.round(engagementRangeMeters)});'},
  {anchor:"    if (!targetLockResult || targetLockResult.success !== true) {",after:true,
   line:'      require("../../space/coopMiningTrace").note("TARGET_LOCK_FAILED",{fleetID:toInt(fleetRecord&&fleetRecord.fleetID,0),systemID:toInt(scene&&scene.systemID,0),minerID:toInt(minerEntity.itemID,0),errorMsg:String((targetLockResult&&targetLockResult.errorMsg)||"NONE")});'},
   {anchor:"const minerEntity = scene.getEntityByID(minerEntityID);",after:true,
    line:'    if (minerEntity) require("../../space/coopStuckWarpRecovery").release(minerEntity, scene);'},
   {anchor:"    if (!targetEntity) {\n      delete assignmentMap[toInt(minerEntity.itemID, 0)];",after:true,
  line:"require(\"../../space/coopMiningTrace\").noteNoMineableTarget(fleetRecord,scene,minerEntity,availableTargetEntries,claimCounts);"},
   {anchor:"    const distanceToTarget = hooks.getSurfaceDistance(minerEntity, targetEntity);",after:true,
    line:'    require("../../space/coopMiningTrace").noteTargetSelected(fleetRecord,scene,minerEntity,targetEntity,miningModules,hooks);'},
   // The overlay only inserts *before* an anchor, so the traced call ends with
   // `continue`: without it the stock call below also runs, activating the same
   // module twice per fleet tick and spending its capacitor twice. Measured: a
   // 250 GJ hull sat at ratio 0.003-0.013 against a 0.092 requirement, so the
   // fleet never mined again after its first cycle.
   // The stock loop discards the activation result, so a module that refuses to
   // start leaves the fleet "mining" forever with activeEffects=0.
   {anchor:"      if (!activeEffect) {\n      scene.activateGenericModule(pseudoSession, entry.moduleItem, entry.effectRecord.name, {\n        targetID: targetEntity.itemID,\n      });\n      }",
    line:"      if (!activeEffect) { require(\"../../space/coopMiningActivate\").activate({scene,pseudoSession,minerEntity,entry,targetEntity,fleetRecord}); continue; }"},
   {anchor:"    if (!minerEntity || minerEntity.mode === \"WARP\" || minerEntity.pendingWarp) {",after:true,
   line:'      require("../../space/coopMiningTrace").note("MINER_NOT_IN_SCENE_OR_WARPING",{fleetID:toInt(fleetRecord&&fleetRecord.fleetID,0),systemID:toInt(scene&&scene.systemID,0),minerID:toInt(minerEntityID,0),found:Boolean(minerEntity),mode:String((minerEntity&&minerEntity.mode)||""),pendingWarp:Boolean(minerEntity&&minerEntity.pendingWarp)});'},
  {anchor:"  fleetRecord.nextThinkAtMs = now + thinkIntervalMs;",after:true,
   line:"  require(\"../../space/coopMiningTrace\").noteTick(fleetRecord,scene,now,thinkIntervalMs);"},
  // A durable ship must never leave the fleet just because its runtime
  // controller was rebuilt: the persisted row still owns the hull. Heal it from
  // the store first, then let the stock filter decide.
  {anchor:"function pruneMiningFleet(fleetRecord) {\n  if (!fleetRecord) {\n    return null;\n  }",
   after:true,
   line:"if (process.env.EVEJS_COOP_NATIVE_MINING_SLOT_SELFHEAL === \"1\") { try { require(\"../../space/coopNativeMiningFleetDurable\").healFleetActors(fleetRecord,{npcService}); } catch (_coopHealError) { console.warn(\"[CoopFleetSelfHeal]\",_coopHealError.message); } }"},
  // The fleet silently drops a miner when its runtime controller disappears.
  // Report WHICH authority was lost (persisted row vs runtime registry) BEFORE
  // the record is pruned, so the cause is measurable instead of guessed.
  {anchor:"  fleetRecord.minerEntityIDs = (Array.isArray(fleetRecord.minerEntityIDs) ? fleetRecord.minerEntityIDs : [])",
   line:"if (process.env.EVEJS_COOP_MINING_TRACE_PRUNE === \"1\") require(\"../../space/coopNativeMiningFleetDurable\").noteDroppedFleetActors(fleetRecord,{npcService});"},
  {anchor:'  if (startupSceneSeedSet.has(startupKey)) {',line:'  if (process.env.EVEJS_COOP_CONVOY_RENEWAL === "1") { const renewal = require("../../space/coopNativeConvoyRenewal").inspect({scene,systemID:scene.systemID,slotCount:resolveStartupFleetCount(),seeded:startupSceneSeedSet.has(startupKey),fleets:getMiningFleetsForSystem(scene.systemID)}); if (!renewal.allowed) return; if (renewal.renewal) startupSceneSeedSet.delete(startupKey); }'},
  {anchor:'  const responsePlan = resolveResponsePlan(scene, fleetRecord, aggressorEntity, {',
   line:'  if (process.env.EVEJS_COOP_PLAYER_CONSEQUENCES === "1") { try { require("../../space/coopNativeConsequences").noteMiningAggression(scene, fleetRecord, aggressorEntity, aggressionEventAtMs); } catch (_coopError) { console.warn("[CoopConsequences]", _coopError.message); } }'}
 ]},
 {file:"server/src/space/npc/nativeNpcWreckService.js",patches:[
  // Persist the source slice before the original native itemStore grant.
  {anchor:'  const grantResult = grantItemToCharacterLocation(',line:'  if (process.env.EVEJS_COOP_PVE_BOSS_LOOT_FENCE === "1") { const claim = require("../coopPveBossLootClaim").begin({wreck:wreckRecord,wreckItem:wreckItemRecord,characterID,destinationLocationID,requestedQuantity}); if (claim.status !== "NOT_VERIFIED_BOSS_WRECK" && claim.status !== "BOSS_LOOT_CLAIMED") return {success:false,errorMsg:"COOP_BOSS_LOOT_CLAIM_BLOCKED"}; }'},
  {anchor:'  const itemType = resolveItemByTypeID(wreckItemRecord.typeID) || {',line:"  if (process.env.EVEJS_COOP_NATIVE_LOOT_QUARANTINE === \"1\") { const guard = require(\"../coopNativeLootQuarantine\").check({wreckID,wreckItemID}); if (guard.status !== \"ALLOW\") return {success:false,errorMsg:\"COOP_LOOT_QUARANTINED\"}; }"},
  {anchor:'  refreshNativeWreckRuntimeEntity(wreckRecord.systemID, wreckRecord.wreckID, { broadcast: true });',line:"  if (process.env.EVEJS_COOP_NATIVE_LOOT_EVIDENCE === \"1\") { try { require(\"../coopNativeLootPickupEvidence\").note({scene:spaceRuntime.ensureScene(wreckRecord.systemID),wreck:wreckRecord,characterID,wreckItemID,destinationLocationID,sourceBefore:wreckItemRecord,sourceAfter:nativeNpcStore.getNativeWreckItem(wreckItemID),availableQuantity,requestedQuantity,grantResult}); } catch (_coopError) { console.warn(\"[CoopNativeLoot]\",_coopError.message); } }",after:false},
  {anchor:"  try {\n    const dungeonUniverseSiteService = require(path.join(",line:'  try { require("../coopVirtualWorldRuntime").confirmedNativeNpcWreck(normalizedSystemID, entityID, wreckRecord.wreckID, shipEntity); } catch (_coopError) { /* optional integration */ }'},
  {anchor:"  try {\n    const dungeonUniverseSiteService = require(path.join(",line:'  try { require("../coopNativeNpcDemo").confirmedWreck(normalizedSystemID, entityID, wreckRecord.wreckID); } catch (_coopError) { /* optional co-op kill tracking */ }'},
  {anchor:"  try {\n    const dungeonUniverseSiteService = require(path.join(",line:'  try { require("../coopNativeConsequences").noteNativeWreck(normalizedSystemID, entityID, wreckRecord.wreckID, shipEntity, options, controller); } catch (_coopError) { console.warn("[CoopConsequences]", _coopError.message); }'},
  {anchor:"  try {\n    const dungeonUniverseSiteService = require(path.join(",line:"  try { require(\"../coopNpcDestructionAttacker\").note(scene, shipEntity, options, wreckRecord); } catch (_coopError) { console.warn(\"[CoopNpcDestructionAttacker]\", _coopError.message); }"}
 ]},
 {file:"server/src/space/npc/npcBehaviorLoop.js",patches:[
   // A hull that is mining is not idle: the idle path clears every target lock, and
   // that stops the mining module before its first cycle. Env-gated, default OFF.
   {anchor:"  if (options.clearTargets !== false) {\n    clearNpcTargetLocks(scene, entity);",line:'  if (options.clearTargets !== false) { let coopMining=false; try { coopMining=require("../coopMiningTargetGuard").keepTargetLock(entity)===true; } catch (_coopError) { console.warn("[CoopMiningLockGuard]", _coopError.message); } if (coopMining) options = {...options, clearTargets: false}; }',after:false},
   // A hook must never throw into stock code: a missing or broken co-op module
   // aborts the whole native tick it was attached to (measured: "NPC tick failed
   // ... Cannot find module ../coopMiningTargetGuard" while the guard module was
   // simply not registered for install).  // A durable NPC whose controller is dropped vanishes from every fleet that
  {"anchor":"    if (activeEffect) {\n      logNpcCombatDebug(\"npc.weapons.module-already-active\"","line":"    if (!require(\"../coopNpcWeaponAmmoGate\").check({entity,moduleItem,bankModuleIDs}).allowed) { if (activeEffect) scene.deactivateGenericModule(pseudoSession, activeEffect.moduleID || moduleItem.itemID, { reason: \"npc-ammo-empty\", deferUntilCycle: false }); continue; }","after":false},
  {anchor:"  if (sourceClass === \"npc\" && targetClass === \"npc\") {",line:"    if ((process.env.EVEJS_COOP_RIVAL_NPC_COMBAT === \"1\" || process.env.EVEJS_COOP_FACTION_WAR_COMBAT === \"1\") && require(\"../coopNpcHostility\").allowsNativeEngagement(entity, target)) return false;",after:true},
  {anchor:"      if (launchResult && launchResult.success) {",line:"        try { require(\"../coopNpcWeaponEvidence\").noteVerified(scene, entity, target, {kind:\"missile-launch\", chargeTypeID:entityMissileSource.chargeTypeID}); } catch (_coopError) { console.warn(\"[CoopWeaponEvidence]\", _coopError.message); }",after:true},
  {anchor:"    logNpcCombatDebug(\"npc.weapons.module-activate\", () => ({",line:"    if (activationOutcome && activationOutcome.success) { try { require(\"../coopNpcWeaponEvidence\").noteVerified(scene, entity, target, {kind:\"module-activation\", moduleID:moduleItem.itemID}); } catch (_coopError) { console.warn(\"[CoopWeaponEvidence]\", _coopError.message); } }"}
 ]}
];
const oldLines=[
 "    if (process.env.EVEJS_COOP_NPC_BUY_NOTIFY_CATCHUP === \"1\") setImmediate(() => { if (isLiveSession(session) && resolveSessionCharacterID(session) === characterID) Promise.resolve().then(() => require(\"../../space/coopNpcMarketCompletionNotify\").notifyPendingSellerOnLogin(characterID)).catch(error => console.warn(\"[CoopMarketSellerCatchup]\", error.message)); });",
 "    if (!require(\"../coopNpcWeaponAmmoGate\").check({entity,moduleItem,bankModuleIDs}).allowed) { if (activeEffect) scene.deactivateGenericModule(pseudoSession, activeEffect.moduleID || moduleItem.itemID, { reason: \"npc-ammo-empty\", deferUntilCycle: false }); continue; }",
 "  if (require(\"../coopNpcAmmoConservation\").isStrict(entity)) return false;",
 "  if (require(\"../../coopNpcAmmoConservation\").isStrict(entity)) return false;",
 "    if (coopTicket && coopTicket.ok) { try { const shared = require(\"../../space/coopFleetMissionTurnin\").finish({ticket:coopTicket,missionRuntime:agentMissionRuntime,leaderActionResult:result,fleetRuntime:require(\"../fleets/fleetRuntime\"),getDockedLocationID:require(\"../structure/structureLocation\").getDockedLocationID}); require(\"../../space/coopRuntimeProbe\").observe(\"coop-fleet-native-mission-turnin\",session,null,shared); } catch (error) { console.warn(\"[CoopFleetMission]\",error.message); } }",
 "    const coopTicket = process.env.EVEJS_COOP_FLEET_MISSION_TURNIN === \"1\" ? require(\"../../space/coopFleetMissionTurnin\").prepare({session,agentID,actionID,fleetRuntime:require(\"../fleets/fleetRuntime\"),missionRuntime:agentMissionRuntime,sessions:require(\"../chat/sessionRegistry\").getSessions(),getDockedLocationID:require(\"../structure/structureLocation\").getDockedLocationID}) : null;",
 "    if (coopTicket && coopTicket.ok) { try { const shared = require(\"../../space/coopFleetMissionTurnin\").finish({ticket:coopTicket,missionRuntime:agentMissionRuntime,fleetRuntime:require(\"../fleets/fleetRuntime\"),getDockedLocationID:require(\"../structure/structureLocation\").getDockedLocationID}); require(\"../../space/coopRuntimeProbe\").observe(\"coop-fleet-native-mission-turnin\",session,null,shared); } catch (error) { console.warn(\"[CoopFleetMission]\",error.message); } }",
 "    if (process.env.EVEJS_COOP_FLEET_TRADE_SAFETY === \"1\") { const peerID = trade.traders.find(x => Number(x) !== Number(session.characterID)); const peer = this._getParticipantSession(peerID, session); const fleet = require(\"../fleets/fleetRuntime\"); const fleetState = peer && require(\"../../space/coopNativeFleetParty\").membership({leaderSession:session,peerSession:peer,fleetRuntime:fleet}); if (fleetState && fleetState.ok) { const safe = require(\"../../space/coopFleetTradeSafety\").check({trade,session,peerSession:peer,items:this._listTradeItems(trade),getItem:findItemById,isTradable:isTradableInventoryItem,containedItems:id=>this._collectContainedItems(id),fleetRuntime:fleet,getDockedLocationID}); if (!safe.ok) { this._resetOfferState(trade); this._throwTradeError(\"Co-op trade blocked: \" + safe.reason); } } }",
 "  if (process.env.EVEJS_COOP_CONVOY_RENEWAL === \"1\") { const renewal = require(\"../../space/coopNativeConvoyRenewal\").inspect({scene,systemID:scene.systemID,slotCount:resolveStartupFleetCount(),seeded:startupSceneSeedSet.has(startupKey),fleets:getMiningFleetsForSystem(scene.systemID)}); if (!renewal.allowed) return; if (renewal.renewal) startupSceneSeedSet.delete(startupKey); }",
 "  if (process.env.EVEJS_COOP_NATIVE_LOOT_QUARANTINE === \"1\") { const guard = require(\"../coopNativeLootQuarantine\").check({wreckID,wreckItemID}); if (guard.status !== \"ALLOW\") return {success:false,errorMsg:\"COOP_LOOT_QUARANTINED\"}; }",
 "  if (process.env.EVEJS_COOP_NATIVE_LOOT_EVIDENCE === \"1\") { try { require(\"../coopNativeLootPickupEvidence\").note({scene:spaceRuntime.ensureScene(wreckRecord.systemID),wreck:wreckRecord,characterID,wreckItemID,sourceBefore:wreckItemRecord,sourceAfter:nativeNpcStore.getNativeWreckItem(wreckItemID),availableQuantity,requestedQuantity,grantResult}); } catch (_coopError) { console.warn(\"[CoopNativeLoot]\",_coopError.message); } }",
 "  if (process.env.EVEJS_COOP_NATIVE_LOOT_EVIDENCE === \"1\") { try { require(\"../coopNativeLootPickupEvidence\").note({scene:spaceRuntime.ensureScene(wreckRecord.systemID),wreck:wreckRecord,characterID,wreckItemID,destinationLocationID,sourceBefore:wreckItemRecord,sourceAfter:nativeNpcStore.getNativeWreckItem(wreckItemID),availableQuantity,requestedQuantity,grantResult}); } catch (_coopError) { console.warn(\"[CoopNativeLoot]\",_coopError.message); } }",
  '      if (process.env.EVEJS_COOP_FLEET_WARP_SAFETY === "1" && !require("../../space/coopFleetWarpSafety").eligible({commanderSession,followerSession,spaceRuntime})) return false;',
  '      if (process.env.EVEJS_COOP_FLEET_WARP_SAFETY === "1") require("../../space/coopFleetWarpSafety").recordFollowerWarp({commanderSession,followerSession,spaceRuntime,result:followerResult,targetEntityID,minimumRange});',
 "  try { require(\"../coopVirtualWorldRuntime\").confirmedNativeNpcWreck(normalizedSystemID, entityID, wreckRecord.wreckID, shipEntity); } catch (_coopError) { /* optional integration */ }",
 "  try { require(\"../coopNpcDestructionAttacker\").note(scene, shipEntity, options, wreckRecord); } catch (_coopError) { console.warn(\"[CoopNpcDestructionAttacker]\", _coopError.message); }",
 "    if (process.env.EVEJS_COOP_RIVAL_NPC_COMBAT === \"1\" && require(\"../coopNpcHostility\").allowsNativeEngagement(entity, target)) return false;",
 "        try { require(\"../coopNpcWeaponEvidence\").noteVerified(scene, entity, target, {kind:\"missile-launch\", chargeTypeID:entityMissileSource.chargeTypeID}); } catch (_coopError) { console.warn(\"[CoopWeaponEvidence]\", _coopError.message); }",
 "    if (activationOutcome && activationOutcome.success) { try { require(\"../coopNpcWeaponEvidence\").noteVerified(scene, entity, target, {kind:\"module-activation\", moduleID:moduleItem.itemID}); } catch (_coopError) { console.warn(\"[CoopWeaponEvidence]\", _coopError.message); } }",
 '  require("../../space/coopRuntimeProbe").observe("disconnect-before-persist", session, null);',
 '  require("../../space/coopRuntimeProbe").observe("disconnect-after-persist", session, null);',
 '  require("./coopRuntimeProbe").observe("space-login-attach", session, activeShip, { attached: Boolean(shipEntity) });',
 '  require("./coopNativeNpcDemo").maybeSpawn(session, activeShip);',
 '  require("./coopVirtualWorldRuntime").observeSession(session, activeShip);',
 '  require("./coopSessionPresence").schedule(session, activeShip, "login");',
 '    require("./coopSessionPresence").schedule(session, moveResult.data, "undock");',
 '  require("./coopSessionPresence").schedule(session, moveResult.data, "stargate");',
 '      try { require("../../space/coopVirtualWorldRuntime").start(); } catch (error) { console.warn("[CoopVirtualWorld] startup", error.message); }',
 '  try { require("../coopVirtualWorldRuntime").confirmedNativeNpcWreck(normalizedSystemID, entityID, wreckRecord.wreckID); } catch (_coopError) { /* optional integration */ }',
 '  try { require("../coopNativeNpcDemo").confirmedWreck(normalizedSystemID, entityID, wreckRecord.wreckID); } catch (_coopError) { /* optional co-op kill tracking */ }',
 '  if (process.env.EVEJS_COOP_PLAYER_CONSEQUENCES === "1") { try { require("../../space/coopNativeConsequences").noteMiningAggression(scene, fleetRecord, aggressorEntity, aggressionEventAtMs); } catch (_coopError) { console.warn("[CoopConsequences]", _coopError.message); } }',
 '  try { require("../coopNativeConsequences").noteNativeWreck(normalizedSystemID, entityID, wreckRecord.wreckID, shipEntity, options, controller); } catch (_coopError) { console.warn("[CoopConsequences]", _coopError.message); }',
  "  \"events\",",
  "  \"alerts\",",
  "  \"jobs\",",
  "  if (command === \"jobs\") { const result=require(\"../../space/coopNpcJobBoard\").handleChat({session,argumentText}); return handledResult(chatHub,session,options,result.message); }",
  "  if (command === \"events\" || command === \"alerts\") { const result=require(\"../../space/coopWorldOpportunityBoard\").handleChat({session,command,argumentText}); return handledResult(chatHub,session,options,result.message); }",
];
// Spec-patch lines must be idempotent across installs: strip() drops them
// before re-applying, exactly like the legacy migrated lines above.
for(const spec of specs)for(const patch of spec.patches)
 if(String(patch.line).includes("coopMiningTrace"))oldLines.push(patch.line);
// Every spec patch that pulls in a co-op module is unambiguously OUR insertion,
// so strip() must drop it before re-applying. Otherwise the second install (and
// every --check) sees the hook twice, reports phantom native-source drift and
// the overlay can never be rebuilt. Missing one line here is a real outage.
for(const spec of specs)for(const patch of spec.patches){
 const line=String(patch.line||"");
 if(line&&line.includes("require(")&&!oldLines.includes(line))oldLines.push(line);
}
const lootOld='  refreshNativeWreckRuntimeEntity(wreckRecord.systemID, wreckRecord.wreckID);';
const lootNew='  refreshNativeWreckRuntimeEntity(wreckRecord.systemID, wreckRecord.wreckID, { broadcast: true });';
const slimBroadcastOld='    scene.sendSlimItemChangesToAllSessions([entity]);';
const slimBroadcastNew='    scene.broadcastSlimItemChanges([entity]);';

module.exports={PIN,names,ORE_PATCH_PATHS,STRUCTURE_PATCH_PATHS,SOCIAL_PATCH_PATHS,specs,oldLines,lootOld,lootNew,slimBroadcastOld,slimBroadcastNew};
