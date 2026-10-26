"use strict";
// Transactional, reversible overlay for the EXACT pinned EveJS checkout.
// Preflight and parse all changed sources before writing anything.
const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const {execFileSync}=require("node:child_process");
const PIN="c3ea396b6761a0ed3e71ad5b8dd7507f9ae6d69f";
const names=["coopAlifeStartupCargoAudit","coopAgentDialogue","coopAlifeEconomy","coopAlifeEconomySensor","coopAlifeNativeBuyerDispatch","coopAlifeNativeBuyerRuntime","coopAlifeNativeDeliveryEvidence","coopAlifeNativeEconomyAct","coopAlifeNativeMiningWitness","coopAlifeNativeResupplyBridge","coopAlifeNews","coopAlifeStationAuthority","coopAlifeStationAuthorityRuntime","coopCivilianOrders","coopCombatProbe","coopConvoyOperations","coopConvoyOutcomeProof","coopCourierDispatch","coopCourierFlight","coopCourierFlightDriver","coopCourierNativeAccept","coopCourierNotices","coopCourierRuntime","coopDroneFighterAuthority","coopDuoCoordinator","coopDuoPresence","coopDuoRaidTactics","coopEncounterDirector","coopEscortContractSettlement","coopEscortFlightGate","coopEscortNativeBinding","coopEscortNativeBootstrap","coopEscortNativeFunds","coopEscortNativeMount","coopEscortNativeRescue","coopEscortNativeTactics","coopEscortPricedOffers","coopEscortReputation","coopEscortRescueNavigation","coopEscortRuntime","coopEscortTacticalGame","coopEscortTerminalAttendance","coopEscortVolunteers","coopEscortWarpFence","coopEwarDogmaCorrections","coopFactionDirector","coopFactionPatrolRuntime","coopFleetDungeonCredit","coopFleetMissionJoin","coopFleetMissionTurnin","coopFleetTradeSafety","coopFleetWarpArrival","coopFleetWarpSafety","coopGameStoreAtomic","coopHeadlessScenePolicy","coopIdentityRegistry","coopIndustryPacing","coopMarketCatalog","coopMissionInstanceProvenance","coopNativeActivity","coopNativeAgentMotion","coopLivingAgentRuntime","coopAdminBridge","coopNativeCombatEvidence","coopNativeConsequences","coopNativeConvoyRenewal","coopNativeDepot","coopNativeFittingSlotGuard","coopNativeFittingSourceGuard","coopNativeFleetParty","coopNativeGateTransfer","coopNativeHaulCargo","coopNativeHaulManifest","coopNativeIndustry","coopNativeLootPickupEvidence","coopNativeLootQuarantine","coopNativeLpStandings","coopNativeMiningReadiness","coopNativeNpcDemo","coopNativeNpcMarket","coopNativePveObjectiveGuard","coopNativeRaidEligibility","coopNativeRaids","coopNativeRestore","coopNativeScanProof","coopNativeStationArrival","coopNativeStationOreSettlement","coopNativeTradeAtomic","coopNativeTradeCustody","coopNativeWarehouse","coopNpcAmmoConservation","coopNpcAmmoDebitJournal","coopNpcAmmoSupply","coopNpcAmmoWitness","coopNpcBuyerCoordinator","coopNpcBuyerNativeBindings","coopNpcBuyerRecoveryAudit","coopNpcBuyerAdminControl","coopNpcChatter","coopNpcCorporateBuyRuntime","coopNpcCorporateBuyerAtomic","coopNpcCorporateSettlement","coopNpcDemandAuthority","coopNpcDestructionAttacker","coopNpcEconomyScheduler","coopNpcEconomyUnknownRecovery","coopNpcFireDebitProof","coopNpcGateTravel","coopNpcHostility","coopNpcHuntPolicy","coopNpcIndustryGameStoreScope","coopNpcIndustryNativeBindings","coopNpcIndustryOfflineAtomic","coopNpcIndustryOfflineDelivery","coopNpcIndustryReady","coopNpcIntelLedger","coopNpcLife","coopNpcLootCommerce","coopNpcLossBridge","coopNpcManufacturingJournal","coopNpcManufacturingNative","coopNpcManufacturingPlanner","coopNpcMarketCompletionNotify","coopNpcMarketPolicy","coopNpcMaterializer","coopNpcMemory","coopNpcNativeEconomyDirector","coopNpcNativeRearm","coopNpcOpportunityPlanner","coopNpcOrderArbiter","coopNpcOrderBridge","coopNpcPartialFillAtomic","coopNpcPersonalGoals","coopNpcPresentation","coopNpcRecognition","coopNpcRefinery","coopNpcRefineryRuntime","coopNpcRolePriority","coopNpcRustOrderAuthority","coopNpcSellPricing","coopNpcSellerTaxAuthority","coopNpcSpawnPools","coopNpcSquadDirector","coopNpcStockWreckProof","coopNpcTactics","coopNpcTopology","coopNpcWeaponAmmoGate","coopNpcWeaponEvidence","coopNpcWreckClaims","coopNpcWreckCustody","coopNpcWreckRecovery","coopPartyNotices","coopPatrolNavigator","coopPatrolOrders","coopPlayerCombatWitness","coopPlayerTravelGuard","coopRescueContracts","coopRescueNativeGame","coopRescueNativeTransfer","coopRescueNativeWarehouse","coopRescueNpcDepot","coopRescueNpcRivalry","coopRuntimeProbe","coopSceneObserverIntegrity","coopSessionPresence","coopSkillGrant","coopStationShipGuard","coopStockFleetCombatEvidence","coopStockFleetWreckEvidence","coopStoryMissionGuard","coopStoryMissionSettlementFence","coopStuckWarpRecovery","coopSystemIntel","coopVirtualEconomy","coopVirtualWorld","coopVirtualWorldRuntime","coopWorldOpportunityBoard","coopWorldSignals"];
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
 "coopNpcIndustryOriginalGameStorePreflight","coopNpcIndustryOriginalStageExecutor","coopNpcIndustryOriginalRustSell");
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
 {file:"server/src/services/mining/miningRuntime.js",patches:[]},
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
 {file:"server/src/space/runtime.js",patches:[]},
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
   {anchor:"  const primaryTargetEntry = [...targetAssignmentCounts.entries()]",after:false,
    line:"  require(\"../../space/coopMiningTrace\").note(\"FLEET_POST_TICK\",{fleetID:toInt(fleetRecord&&fleetRecord.fleetID,0),systemID:toInt(scene&&scene.systemID,0),state:String(fleetRecord.state||\"\"),miners:(Array.isArray(fleetRecord.minerEntityIDs)?fleetRecord.minerEntityIDs:[]).map(function(id){var e=scene.getEntityByID(id);return id+\"|\"+String((e&&e.mode)||\"none\")+\"|act\"+(e&&e.activeModuleEffects instanceof Map?e.activeModuleEffects.size:-1)+\"|cap\"+(e?Number(e.capacitorChargeRatio):\"none\")+\"|capmax\"+(e?Number(e.capacitorCapacity):0);}).join(\" ; \")});"},
   {anchor:"    if (!targetEntity) {\n      delete assignmentMap[toInt(minerEntity.itemID, 0)];",after:true,
    line:'      require("../../space/coopMiningTrace").note("NO_MINEABLE_TARGET",{fleetID:toInt(fleetRecord&&fleetRecord.fleetID,0),systemID:toInt(scene&&scene.systemID,0),minerID:toInt(minerEntity.itemID,0),rocks:(Array.isArray(availableTargetEntries)?availableTargetEntries.length:-1),claims:(claimCounts instanceof Map?claimCounts.size:-1),activeAsteroidID:toInt(fleetRecord&&fleetRecord.activeAsteroidID,0)});'},
   {anchor:"    const distanceToTarget = hooks.getSurfaceDistance(minerEntity, targetEntity);",after:true,
    line:'    require("../../space/coopMiningTrace").note("MINER_TARGET",{fleetID:toInt(fleetRecord&&fleetRecord.fleetID,0),systemID:toInt(scene&&scene.systemID,0),minerID:toInt(minerEntity.itemID,0),targetID:toInt(targetEntity.itemID,0),modules:miningModules.length,fitted:getNpcFittedModuleItems(minerEntity).length,activeEffects:(minerEntity.activeModuleEffects instanceof Map?minerEntity.activeModuleEffects.size:-1),distance:Math.round(hooks.getSurfaceDistance(minerEntity,targetEntity))});'},
   // The stock loop discards the activation result, so a module that refuses to
   // start leaves the fleet "mining" forever with activeEffects=0.
   {anchor:"      if (!activeEffect) {\n      scene.activateGenericModule(pseudoSession, entry.moduleItem, entry.effectRecord.name, {\n        targetID: targetEntity.itemID,\n      });\n      }",
    line:'      if (!activeEffect) { const coopAct = scene.activateGenericModule(pseudoSession, entry.moduleItem, entry.effectRecord.name, { targetID: targetEntity.itemID }); if (!coopAct || coopAct.success !== true) require("../../space/coopMiningTrace").note("MODULE_ACTIVATE_FAILED",{fleetID:toInt(fleetRecord&&fleetRecord.fleetID,0),systemID:toInt(scene&&scene.systemID,0),minerID:toInt(minerEntity.itemID,0),moduleID:toInt(entry.moduleItem.itemID,0),typeID:toInt(entry.moduleItem.typeID,0),locationID:toInt(entry.moduleItem.locationID,0),shipID:toInt(minerEntity.itemID,0),cap:Number(minerEntity.capacitorCapacity)||0,ratio:Number(minerEntity.capacitorChargeRatio),native:(minerEntity.nativeNpc===true),hasSession:Boolean(minerEntity.session),errorMsg:String((coopAct&&coopAct.errorMsg)||"NONE")}); }'},
   {anchor:"    if (!minerEntity || minerEntity.mode === \"WARP\" || minerEntity.pendingWarp) {",after:true,
   line:'      require("../../space/coopMiningTrace").note("MINER_NOT_IN_SCENE_OR_WARPING",{fleetID:toInt(fleetRecord&&fleetRecord.fleetID,0),systemID:toInt(scene&&scene.systemID,0),minerID:toInt(minerEntityID,0),found:Boolean(minerEntity),mode:String((minerEntity&&minerEntity.mode)||""),pendingWarp:Boolean(minerEntity&&minerEntity.pendingWarp)});'},
  {anchor:"  fleetRecord.nextThinkAtMs = now + thinkIntervalMs;",after:true,
    line:'  require("../../space/coopMiningTrace").note("TICK_"+String(fleetRecord.state||"unknown"),{fleetID:toInt(fleetRecord.fleetID,0),systemID:toInt(scene.systemID,0),activeAsteroidID:toInt(fleetRecord.activeAsteroidID,0)});'},
  {anchor:'  if (startupSceneSeedSet.has(startupKey)) {',line:'  if (process.env.EVEJS_COOP_CONVOY_RENEWAL === "1") { const renewal = require("../../space/coopNativeConvoyRenewal").inspect({scene,systemID:scene.systemID,slotCount:resolveStartupFleetCount(),seeded:startupSceneSeedSet.has(startupKey),fleets:getMiningFleetsForSystem(scene.systemID)}); if (!renewal.allowed) return; if (renewal.renewal) startupSceneSeedSet.delete(startupKey); }'},
  {anchor:'  const responsePlan = resolveResponsePlan(scene, fleetRecord, aggressorEntity, {',
   line:'  if (process.env.EVEJS_COOP_PLAYER_CONSEQUENCES === "1") { try { require("../../space/coopNativeConsequences").noteMiningAggression(scene, fleetRecord, aggressorEntity, aggressionEventAtMs); } catch (_coopError) { console.warn("[CoopConsequences]", _coopError.message); } }'}
 ]},
 {file:"server/src/space/npc/nativeNpcWreckService.js",patches:[
  {anchor:'  const itemType = resolveItemByTypeID(wreckItemRecord.typeID) || {',line:"  if (process.env.EVEJS_COOP_NATIVE_LOOT_QUARANTINE === \"1\") { const guard = require(\"../coopNativeLootQuarantine\").check({wreckID,wreckItemID}); if (guard.status !== \"ALLOW\") return {success:false,errorMsg:\"COOP_LOOT_QUARANTINED\"}; }"},
  {anchor:'  refreshNativeWreckRuntimeEntity(wreckRecord.systemID, wreckRecord.wreckID, { broadcast: true });',line:"  if (process.env.EVEJS_COOP_NATIVE_LOOT_EVIDENCE === \"1\") { try { require(\"../coopNativeLootPickupEvidence\").note({scene:spaceRuntime.ensureScene(wreckRecord.systemID),wreck:wreckRecord,characterID,wreckItemID,destinationLocationID,sourceBefore:wreckItemRecord,sourceAfter:nativeNpcStore.getNativeWreckItem(wreckItemID),availableQuantity,requestedQuantity,grantResult}); } catch (_coopError) { console.warn(\"[CoopNativeLoot]\",_coopError.message); } }",after:false},
  {anchor:"  try {\n    const dungeonUniverseSiteService = require(path.join(",line:'  try { require("../coopVirtualWorldRuntime").confirmedNativeNpcWreck(normalizedSystemID, entityID, wreckRecord.wreckID, shipEntity); } catch (_coopError) { /* optional integration */ }'},
  {anchor:"  try {\n    const dungeonUniverseSiteService = require(path.join(",line:'  try { require("../coopNativeNpcDemo").confirmedWreck(normalizedSystemID, entityID, wreckRecord.wreckID); } catch (_coopError) { /* optional co-op kill tracking */ }'},
  {anchor:"  try {\n    const dungeonUniverseSiteService = require(path.join(",line:'  try { require("../coopNativeConsequences").noteNativeWreck(normalizedSystemID, entityID, wreckRecord.wreckID, shipEntity, options, controller); } catch (_coopError) { console.warn("[CoopConsequences]", _coopError.message); }'},
  {anchor:"  try {\n    const dungeonUniverseSiteService = require(path.join(",line:"  try { require(\"../coopNpcDestructionAttacker\").note(scene, shipEntity, options, wreckRecord); } catch (_coopError) { console.warn(\"[CoopNpcDestructionAttacker]\", _coopError.message); }"}
 ]},
 {file:"server/src/space/npc/npcBehaviorLoop.js",patches:[
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
function count(text,needle){return text.split(needle).length-1;}
function strip(source){
 return source.split("\n").filter(row=>!oldLines.includes(row.replace(/\r$/,""))).join("\n");
}
function transform(source,spec,remove){
 let text=strip(source);
 if(spec.file==="server/src/services/industry/industryManagerService.js")
  text=require("./coop-player-industry-native-patch.cjs").patch(text,spec.file,remove);
 // Undo late Chat 25/32/39 hooks BEFORE the existing itemStore and
 // other native transforms so ownership/export adjacency remains unchanged.
 if(remove){
  for(const [helper,targets] of [
   ["./coop-social-native-guards-patch.cjs",SOCIAL_PATCH_PATHS],
   ["./coop-structure-alliance-guard-patch.cjs",STRUCTURE_PATCH_PATHS],
   ["./coop-player-ore-atomic-patch.cjs",ORE_PATCH_PATHS]
  ])if(targets.has(spec.file))text=require(helper).patch(text,spec.file,true);
 }
 if(spec.file==="server/src/services/exploration/wormholes/wormholeMgrService.js")
  text=require("./coop-wormhole-jump-fence-patch.cjs").patch(text,spec.file,remove);
 if(spec.file==="server/src/space/transitions.js")
  text=require("./coop-pochven-conduit-patch.cjs").patch(text,spec.file,remove);
 if(spec.file==="server/src/services/exploration/scanMgrService.js" ||
    spec.file==="server/src/services/ship/beyonceService.js")
  text=require("./coop-native-exploration-patch.cjs").patch(text,spec.file,remove);
 if(spec.file==="server/src/services/market/marketProxyService.js")
  text=require("./coop-market-catalog-patch.cjs").patch(text,spec.file,remove);
 if(spec.file==="server/src/services/market/marketProxyService.js") {
  if(remove) {
   text=require("./coop-npc-corporate-buy-patch.cjs").patch(text,{remove:true});
   text=require("./coop-npc-market-buy-safety-patch.cjs").patch(text,{remove:true});
  } else {
   text=require("./coop-npc-market-buy-safety-patch.cjs").patch(text,{remove:false});
   text=require("./coop-npc-corporate-buy-patch.cjs").patch(text,{remove:false});
  }
 }
 if(spec.file==="server/src/services/market/marketProxyService.js") {
  if(remove) {
   text=require("./coop-player-market-buy-refund-patch.cjs").patch(text,{remove:true});
   text=require("./coop-player-market-buy-settlement-patch.cjs").patch(text,{remove:true});
   text=require("./coop-player-market-buy-reserve-patch.cjs").patch(text,{remove:true});
   text=require("./coop-player-market-atomic-patch.cjs").patch(text,{remove:true});
   text=require("./coop-player-market-rust-claim-patch.cjs").patch(text,{remove:true});
   text=require("./coop-player-market-settlement-patch.cjs").patch(text,{remove:true});
   text=require("./coop-player-market-fill-patch.cjs").patch(text,{remove:true});
   text=require("./coop-market-sell-custody-patch.cjs").patch(text,{remove:true});
   text=require("./coop-market-cancel-custody-patch.cjs").patch(text,{remove:true});
  } else {
   text=require("./coop-market-cancel-custody-patch.cjs").patch(text,{remove:false});
   text=require("./coop-market-sell-custody-patch.cjs").patch(text,{remove:false});
   text=require("./coop-player-market-fill-patch.cjs").patch(text,{remove:false});
   text=require("./coop-player-market-settlement-patch.cjs").patch(text,{remove:false});
   text=require("./coop-player-market-rust-claim-patch.cjs").patch(text,{remove:false});
   text=require("./coop-player-market-atomic-patch.cjs").patch(text,{remove:false});
   text=require("./coop-player-market-buy-reserve-patch.cjs").patch(text,{remove:false});
   text=require("./coop-player-market-buy-settlement-patch.cjs").patch(text,{remove:false});
   text=require("./coop-player-market-buy-refund-patch.cjs").patch(text,{remove:false});
  }
 }
 if(spec.file==="server/src/space/runtime.js")
  text=require("./coop-native-npc-fire-debit-patch.cjs").patch(text,{remove});
 if(spec.file==="server/src/space/movement/warp/movementWarpState.js")
  text=require("./coop-escort-native-motion-patch.cjs").patch(text,{remove});
 if(spec.file==="server/src/space/npc/nativeNpcService.js")
  text=require("./coop-escort-ingress-materialize-patch.cjs").patch(text,{remove});
 if(spec.file==="server/src/services/inventory/itemStore.js" || spec.file==="server/src/services/trade/tradeMgrService.js")
  text=require("./coop-atomic-trade-patch.cjs").patch(text,spec.file,remove);
 if(spec.file==="server/src/services/inventory/itemStore.js" || spec.file==="server/src/services/trade/tradeMgrService.js")
  text=require("./coop-native-trade-custody-patch.cjs").patch(text,spec.file,remove);
 if(spec.file==="server/src/services/inventory/itemStore.js"&&!remove)
  text=require("./coop-native-refinery-item-patch.cjs").patch(text,spec.file,false);
 if(spec.file==="server/src/services/inventory/itemStore.js")
  text=require("./coop-native-warehouse-item-patch.cjs").patch(text,spec.file,remove);
 if(spec.file==="server/src/services/inventory/itemStore.js"&&remove)
  text=require("./coop-native-refinery-item-patch.cjs").patch(text,spec.file,true);
 if(spec.file.endsWith("nativeNpcStore.js")){
  // Persistent IDs must never reuse an ID handed out earlier in the
  // current process for a transient NPC fleet. Both allocation paths
  // must advance the common in-memory high-water mark.
  const eol=text.includes("\r\n")?"\r\n":"\n";
  const before=[
   '  const nextID = Math.max(',
   '    toPositiveInt(root && root[counterKey], 0),',
   '    toPositiveInt(ROOT[tableName] && ROOT[tableName][counterKey], 0),',
   '  );'
  ].join(eol);
  const after=[
   '  const nextID = Math.max(',
   '    toPositiveInt(root && root[counterKey], 0),',
   '    toPositiveInt(ROOT[tableName] && ROOT[tableName][counterKey], 0),',
   '    Number.isSafeInteger(transientCounters[tableName]) ? transientCounters[tableName] : 0,',
   '  );'
  ].join(eol);
  const originalReturn=[
   '  return {',
   '    success: true,',
   '    data: nextID,',
   '  };'
  ].join(eol);
  const fixedReturn=[
   '  if (Number.isSafeInteger(transientCounters[tableName]))',
   '    transientCounters[tableName] = Math.max(transientCounters[tableName], nextID + 1);',
   ...originalReturn.split(eol)
  ].join(eol);
  if(count(text,before)+count(text,after)!==1||
     count(text,originalReturn)!==1||count(text,fixedReturn)>1)
   throw Error("Unrecognized native NPC mixed persistent/transient ID allocator");
  text=remove?text.replace(after,before):text.replace(before,after);
  if(remove){
   if(count(text,fixedReturn)===1)text=text.replace(fixedReturn,originalReturn);
  }else if(count(text,fixedReturn)===0){
   text=text.replace(originalReturn,fixedReturn);
  }
 }
 if(spec.file.endsWith("nativeNpcWreckService.js")){
  if(count(text,lootOld)+count(text,lootNew)!==1)throw Error("Ambiguous native wreck refresh");
  text=remove?text.replace(lootNew,lootOld):text.replace(lootOld,lootNew);
  // The old method does not exist on the pinned SolarSystemScene.
  // A thrown exception here can happen after a loot item has been granted.
  if(count(text,slimBroadcastOld)+count(text,slimBroadcastNew)!==1)
   throw Error("Ambiguous native wreck client slim-item broadcast");
  text=remove?text.replace(slimBroadcastNew,slimBroadcastOld):
   text.replace(slimBroadcastOld,slimBroadcastNew);
 }
 // The station-arrival layer rewrites the haulereturn block below, so it is
 // stripped first whenever it is present. Without this, re-running install on
 // an already patched checkout fails with "Unexpected EveJS NPC haul arrival
 // location" instead of being a no-op (it is re-applied further down).
 if(spec.file.endsWith("miningNpcOperations.js")&&
    text.includes('require("../../space/coopNativeStationArrival")'))
  text=require("./coop-native-station-arrival-patch.cjs").patch(text,spec.file,true);
 // Detach ALIFE-09 stable-ID shim before ALIFE-08 validates its pinned bootCall.
 if(spec.file.endsWith("miningNpcOperations.js")&&
    text.includes('coopDurableFleetID:Number(scene.systemID)*32+Number(slot),'))
  text=require("./coop-native-mining-stable-fleet-id-patch.cjs").patch(text,true);
 if(spec.file.endsWith("miningNpcOperations.js")){
  // Replace the vanilla "miner ore disappears during hauling" path with
  // a real native cargo reparent to a live hauler ship. Keep fallback.
  const oldTransfer='    hauledVolumeM3 += clearNpcMiningCargo(entity);';
  const newTransfer='    hauledVolumeM3 += process.env.EVEJS_COOP_NATIVE_HAUL_CARGO === "1" ? require("../../space/coopNativeHaulCargo").transferCargo(scene, fleetRecord, entity) : clearNpcMiningCargo(entity);';
  const oldArrival='      fleetRecord.state = "mining";';
  const newArrival='      if (process.env.EVEJS_COOP_NATIVE_HAUL_CARGO === "1") require("../../space/coopNativeHaulCargo").unloadCargo(scene, fleetRecord);'+(text.includes("\r\n")?"\r\n":"\n")+oldArrival;
  if(count(text,oldTransfer)+count(text,newTransfer)!==1)throw Error("Unexpected EveJS NPC haul transfer location");
  text=remove?text.replace(newTransfer,oldTransfer):text.replace(oldTransfer,newTransfer);
  const oldBlock='  if (fleetRecord.state === "haulereturn") {'+(text.includes("\r\n")?"\r\n":"\n")+'    if (now >= toFiniteNumber(fleetRecord.haulerReturnAtMs, 0)) {'+(text.includes("\r\n")?"\r\n":"\n")+oldArrival;
  const newBlock=oldBlock.replace(oldArrival,newArrival);
  if(count(text,oldBlock)+count(text,newBlock)!==1)throw Error("Unexpected EveJS NPC haul arrival location");
  text=remove?text.replace(newBlock,oldBlock):text.replace(oldBlock,newBlock);

  const eol=text.includes("\r\n")?"\r\n":"\n";
  const loadedMarker='  const ingressDurationMs = Math.max(';
  const completeFn='function completeHaulCycle(scene, fleetRecord, now) {';
  const loadedBlock=[
    '  if (process.env.EVEJS_COOP_NATIVE_HAUL_CARGO === "1") {',
    '    fleetRecord.state = "loaded";',
    '    fleetRecord.loadedUntilMs = now + Math.max(30000, Math.min(240000, Number(process.env.EVEJS_COOP_HAULER_HOLD_MS || 120000)));',
    '    fleetRecord.lastHauledVolumeM3 = hauledVolumeM3;',
    '    fleetRecord.lastHauledAtMs = now;',
    '    fleetRecord.nextThinkAtMs = fleetRecord.loadedUntilMs;',
    '    return;',
    '  }',
    ''
  ].join(eol);
  const loadedHandler=[
    '  if (fleetRecord.state === "loaded") {',
    '    if (now < toFiniteNumber(fleetRecord.loadedUntilMs, 0)) return;',
    '    const ingressMs = Math.max(250, toFiniteNumber(config.miningNpcWarpIngressDurationMs, DEFAULT_MINING_WARP_INGRESS_DURATION_MS));',
    '    if (fleetRecord.originAnchor && fleetRecord.originAnchor.position) {',
    '      for (const entityID of fleetRecord.haulerEntityIDs || []) {',
    '        npcService.runtime.warpToPoint(entityID, fleetRecord.originAnchor.position, {',
    '          forceImmediateStart: true, broadcastWarpStartToVisibleSessions: true,',
    '          visibilitySuppressMs: 250, ingressDurationMs: ingressMs',
    '        });',
    '      }',
    '    }',
    '    fleetRecord.haulerNextArrivalAtMs = now + getHaulerRepeatDelayMs();',
    '    fleetRecord.state = "haulereturn";',
    '    fleetRecord.haulerReturnAtMs = now + ingressMs;',
    '    fleetRecord.nextThinkAtMs = fleetRecord.haulerReturnAtMs;',
    '    return;',
    '  }',
    ''
  ].join(eol);
  if(remove){
    if(count(text,loadedBlock)===1)text=text.replace(loadedBlock,'');
    else if(count(text,loadedBlock)!==0)throw Error("Unexpected native hauler hold patch state");
    if(count(text,loadedHandler)===1)text=text.replace(loadedHandler,'');
    else if(count(text,loadedHandler)!==0)throw Error("Unexpected native hauler loaded handler state");
  }else{
    if(count(text,loadedBlock)===0){
      const pos=text.indexOf(completeFn),at=pos<0?-1:text.indexOf(loadedMarker,pos);
      if(pos<0||at<0)throw Error("Missing native hauler departure anchor");
      text=text.slice(0,at)+loadedBlock+text.slice(at);
    }
    if(count(text,loadedHandler)===0){
      const gate='  if (fleetRecord.state === "haulereturn") {';
      if(count(text,gate)!==1)throw Error("Unknown native hauler return state");
      text=text.replace(gate,loadedHandler+gate);
    }
  }
 }
 if(spec.file.endsWith("miningNpcOperations.js")&&remove)
  text=require("./coop-native-mining-durable-patch.cjs").patch(text,true);
 if(spec.file.endsWith("miningNpcOperations.js"))
  text=require("./coop-mining-startup-recovery-patch.cjs").patchStartupRecovery(text,remove);
 if(spec.file.endsWith("miningNpcOperations.js")&&!remove){
  text=require("./coop-native-mining-durable-patch.cjs").patch(text,false);
  text=require("./coop-native-mining-stable-fleet-id-patch.cjs").patch(text,false);
 }
 if(spec.file==="server/src/services/mining/miningRuntime.js" || spec.file==="server/src/services/mining/miningRuntimeState.js"){
  if(remove){
   text=require("./coop-native-mining-atomic-source-patch.cjs").patch(text,spec.file,true);
   text=require("./coop-native-mining-cycle-conservation-patch.cjs").patch(text,spec.file,true);
  }else{
   text=require("./coop-native-mining-cycle-conservation-patch.cjs").patch(text,spec.file,false);
   text=require("./coop-native-mining-atomic-source-patch.cjs").patch(text,spec.file,false);
  }
 }
 // ALIFE-05: existing native stock mining writer; store-before-hull commit when opt-in.
 if(spec.file.endsWith("miningNpcOperations.js"))
  text=require("./coop-native-mining-cargo-integrity-patch.cjs").patchMiningCargo(text,remove);
 if(spec.file.endsWith("agent/agentMissionRuntime.js")||spec.file.endsWith("agent/missionRuntimeState.js")||spec.file.endsWith("dungeon/dungeonUniverseSiteService.js"))
  text=require("./coop-fleet-mission-native-patch.cjs").patch(text,spec.file,remove);
 if(spec.file==="server/src/services/agent/agentMissionRuntime.js")
  text=require("./coop-fleet-mission-join-patch.cjs").patch(text,spec.file,remove);
 if(spec.file.endsWith("industry/industryParityHelpers.js"))
  text=require("./coop-industry-time-patch.cjs").patch(text,spec.file,remove);
 if(spec.file==="server/index.js" || spec.file==="server/src/services/machoNet/machoNetService.js" ||
    spec.file==="server/src/services/contracts/contractRuntimeState.js")
  text=require("./coop-native-contract-routing-patch.cjs").patch(text,spec.file,remove);
  // CH23/30/37 reconciliation: original contractProxy remains the sole owner of
  // native item/ISK mutations; optional file-journal guard is default OFF.
  if(spec.file==="server/src/services/_other/contractProxyService.js")
   text=require("./coop-native-contract-mutation-fence-patch.cjs").patch(text,spec.file,remove);
 if(spec.file==="server/src/services/evermarks/lpStoreMgrService.js")
  text=require("./coop-native-lp-standing-patch.cjs").patch(text,spec.file,remove);
 if(spec.file.endsWith("/space/combat/killmailTracker.js")){
  // Install order: existing player damage patch, THEN native war
  // structure killmail witness. Remove in the exact inverse order.
  if(remove){
   text=require("./coop-war-structure-killmail-patch.cjs").patch(text,{remove:true});
   text=require("./coop-player-damage-native-patch.cjs").patch(text,{remove:true});
  }else{
   text=require("./coop-player-damage-native-patch.cjs").patch(text,{remove:false});
   text=require("./coop-war-structure-killmail-patch.cjs").patch(text,{remove:false});
  }
 }
 // CH31: native corporate custody/role fences; default OFF, reversible.
 if(["industry/industryAccess.js","inventory/invBrokerService.js",
     "corporation/corpRegistryRuntime.js","corporation/corpMemberActionState.js",
     "corporation/officeManagerService.js"].some(p=>spec.file==="server/src/services/"+p))
  text=require("./coop-player-corporation-access-patch.cjs").patch(text,spec.file,remove);
 // CH38: source-only native NPE hooks; never bypass the stock tutorial state.
 if(spec.file==="server/src/services/npe/airNpeService.js"||
    spec.file==="server/src/services/npe/nesIntroService.js"||
    spec.file==="server/src/services/account/tutorialSvcService.js"||
    spec.file==="server/src/services/character/achievementTrackerMgrService.js")
   text=require("./coop-npe-native-state-patch.cjs").patch(text,spec.file,remove);
 if(spec.file==="server/src/services/agent/agentMgrService.js"){
  // Remove job hooks first, then existing dialogue patch. Install in reverse.
  if(remove){
   text=require("./coop-faction-war-agent-patch.cjs").patch(text,{remove:true});
   text=require("./coop-native-job-agent-patch.cjs").patch(text,{remove:true});
   text=require("./coop-agent-dialogue-patch.cjs").patch(text,{remove:true});
  }else{
   text=require("./coop-agent-dialogue-patch.cjs").patch(text,{remove:false});
   text=require("./coop-native-job-agent-patch.cjs").patch(text,{remove:false});
   text=require("./coop-faction-war-agent-patch.cjs").patch(text,{remove:false});
  }
 }
 if(spec.file==="server/src/space/npc/nativeNpcWreckService.js")
  text=require("./coop-salvage-death-native-patch.cjs").patch(text,remove);
 if(!remove)for(const patch of spec.patches){
  const eol=text.includes("\r\n")?"\r\n":"\n";
  const anchor=patch.anchor.replace(/\n/g,eol);
  if(count(text,anchor)!==1)throw Error("Unknown or duplicate source anchor: "+spec.file+" "+patch.anchor);
  text=text.replace(anchor,patch.after?anchor+eol+patch.line:patch.line+eol+anchor);
 }
 if(spec.file.endsWith("miningNpcOperations.js")&&!remove)
  text=require("./coop-native-station-arrival-patch.cjs").patch(text,spec.file,false);
 if(spec.file==="server/src/gameStore/index.js"||spec.file==="server/src/gameStore/sqliteStore.js"||spec.file==="server/src/services/inventory/itemStore.js")
  text=require("./coop-gamestore-atomic-patch.cjs").patch(text,spec.file,remove);
 if(spec.file==="server/src/gameStore/index.js")
  text=require("./coop-npc-market-fills-table-patch.cjs").patch(text,spec.file,remove);
 if(spec.file==="server/src/gameStore/index.js")
  text=require("./coop-player-market-fills-table-patch.cjs").patch(text,spec.file,remove);
 if(spec.file==="server/src/services/character/characterState.js"||spec.file==="server/src/services/corporation/corporationRuntimeState.js")
  text=require("./coop-npc-account-cache-patch.cjs").patch(text,spec.file,remove);
 // Apply opt-in hooks LAST, inside the single transactional installer.
 if(!remove){
  for(const [helper,targets] of [
   ["./coop-player-ore-atomic-patch.cjs",ORE_PATCH_PATHS],
   ["./coop-structure-alliance-guard-patch.cjs",STRUCTURE_PATCH_PATHS],
   ["./coop-social-native-guards-patch.cjs",SOCIAL_PATCH_PATHS]
  ])if(targets.has(spec.file))text=require(helper).patch(text,spec.file,false);
 }
 new vm.Script(text,{filename:spec.file});
 return text;
}
// All sources are preflighted before the first write. Restore the failed
// item too: writeFileSync may have already truncated its destination.
function executePlan(changed,ops=fs){
 const attempted=[];
 try{
  for(const item of changed){
   attempted.push(item);
   if(item.after===null)ops.unlinkSync(item.file);
   else ops.writeFileSync(item.file,item.after,"utf8");
  }
 }catch(error){
  const rollbackFailures=[];
  for(const item of attempted.reverse()){
   try{
    if(item.before===null){if(ops.existsSync(item.file))ops.unlinkSync(item.file);}
    else ops.writeFileSync(item.file,item.before,"utf8");
   }catch(rollbackError){
    rollbackFailures.push(item.file);
    console.error("Source rollback failed:",item.file,rollbackError.message);
   }
  }
  if(rollbackFailures.length)
   throw Error("Overlay rollback incomplete: "+rollbackFailures.join(", "),{cause:error});
  throw error;
 }
}
function run({codePath,remove=false,dryRun=false}){
 const project=path.resolve(__dirname,".."),code=path.resolve(codePath);
 if(!fs.existsSync(path.join(code,"compose.yaml")))throw Error("Missing EveJS compose.yaml: "+code);
 const sha=execFileSync("git",["-C",path.dirname(code),"rev-parse","HEAD"],{encoding:"utf8"}).trim();
 if(sha!==PIN)throw Error("Refusing incompatible EveJS version "+sha);
 const plan=[];
 for(const spec of specs){
  const file=path.join(code,spec.file),before=fs.readFileSync(file,"utf8");
  const sourceState=classifyFile(before,spec,code);
  if(sourceState!=="PRISTINE"&&sourceState!=="PATCHED")
   throw Error("Refusing to modify drifted native source: "+spec.file+" ("+sourceState+")");
  plan.push({file,before,after:transform(before,spec,remove)});
 }
 for(const name of names){
  const file=path.join(code,"server/src/space",name+".js");
  const src=path.join(project,"integration",name+".cjs");
  if(!remove){
   const after=fs.readFileSync(src,"utf8");
   new vm.Script(after,{filename:src});
   plan.push({file,before:fs.existsSync(file)?fs.readFileSync(file,"utf8"):null,after});
  }else if(fs.existsSync(file)){
   const before=fs.readFileSync(file,"utf8");
   if(before!==fs.readFileSync(src,"utf8"))
    throw Error("Refusing to remove drifted overlay module: "+name);
   plan.push({file,before,after:null});
  }
 }
 const changed=plan.filter(p=>p.before!==p.after);
 if(!dryRun)executePlan(changed);
 return {status:dryRun?"DRY_RUN_OK":remove?"REMOVED":"INSTALLED",changed:changed.map(p=>path.relative(code,p.file))};
}
function classifyFile(text,spec,code){
 try{
  const pristine=transform(text,spec,true);
  if(pristine!==text)return transform(pristine,spec,false)===text?"PATCHED":"DRIFTED";
  transform(text,spec,false);
  return spec.patches.some(p=>text.includes(p.line))?"DRIFTED":"PRISTINE";
 }catch(_error){
  // Chained patch modules legitimately refuse to REMOVE a hook that a pristine
  // file never had. Falling back to git HEAD tells the truth: a file identical
  // to HEAD is pristine, and a HEAD that our patches reproduce exactly is
  // patched. Only a real mismatch is drift.
  try{
   const repoRoot=path.dirname(code);
   const rel=path.relative(repoRoot,code).split(path.sep).join("/");
   const head=execFileSync("git",["-C",repoRoot,"show",
    "HEAD:"+(rel?rel+"/":"")+spec.file],
    {encoding:"utf8",maxBuffer:64*1024*1024});
   if(head===text)return "PRISTINE";
   try{if(transform(head,spec,false)===text)return "PATCHED";}catch(_readd){}
   return "DRIFTED";
  }catch(_head){return "ANCHOR_MISMATCH";}
 }
}
function check({codePath}){
 const project=path.resolve(__dirname,".."),code=path.resolve(codePath);
 if(!fs.existsSync(path.join(code,"compose.yaml")))throw Error("Missing EveJS compose.yaml: "+code);
 let sha="UNKNOWN";
 try{sha=execFileSync("git",["-C",path.dirname(code),"rev-parse","HEAD"],{encoding:"utf8"}).trim();}catch(_error){}
 const problems=[],files=[],modules=[];
 for(const spec of specs){
  const file=path.join(code,spec.file);
  const state=fs.existsSync(file)?classifyFile(fs.readFileSync(file,"utf8"),spec,code):"MISSING";
  files.push({file:spec.file,state});
  if(state!=="PRISTINE"&&state!=="PATCHED")problems.push({target:spec.file,kind:"native-source",state});
 }
 for(const name of names){
  const deployed=path.join(code,"server/src/space",name+".js");
  const source=path.join(project,"integration",name+".cjs");
  const state=!fs.existsSync(source)?"SOURCE_MISSING":!fs.existsSync(deployed)?"MISSING":
   fs.readFileSync(deployed,"utf8")===fs.readFileSync(source,"utf8")?"CURRENT":"STALE";
  modules.push({name,state});
  if(state!=="CURRENT")problems.push({target:"server/src/space/"+name+".js",kind:"overlay-module",state});
 }
 const pinMatches=sha===PIN;
 const counts={pristine:0,patched:0,drifted:0,anchorMismatch:0,missing:0,moduleCurrent:0,moduleStale:0,moduleMissing:0};
 for(const item of files){
  if(item.state==="PRISTINE")counts.pristine++;
  else if(item.state==="PATCHED")counts.patched++;
  else if(item.state==="DRIFTED")counts.drifted++;
  else if(item.state==="ANCHOR_MISMATCH")counts.anchorMismatch++;
  else counts.missing++;
 }
 for(const item of modules){
  if(item.state==="CURRENT")counts.moduleCurrent++;
  else if(item.state==="STALE")counts.moduleStale++;
  else counts.moduleMissing++;
 }
 const status=!pinMatches?"WRONG_PIN":problems.length?"OVERLAY_DRIFT":"OVERLAY_OK";
 return {status,pin:PIN,sha,pinMatches,counts,problems,files,modules};
}
if(require.main===module){
 try{
  const args=process.argv.slice(2),at=args.indexOf("--code-path");
  if(at<0||!args[at+1])throw Error("Usage: node patch-evejs-coop.cjs --code-path <EveJS/Code> [--remove] [--dry-run|--check]");
  const result=args.includes("--check")?check({codePath:args[at+1]}):run({codePath:args[at+1],remove:args.includes("--remove"),dryRun:args.includes("--dry-run")});
  if(args.includes("--check")){
   const {files:_files,modules:_modules,...summary}=result;
   console.log(JSON.stringify({...summary,problems:result.problems},null,2));
   if(result.status!=="OVERLAY_OK")process.exitCode=2;
  }else console.log(JSON.stringify(result,null,2));
 }catch(error){console.error("[COOP PATCH ERROR]",error.message);process.exitCode=1;}
}
module.exports={run,check,executePlan,classifyFile,transform,strip,specs,names,PIN};
