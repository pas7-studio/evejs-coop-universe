"use strict";
// Optional background driver of virtual world; no NPC ships materialized.
let world=null,timer=null,combatTimer=null,bridge=null,gateTravelDirector=null,nativeGateTransfer=null,nativeMarketTrader=null,nativeMarketTickRunning=false,nativeMarketBlocked=false,economy=null,lossBridge=null,factionDirector=null,patrolDirector=null,patrolNavigator=null,civilianOrders=null,life=null,identityRegistry=null,raidDirector=null,huntPolicy=null,tacticsDirector=null,pveSiteDefenseDirector=null,pveWaveReinforcementsDirector=null,pveObjectiveDoctrineDirector=null,pveNativeBossDirector=null,activityDirector=null,combatEvidenceDirector=null,stockCombatEvidenceDirector=null;
const observedNpcIDs=new Set();
const visitedSystems=new Set();
const initializedNativeMiningScenes=new WeakSet();
let warFleetRegistry=null,warBattleDirector=null,warMobilizer=null,warGateStaging=null,warGateHandoff=null,warRecoverySocket=null,warDemobilizer=null,warCasualtyLedger=null,warObjectiveDirector=null;
let backgroundTicks=0,headlessBootTimer=null,nativeOrderBridge=null,personalGoals=null,squadDirector=null,wreckRecoveryDirector=null,wreckCustody=null,lootCommerce=null,nativeRearm=null,nativeAmmoWitness=null,nativeAmmoSupply=null;
let intelAnnouncer=null,recognitionAnnouncer=null,alifeEconomyObserver=null,nativeMiningWitness=null,courierDispatch=null;
let alifeStationAuthority=null,alifeEconomyAuthorityBusy=false,alifeBuyerRuntime=null,alifeManufacturingRuntime=null;
let worldPhaseCoordinator=null;
function safeNpcPhase(phase,run){
 try{return run();}
 catch(error){
  console.warn("[CoopLivingWorld] "+phase,error.message);
  try{require("./coopRuntimeProbe").observe("living-world-phase-failed",null,null,
   {phase,reason:String(error.message).slice(0,160)});}catch(_ignored){}
  return null;
 }
}
// Opt-in shared native order arbitration; original native behavior stays OFF.
// ALIFE-1 Phase A: one master switch for order authority. The ALIFE flag
// implies arbitration so a world cannot be "alive" while six directors race
// for the same hull; the legacy arbiter flag keeps working unchanged.
function alifeOrderArbitrationEnabled(env={}){
 return env.EVEJS_COOP_ALIFE==="1"||env.EVEJS_COOP_NPC_ORDER_ARBITER==="1";
}
// FW-003: use the very same native GameStore and physical identity as
// existing living-world orders. A missing/corrupt registry is UNKNOWN and
// cannot silently surrender a warship to a civilian/raid planner.
function nativeWarFleetRegistry(){
 if(process.env.EVEJS_COOP_FACTION_WAR!=="1"||
    process.env.EVEJS_COOP_FACTION_WAR_FLEETS!=="1"||
    process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS!=="1")return null;
 if(!warFleetRegistry){
  const runtime=require("./runtime"),controllers=require("./npc/npcRegistry"),
   entityStore=require("./npc/nativeNpcStore"),
   factions=require("../services/faction/factionState");
  const proofs=require("./coopWarFleetNativeProofs").createWarFleetNativeProofs({
   sceneForSystem:id=>runtime.scenes instanceof Map?runtime.scenes.get(id):null,
   getController:id=>controllers.getControllerByEntityID(id),
   getNativeEntity:id=>entityStore.getNativeEntity(id),
   assignments:()=>[...(bridge?.snapshot()||[]),
    ...Object.values(identityRegistry?.snapshot()?.links||{})],
   getFactionForCorporation:id=>factions.getFactionIDForCorporation(id)
  });
  warFleetRegistry=require("./coopWarFleetRegistry").createWarFleetRegistry({
   gameStore:require("../gameStore"),...proofs,
   // A terminal campaign is NOT permission to hijack a busy NPC. The
   // native hull and a nonambiguous arbiter idle state are mandatory.
   verifyDemobOrderIdle:d=>{
    const arbiter=nativeOrderBridge;
    if(!arbiter||!d?.entityID||!d?.pilotID)return false;
    let scene,ctrl,leases;
    try{
     scene=runtime.scenes instanceof Map?runtime.scenes.get(d.systemID):null;
     ctrl=controllers.getControllerByEntityID(d.entityID);
     leases=arbiter.snapshot()?.leases;
    }catch{return false}
    const ship=scene?.getEntityByID?.(d.entityID);
    if(!Array.isArray(leases)||!ship||ship.nativeNpc!==true||
     ship.itemID!==d.entityID||ship.session?.characterID||
     ctrl?.entityID!==d.entityID||ctrl.systemID!==d.systemID||
     ctrl.manualOrder||ctrl.currentTargetID||ship.pendingWarp||
     ship.warpState||ship.isWarping||
     !["STOP","IDLE"].includes(String(ship.mode||"").toUpperCase()))
     return false;
    const now=Date.now();
    if(leases.some(l=>l.entityID===d.entityID&&
     (l.phase==="ISSUING"||l.phase==="OUTCOME_UNKNOWN"||
      l.phase==="ACTIVE"&&(!Number.isSafeInteger(l.expiresAt)||
       l.expiresAt>now))))return false;
    try{
     if(tacticsDirector?.activeIDs()?.has(d.entityID)===true||
      nativeAmmoSupply?.activeIDs(d.systemID)?.has(d.entityID)===true)
      return false;
    }catch{return false}
    return true;
   }
  });
 }
 return warFleetRegistry;
}
// FW-008: terminal war campaigns demobilize BEFORE the existing native
// recruiter evaluates new adjacent wars. No second tick or physical ship
// movement. All custody changes are rechecked inside native SQLite.
function advanceNativeWarDemobilization(){
 const {enabled,createWarDemobilizer}=require("./coopWarDemobilizer");
 if(!enabled(process.env)||!visitedSystems.size||!identityRegistry)return;
 const registry=nativeWarFleetRegistry(),guard=npcOrderBridge();
 if(!registry||!guard)return;
 if(!warDemobilizer){
  const gameStore=require("../gameStore"),
   warStore=require("./coopFactionWarStore"),
   warCore=require("./coopFactionWarCore");
  warDemobilizer=createWarDemobilizer({
   registry,
   readWarState:()=>{
    const result=gameStore.read(warStore.TABLE,"/"+warStore.KEY);
    if(result?.success!==true)return null;
    warCore.validateState(result.data);return result.data;
   },
   readLinks:()=>Object.values(identityRegistry.snapshot()?.links||{}),
   getOrderLeases:()=>guard.snapshot().leases
  });
 }
 const result=warDemobilizer.tick({
  systemIDs:[...visitedSystems].slice(0,12)
 });
 if(result.demobilized.length)
  require("./coopRuntimeProbe").observe(
   "living-native-war-demobilized",null,null,{
    status:result.status,ships:result.demobilized,
    evidence:"TERMINAL_NATIVE_WAR_FLEET_RELEASE_NO_HULL_OR_CARGO_MUTATION"
   });
}
// FW-003C: real patrol mobilization on the SAME existing A-Life tick. Any
// failed source proof results in zero military assignments, never free ships.
function advanceNativeWarMobilization(){
 const {enabled,createWarMobilizer}=require("./coopWarMobilizer");
 if(!enabled(process.env)||!visitedSystems.size||!identityRegistry)return;
 const registry=nativeWarFleetRegistry(),guard=npcOrderBridge();
 if(!registry||!guard)return;
 if(!warMobilizer){
  const native=require("./runtime"),npcStore=require("./npc/nativeNpcStore"),
   controllers=require("./npc/npcRegistry"),
   factions=require("../services/faction/factionState"),
   gameStore=require("../gameStore"),
   {KEY,TABLE}=require("./coopFactionWarStore"),
   core=require("./coopFactionWarCore"),
   dogma=require("./combat/weaponDogma"),
   capability=require("./npc/npcCapabilityResolver");
  const readiness=require("./coopWarMusterReadiness").createWarMusterReadiness({
   store:npcStore,resolveFamily:dogma.resolveWeaponFamily,
   isOptional:dogma.isChargeOptionalTurretWeapon,
   compatible:capability.isNpcChargeCompatibleWithModule
  });
  warMobilizer=createWarMobilizer({
   registry,
   readWarState:()=>{
    const r=gameStore.read(TABLE,"/"+KEY);
    if(r?.success!==true)return null;
    core.validateState(r.data);
    return r.data;
   },
   readLinks:()=>Object.values(identityRegistry.snapshot().links||{}),
   // Existing scenes only: a military director must never manufacture an
   // enemy or force NPC materialization by observing an unvisited system.
   sceneForSystem:id=>native.scenes instanceof Map?native.scenes.get(id):null,
   getNativeEntity:id=>npcStore.getNativeEntity(id),
   getController:id=>controllers.getControllerByEntityID(id),
   getFactionForCorporation:id=>factions.getFactionIDForCorporation(id),
   inspectReadiness:context=>readiness.inspect(context),
   getOrderLeases:()=>guard.snapshot().leases,
   isTactical:id=>tacticsDirector?.activeIDs()?.has(id)===true
  });
 }
 const result=warMobilizer.tick({systemIDs:[...visitedSystems].slice(0,12)});
 if(result.mobilized.length)require("./coopRuntimeProbe").observe(
  "living-native-war-mobilization",null,null,
  {status:result.status,ships:result.mobilized,
   evidence:"EXISTING_NATIVE_PATROLS_RESERVED_NO_SPAWN_OR_FUNDS"});
}
// FW-007B: recover/audit native military handoff BEFORE the materializer
// may prune old pilot links or rebuild another physical hull.
function ensureWarRecoverySocket(){
 if(process.env.EVEJS_COOP_WAR_RECOVERY_SOCKET!=="1")return;
 if(warRecoverySocket)return;
 if(process.env.EVEJS_COOP_WAR_RECOVERY_ADMIN!=="1")
  throw Error("WAR_RECOVERY_ADMIN_FLAG_REQUIRED");
 const instance=require("./coopWarRecoverySocket").createWarRecoverySocket({
  createConsole:({authorizeOperator})=>
   createWarRecoveryAdmin({authorizeOperator}),
  socketPath:process.env.EVEJS_COOP_WAR_RECOVERY_SOCKET_PATH||
   "/run/evejs/coop-war-recovery.sock",
  secretFile:process.env.EVEJS_COOP_WAR_RECOVERY_SECRET_FILE||
   "/run/secrets/evejs-war-recovery-key"
 });
 const result=instance.start();
 if(result.status!=="LISTENING_INITIATED")
  throw Error("WAR_RECOVERY_SOCKET_NOT_LISTENING:"+result.status);
 warRecoverySocket=instance;
}
function ensureNativeWarGateHandoff(runtime){
 if(process.env.EVEJS_COOP_FACTION_WAR_NATIVE_TRANSFER!=="1")return;
 const {flag,createWarGateHandoff}=require("./coopWarGateHandoff");
 if(!flag(process.env))
  throw Error("WAR_GATE_HANDOFF_FLAGS_INCOMPLETE");
 if(warGateHandoff){
  const audit=warGateHandoff.auditStartup();
  if(audit.status!=="CLEAN")
   throw Error("WAR_GATE_HANDOFF_REQUIRES_REPAIR:"+audit.status);
  return;
 }
 if(!identityRegistry)throw Error("WAR_GATE_IDENTITY_MISSING");
 const worldData=require("./worldData"),controllers=require("./npc/npcRegistry"),
  store=require("./npc/nativeNpcStore"),service=require("./npc/nativeNpcService"),
  scramble=require("./modules/hostileModuleRuntime");
 const instance=createWarGateHandoff({
  gameStore:require("../gameStore"),identityRegistry,
  sceneForSystem:id=>runtime.ensureScene(id,{refreshStargates:false}),
  getGate:id=>worldData.getStargateByID(id),
  nativeStore:store,service,
  getController:id=>controllers.getControllerByEntityID(id),
  isScrambled:ship=>scramble.isEntityWarpScrambled(ship),
  journalDir:process.env.EVEJS_COOP_WAR_TRANSFER_JOURNAL_DIR||
   "/var/lib/evejs/coop-war-native-transfers"
 });
 // Keep the controller available to the privileged local operator
 // even if startup is intentionally blocked by an unresolved warship.
 warGateHandoff=instance;
 // The protected recovery channel must stay reachable after quarantine
 // blocks normal world materialization.
 ensureWarRecoverySocket();
 const audit=instance.auditStartup();
 if(audit.status!=="CLEAN")
  throw Error("WAR_GATE_HANDOFF_REQUIRES_REPAIR:"+audit.status);
}
function advanceNativeWarGateStaging(){
 if(process.env.EVEJS_COOP_FACTION_WAR_GATE_APPROACH!=="1"||
    !visitedSystems.size)return;
 const {createWarGateStaging,gate}=require("./coopWarGateStaging");
 if(!gate(process.env))return;
 const guard=npcOrderBridge();
 if(!guard||!nativeWarFleetRegistry())return;
 if(process.env.EVEJS_COOP_FACTION_WAR_NATIVE_TRANSFER==="1"){
  ensureNativeWarGateHandoff(require("./runtime"));
  const finished=warGateHandoff?.retireCompleted({max:2});
  if(finished?.retired?.length)
   require("./coopRuntimeProbe").observe(
    "living-native-war-transit-retired",null,null,{
     status:finished.status,retired:finished.retired,
     evidence:"PROVEN_TERMINAL_TRANSFER_ARCHIVED_NO_SHIP_MOVEMENT"
    });
 }
 if(!warGateStaging){
  const native=require("./runtime"),npc=require("./npc/npcRuntime"),
   controllers=require("./npc/npcRegistry"),worldData=require("./worldData"),
   gameStore=require("../gameStore"),
   warStore=require("./coopFactionWarStore"),
   fleetStore=require("./coopWarFleetRegistry"),
   treasuryStore=require("./coopWarTreasury"),
   warCore=require("./coopFactionWarCore");
  function readRow(table,key,validate){
   const read=gameStore.read(table,"/"+key);
   if(read?.success!==true)return null;
   validate(read.data);return read.data;
  }
  warGateStaging=createWarGateStaging({
   readWar:()=>readRow(warStore.TABLE,warStore.KEY,warCore.validateState),
   readFleet:()=>readRow(fleetStore.TABLE,fleetStore.KEY,fleetStore.validate),
   readTreasury:()=>readRow(treasuryStore.TABLE,treasuryStore.KEY,treasuryStore.validate),
   sceneForSystem:id=>native.scenes instanceof Map?native.scenes.get(id):null,
   getGate:id=>worldData.getStargateByID(id),
   warpToEntity:(id,targetID,opts)=>npc.warpToEntity(id,targetID,opts),
   getController:id=>controllers.getControllerByEntityID(id),
   bridge:guard,
   transfer:warGateHandoff?(args=>warGateHandoff.transfer(args)):null,
   isTactical:id=>tacticsDirector?.activeIDs()?.has(id)===true,
   isAmmoRetreat:(systemID,id)=>nativeAmmoSupply?.activeIDs(systemID)?.has(id)===true
  });
 }
 const result=warGateStaging.tick({systemIDs:[...visitedSystems].slice(0,12)});
 for(const moved of result.orders){
  if(moved.action==="VERIFIED_NATIVE_GATE_TRANSFER")
   visitedSystems.add(Number(moved.targetSystemID));
 }
 if(result.orders.length||result.observations.length)
  require("./coopRuntimeProbe").observe("living-native-war-gate-staging",
   null,null,{status:result.status,orders:result.orders,
    observations:result.observations,
    evidence:"PHYSICAL_GATE_APPROACH_ONLY_NO_SYSTEM_TRANSFER"});
}
function advanceNativeWarCombat(){
 const api=require("./coopWarCombatAuthority");
 if(!api.combatEnabled()||!api.ammoEnabled()||!visitedSystems.size)return;
 const guard=npcOrderBridge();
 if(!guard||!nativeWarFleetRegistry())return;
 const runtime=require("./runtime");
 if(!warBattleDirector){
  const npc=require("./npc/npcRuntime");
  const authority=api.createWarCombatAuthority({
   gameStore:require("../gameStore"),
   getController:id=>require("./npc/npcRegistry").getControllerByEntityID(id),
   getNativeEntity:id=>require("./npc/nativeNpcStore").getNativeEntity(id),
   getFactionForCorporation:id=>
    require("../services/faction/factionState").getFactionIDForCorporation(id)
  });
  warBattleDirector=require("./coopWarBattleDirector").createWarBattleDirector({
   authority,bridge:guard,
   sceneForSystem:id=>runtime.scenes instanceof Map?runtime.scenes.get(id):null,
   issueNativeAttack:(id,targetID,options)=>npc.issueAttackOrder(id,targetID,options),
   getController:id=>require("./npc/npcRegistry").getControllerByEntityID(id),
   isAmmoDepleted:(sys,id)=>nativeAmmoSupply?.activeIDs(sys)?.has(id)===true,
   isTactical:id=>tacticsDirector?.activeIDs()?.has(id)===true
  });
 }
 const result=warBattleDirector.tick({systemIDs:[...visitedSystems].slice(0,12)});
 if(result.orders.length)require("./coopRuntimeProbe").observe(
  "living-native-war-attack-orders",null,null,{
   status:result.status,orders:result.orders,
   evidence:"ACK_ONLY_NOT_DAMAGE_OR_KILL"
  });
}
// FW-009B: original stocked native structures, real killmail combat
// proof, fully enumerated physical ships. No independent scheduler and
// no virtual capture. A missing source, unknown scene or absent explicit
// objective-type allowlist keeps military control unchanged.
function advanceNativeWarObjectives(){
 const {enabled,createWarObjectiveDirector}=require("./coopWarObjectiveDirector");
 if(!enabled(process.env)||!visitedSystems.size)return;
 if(!require("./coopWarObjectiveDirector").typesFromEnv(process.env).size)return;
 if(!warObjectiveDirector){
  const gameStore=require("../gameStore"),
   worldData=require("./worldData"),
   runtime=require("./runtime"),
   controllers=require("./npc/npcRegistry"),
   npcStore=require("./npc/nativeNpcStore"),
   factions=require("../services/faction/factionState"),
   structure=require("./coopWarNativeStructureControl"),
   proofApi=require("./coopWarNativeStructureCombatProof"),
   adjudicatorApi=require("./coopWarObjectiveAdjudicator");
  const getNativeStructure=id=>worldData.getStructureByID(id),
   getFactionForCorporation=id=>factions.getFactionIDForCorporation(id);
  const proof=proofApi.createWarStructureCombatProof({
   gameStore,getNativeStructure,getFactionForCorporation,
   getNativeKillmail:id=>
    require("../services/killmail/killmailState").getKillmailRecord(id)
  });
  const occupancy=structure.createNativeStructureControlWitness({
   sceneForSystem:id=>runtime.scenes instanceof Map?
    runtime.scenes.get(id):null,
   listAllPhysicalShips:structure.listPinnedSceneShips,
   getNativeEntity:id=>npcStore.getNativeEntity(id),
   getController:id=>controllers.getControllerByEntityID(id),
   getFactionForCorporation,
   allowMilitiaPlayers:process.env.EVEJS_COOP_FACTION_WAR_PLAYER_CAPTURE==="1",
   getLivePlayerSessions:()=>require("../services/chat/sessionRegistry").getSessions()
  });
  const adjudicator=adjudicatorApi.createWarObjectiveAdjudicator({
   gameStore,getNativeStructure,getFactionForCorporation,
   verifyNativeCombatDestruction:d=>
    proof.verifyNativeCombatDestruction(d),
   observeNativeControl:d=>occupancy.observe(d)
  });
  warObjectiveDirector=createWarObjectiveDirector({
   adjudicator,combatProof:proof,
   getFactionForCorporation,
   listNativeStructures:systemID=>worldData.getStructuresForSystem(systemID),
   readWarState:()=>{
    const row=gameStore.read("corporationRuntime",
     "/coop-faction-war\u001fstate-v1");
    if(row?.success!==true)return null;
    require("./coopFactionWarCore").validateState(row.data);
    return row.data;
   }
  });
 }
 const result=warObjectiveDirector.tick({
  systemIDs:[...visitedSystems].slice(0,12)
 });
 if(result.events?.length)
  require("./coopRuntimeProbe").observe(
   "living-native-war-objectives",null,null,{
    status:result.status,events:result.events,
    evidence:"PHYSICAL_STRUCTURE_COMBAT_KILLMAIL_AND_UNCONTESTED_NATIVE_OCCUPANCY"
   });
}
// One existing A-Life 30-second scheduler, no faction-war timer.
function npcOrderBridge(){
 if(!alifeOrderArbitrationEnabled(process.env))return null;
 if(!nativeOrderBridge){
  const native=require("./runtime"),controllers=require("./npc/npcRegistry");
  const arbiter=require("./coopNpcOrderArbiter").createOrderArbiter();
  nativeOrderBridge=require("./coopNpcOrderBridge").createOrderBridge({
   arbiter,assignments:()=>[
    ...(bridge?.snapshot()||[]),
    ...Object.values(identityRegistry?.snapshot()?.links||{})
   ],
   sceneForSystem:id=>native.ensureScene(id,{refreshStargates:false}),
   getController:id=>controllers.getControllerByEntityID(id),
   // Dynamic callback prevents enabling WAR after the bridge was created
   // without its registry guard. Disabled war never grants WAR orders.
   warShipClaim:link=>(
    process.env.EVEJS_COOP_FACTION_WAR_FLEETS==="1"&&
    process.env.EVEJS_COOP_FACTION_WAR==="1"&&
    process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS==="1")?
    (nativeWarFleetRegistry()?.claim(link)||"UNKNOWN"):"UNASSIGNED"
  });
 }
 return nativeOrderBridge;
}
function npcNativeOrder(owner,entityID,action,execute,systemID){
 const guard=npcOrderBridge();
 if(!guard)return owner==="WAR"?{success:false,errorMsg:"COOP_NPC_ORDER_WAR_ARBITER_REQUIRED"}:execute();
 return guard.issue({owner,entityID,action,execute,systemID});
}
function addNpcOrderBlocks(blockedIDs,systemID,owner){
 const guard=npcOrderBridge();
 if(guard)for(const id of guard.blocksForSystem(systemID,owner))blockedIDs.add(id);
 return blockedIDs;
}
// Personal intentions affect only NPC routes; no native funds, kills or cargo.
function npcPersonalGoals(){
 if(process.env.EVEJS_COOP_NPC_PERSONAL_GOALS!=="1"||
    process.env.EVEJS_COOP_NPC_CAPSULEER_AGENCY!=="1"||
    !alifeOrderArbitrationEnabled(process.env))return null;
 if(!personalGoals)personalGoals=require("./coopNpcPersonalGoals").createPersonalGoals({
  file:process.env.EVEJS_COOP_NPC_GOALS_FILE||"/var/lib/evejs/coop-npc-goals.json"
 });
 return personalGoals;
}
function npcRealPoints(scene){
 const points=require("./coopNpcTopology").waypoints(scene);
 return {gateCount:points.filter(p=>p.kind==="stargate").length,
  beltCount:points.filter(p=>p.kind==="asteroidBelt").length,
  stationCount:points.filter(p=>p.kind==="station").length};
}
function observeNativeMiningProof(){
 if(!world||!visitedSystems.size)return;
 const runtime=require("./runtime"),mining=require("../services/mining/miningNpcOperations"),
  miningState=require("../services/mining/miningRuntimeState"),
  store=require("./npc/nativeNpcStore"),probe=require("./coopRuntimeProbe");
 if(!nativeMiningWitness)nativeMiningWitness=
  require("./coopAlifeNativeMiningWitness").createNativeMiningWitness();
 // Never create a scene for an observer: physical mining must already exist.
 for(const systemID of [...visitedSystems].sort((a,b)=>a-b).slice(0,2)){
  const scene=runtime.scenes instanceof Map?runtime.scenes.get(systemID):null;
  if(!scene)continue;
  const result=nativeMiningWitness.tick({
   scene,fleets:mining.getMiningFleetsForSystem(systemID),
   getNativeEntity:id=>store.getNativeEntity(id),
   listNativeCargo:id=>store.listNativeCargoForEntity(id),
   isMineableStaticEntity:miningState.isMineableStaticEntity,
   getMineableState:(sc,id)=>miningState.getMineableState(sc,id)
  });
  if(result.status!=="OBSERVED"){
   if(backgroundTicks%10===0)probe.observe("alife-native-mining-blocker",null,
    {spaceState:{systemID}},{status:result.status,source:"NATIVE_MINING_READ_ONLY"});
   continue;
  }
  for(const row of result.results){
   if(row.status!=="NATIVE_MINING_ACTIVE_NO_YIELD_DELTA"||
      backgroundTicks%10===0)
    probe.observe("alife-native-mining-proof",null,
     {spaceState:{systemID}},row);
  }
 }
}
function syncNativeDeliveries(){
 if(!economy||process.env.EVEJS_COOP_NATIVE_HAUL_CARGO!=="1")return;
 const depot=require("./coopNativeDepot").getNativeDepot();
 const audit=depot.audit();
 if(audit.status==="NEEDS_OPERATOR_REPAIR"){
  require("./coopRuntimeProbe").observe("living-native-depot-repair-needed",null,null,
   {status:audit.status,invalid:audit.invalid,unresolved:audit.unresolved});
  return;
 }
 if(audit.status==="PENDING_CUSTODY_RECONCILIATION")
  require("./coopRuntimeProbe").observe("living-native-depot-pending",null,null,
   {status:audit.status,unresolved:audit.unresolved});
 const result=economy.syncNativeDeliveries(depot.snapshot().totals);
 if(result.quantity>0){
  console.info("[CoopLivingWorld] Real NPC ore delivered to virtual system supply",JSON.stringify(result));
  require("./coopRuntimeProbe").observe("living-real-ore-delivery",null,null,{
    quantity:result.quantity,systemTotals:depot.snapshot().totals
  });
 }
}
function start(){
 if(process.env.EVEJS_COOP_VIRTUAL_WORLD!=="1"){
  if(process.env.EVEJS_COOP_HEADLESS_WORLD_BOOT==="1")
   console.warn("[CoopLivingWorld] BLOCKED_RUNTIME_CONFIG: headless boot is enabled but virtual world is disabled");
  return;
 }
 if(world)return;
 // Diagnostic invocation only; no claim of booted native ships or world.
 require("./coopRuntimeProbe").observe("living-startup-entered",null,null,
  {status:"START_REQUESTED_NOT_READY",headlessConfigured:process.env.EVEJS_COOP_HEADLESS_WORLD_BOOT==="1"});
 const route=String(process.env.EVEJS_COOP_VIRTUAL_ROUTE||"30000142,30000144").split(",").map(Number);
 let nextWorld,nextLife;
 try{
  const {createWorld}=require("./coopVirtualWorld");
  nextWorld=createWorld({file:process.env.EVEJS_COOP_VIRTUAL_STATE_FILE||"/var/lib/evejs/coop-virtual-world.json",
    route,population:Number(process.env.EVEJS_COOP_VIRTUAL_POPULATION||16),
    travelMs:Number(process.env.EVEJS_COOP_VIRTUAL_TRAVEL_MS||120000),
    migrateFactions:process.env.EVEJS_COOP_FACTION_LAYOUT_V2==="1"});
  const {createLife}=require("./coopNpcLife");
  nextLife=createLife({file:process.env.EVEJS_COOP_LIFE_FILE||"/var/lib/evejs/coop-npc-life.json",
   recoveryMs:Number(process.env.EVEJS_COOP_CLONE_RECOVERY_MS||1800000)});
 }catch(error){
  // Never delete or reinitialize real persisted state to fake a ready world.
  require("./coopRuntimeProbe").observe("living-startup-failed",null,null,
   {status:"BLOCKED_PERSISTED_WORLD_INIT",phase:"persistent-state-load",
    errorCode:String(error?.code||error?.name||"UNKNOWN").replace(/[^A-Za-z0-9_]/g,"_").slice(0,48)});
  throw error;
 }
 world=nextWorld;life=nextLife;
 // Headless bootstrap must resolve persisted native pilot links before
 // advancing virtual travel; otherwise a real parked ship can be
 // virtually transported to another system during process startup.
 if(process.env.EVEJS_COOP_HEADLESS_WORLD_BOOT!=="1")world.advance();
 if(process.env.EVEJS_COOP_VIRTUAL_ECONOMY==="1"){
  safeNpcPhase("economy-init",()=>{
   const {createEconomy}=require("./coopVirtualEconomy");
   economy=createEconomy({
    file:process.env.EVEJS_COOP_ECONOMY_FILE||"/var/lib/evejs/coop-economy.json"
   });
   economy.advance(world.snapshot().pilots);
  });
  safeNpcPhase("native-depot-init",syncNativeDeliveries);
  if(economy)safeNpcPhase("faction-init",()=>{
   const {createFactionDirector}=require("./coopFactionDirector");
   factionDirector=createFactionDirector({
    file:process.env.EVEJS_COOP_FACTION_FILE||"/var/lib/evejs/coop-factions.json"
   });
   factionDirector.advance(economy.snapshot().systems);
  });
 }
 worldPhaseCoordinator=require("./coopLivingWorldPhaseCoordinator").createPhaseCoordinator({
 execute:safeNpcPhase,onCycle:row=>{
  if(row.sequence%10!==0&&!row.unknownNames.length)return;
  require("./coopRuntimeProbe").observe("living-world-phase-cycle",null,null,{
   status:row.status,sequence:row.sequence,phaseCount:row.phaseCount,
   groups:row.groups,unknownNames:row.unknownNames,
   source:row.source,nativeSettlementVerified:false});
 }});
 timer=setInterval(()=>worldPhaseCoordinator.tick(runPhase=>{
  backgroundTicks++;
  // Read-only courier pass (COOP-024). It never mutates a contract: it only
  // reports what the decision core thinks of the outstanding courier contracts,
  // so the live wiring can be verified before anything is accepted.
  if(process.env.EVEJS_COOP_COURIER_OBSERVE==="1")runPhase("courier-observe",()=>{
   const {listContractRecords}=require("../services/contracts/contractRuntimeState");
   const {evaluateContract}=require("./coopCourierDispatch");
   for(const record of listContractRecords()){
    if(Number(record&&record.type)!==3||Number(record&&record.status)!==0)continue;
    const decision=evaluateContract(record,{sameSystemOnly:true,requireZeroCollateral:false},{walletIsk:0,hullCapacityM3:465000});
    console.log(`[CoopCourier] contract ${record.contractID} volume ${record.volume} -> ${decision.status}`);
   }
  });
  // Real courier dispatch (COOP-024). Opt-in and default OFF: it accepts the
  // owner's genuine native courier contract with a seeded courier character,
  // flies it natively and completes it. Observe above stays read-only.
  if(process.env.EVEJS_COOP_ADMIN_BRIDGE==="1")runPhase("admin-bridge",()=>{
    require("./coopAdminBridge").drain({log:console.log});
  });
  if(process.env.EVEJS_COOP_COURIER_DISPATCH==="1")runPhase("courier-dispatch",()=>{
   if(!courierDispatch)courierDispatch=require("./coopCourierRuntime").createCourierDispatch({
    contracts:require("../services/contracts/contractRuntimeState"),
    gameStore:require("../gameStore"),
    itemStore:require("../services/inventory/itemStore"),
    worldData:require("./worldData"),
    transitions:require("./transitions"),
    space:require("./runtime"),
    sceneForSystem:id=>require("./runtime").ensureScene(id,{refreshStargates:false}),
    pilots:String(process.env.EVEJS_COOP_COURIER_PILOTS||"140000100,140000101,140000102,140000103,140000104,140000105,140000106").split(","),
    sendMail:mail=>require("../services/mail/mailState").sendMail({
     senderID:mail.senderID,toCharacterIDs:mail.toCharacterIDs,saveSenderCopy:false,title:mail.title,body:mail.body}),
    log:console.log
   });
   courierDispatch.tick();
  });
  runPhase("virtual-travel",()=>{
   // A real physical EveJS ship is pinned to its actual system.
   const pins={};
   if(bridge)for(const entry of bridge.snapshot())pins[entry.pilotID]=entry.systemID;
   if(identityRegistry)for(const [pilotID,entry] of Object.entries(identityRegistry.snapshot().links)){
    if(!pins[pilotID]&&identityRegistry.get(pilotID))pins[pilotID]=entry.systemID;
   }
   if(process.env.EVEJS_COOP_HEADLESS_WORLD_BOOT!=="1"||identityRegistry)
    world.advance(pins);
  });
  if(economy)runPhase("virtual-economy",()=>economy.advance(world.snapshot().pilots));
  runPhase("native-depot",syncNativeDeliveries);
  // ALIFE-04: existing 30s tick only; original native mining rock locks,
  // active module effects, and real nativeNpcStore cargo identity.
  if(process.env.EVEJS_COOP_ALIFE==="1"&&
   process.env.EVEJS_COOP_NATIVE_MINING==="1"&&
   process.env.EVEJS_COOP_ALIFE_MINING_PROOF==="1")
   runPhase("alife-native-mining-proof",observeNativeMiningProof);
  // COOP-042: one A-Life 30-second tick; READ ONLY, no extra scheduler.
  if(process.env.EVEJS_COOP_ALIFE==="1"&&process.env.EVEJS_COOP_ALIFE_ECONOMY==="1")
   runPhase("alife-native-economy-observe",()=>{
    void observeAlifeEconomy().catch(error=>console.warn("[CoopAlifeEconomy] observation",error.message));
   });
  if(factionDirector&&economy)runPhase("faction",()=>factionDirector.advance(economy.snapshot().systems));
  // Opt-in normal ammo orders flow from native A-Life decisions; survival
  // still receives an immediate authoritative native retreat attempt.
  if(require("./coopAlifeNativeResupplyBridge").nativeResupplyActEnabled()){
   runPhase("native-ammo-readiness",()=>
    advanceNativeAmmoSupply({mode:"MONITOR_ONLY"}));
   runPhase("native-ammo-survival",()=>
    advanceNativeAmmoSupply({mode:"SURVIVAL"}));
  }
  else runPhase("native-ammo-supply",advanceNativeAmmoSupply);
  runPhase("native-raids",advanceNativeRaids);
  runPhase("native-tactics",advanceNativeTactics);
  runPhase("native-pve-boss-wreck",advanceNativePveBossWreck);
  runPhase("native-pve-site-defense",advanceNativePveSiteDefense);
  runPhase("native-pve-wave-reinforcements",advanceNativePveWaveReinforcements);
  runPhase("native-pve-objective-doctrine",advanceNativePveObjectiveDoctrine);
  runPhase("native-faction-war-demobilization",advanceNativeWarDemobilization);
  runPhase("native-faction-war-mobilization",advanceNativeWarMobilization);
  runPhase("native-faction-war-gate-staging",advanceNativeWarGateStaging);
  runPhase("native-faction-war-battle",advanceNativeWarCombat);
  runPhase("native-faction-war-objectives",advanceNativeWarObjectives);
  runPhase("native-ammo-observe",observeNativeAmmoConsumption);
  runPhase("native-wreck-recovery",advanceNativeWreckRecovery);
  runPhase("native-salvage-rivals",advanceNativeSalvageRivals);
  // Source-backed market decisions share this tick and never start a second
  // scheduler. Awaiting Rust does not stall NPC physics or fleet movement.
  if(process.env.EVEJS_COOP_ALIFE_SALVAGE_MARKET==="1")
   runPhase("native-salvage-market",()=>{
    void require("./coopAlifeSalvageMarketRuntime").advance({
     systems:()=>new Set(visitedSystems)
    }).then(result=>{
     if(result?.status==="ALIFE_SALVAGE_MARKET_ATTEMPT"||
      result?.status==="ALIFE_SALVAGE_MARKET_RECOVERY")
      require("./coopRuntimeProbe").observe("alife-native-salvage-market",
       null,null,{status:result.status,wreckItemID:result.wreckItemID,
        resultStatus:result.result?.status,priceCents:result.priceCents||null,
        nativeEscrowVerified:result.result?.nativeEscrowVerified===true,
        corporationWalletCredited:result.result?.walletCredited===true,
        virtualISK:false});
    }).catch(error=>console.warn("[CoopSalvageMarket] tick",error.message));
   });
  runPhase("native-wreck-custody",advanceNativeWreckCustody);
  runPhase("native-loot-station-delivery",advanceNativeLootStationDelivery);
  runPhase("native-gate-approach",advanceNativeGateApproach);
  runPhase("native-patrols",advanceNativePatrolRoutes);
  runPhase("npc-recognition",advanceNpcRecognition);
  runPhase("native-civilians",advanceNativeCivilianOrders);
  // Real NPC market RPC is async: explicitly handle rejection, never fire
  // overlapping economy transactions from the 30-second timer.
  if(process.env.EVEJS_COOP_NATIVE_NPC_MARKET==="1")
   runPhase("native-market-schedule",()=>{
    void advanceNativeMarket().catch(error=>console.warn("[CoopNativeMarket] tick",error.message));
   });
  // Which ore really has a buyer here. Pure advice for the next haul.
  if(process.env.EVEJS_COOP_ECONOMY_DESTINATION==="1")
   runPhase("economy-destination-ore",observeEconomyOre);
  runPhase("native-activity",observeNativeActivity);
  if(backgroundTicks%4===0&&process.env.EVEJS_COOP_MATERIALIZE_NPCS==="1")
   for(const systemID of visitedSystems)runPhase("npc-reconcile:"+systemID,
    ()=>observeSession(null,{itemID:0,spaceState:{systemID}}));
 }),30000);
 timer.unref?.();
 // NPC fights can end before the ordinary 30s economy tick. A read-only
 // 5s sampling loop captures HP changes without altering EveJS combat.
 if(process.env.EVEJS_COOP_HEADLESS_WORLD_BOOT==="1"&&!combatTimer){
  const configured=Number(process.env.EVEJS_COOP_NATIVE_COMBAT_SAMPLE_MS||5000);
  const every=Number.isFinite(configured)?Math.max(2000,Math.min(15000,configured)):5000;
  combatTimer=setInterval(()=>safeNpcPhase("native-combat-evidence",observeNativeCombat),every);
  combatTimer.unref?.();
 }
 scheduleHeadlessWorldBoot(route);
}
// Rapid bounded bootstrap attempts, then bounded low-frequency rechecks.
// A temporarily absent EveJS static-data store must not permanently disable
// autonomous NPCs until the next server restart.
function nextHeadlessRetryMs(attempts){
 const count=Math.max(1,Number(attempts)||1);
 if(count<6)return 30000;
 if(count<12)return 5*60000;
 if(count<18)return 10*60000;
 return 15*60000;
}
function isHeadlessNativeReady({miningEnabled=true,physicalNpcCount=0,
 beltCount=0,physicalMiningShips=0,waypointCount=0,sdeBeltCount=null,
 startupSlotsReady=true}={}){
 // A beltless solar system is legitimately not mineable. Require mining
 // fleet/physical belts only when the authoritative SDE says the *system*
 // has mining belts. Never invent a Jita belt or treat it as corrupt data.
 const hasSdeEvidence=Number.isSafeInteger(sdeBeltCount)&&sdeBeltCount>=0;
 const miningRequired=miningEnabled&&(!hasSdeEvidence||sdeBeltCount>0);
 return physicalNpcCount>0&&waypointCount>0&&
  (!miningRequired||(beltCount>0&&physicalMiningShips>0&&startupSlotsReady===true));
}
// Initialize real EveJS scenes without waiting for a human to log in.
// This is not a client/gameplay proof: only existing native entities count.
function scheduleHeadlessWorldBoot(route){
 if(process.env.EVEJS_COOP_HEADLESS_WORLD_BOOT!=="1"||headlessBootTimer)return;
 const systems=new Set(route.filter(id=>Number.isSafeInteger(id)&&id>0));
 if(!systems.size)return;
 require("./coopRuntimeProbe").observe("living-headless-boot-requested",null,null,
  {systems:[...systems],status:"SCHEDULED_NOT_VERIFIED"});
 let attempts=0;
 const attempt=()=>{
  headlessBootTimer=null;
  attempts++;
  // Distinguish a scheduled but never fired boot timer from a real scene
  // initialization failure. This is emitted BEFORE any native scene work.
  require("./coopRuntimeProbe").observe("living-headless-boot-attempt",null,null,{
   attempt:attempts,pendingSystems:[...systems]});
  for(const systemID of [...systems]){
   try{
    const runtime=require("./runtime");
    const miningEnabled=process.env.EVEJS_COOP_NATIVE_MINING==="1";
    observeSession(null,{itemID:0,spaceState:{systemID}});
    const scene=runtime.ensureScene(systemID,{refreshStargates:false});
    // Non-mining worlds must not depend on EveJS mining service being
    // configured, available, or importable merely to finish boot.
    const fleetRecords=miningEnabled
     ?require("../services/mining/miningNpcOperations").getMiningFleetsForSystem(systemID)||[]:[];
    const fleetShips=miningEnabled
     ?fleetRecords.flatMap(f=>[...(f.minerEntityIDs||[]),...(f.haulerEntityIDs||[])])
       .filter(id=>{
        const entity=scene?.getEntityByID?.(Number(id));
        return entity?.nativeNpc===true&&entity?.kind==="ship";
       })
     :[];
    const links=Object.values(identityRegistry?.snapshot().links||{})
     .filter(link=>{
      if(Number(link.systemID)!==systemID)return false;
      const ship=scene?.getEntityByID?.(Number(link.entityID));
      return ship?.kind==="ship"&&ship.nativeNpc===true;
     });
    const topology=require("./coopNpcTopology").waypoints(scene);
    const beltCount=topology.filter(p=>p.kind==="asteroidBelt").length;
    const sdeBelts=require("./worldData").getAsteroidBeltsForSystem(systemID).length;
    const policy=require("./coopHeadlessScenePolicy");
    const tracked=policy.shouldTrackNativeScene({
     systemID,scene,realWaypointCount:topology.length});
    // An actual initialized scene is worth rechecking even when the first
    // native spawn attempt failed. Previously only a successful pilot link
    // made a system eligible for the 2-minute reconcile loop.
    if(tracked)visitedSystems.add(systemID);
    const miningStartup=policy.nativeMiningStartupPolicy({
     systemID,sdeBelts,sceneBelts:beltCount});
    const startupSystems=String(process.env.EVEJS_MINING_NPC_STARTUP_SYSTEM_IDS||"")
     .split(",").map(x=>Number(x.trim())).filter(id=>Number.isSafeInteger(id)&&id>0);
    const requireSlots=miningEnabled&&sdeBelts>0&&beltCount>0&&
     process.env.EVEJS_COOP_MINING_STARTUP_RETRY==="1"&&
     process.env.EVEJS_MINING_NPC_STARTUP_ENABLED==="true"&&
     (!startupSystems.length||startupSystems.includes(Number(systemID)));
    const startupSlots=requireSlots
     ?require("./coopNativeMiningReadiness").inspect({
       scene,systemID,fleets:fleetRecords,
       expectedCount:Number(process.env.EVEJS_MINING_NPC_STARTUP_FLEET_COUNT||1)
      })
     :{status:"NOT_REQUIRED",ready:true,missingSlots:[]};
    // Zero belts in Jita are expected SDE geography; a global SDE belt
    // counter cannot prove a mineable belt in the physical system scene.
    require("./coopRuntimeProbe").observe("living-native-system-site-readiness",null,
     {spaceState:{systemID}},{systemID,realAsteroidBelts:beltCount,
      authoritativeSdeBelts:sdeBelts,realWaypoints:topology.length,
      trackingForReconcile:tracked,stockMiningStartup:miningStartup,
      source:"PINNED_EVEJS_SYSTEM_STATIC_SCENE",
      status:sdeBelts===0?"SDE_SYSTEM_HAS_NO_BELTS":
       beltCount===0?"SDE_BELTS_MISSING_FROM_SCENE":"REAL_BELT_PRESENT"});
    const verified=isHeadlessNativeReady({
     miningEnabled,
     physicalNpcCount:links.length,waypointCount:topology.length,
     beltCount,physicalMiningShips:fleetShips.length,
     sdeBeltCount:sdeBelts,startupSlotsReady:startupSlots.ready
    });
    // A real named native NPC can operate even if stock mining or static
    // topology is incomplete. Readiness remains a stricter separate gate.
    if(verified)systems.delete(systemID);
    require("./coopRuntimeProbe").observe("living-headless-boot-system",null,
     {spaceState:{systemID}},
     {attempt:attempts,status:verified?"NATIVE_SCENE_READY":"PENDING_NATIVE_SCENE",
      realAsteroidBelts:beltCount,authoritativeSdeBelts:sdeBelts,
      miningApplicable:miningEnabled&&sdeBelts>0,
      trackedForReconcile:tracked,
      miningStartupStatus:miningStartup.status,
      nativeStartupSlots:startupSlots,
      physicalMiningShips:fleetShips.length,
      actualNamedNpcShips:links.length,sceneReady:Boolean(scene)});
   }catch(error){
    console.warn("[CoopHeadlessWorld] system "+systemID,error.message);
    require("./coopRuntimeProbe").observe("living-headless-boot-system",null,
     {spaceState:{systemID}},{attempt:attempts,status:"FAILED",reason:String(error.message).slice(0,120)});
   }
  }
  if(systems.size){
   const retryMs=nextHeadlessRetryMs(attempts);
   // One warning at the end of quick boot, then infrequent unresolved
   // warnings. Continue trying autonomously; never busy-loop.
   if(attempts===6||(attempts>6&&(attempts-6)%12===0))
    require("./coopRuntimeProbe").observe("living-headless-boot-incomplete",null,null,
     {pendingSystems:[...systems],attempts,retryMs,retrying:true});
   headlessBootTimer=setTimeout(attempt,retryMs);
   headlessBootTimer.unref?.();
  }
 };
 headlessBootTimer=setTimeout(attempt,10000);
 headlessBootTimer.unref?.();
}
function ensurePatrolNavigator(runtime,npc){
 if(patrolNavigator)return;
 const {createPatrolNavigator}=require("./coopPatrolNavigator");
 patrolNavigator=createPatrolNavigator({
  sceneForSystem:id=>runtime.ensureScene(id,{refreshStargates:false}),
  warp:(id,point,options)=>npcNativeOrder("PATROL",id,"warp",
   ()=>npc.warpToPoint(id,point,options)),
  orbit:(id,targetID,range)=>npcNativeOrder("PATROL",id,"orbit",
   ()=>npc.orbit(id,targetID,range))
 });
}
function ensureNativeGateTransfer(runtime){
 if(process.env.EVEJS_COOP_NATIVE_GATE_APPROACH!=="1"||
  process.env.EVEJS_COOP_NATIVE_GATE_TRANSFER!=="1"||
  nativeGateTransfer)return;
 if(!identityRegistry)throw Error("NATIVE_GATE_TRANSFER_IDENTITY_UNAVAILABLE");
 const worldData=require("./worldData"),controllers=require("./npc/npcRegistry");
 const store=require("./npc/nativeNpcStore");
 const service=require("./npc/nativeNpcService");
 const scrambled=require("./modules/hostileModuleRuntime");
 const prepared=require("./coopNativeGateTransfer").createNativeGateTransfer({
  sceneForSystem:id=>runtime.ensureScene(id,{refreshStargates:false}),
  getGate:id=>worldData.getStargateByID(id),
  store,service,getController:id=>controllers.getControllerByEntityID(id),
  registry:identityRegistry,isScrambled:ship=>scrambled.isEntityWarpScrambled(ship)
 });
 // Must run BEFORE bridge.reconcile() invokes registry.prune(); otherwise
 // an interrupted in-transit ship can lose its durable pilot link.
 const recovered=prepared.recoverPending();
 if(recovered.status==="NEEDS_OPERATOR_REPAIR")
  throw Error("NATIVE_GATE_TRANSFER_REPAIR_REQUIRED: "+JSON.stringify(recovered.pending).slice(0,240));
 if(recovered.recovered)
  require("./coopRuntimeProbe").observe("living-native-gate-recovery",null,null,recovered);
 nativeGateTransfer=prepared;
}
function advanceNativeGateApproach(){
 if(process.env.EVEJS_COOP_NATIVE_GATE_APPROACH!=="1"||
  !bridge||!identityRegistry||!world||!visitedSystems.size)return;
 const route=String(process.env.EVEJS_COOP_VIRTUAL_ROUTE||"")
  .split(",").map(Number).filter(id=>Number.isSafeInteger(id)&&id>0);
 if(route.length<2)return;
 const runtime=require("./runtime"),npc=require("./npc/npcRuntime");
 const worldData=require("./worldData"),controllers=require("./npc/npcRegistry");
 // Both flags are opt-in and OFF by default. If the world is already
 // initialized, this call is idempotent; otherwise observeSession() recovers
 // before any registry pruning on first native boot.
 ensureNativeGateTransfer(runtime);
 if(!gateTravelDirector){
  gateTravelDirector=require("./coopNpcGateTravel").createGateTravel({
   warp:(entityID,gateID,options)=>npcNativeOrder("GATE",entityID,"warp-to-gate",
    ()=>npc.warpToEntity(entityID,gateID,options)),
   getGate:id=>worldData.getStargateByID(id),
   transfer:nativeGateTransfer?(args=>npcNativeOrder("GATE",args.entityID,
    "transfer",()=>nativeGateTransfer.transfer(args),args.gate?.sourceSystemID)):null
  });
 }
 const roles=economy?.snapshot().pilots||{};
 const links=bridge.snapshot().filter(a=>a?.pilotID&&a.entityID);
 const blockedIDs=tacticsDirector?.activeIDs()||new Set();
 if(raidDirector)for(const id of raidDirector.activePirateIDs(system=>
  runtime.ensureScene(system,{refreshStargates:false})))blockedIDs.add(id);
 if(wreckRecoveryDirector)for(const sys of visitedSystems)
  for(const id of wreckRecoveryDirector.activeIDs(sys))blockedIDs.add(id);
 if(lootCommerce)for(const sys of visitedSystems)
  for(const id of lootCommerce.activeIDs(sys))blockedIDs.add(id);
 for(const systemID of visitedSystems){
  const scene=runtime.ensureScene(systemID,{refreshStargates:false});
  const assignments=links.filter(a=>Number(a.systemID)===Number(systemID));
  addNpcOrderBlocks(blockedIDs,systemID,"GATE");
  const evidence=gateTravelDirector.tick({systemID,scene,assignments,route,roles,
   getController:id=>controllers.getControllerByEntityID(id),blockedIDs});
  for(const move of evidence.orders){
   if(move.action!=="VERIFIED_NATIVE_GATE_TRANSFER")continue;
   // The destination must join real NPC simulation immediately after
   // confirmed physical arrival; never wait for a future headless boot.
   visitedSystems.add(Number(move.targetSystemID));
   require("./coopRuntimeProbe").observe("living-native-gate-transfer",null,
    {spaceState:{systemID:Number(move.targetSystemID)}},{
     pilotID:move.pilotID,entityID:move.entityID,
     sourceSystemID:Number(systemID),
     destinationSystemID:Number(move.targetSystemID),
     sourceGateID:move.sourceGateID,
     status:"SAME_NATIVE_SHIP_ARRIVED",
     evidenceSource:"NATIVE_DEMATERIALIZE_REMATERIALIZE"
    });
  }
  if(evidence.orders.length||evidence.observations.length)
   require("./coopRuntimeProbe").observe("living-native-gate-approach",null,
    {spaceState:{systemID}},{
     status:evidence.status,gateCount:evidence.gateCount,
     orders:evidence.orders,observations:evidence.observations,
     nativeTransferVerified:evidence.orders.some(o=>o.action==="VERIFIED_NATIVE_GATE_TRANSFER")
    });
 }
}
// This does not infer hits, and it never edits native cargo. The strict native
// reload policy is hooked separately into the pinned missile/local-cycle code.
function observeNativeAmmoConsumption(){
 if(process.env.EVEJS_COOP_NPC_STRICT_AMMO!=="1"||
  !identityRegistry||!visitedSystems.size)return;
 const runtime=require("./runtime"),store=require("./npc/nativeNpcStore");
 if(!nativeAmmoWitness)nativeAmmoWitness=
  require("./coopNpcAmmoWitness").createAmmoWitness({store});
 const assignments=Object.values(identityRegistry.snapshot().links||{});
 for(const systemID of visitedSystems){
  const scene=runtime.ensureScene(systemID,{refreshStargates:false});
  const result=nativeAmmoWitness.sample({scene,assignments});
  if(result.events.length)
   require("./coopRuntimeProbe").observe("living-native-npc-ammo-debit",null,
    {spaceState:{systemID}},{events:result.events,
     status:"NATIVE_CARGO_DELTA_ONLY_NOT_AUTHORED_SHOT"});
 }
}
// Source-verified native kill -> real surviving wreck -> same killer ship.
// Stage J: one opt-in native competing salvage step on the EXISTING 30s
// A-Life tick. Uses existing named NPC hulls, actual native movements and
// one atomic original cargo debit; never spawns a rival or mints a stack.
let salvageRivalDirector=null,salvageRivalStationDelivery=null;
function advanceNativeSalvageRivals(){
 if(process.env.EVEJS_COOP_ALIFE_SALVAGE_RIVALS!=="1"||
  !alifeOrderArbitrationEnabled(process.env)||
  !identityRegistry||!bridge||!visitedSystems.size)return;
 const fs=require("node:fs"),path=require("node:path");
 const root=process.env.EVEJS_COOP_NPC_WAREHOUSE_DIR||
  "/var/lib/evejs/coop-native-warehouse";
 const runtime=require("./runtime"),store=require("./npc/nativeNpcStore"),
  npc=require("./npc/npcRuntime"),controllers=require("./npc/npcRegistry"),
  gameStore=require("../gameStore"),
  items=require("../services/inventory/itemStore");
 const atomic=gameStore.coopAtomicNativeRows;
 if(typeof atomic?.transact!=="function")return;
 if(!salvageRivalDirector)
  salvageRivalDirector=require("./coopSalvageNpcRivals").createSalvageRivals({
   atomic,
   readCases:systemID=>{
    const dir=path.join(root,"salvage-provenance");
    let names;
    try{names=fs.readdirSync(dir)}catch(e){
     if(e?.code==="ENOENT")return [];
     throw e;
    }
    if(names.length>256||names.some(n=>!/^[0-9]+-[0-9]+-[0-9]+[.]json$/.test(n)))
     throw Error("SALVAGE_RIVAL_MANIFEST_DIRECTORY_UNTRUSTED");
    const found=[];
    for(const name of names){
     const raw=fs.readFileSync(path.join(dir,name),"utf8");
     if(raw.length>131072)throw Error("SALVAGE_RIVAL_WITNESS_TOO_LARGE");
     const rec=JSON.parse(raw);
     if(rec?.v!==1||rec.manifestKey!==name.slice(0,-5)||
      !Array.isArray(rec.rows))throw Error("SALVAGE_RIVAL_WITNESS_INVALID");
     if(rec.systemID===systemID)found.push(rec);
    }
    return found;
   },
   readEscrow:key=>{
    const result=gameStore.read("corporationRuntime","/coopSalvageEscrows");
    if(!result?.success)return {status:result?.errorMsg==="ENTRY_NOT_FOUND"?"NOT_FOUND":"UNKNOWN"};
    const saved=result.data?.byContract?.["salvage-"+key];
    return saved?{status:saved.status}:{status:"NOT_FOUND"};
   },
   getController:id=>controllers.getControllerByEntityID(id),
   getNativeEntity:store.getNativeEntity,
   getNativeWreck:store.getNativeWreck,
   getNativeWreckItems:store.listNativeWreckItemsForWreck,
   readCargo:store.listNativeCargoForEntity,
   getUnitVolume:typeID=>Number(items.getItemMetadata(typeID)?.volume),
   warp:(id,wreckID)=>npcNativeOrder("CIVILIAN",id,"salvage-warp",
    ()=>npc.warpToEntity(id,wreckID),runtime.ensureScene(
     store.getNativeEntity(id)?.systemID,{refreshStargates:false})?.systemID),
   orbit:(id,wreckID,meters)=>npcNativeOrder("CIVILIAN",id,"salvage-orbit",
    ()=>npc.orbit(id,wreckID,meters),runtime.ensureScene(
     store.getNativeEntity(id)?.systemID,{refreshStargates:false})?.systemID)
  });
 if(!salvageRivalStationDelivery)
  salvageRivalStationDelivery=require("./coopSalvageNpcStationDelivery")
   .createNpcSalvageDelivery({
    atomic,readNativeCargo:store.listNativeCargoForEntity,
    readNativeItems:()=>Object.values(items.getAllItems()),
    readRivalJournal:()=>{
     const r=gameStore.read("corporationRuntime","/coopSalvageRivalMoves");
     if(r?.errorMsg==="ENTRY_NOT_FOUND")
      return {version:1,moves:{}};
     if(!r?.success)throw Error("SALVAGE_RIVAL_JOURNAL_UNAVAILABLE");
     return r.data;
    },
    readNativeEntity:store.getNativeEntity,
    getController:id=>controllers.getControllerByEntityID(id),
    getStation:id=>require("./worldData").getStationByID(id),
    buildInventoryItem:items.buildInventoryItem,
    warp:(id,stationID)=>npcNativeOrder("CIVILIAN",id,"rival-station-warp",
     ()=>npc.warpToEntity(id,stationID)),
    orbit:(id,stationID,meters)=>npcNativeOrder("CIVILIAN",id,"rival-station-orbit",
     ()=>npc.orbit(id,stationID,meters))
   });
 const roles=world?.snapshot()?.pilots||[];
 const links=[...bridge.snapshot(),...Object.values(
  identityRegistry.snapshot()?.links||{})];
 for(const systemID of visitedSystems){
  const scene=runtime.scenes instanceof Map?runtime.scenes.get(systemID):null;
  if(!scene)continue;
  const blockedIDs=new Set();
  if(tacticsDirector)for(const id of tacticsDirector.activeIDs())blockedIDs.add(id);
  if(gateTravelDirector)for(const id of gateTravelDirector.activeIDs())blockedIDs.add(id);
  if(raidDirector)for(const id of raidDirector.activePirateIDs(sid=>
   runtime.ensureScene(sid,{refreshStargates:false})))blockedIDs.add(id);
  if(wreckRecoveryDirector)for(const id of wreckRecoveryDirector.activeIDs(systemID))
   blockedIDs.add(id);
  addNpcOrderBlocks(blockedIDs,systemID,"CIVILIAN");
  const delivery=salvageRivalStationDelivery.tick({scene,
   assignments:links,blockedIDs});
  if(delivery.orders.length||delivery.deliveries.length)
   require("./coopRuntimeProbe").observe("alife-salvage-rival-station",
    null,{spaceState:{systemID}},{
     status:delivery.status,orders:delivery.orders,
     nativeStockDeliveries:delivery.deliveries,
     nativeInventoryAtomic:true,iskGranted:false
    });
  // A cargo-occupied NPC returning to a station must not also receive
  // a new wreck warp order from another A-Life director in this tick.
  if(delivery.orders.length||delivery.deliveries.length)continue;
  const result=salvageRivalDirector.tick({scene,assignments:links,roles,
   blockedIDs});
  if(result.orders.length||result.pickups.length)
   require("./coopRuntimeProbe").observe("alife-salvage-competition",
    null,{spaceState:{systemID}},{
     status:result.status,nativeOrders:result.orders,
     nativeCargoReceipts:result.pickups,
     npcSpawned:false,iskGranted:false
    });
 }
}
function advanceNativeWreckRecovery(){
 if(process.env.EVEJS_COOP_NPC_WRECK_RECOVERY!=="1"||
  process.env.EVEJS_COOP_NATIVE_WEAPON_EVIDENCE!=="1"||
  !alifeOrderArbitrationEnabled(process.env)||
  !identityRegistry||!bridge||!visitedSystems.size)return;
 const runtime=require("./runtime"),npc=require("./npc/npcRuntime"),
  store=require("./npc/nativeNpcStore"),controllers=require("./npc/npcRegistry");
 const journal=require("./coopNpcWreckClaims").getWreckClaims();
 if(!wreckRecoveryDirector)
  wreckRecoveryDirector=require("./coopNpcWreckRecovery").createWreckRecovery({
   warp:(entityID,wreckID,options)=>npcNativeOrder("CIVILIAN",entityID,"wreck-warp",
    ()=>npc.warpToEntity(entityID,wreckID,options)),
   orbit:(entityID,wreckID,meters)=>npcNativeOrder("CIVILIAN",entityID,"wreck-orbit",
    ()=>npc.orbit(entityID,wreckID,meters))
  });
 const assignments=bridge.snapshot().concat(
  Object.values(identityRegistry.snapshot().links||{}));
 for(const systemID of visitedSystems){
  const claims=journal.active(systemID);
  if(!claims.length)continue;
  const scene=runtime.ensureScene(systemID,{refreshStargates:false});
  const blockedIDs=new Set();
  if(tacticsDirector)for(const id of tacticsDirector.activeIDs())blockedIDs.add(id);
  if(gateTravelDirector)for(const id of gateTravelDirector.activeIDs())blockedIDs.add(id);
  if(raidDirector)for(const id of raidDirector.activePirateIDs(sys=>
    runtime.ensureScene(sys,{refreshStargates:false})))blockedIDs.add(id);
  if(lootCommerce)for(const id of lootCommerce.activeIDs(systemID))blockedIDs.add(id);
  addNpcOrderBlocks(blockedIDs,systemID,"CIVILIAN");
  const result=wreckRecoveryDirector.tick({systemID,scene,claims,assignments,store,
   getController:id=>controllers.getControllerByEntityID(id),blockedIDs,
   pickupDistance:process.env.EVEJS_COOP_NPC_WRECK_TRANSFER==="1"?2500:0});
  if(result.orders.length||result.inspections.length)
   require("./coopRuntimeProbe").observe("living-npc-postraid-wreck-recovery",null,
    {spaceState:{systemID}},{orders:result.orders,inspections:result.inspections,
     transferStatus:"NOT_IMPLEMENTED_NO_NATIVE_ATOMIC_CUSTODY"});
 }
}
// Native source-first wreck debit -> native cargo credit. This phase is
// separate from mere wreck inspection and disabled by default.
function advanceNativeWreckCustody(){
 if(process.env.EVEJS_COOP_NPC_WRECK_TRANSFER!=="1"||
  process.env.EVEJS_COOP_NPC_WRECK_RECOVERY!=="1"||
  process.env.EVEJS_COOP_NATIVE_WEAPON_EVIDENCE!=="1"||
  !alifeOrderArbitrationEnabled(process.env)||
  nativeMarketTickRunning||!identityRegistry||!bridge)return;
 const runtime=require("./runtime"),store=require("./npc/nativeNpcStore"),
  controllers=require("./npc/npcRegistry");
 if(!wreckCustody)wreckCustody=require("./coopNpcWreckCustody").createWreckCustody({
  store,sceneForSystem:id=>runtime.ensureScene(id,{refreshStargates:false}),
  resolveType:id=>require("../services/inventory/itemTypeRegistry").resolveItemByTypeID(id),
  root:process.env.EVEJS_COOP_NPC_WRECK_CUSTODY_ROOT||
   "/var/lib/evejs/coop-npc-wreck-custody"
 });
 const recovered=wreckCustody.recover();
 if(recovered.status!=="CLEAN"){
  require("./coopRuntimeProbe").observe("living-npc-wreck-custody-blocked",
   null,null,{status:recovered.status,
    pending:recovered.pending?.slice(0,5)});
  return;
 }
 const claims=require("./coopNpcWreckClaims").getWreckClaims();
 const byPilot=new Map();
 for(const row of [...bridge.snapshot(),
  ...Object.values(identityRegistry.snapshot().links||{})]){
  if(!row?.pilotID||!Number.isSafeInteger(Number(row.entityID)))continue;
  const key=String(row.pilotID)+":"+String(row.entityID)+":"+String(row.systemID);
  byPilot.set(key,row);
 }
 const assignments=[...byPilot.values()];
 let count=0;
 for(const systemID of visitedSystems){
  if(count>=2)break;
  const scene=runtime.ensureScene(systemID,{refreshStargates:false});
  for(const claim of claims.active(systemID)){
   if(count>=2)break;
   const ship=scene.getEntityByID(claim.attackerEntityID),
    wreck=scene.getEntityByID(claim.wreckID);
   if(ship?.kind!=="ship"||ship.nativeNpc!==true||
    wreck?.nativeNpcWreck!==true||!ship.position||!wreck.position||
    !["x","y","z"].every(k=>Number.isFinite(ship.position[k])&&
     Number.isFinite(wreck.position[k]))||
    Math.hypot(ship.position.x-wreck.position.x,
     ship.position.y-wreck.position.y,
     ship.position.z-wreck.position.z)>2500)continue;
   if(tacticsDirector?.activeIDs().has(Number(claim.attackerEntityID))||
    gateTravelDirector?.activeIDs().has(Number(claim.attackerEntityID))||
    raidDirector?.activePirateIDs(sys=>runtime.ensureScene(sys,{refreshStargates:false}))
     .has(Number(claim.attackerEntityID)))continue;
   const items=store.listNativeWreckItemsForWreck(claim.wreckID);
   if(!Array.isArray(items))continue;
   for(const item of items.slice(0,2)){
    if(count>=2)break;
    const result=wreckCustody.transfer({claim,scene,
     entityID:Number(claim.attackerEntityID),
     wreckItemID:Number(item.wreckItemID),assignments,
     getController:id=>controllers.getControllerByEntityID(id),
     verifyClaim:({claim:presented})=>
      claims.active(systemID).some(saved=>
       Number(saved.wreckID)===Number(presented.wreckID)&&
       Number(saved.sourceEntityID)===Number(presented.sourceEntityID)&&
       Number(saved.attackerEntityID)===Number(presented.attackerEntityID)&&
       saved.attackerPilotID===presented.attackerPilotID&&
       Number(saved.at)===Number(presented.at)),
     canLoot:({wreck,native})=>
      Number(wreck.ownerID)>0&&Number(wreck.ownerID)===Number(native.ownerID)||
      Number(wreck.lootRightCorpID)>0&&
       Number(wreck.lootRightCorpID)===Number(native.corporationID)&&
       Number(native.corporationID)>0});
    if(result.status==="NATIVE_WRECK_CARGO_SETTLED"){
     count++;
     require("./coopRuntimeProbe").observe("living-npc-wreck-cargo-settled",null,
      {spaceState:{systemID}},result);
    }else if(!["NATIVE_LOOT_RIGHTS_NOT_VERIFIED","INVALID_NATIVE_CUSTODY_PROOF",
     "NATIVE_WRECK_OR_SHIP_UNVERIFIED","NATIVE_COMBAT_ORDER_ACTIVE",
     "NATIVE_CARGO_FULL","ALREADY_SETTLED"].includes(result.status)){
     require("./coopRuntimeProbe").observe("living-npc-wreck-custody-refused",null,
      {spaceState:{systemID}},{status:result.status,
       wreckID:claim.wreckID,itemID:item.wreckItemID});
    }
   }
  }
 }
}
// Move only source-authenticated recovered wreck cargo; no market side effects.
function advanceNativeLootStationDelivery(){
 if(process.env.EVEJS_COOP_NPC_LOOT_COMMERCE!=="1"||
  process.env.EVEJS_COOP_NPC_WRECK_TRANSFER!=="1"||
  !alifeOrderArbitrationEnabled(process.env)||
  !identityRegistry||!bridge||!visitedSystems.size)return;
 const runtime=require("./runtime"),npc=require("./npc/npcRuntime"),
  controllers=require("./npc/npcRegistry"),
  store=require("./npc/nativeNpcStore"),worldData=require("./worldData");
 if(!lootCommerce)lootCommerce=require("./coopNpcLootCommerce").createLootCommerce({
  root:process.env.EVEJS_COOP_NPC_WRECK_CUSTODY_ROOT||
   "/var/lib/evejs/coop-npc-wreck-custody",
  store,sceneForSystem:id=>runtime.ensureScene(id,{refreshStargates:false}),
  getController:id=>controllers.getControllerByEntityID(id),
  getStation:id=>worldData.getStationByID(id),
  warp:(id,stationID,opts)=>npcNativeOrder("CIVILIAN",id,"loot-station-warp",
   ()=>npc.warpToEntity(id,stationID,opts)),
  orbit:(id,stationID,range)=>npcNativeOrder("CIVILIAN",id,"loot-station-orbit",
   ()=>npc.orbit(id,stationID,range))
 });
 const byKey=new Map();
 for(const row of [...bridge.snapshot(),
  ...Object.values(identityRegistry.snapshot().links||{})])
  if(row?.pilotID&&Number(row.entityID)>0&&Number(row.systemID)>0)
   byKey.set(row.pilotID+":"+row.entityID+":"+row.systemID,row);
 const assignments=[...byKey.values()],blockedIDs=new Set();
 if(tacticsDirector)for(const id of tacticsDirector.activeIDs())blockedIDs.add(id);
 if(gateTravelDirector)for(const id of gateTravelDirector.activeIDs())blockedIDs.add(id);
 if(raidDirector)for(const id of raidDirector.activePirateIDs(sys=>
   runtime.ensureScene(sys,{refreshStargates:false})))blockedIDs.add(id);
 if(wreckRecoveryDirector)for(const sys of visitedSystems)
  for(const id of wreckRecoveryDirector.activeIDs(sys))blockedIDs.add(id);
 for(const sys of visitedSystems)addNpcOrderBlocks(blockedIDs,sys,"CIVILIAN");
 const result=lootCommerce.tick({assignments,blockedIDs});
 if(result.orders.length||result.ready.length)
  require("./coopRuntimeProbe").observe("living-npc-loot-station",null,null,{
   nativeMovementOrders:result.orders,physicallyReady:result.ready,
   source:"AUTHENTICATED_NATIVE_WRECK_CARGO",iskCredited:false
  });
}
function advanceNativePatrolRoutes(){
 if(!patrolDirector||!patrolNavigator||process.env.EVEJS_COOP_FACTION_PATROLS!=="1")return;
 for(const [systemID,entityIDs] of Object.entries(patrolDirector.snapshot())){
  const blockedIDs=gateTravelDirector?.activeIDs()||new Set();
  if(wreckRecoveryDirector&&process.env.EVEJS_COOP_NPC_WRECK_RECOVERY==="1")
   for(const id of wreckRecoveryDirector.activeIDs(Number(systemID)))blockedIDs.add(id);
  if(lootCommerce)for(const id of lootCommerce.activeIDs(Number(systemID)))blockedIDs.add(id);
  if(nativeAmmoSupply)for(const id of nativeAmmoSupply.activeIDs(Number(systemID)))blockedIDs.add(id);
  // Keep the existing patrol scheduling path unchanged when arbitration is OFF.
  if(alifeOrderArbitrationEnabled(process.env)){
   if(tacticsDirector)for(const id of tacticsDirector.activeIDs())blockedIDs.add(id);
   if(raidDirector)for(const id of raidDirector.activePirateIDs(sys=>{
    const native=require("./runtime");return native.ensureScene(sys,{refreshStargates:false});
   }))blockedIDs.add(id);
   addNpcOrderBlocks(blockedIDs,Number(systemID),"PATROL");
  }
  const result=patrolNavigator.tick(Number(systemID),entityIDs,{blockedIDs});
  if(result.orders?.length)console.info("[CoopFactionPatrol] native waypoint orders",JSON.stringify({systemID,orders:result.orders}));
 }
}
function ensureNativeMining(scene,systemID){
 if(process.env.EVEJS_COOP_NATIVE_MINING!=="1"||!scene)return;
 if(initializedNativeMiningScenes.has(scene)){
  // Reconsider real convoy losses at the normal bounded world reconcile
  // interval; do not re-run general mining scene init after startup.
  // The pinned upstream startup hook + native renewal policy enforce
  // loss cooldown and spawn caps before any replacement is permitted.
  if(process.env.EVEJS_COOP_CONVOY_RENEWAL==="1")
   require("../services/mining/miningNpcOperations").handleSceneCreated(scene);
  return;
 }
 // Stock EveJS mining operations prevent duplicate fleet seeding.
 // If the scene was only partially initialized, retry on the next pass.
 require("../services/mining/miningRuntime").handleSceneCreated(scene);
 const mining=require("../services/mining/miningNpcOperations");
 const expected=Number(process.env.EVEJS_MINING_NPC_STARTUP_FLEET_COUNT||1);
 const configured=String(process.env.EVEJS_MINING_NPC_STARTUP_SYSTEM_IDS||"")
  .split(",").map(x=>Number(x.trim())).filter(x=>Number.isSafeInteger(x)&&x>0);
 // A lone ship, a GM fleet or just the first of multiple startup
 // slots is not enough: keep retrying missing native fleet slots.
 if(process.env.EVEJS_COOP_MINING_STARTUP_RETRY==="1"&&
  process.env.EVEJS_MINING_NPC_STARTUP_ENABLED==="true"&&
  (!configured.length||configured.includes(Number(systemID)))){
  const outcome=require("./coopNativeMiningReadiness").inspect({
   scene,systemID,expectedCount:expected,
   fleets:mining.getMiningFleetsForSystem(systemID)
  });
  if(outcome.ready)initializedNativeMiningScenes.add(scene);
 }else if((mining.getMiningFleetsForSystem(systemID)||[]).some(f=>
   [...(f.minerEntityIDs||[]),...(f.haulerEntityIDs||[])]
    .some(id=>scene.getEntityByID?.(Number(id)))))
  initializedNativeMiningScenes.add(scene);
}
function ensureCivilianOrders(runtime,npc){
 if(civilianOrders)return;
 const {createCivilianOrders}=require("./coopCivilianOrders");
 civilianOrders=createCivilianOrders({
  sceneForSystem:id=>runtime.ensureScene(id,{refreshStargates:false}),
  warp:(id,point,options)=>npcNativeOrder("CIVILIAN",id,"warp",
   ()=>npc.warpToPoint(id,point,options)),
  orbit:(id,targetID,range)=>npcNativeOrder("CIVILIAN",id,"orbit",
   ()=>npc.orbit(id,targetID,range)),
  // With a player on grid, a scheduled civilian route must not warp the NPC
  // away in front of them (they visually vanish). OFF by default.
  playerHoldMeters:process.env.EVEJS_COOP_NPC_ROUTE_HOLD==="1"?200000:0
 });
}
function observeNativeCombat(){
 if(process.env.EVEJS_COOP_HEADLESS_WORLD_BOOT!=="1"||!identityRegistry||!visitedSystems.size)return;
 if(!combatEvidenceDirector)
  combatEvidenceDirector=require("./coopNativeCombatEvidence").createCombatEvidence();
 const runtime=require("./runtime");
 const damage=require("./combat/damage");
 const controllers=require("./npc/npcRegistry");
 const links=Object.values(identityRegistry.snapshot().links||{});
 for(const systemID of visitedSystems){
  try{
   const scene=runtime.ensureScene(systemID,{refreshStargates:false});
   const getHealth=entity=>{
    const max=damage.getEntityMaxHealthLayers(entity);
    if(!Object.values(max).some(n=>n>0))return null;
    return damage.getEntityCurrentHealthLayers(entity,max);
   };
   const getController=id=>controllers.getControllerByEntityID(id);
   const result=combatEvidenceDirector.sample({
    systemID,scene,links,getHealth,getController
   });
   if(result.status==="SAMPLED"&&result.damageEvents)
    require("./coopRuntimeProbe").observe("living-native-combat-damage",null,
     {spaceState:{systemID}},result);
   // Named pirate -> unnamed genuine stock miner is a valid native PvE
   // encounter, but cannot be reported as named-vs-named damage.
   if(process.env.EVEJS_COOP_NPC_RAIDS==="1"){
    if(!stockCombatEvidenceDirector)
     stockCombatEvidenceDirector=require("./coopStockFleetCombatEvidence")
      .createStockFleetCombatEvidence();
    const mining=require("../services/mining/miningNpcOperations");
    const fleetShips=require("./coopNativeRaidEligibility").liveFleetShips(
     mining.getMiningFleetsForSystem(systemID),scene,systemID);
    const stock=stockCombatEvidenceDirector.sample({
     systemID,scene,links,pilots:world?.snapshot()?.pilots||[],
     fleetShips,getHealth,getController
    });
    if(stock.status==="SAMPLED"&&stock.damageEvents)
     require("./coopRuntimeProbe").observe("living-native-stock-fleet-combat",null,
      {spaceState:{systemID}},stock);
   }
  }catch(error){console.warn("[CoopNativeCombatEvidence] sample",systemID,error.message);}
 }
}
function observeNativeActivity(){
 if(process.env.EVEJS_COOP_HEADLESS_WORLD_BOOT!=="1"||!identityRegistry||!visitedSystems.size)return;
 if(!activityDirector)activityDirector=require("./coopNativeActivity").createActivity();
 const runtime=require("./runtime");
 const store=require("./npc/nativeNpcStore");
 const registry=require("./npc/npcRegistry");
 const links=Object.values(identityRegistry.snapshot().links||{});
 for(const systemID of visitedSystems){
  try{
   const scene=runtime.ensureScene(systemID,{refreshStargates:false});
   const sample=activityDirector.sample({
    systemID,scene,links,
    getCargo:id=>store.listNativeCargoForEntity(id),
    getController:id=>registry.getControllerByEntityID(id)
   });
   // A sample with no activity is not a PASS. Emit occasional liveness
   // evidence without growing the log on every quiet NPC tick.
   if(sample.status==="SAMPLED"&&
      (sample.observedMovement||sample.oreGrowth||sample.engagedNativeNpcs||backgroundTicks%10===0)){
     require("./coopRuntimeProbe").observe("living-native-activity",null,
      {spaceState:{systemID}},sample);
   }
  }catch(error){console.warn("[CoopNativeActivity] sample",systemID,error.message);}
 }
}
async function observeAlifeEconomy(){
 // COOP-043: still one existing 30-second A-Life tick, no competing timer.
 if(alifeEconomyAuthorityBusy)return;
 alifeEconomyAuthorityBusy=true;
 try{
  if(!world||!identityRegistry||!visitedSystems.size){
   if(backgroundTicks%10===0)require("./coopRuntimeProbe").observe(
    "alife-economy-blocker",null,null,{reason:"NATIVE_ALIFE_WORLD_NOT_READY",
     status:"BLOCKED",source:"NATIVE_ECONOMY_SENSOR"});
   return;
  }
  const native=require("./runtime"),npcStore=require("./npc/nativeNpcStore");
  const controllers=require("./npc/npcRegistry");
  const worldData=require("./worldData"),probe=require("./coopRuntimeProbe");
  if(!alifeEconomyObserver)alifeEconomyObserver=require("./coopAlifeEconomy")
   .createAlifeEconomyObserver({emit:event=>probe.observe(event.event,null,
     {spaceState:{systemID:event.systemID}},event)});
  const roles=new Map(world.snapshot().pilots.map(p=>[p.id,p.role]));
  const links=Object.values(identityRegistry.snapshot().links||{});
  const authorityEnabled=process.env.EVEJS_COOP_ALIFE_ECONOMY_AUTHORITY==="1";
  if(authorityEnabled&&!alifeStationAuthority){
   const {createRuntimeStationAuthority,parseTargets}=require("./coopAlifeStationAuthorityRuntime");
   const products=parseTargets(process.env.EVEJS_COOP_ALIFE_ECONOMY_PRODUCTS||"");
   alifeStationAuthority=createRuntimeStationAuthority({products,deps:{
    worldData,
    itemStore:require("../services/inventory/itemStore"),
    industryStatic:require("../services/industry/industryStaticData"),
    industryParity:require("../services/industry/industryParityHelpers"),
    gameStore:require("../gameStore"),
    marketClient:require("../services/market/marketDaemonClient").marketDaemonClient
   }});
  }
  // Global read budget across all systems, not eight stations per system.
  let remainingStations=8;
  const stationEvidenceCache=new Map();
  for(const systemID of [...visitedSystems].sort((a,b)=>a-b).slice(0,4)){
   const scene=native.ensureScene(systemID,{refreshStargates:false});
   const snap=require("./coopAlifeEconomySensor").readEconomySnapshot({
    systemID,scene,links,roles,
    getController:id=>controllers.getControllerByEntityID(id),
    getStation:id=>worldData.getStationByID(id),
    getNativeEntity:id=>npcStore.getNativeEntity(id),
    listNativeCargo:id=>npcStore.listNativeCargoForEntity(id),
    inspectNativeAmmo:(entityID,pilotID)=>nativeAmmoSupply?.inspect({
     scene,entityID,pilotID,assignments:links})||null,
    readStationEconomy:()=>null
   });
   if(authorityEnabled&&alifeStationAuthority&&snap.authoritativeNative===true){
    // Bound to the pilot's actual native corporation; never broadcast another
    // corporation's station stock to a trader or a player-owned ship.
    const cache=stationEvidenceCache;
    for(const pilot of snap.pilots){
     if(pilot.role!=="trader"||!pilot.stationID||!pilot.ownerID)continue;
     const key=pilot.ownerID+":"+pilot.stationID;
     if(cache.has(key)){pilot.economy=cache.get(key);continue;}
     if(remainingStations--<=0){pilot.economy={authoritativeNative:false,
       reason:"NATIVE_ALIFE_STATION_BUDGET_EXCEEDED"};continue;}
     const observed=await alifeStationAuthority.read({
      ownerID:pilot.ownerID,stationID:pilot.stationID,systemID});
     pilot.economy=observed;
     cache.set(key,observed);
    }
   }
   const decision=alifeEconomyObserver.tick(snap);
   // LW-04B: use this existing A-Life authority tick for manufacturing
   // admission only. Shipped native industry bindings are NOT live-safe.
   if(process.env.EVEJS_COOP_ALIFE_ECONOMY_ACT==="1"){
    // Manufacturing admission is independent of the remaining A-Life phases.
    // A failed native source callback cannot suppress NPC resupply or buyer
    // observations in this 30-second world cycle; never retry the intent.
    try{
     if(!alifeManufacturingRuntime)alifeManufacturingRuntime=
      require("./coopAlifeNativeManufacturingRuntime").createRuntimeAlifeManufacturing({
       getNativeEntity:id=>npcStore.getNativeEntity(id),
       getController:id=>controllers.getControllerByEntityID(id),
       sceneForSystem:id=>native.scenes instanceof Map?native.scenes.get(id):null,
       getStation:id=>worldData.getStationByID(id)
      });
     const result=await alifeManufacturingRuntime.tick({
      snapshot:snap,decision,registry:identityRegistry});
     if(result.status==="BLOCKED"||result.status==="ADMISSION_EVALUATED")
      probe.observe("alife-native-manufacturing-admission",null,
       {spaceState:{systemID}},
       {status:result.status,reason:result.reason||null,
        count:result.count||0,
        directorReportedNativeAction:result.results?.some(x=>x.nativeMutation===true)===true,
        nativeSettlementVerified:false,
        source:"NATIVE_SOURCE_ADMISSION_NOT_NATIVE_SETTLEMENT"});
    }catch(_error){
     probe.observe("alife-native-manufacturing-admission",null,
      {spaceState:{systemID}},
      {status:"BLOCKED",reason:"NATIVE_MANUFACTURING_ADMISSION_EXCEPTION",
       nativeSettlementVerified:false,
       source:"NATIVE_SOURCE_ADMISSION_NOT_NATIVE_SETTLEMENT"});
    }
   }
   if(require("./coopAlifeNativeResupplyBridge").nativeResupplyActEnabled())
    safeNpcPhase("alife-native-resupply-act",()=>
     advanceNativeAmmoSupply({mode:"PLANNED",systemIDFilter:systemID,decision}));
   // COOP-049: exactly one existing A-Life authority may dispatch the
   // opt-in native corporate buyer. Independent legacy market writers block it.
   if(process.env.EVEJS_COOP_ALIFE_NATIVE_BUYER==="1"){
    if(process.env.EVEJS_COOP_NATIVE_NPC_MARKET==="1"||nativeMarketTickRunning){
     probe.observe("alife-native-buyer-blocked",null,{spaceState:{systemID}},
      {reason:"PARALLEL_NATIVE_MARKET_WRITER_ENABLED",status:"BLOCKED"});
    }else{
     if(!alifeBuyerRuntime)alifeBuyerRuntime=require("./coopAlifeNativeBuyerRuntime")
      .createRuntimeAlifeBuyer({file:process.env.EVEJS_COOP_NPC_CORP_BUY_JOURNAL||
       "/var/lib/evejs/coop-npc-corp-buy-journal.json"});
     const purchased=await alifeBuyerRuntime.tick({snapshot:snap,decision,
      registry:identityRegistry,world});
     if(purchased.purchases?.length||purchased.status==="BLOCKED")
      probe.observe("alife-native-buyer-result",null,{spaceState:{systemID}},
       {status:purchased.status,purchases:purchased.purchases||[],
        reason:purchased.reason||null});
    }
   }
  }
 }finally{alifeEconomyAuthorityBusy=false}
}
function lockedTargets(scene,ship){
 try{return (scene?.getTargetsForEntity?.(ship)||[]).map(Number).slice(0,6);}
 catch(error){return "UNAVAILABLE";}
}
function npcModuleSummary(ship){
 try{
  const equipment=require("./npc/npcEquipment");
  const runtime=require("../services/mining/miningRuntime");
  const fitting=require("../services/fitting/liveFittingState");
  const items=equipment.getNpcFittedModuleItems(ship)||[];
  return items.slice(0,10).map(item=>{
   let miningEffects=0;
   try{
    miningEffects=(fitting.getTypeEffectRecords(Number(item?.typeID)||0)||[])
     .filter(effect=>{try{return runtime.isMiningEffectRecord(effect,item);}catch(_error){return false;}}).length;
   }catch(_error){miningEffects=-1;}
   const online=typeof fitting.isModuleOnline==="function"?fitting.isModuleOnline(item):null;
   return {typeID:Number(item?.typeID)||0,miningEffects,
    online,flagID:Number(item?.flagID)||0,
    // Does the native runtime really hold this module in an active cycle?
    active:ship?.activeModuleEffects instanceof Map?
     Boolean(ship.activeModuleEffects.get(Number(item?.itemID)||0)):null,
    activeTarget:ship?.activeModuleEffects instanceof Map?
     Number(ship.activeModuleEffects.get(Number(item?.itemID)||0)?.targetID)||0:0,
    capacitor:Number.isFinite(ship?.capacitorCharge)?Math.round(ship.capacitorCharge):null,
    hasState:Boolean(item?.moduleState&&typeof item.moduleState==="object"),
    hasExplicit:typeof fitting.hasExplicitModuleOnlineState==="function"?
     fitting.hasExplicitModuleOnlineState(item):null};
  });
 }catch(error){return "UNAVAILABLE:"+String(error?.message||error).slice(0,40);}
}
function distanceBetween(left,right){
 if(!left||!right)return null;
 const keys=["x","y","z"];
 if(!keys.every(key=>Number.isFinite(left[key])&&Number.isFinite(right[key])))return null;
 return Math.round(Math.hypot(left.x-right.x,left.y-right.y,left.z-right.z));
}
function nearestBeltMeters(scene,position){
 if(!position)return null;
 let nearest=null;
 for(const entity of scene?.staticEntities||[]){
  if(entity?.kind!=="asteroidBelt"||!entity.position)continue;
  const meters=distanceBetween(position,entity.position);
  if(meters===null)continue;
  if(nearest===null||meters<nearest)nearest=meters;
 }
 return nearest;
}
function mineableSummary(scene,entityID){
 try{
  const state=require("../services/mining/miningRuntimeState").getMineableState(scene,entityID);
  if(!state)return null;
  return {yieldTypeID:Number(state.yieldTypeID)||0,
   remaining:Number(state.remainingQuantity)||0,
   unitVolume:Number(state.unitVolume)||0,
   updatedAtMs:Number(state.updatedAtMs)||0};
 }catch(error){return "UNAVAILABLE:"+String(error?.message||error).slice(0,40);}
}
function mineableBeltSummary(scene){
 try{
  const state=require("../services/mining/miningRuntimeState");
  const entities=(scene?.staticEntities||[]).filter(entity=>{
   try{return state.isMineableStaticEntity(entity);}catch(_error){return false;}
  });
  let withOre=0,totalRemaining=0;
  for(const entity of entities.slice(0,400)){
   const mineable=state.getMineableState(scene,Number(entity.itemID)||0);
   const remaining=Number(mineable?.remainingQuantity)||0;
   if(remaining>0){withOre++;totalRemaining+=remaining;}
  }
  return {entities:entities.length,withOre,totalRemaining};
 }catch(error){return "UNAVAILABLE:"+String(error?.message||error).slice(0,40);}
}
function miningShipDetail(systemID,fleet){
 try{
  const scene=require("./runtime").ensureScene(systemID,{refreshStargates:false});
  const rocks=[];
  const rockForShips=scene?.getEntityByID?.(Number(fleet?.activeAsteroidID));
  const rockPosition=rockForShips?.position||null;
  const ships=[...(fleet?.minerEntityIDs||[]),...(fleet?.haulerEntityIDs||[])].map(id=>{
   const ship=scene?.getEntityByID?.(Number(id));
   if(!ship)return {id:Number(id)||0,missing:true};
   return {id:Number(id)||0,mode:String(ship.mode||""),
    target:Number(ship.targetID)||0,stacks:(ship.nativeCargoItems||[]).length,
    quantity:(ship.nativeCargoItems||[]).reduce((sum,item)=>sum+Math.max(0,Number(item.quantity)||0),0),
    toRockMeters:distanceBetween(ship.position,rockPosition),
    toBeltMeters:nearestBeltMeters(scene,ship.position),
    targets:lockedTargets(scene,ship),
    // Mining only starts when the hull really carries online mining modules.
    modules:npcModuleSummary(ship)};
  });
  const rock=scene?.getEntityByID?.(Number(fleet?.activeAsteroidID));
  if(rock)rocks.push({id:Number(rock.itemID)||0,typeID:Number(rock.typeID)||0,
   quantity:Number(rock.quantity ?? rock.remainingQuantity ?? rock.oreQuantity)||0,
   radius:Number(rock.radius)||0,
   mineable:mineableSummary(scene,Number(rock.itemID)||0)});
  const belt=mineableBeltSummary(scene);
  return {ships,rocks,belt};
 }catch(error){return {error:String(error?.message||error).slice(0,80)};}
}
function observeEconomyOre(){
 if(!visitedSystems.size)return;
 const arrival=require("./coopNativeStationArrival");
 for(const systemID of [...visitedSystems].sort((a,b)=>a-b).slice(0,4))
  arrival.observePreferredOre({systemID,reason:"periodic"});
 // Same process, same second: the real native mining records. Without this a
 // stalled haul looks exactly like a fleet that is simply still mining.
 try{
  const mining=require("../services/mining/miningNpcOperations");
  const probe=require("./coopRuntimeProbe");
  for(const systemID of [...visitedSystems].sort((a,b)=>a-b).slice(0,4)){
   const fleets=mining.getMiningFleetsForSystem(systemID)||[];
   if(!fleets.length)continue;
   probe.observe("living-mining-fleet-state",null,{spaceState:{systemID}},{
    systemID,fleets:fleets.slice(0,6).map(fleet=>({
     fleetID:Number(fleet?.fleetID)||0,state:String(fleet?.state||""),
     miners:(fleet?.minerEntityIDs||[]).length,haulers:(fleet?.haulerEntityIDs||[]).length,
     activeAsteroidID:Number(fleet?.activeAsteroidID)||0,
     loadedUntilMs:Number(fleet?.loadedUntilMs)||0,
     lastHauledVolumeM3:Number(fleet?.lastHauledVolumeM3)||0,
     stationID:Number(fleet?.coopStationArrival?.stationID)||0,
     noCargo:fleet?.coopStationNoCargo===true,
     nextThinkAtMs:Number(fleet?.nextThinkAtMs)||0,now:Date.now(),
     // Where mining really stops: an empty miner, a dead rock or a spent module.
     shipDetail:miningShipDetail(systemID,fleet)
    }))
   });
  }
 }catch(error){console.warn("[CoopEconomyDestination] fleet state",error.message);}
}
function nativeMarketAllowlist(name){
 return [...new Set(String(process.env[name]||"").split(",").map(Number)
  .filter(x=>Number.isSafeInteger(x)&&x>0))].slice(0,20);
}
// How the merchant prices its own stock: the best real bid first, then small
// steps down every few minutes while nothing sells. Pure policy; the guarded
// native trader still owns every mutation (order fill, cargo, ledger).
let nativeSellPricing=null;
function sellPricing(){
 if(process.env.EVEJS_COOP_NPC_SELL_PRICING!=="1")return null;
 if(!nativeSellPricing)nativeSellPricing=require("./coopNpcSellPricing").createSellPricing({
  intervalMs:Math.max(30000,Math.min(3600000,
   Number(process.env.EVEJS_COOP_NPC_SELL_STEP_INTERVAL_MS||120000))),
  stepPct:Math.max(0.01,Math.min(0.5,
   Number(process.env.EVEJS_COOP_NPC_SELL_STEP_PCT||0.05))),
  minPct:Math.max(0.2,Math.min(0.99,
   Number(process.env.EVEJS_COOP_NPC_SELL_FLOOR_PCT||0.55)))});
 return nativeSellPricing;
}
// One durable guarded trader for the whole process: the arrival sale and the
// normal market tick must share the same in-memory ledger, never a second copy.
function ensureMarketTrader(){
 if(nativeMarketTrader||nativeMarketBlocked)return nativeMarketTrader;
 if(!identityRegistry||!world)return null;
 const runtime=require("./runtime"),store=require("./npc/nativeNpcStore");
 const worldData=require("./worldData"),inventory=require("../services/inventory/itemTypeRegistry");
 const controllers=require("./npc/npcRegistry");
 const marketClient=require("../services/market/marketDaemonClient").marketDaemonClient;
 const {createNpcMarketTrader}=require("./coopNativeNpcMarket");
 const market=createNpcMarketTrader({
  call:(method,params)=>marketClient.call(method,params),
  store,registry:identityRegistry,getStation:id=>worldData.getStationByID(id),
  sceneForSystem:id=>runtime.ensureScene(id,{refreshStargates:false}),
  getController:id=>controllers.getControllerByEntityID(id),
  resolveType:id=>inventory.resolveItemByTypeID(id),
  root:process.env.EVEJS_COOP_NPC_MARKET_ROOT||"/var/lib/evejs/coop-native-market",
  maxQuantity:Math.max(1,Math.min(20,Number(process.env.EVEJS_COOP_NPC_MARKET_MAX_QTY||5))),
  // A sale is bounded by the real seeded bid volume, like a player's. The
  // small MAX_QTY stays a BUY spending guard and never starves the economy.
  maxSellQuantity:Math.max(1,Math.min(1000000,
   Number(process.env.EVEJS_COOP_NPC_MARKET_MAX_SELL_QTY||100000))),
  maxPrice:Math.max(0.01,Math.min(1000000,Number(process.env.EVEJS_COOP_NPC_MARKET_MAX_PRICE||10000))),
  cooldownMs:Math.max(30000,Math.min(3600000,Number(process.env.EVEJS_COOP_NPC_MARKET_COOLDOWN_MS||300000))),
  priceFloorFor:process.env.EVEJS_COOP_NPC_SELL_PRICING==="1"?
   (typeID,bestBid,stationID)=>{
    const pricing=sellPricing();
    if(!pricing)return 0;
    const key=Number(stationID)+":"+Number(typeID);
    pricing.offer(key,bestBid);
    const decision=pricing.decide({key,bestBid});
    return decision.price||0;
   }:null
 });
 // A pending RPC of unknown outcome can never be retried automatically.
 const recovered=market.recover();
 if(recovered.status==="NEEDS_OPERATOR_REPAIR"){
  nativeMarketBlocked=true;
  require("./coopRuntimeProbe").observe("living-native-market-repair-required",null,null,recovered);
  return null;
 }
 if(recovered.recovered)
  require("./coopRuntimeProbe").observe("living-native-market-recovered",null,null,recovered);
 nativeMarketTrader=market;
 return market;
}
async function advanceNativeMarket(){ if(process.env.EVEJS_COOP_NATIVE_NPC_MARKET!=="1"||
  nativeMarketBlocked||nativeMarketTickRunning||
  !identityRegistry||!world||!visitedSystems.size)return;
 const sellTypes=nativeMarketAllowlist("EVEJS_COOP_NPC_MARKET_SELL_TYPES");
 const buyTypes=nativeMarketAllowlist("EVEJS_COOP_NPC_MARKET_BUY_TYPES");
 if(!sellTypes.length&&!buyTypes.length)return;
 nativeMarketTickRunning=true;
 try{
  const runtime=require("./runtime"),store=require("./npc/nativeNpcStore");
  const worldData=require("./worldData"),inventory=require("../services/inventory/itemTypeRegistry");
  const controllers=require("./npc/npcRegistry");
  const marketClient=require("../services/market/marketDaemonClient").marketDaemonClient;
  const market=ensureMarketTrader();
  if(!market)return;
  const roles=new Map(world.snapshot().pilots.map(p=>[p.id,p.role]));
  const rearmEnabled=process.env.EVEJS_COOP_NPC_EARN_SPEND_REARM==="1"&&
   process.env.EVEJS_COOP_NPC_LOOT_COMMERCE==="1"&&
   alifeOrderArbitrationEnabled(process.env);
  if(rearmEnabled&&!nativeRearm)
   nativeRearm=require("./coopNpcNativeRearm").createNativeRearm({
    store,registry:identityRegistry,
    sceneForSystem:id=>runtime.ensureScene(id,{refreshStargates:false}),
    getController:id=>controllers.getControllerByEntityID(id),
    getStation:id=>worldData.getStationByID(id),
    resolveType:id=>inventory.resolveItemByTypeID(id),
    compatible:(module,typeID)=>require("./npc/npcCapabilityResolver")
     .isNpcChargeCompatibleWithModule(module,typeID),
    verifyCombatCharge:(ship,module)=>require("./npc/npcEquipment")
     .getNpcLoadedChargeForModule(ship,module),
    root:process.env.EVEJS_COOP_NPC_MARKET_ROOT||
     "/var/lib/evejs/coop-native-market"
   });
  const rearmTypes=rearmEnabled?nativeMarketAllowlist(
   "EVEJS_COOP_NPC_REARM_CHARGE_TYPES").filter(x=>buyTypes.includes(x)):[];
  const blocked=tacticsDirector?.activeIDs()||new Set();
  if(gateTravelDirector)for(const id of gateTravelDirector.activeIDs())blocked.add(id);
  if(raidDirector)for(const id of raidDirector.activePirateIDs(id=>
   runtime.ensureScene(id,{refreshStargates:false})))blocked.add(id);
  for(const sys of visitedSystems)addNpcOrderBlocks(blocked,sys,"CIVILIAN");
  const links=Object.values(identityRegistry.snapshot().links||{})
   .filter(l=>l?.pilotID&&l.entityID)
   .sort((a,b)=>String(a.pilotID).localeCompare(String(b.pilotID)));
  let completed=0;
  for(const systemID of visitedSystems){
   if(completed>=2)break;
   const scene=runtime.ensureScene(systemID,{refreshStargates:false});
   const stations=(scene.staticEntities||[]).filter(x=>x?.kind==="station"&&Number(x.itemID)>0);
   if(!stations.length)continue;
   for(const link of links.filter(x=>Number(x.systemID)===Number(systemID))){
    if(completed>=2)break;
    const role=roles.get(link.pilotID)||link.role;
    const recoveredPirate=role==="pirate"&&
     process.env.EVEJS_COOP_NPC_LOOT_COMMERCE==="1"&&
     process.env.EVEJS_COOP_NPC_WRECK_TRANSFER==="1"&&
     lootCommerce!==null;
    const rearmingPirate=role==="pirate"&&rearmEnabled&&
     nativeRearm!==null&&rearmTypes.length>0;
    if(!["trader","hauler"].includes(role)&&!recoveredPirate&&
       !rearmingPirate||blocked.has(Number(link.entityID)))continue;
    const ship=scene.getEntityByID(Number(link.entityID));
    const ctrl=controllers.getControllerByEntityID(Number(link.entityID));
    if(!ship||ship.nativeNpc!==true||Number(ctrl?.currentTargetID)>0||
     ctrl?.manualOrder?.type==="attack"||
     String(ship.mode||"").toUpperCase().includes("WARP"))continue;
    const station=stations.find(x=>{
     const dx=ship.position?.x-x.position?.x,dy=ship.position?.y-x.position?.y,
      dz=ship.position?.z-x.position?.z;
     return [dx,dy,dz].every(Number.isFinite)&&Math.hypot(dx,dy,dz)<=10000+
      Math.max(0,Number(x.radius)||0)+Math.max(0,Number(ship.radius)||0);
    });
    if(!station)continue;
    const nativeCargo=recoveredPirate?
     lootCommerce.stock({pilotID:link.pilotID,entityID:Number(link.entityID)}):
     store.listNativeCargoForEntity(Number(link.entityID))||[];
    const eligible= nativeCargo.filter(c=>Number(c.moduleID||0)===0&&
     c.singleton!==true&&Number(c.quantity)>0&&sellTypes.includes(Number(c.typeID)));
    const tradeCandidates=recoveredPirate?
     eligible.filter(c=>lootCommerce.readyFor({
      pilotID:link.pilotID,entityID:Number(link.entityID),systemID,
      stationID:Number(station.itemID),cargoID:Number(c.cargoID)
     })).map(c=>({side:"sell",typeID:Number(c.typeID),
      cargoID:Number(c.cargoID),
      verifyCargo:row=>lootCommerce.verifiedCargo({
       pilotID:link.pilotID,entityID:Number(link.entityID),cargo:row})})):
     ["trader","hauler"].includes(role)?
      [...new Set(eligible.map(c=>Number(c.typeID)))]
       .map(typeID=>({side:"sell",typeID}))
       .concat(buyTypes.map(typeID=>({side:"buy",typeID}))):[];
    // Only a genuinely earned positive native NPC ledger balance may fund
    // new seeded-market charge purchases. No virtual bounties or free ISK.
    let loadPlan=null;
    if(rearmingPirate&&nativeMarketTrader.snapshot().pilots[link.pilotID]?.balance>0){
     loadPlan=nativeRearm.candidates({pilotID:link.pilotID,
      entityID:Number(link.entityID),systemID,
      stationID:Number(station.itemID),allowedTypes:rearmTypes});
     if(loadPlan.status==="REARM_READY"){
      const loaded=nativeRearm.load({pilotID:link.pilotID,
       entityID:Number(link.entityID),systemID,
       stationID:Number(station.itemID),cargoID:loadPlan.cargoID,
       moduleID:loadPlan.moduleID});
      if(loaded.status==="NATIVE_NPC_CHARGE_LOADED"||
       loaded.status==="ALREADY_LOADED"){
       completed++;
       require("./coopRuntimeProbe").observe("living-npc-earned-rearm",null,
        {spaceState:{systemID}},loaded);
      }else require("./coopRuntimeProbe").observe("living-npc-rearm-blocked",null,
       {spaceState:{systemID}},{status:loaded.status,
        pilotID:link.pilotID,entityID:Number(link.entityID)});
      continue;
     }
     if(loadPlan.status==="REARM_NEEDS_PURCHASE")
      tradeCandidates.push({side:"buy",typeID:loadPlan.typeID});
    }
    for(const trade of tradeCandidates){
     const result=await nativeMarketTrader.execute({
      scene,pilotID:link.pilotID,entityID:Number(link.entityID),
      stationID:Number(station.itemID),
      ...trade,buyTypes,sellTypes
     });
     if(result.status==="TRADE_SETTLED"){
      completed++;
      // A sale resets this stack's asking price for the next haul.
      if(trade.side==="sell"){
       const pricing=sellPricing();
       if(pricing)pricing.noteSold(Number(station.itemID)+":"+Number(trade.typeID));
      }
      require("./coopRuntimeProbe").observe(
       rearmingPirate&&trade.side==="buy"?
        "living-native-npc-ammo-purchased":
        recoveredPirate?"living-native-loot-market-settled":"living-native-market-trade",
       null,{spaceState:{systemID}},{
        ...result,marketCurrency:"NPC_LEDGER_ONLY_NOT_EVEJS_PLAYER_WALLET",
        sourceOfFunds:trade.side==="buy"?
         "PREVIOUS_NPC_MARKET_LEDGER_EARNINGS":"SEED_MARKET_FILLED_ORDER"
       });
      // The actual native market purchase is already settled. Bind that
      // very cargo ID to an already fitted compatible module; if loading
      // fails, the bought stack remains real cargo for later reconciliation.
      if(rearmingPirate&&trade.side==="buy"&&loadPlan?.moduleID){
       const loaded=nativeRearm.load({pilotID:link.pilotID,
        entityID:Number(link.entityID),systemID,
        stationID:Number(station.itemID),cargoID:result.cargoID,
        moduleID:loadPlan.moduleID});
       require("./coopRuntimeProbe").observe(
        ["NATIVE_NPC_CHARGE_LOADED","ALREADY_LOADED"].includes(loaded.status)?
         "living-npc-earned-rearm":"living-npc-rearm-blocked",null,
        {spaceState:{systemID}},{...loaded,
         purchaseSettled:true,cargoID:result.cargoID});
      }
      break;
     }
     if(result.status==="PRICE_BELOW_FLOOR"){
      require("./coopRuntimeProbe").observe("living-npc-sell-policy",null,
       {spaceState:{systemID}},{...result,decision:"HOLD_UNTIL_FLOOR_STEPS_DOWN",
        marketCurrency:"NPC_LEDGER_ONLY_NOT_EVEJS_PLAYER_WALLET"});
      continue;
     }
     if(["RPC_OUTCOME_UNKNOWN","RPC_ACK_NOT_VERIFIABLE","NEEDS_MARKET_REPAIR",
      "UNRESOLVED_MARKET_JOURNAL"].includes(result.status)){
      nativeMarketBlocked=true;
      require("./coopRuntimeProbe").observe("living-native-market-repair-required",null,
       {spaceState:{systemID}},{pilotID:link.pilotID,status:result.status});
      return;
     }
    }
   }
  }
 }finally{nativeMarketTickRunning=false;}
}
function advanceNativeCivilianOrders(){
 if(!bridge||!civilianOrders||process.env.EVEJS_COOP_MATERIALIZE_NPCS!=="1")return [];
 const current=new Map(world.snapshot().pilots.map(p=>[p.id,p.systemID]));
 const assignments=bridge.snapshot().filter(p=>current.get(p.pilotID)===p.systemID);
 const blockedIDs=raidDirector?.activePirateIDs?.(systemID=>{
  const runtime=require("./runtime");
  return runtime.ensureScene(systemID,{refreshStargates:false});
 })||new Set();
 if(tacticsDirector)for(const id of tacticsDirector.activeIDs())blockedIDs.add(id);
 if(gateTravelDirector)for(const id of gateTravelDirector.activeIDs())blockedIDs.add(id);
 if(wreckRecoveryDirector&&process.env.EVEJS_COOP_NPC_WRECK_RECOVERY==="1")
  for(const sys of new Set(assignments.map(x=>Number(x.systemID))))
   for(const id of wreckRecoveryDirector.activeIDs(sys))blockedIDs.add(id);
 if(lootCommerce)for(const sys of new Set(assignments.map(x=>Number(x.systemID))))
  for(const id of lootCommerce.activeIDs(sys))blockedIDs.add(id);
 if(nativeAmmoSupply)for(const sys of new Set(assignments.map(x=>Number(x.systemID))))
  for(const id of nativeAmmoSupply.activeIDs(sys))blockedIDs.add(id);
 // A physically observing squad scout must stay on-grid for the 15s relay:
 // don't let generic civilian waypoints warp that SAME native ship away.
 if(process.env.EVEJS_COOP_NPC_SQUAD_RAIDS==="1"&&squadDirector)
  for(const sys of new Set(assignments.map(x=>Number(x.systemID))))
   for(const scoutID of squadDirector.activeScoutIDs(sys))blockedIDs.add(scoutID);
 for(const sys of new Set(assignments.map(x=>Number(x.systemID))))
  addNpcOrderBlocks(blockedIDs,sys,"CIVILIAN");
 const roles=economy?.snapshot().pilots||{};
 const goals=npcPersonalGoals(),routeOverrides={};
 if(goals){
  const snapshots=goals.snapshot().pilots;
  const runtime=require("./runtime");
  for(const pilot of assignments){
   if(roles[pilot.pilotID]?.role!=="pirate")continue;
   const scene=runtime.ensureScene(pilot.systemID,{refreshStargates:false});
   const ship=scene?.getEntityByID?.(Number(pilot.entityID));
   if(ship?.nativeNpc!==true||ship.kind!=="ship"||ship.session?.characterID)continue;
   if(!snapshots[pilot.pilotID]||snapshots[pilot.pilotID].systemID!==Number(pilot.systemID))
    goals.decide({pilotID:pilot.pilotID,systemID:pilot.systemID,...npcRealPoints(scene)});
   const role=goals.routeRole({pilotID:pilot.pilotID,systemID:pilot.systemID});
   if(role)routeOverrides[pilot.pilotID]=role;
  }
 }
 const orders=civilianOrders.tick(assignments,roles,{blockedIDs,routeOverrides});
 if(goals)for(const order of orders){
  if(!routeOverrides[order.pilotID])continue;
  try{goals.observeNativeOrder({pilotID:order.pilotID,
    systemID:assignments.find(a=>a.pilotID===order.pilotID)?.systemID,
    entityID:order.entityID,targetID:order.targetID,action:order.action});
  }catch(error){console.warn("[CoopNpcGoals] native route evidence",error.message);}
 }
 if(orders.length)console.info("[CoopVirtualWorld] native civilian work routes",JSON.stringify(orders));
 return orders;
}
// Physically stranded NPCs cannot invent ammo. Warping away from battle
// uses a real unscrumbled native hull, with safe real station destination.
function advanceNativeAmmoSupply({mode="LEGACY",systemIDFilter=null,decision=null}={}){
 if(process.env.EVEJS_COOP_NPC_AMMO_SUPPLY!=="1"||
  process.env.EVEJS_COOP_NPC_STRICT_AMMO!=="1"||
  !alifeOrderArbitrationEnabled(process.env)||
  !bridge||!identityRegistry||!world||!visitedSystems.size)return;
 const runtime=require("./runtime"),npc=require("./npc/npcRuntime"),
  store=require("./npc/nativeNpcStore"),controllers=require("./npc/npcRegistry"),
  equipment=require("./npc/npcEquipment"),dogma=require("./combat/weaponDogma"),
  types=require("./npc/npcCapabilityResolver"),
  worldData=require("./worldData"),
  scramble=require("./modules/hostileModuleRuntime");
 if(!nativeAmmoSupply)nativeAmmoSupply=
  require("./coopNpcAmmoSupply").createAmmoSupply({
   store,getWeaponModules:equipment.getNpcWeaponModules,
   resolveFamily:weapon=>dogma.resolveWeaponFamily(weapon),
   isOptional:weapon=>dogma.isChargeOptionalTurretWeapon(weapon),
   compatible:types.isNpcChargeCompatibleWithModule,
   getController:id=>controllers.getControllerByEntityID(id),
   getStation:id=>worldData.getStationByID(id),
   warp:(id,targetID,options)=>npcNativeOrder("TACTICS",id,"ammo-retreat-warp",
    ()=>npc.warpToEntity(id,targetID,options)),
   orbit:(id,targetID,range)=>npcNativeOrder("CIVILIAN",id,"ammo-resupply-orbit",
    ()=>npc.orbit(id,targetID,range)),
   isScrambled:ship=>scramble.isEntityWarpScrambled(ship)
  });
 const roles=new Map(world.snapshot().pilots.map(p=>[p.id,p.role]));
 const assignments=bridge.snapshot().filter(x=>roles.get(x.pilotID)==="pirate");
 for(const systemID of visitedSystems){
  if(systemIDFilter!==null&&Number(systemIDFilter)!==Number(systemID))continue;
  const scene=runtime.ensureScene(systemID,{refreshStargates:false});
  const blockedIDs=new Set();
  if(lootCommerce)for(const id of lootCommerce.activeIDs(systemID))blockedIDs.add(id);
  if(tacticsDirector)for(const id of tacticsDirector.activeIDs())blockedIDs.add(id);
  let chosen=assignments,selected=null;
  if(mode==="SURVIVAL"||mode==="PLANNED"){
   selected=require("./coopAlifeNativeResupplyBridge").selectAmmoResupply({
    mode,systemID,assignments,decision,scene,
    getController:id=>controllers.getControllerByEntityID(id),
    inspectAmmo:args=>nativeAmmoSupply.inspect(args)});
   if(selected.status!=="SELECTED"||selected.selected.length===0)continue;
   chosen=selected.selected;
  }
  const result=nativeAmmoSupply.tick({scene,assignments:chosen,blockedIDs,
   observeOnly:mode==="MONITOR_ONLY"});
  if(result.orders.length||result.events.length)
   require("./coopRuntimeProbe").observe("living-native-ammo-supply",null,
    {spaceState:{systemID}},{orders:result.orders,events:result.events,
     nativeCargoSupplyOnly:true,cargoCredited:false,alifeMode:mode});
  if(mode==="PLANNED"&&result.orders.length)
   for(const order of result.orders){
    const intent=selected.intents.get(order.pilotID);
    if(!intent||Number(intent.entityID)!==Number(order.entityID))continue;
    require("./coopRuntimeProbe").observe("alife-native-act-order",null,
     {spaceState:{systemID}},{pilotID:order.pilotID,entityID:order.entityID,
      stage:"RESUPPLY",intentID:intent.intentID,stationID:order.stationID,
      nativeAction:order.action,proof:"NATIVE_ORDER_ACCEPTED",
      nativeMutation:true,cargoCredited:false,iskCredited:false});
   }
 }

}
function advanceNativeRaids(){
 if(process.env.EVEJS_COOP_NPC_RAIDS!=="1"||!bridge||!visitedSystems.size)return;
 const runtime=require("./runtime"),npc=require("./npc/npcRuntime");
 const mining=require("../services/mining/miningNpcOperations");
 const nativeStore=require("./npc/nativeNpcStore");
 const controllers=require("./npc/npcRegistry");
 if(!raidDirector){
  raidDirector=require("./coopNativeRaids").createRaids({
   warp:(pirateID,targetID,options)=>npcNativeOrder("RAID",pirateID,"warp-to-prey",
    ()=>npc.warpToEntity(pirateID,targetID,options)),
   attack:(pirateID,targetID,options)=>npcNativeOrder("RAID",pirateID,"attack",
    ()=>npc.issueAttackOrder(pirateID,targetID,options))
  });
 }
 if(process.env.EVEJS_COOP_NPC_CAPSULEER_AGENCY==="1"&&!huntPolicy) {
  // Opt-in NPC-vs-NPC assessment only. Native stock raid eligibility remains
  // authoritative; players can only count as potential defenders, not prey.
  huntPolicy=require("./coopNpcHuntPolicy").createHuntPolicy({
   file:process.env.EVEJS_COOP_NPC_INTEL_FILE||"/var/lib/evejs/coop-npc-intel.json",
   onDecision:decision=>require("./coopRuntimeProbe").observe("living-npc-opportunity",null,null,decision)
  });
 }
 const roles=economy?.snapshot().pilots||{};
 // Validate persisted goal state before allowing any new native raid command.
 const goals=npcPersonalGoals();
 for(const systemID of visitedSystems){
  // Once a pilot has genuinely recovered cargo and begun physical delivery,
  // it must not abandon its sale route to accept an opportunistic new raid.
  const delivering=lootCommerce?.activeIDs(systemID)||new Set();
  const outOfAmmo=nativeAmmoSupply?.activeIDs(systemID)||new Set();
  const pirates=bridge.snapshot().filter(p=>
   p.systemID===systemID&&roles[p.pilotID]?.role==="pirate"&&
   !delivering.has(Number(p.entityID))&&
   !outOfAmmo.has(Number(p.entityID))).map(x=>x.entityID);
  if(!pirates.length)continue;
  const scene=runtime.ensureScene(systemID,{refreshStargates:false});
  const fleets=mining.getMiningFleetsForSystem(systemID);
  const raidPolicy=require("./coopNativeRaidEligibility");
  // Authoritative live EveJS mining fleet membership is the only source
  // of valid targets. Unnamed stock miners are not invisible to pirates.
  const fleetShips=raidPolicy.liveFleetShips(fleets,scene);
  const activeLinks=Object.values(identityRegistry?.snapshot().links||{})
   .filter(link=>Number(link.systemID)===Number(systemID)&&
    scene.getEntityByID(Number(link.entityID)));
  const actualPilots=world.snapshot().pilots;
  const factionByPilot=new Map(actualPilots.map(p=>[p.id,p.faction]));
  const squadContacts=activeLinks.map(p=>({...p,
   faction:factionByPilot.get(p.pilotID)}));
  // Squad coordination is optional, NPC-on-NPC only, and never a second
  // attack loop. Existing native stock mining raid legality still runs first.
  const squadEnabled=process.env.EVEJS_COOP_NPC_SQUAD_RAIDS==="1"&&
   process.env.EVEJS_COOP_NPC_CAPSULEER_AGENCY==="1"&&
   alifeOrderArbitrationEnabled(process.env);
  if(squadEnabled&&!squadDirector)
   squadDirector=require("./coopNpcSquadDirector").createSquadDirector();
  const squads=squadEnabled?squadDirector:null;
  // Native ore custody is only a server-side eligibility prefilter,
  // NEVER cargo-scan knowledge supplied to the NPC or shared report.
  const raidCandidates=squads?fleetShips.filter(candidate=>
   (nativeStore.listNativeCargoForEntity(candidate.id)||[]).some(c=>
    Number(c?.moduleID||0)===0&&Number(c?.quantity)>0)):fleetShips;
  const squadState=squads?.observe({systemID,scene,
   pirates:squadContacts.filter(p=>p.role==="pirate"),
   pilots:actualPilots,fleetShips:raidCandidates,
   canAttack:({pirateID,targetID})=>raidPolicy.isAuthorizedStockMiningRaid({
    systemID,attacker:scene.getEntityByID(pirateID),
    target:scene.getEntityByID(targetID),links:activeLinks,
    pilots:actualPilots,fleetShips:raidCandidates
   })});
  if(squadState?.teams?.length&&backgroundTicks%10===0)
   require("./coopRuntimeProbe").observe("living-npc-scout-relay",null,
    {spaceState:{systemID}},{teams:squadState.teams});
  const assessments=new Map();
  const canAttack=({pirateID,targetID})=>{
   // The existing source-verified NPC combat gate ALWAYS runs first.
   if(!raidPolicy.isAuthorizedStockMiningRaid({
    systemID,attacker:scene.getEntityByID(pirateID),
    target:scene.getEntityByID(targetID),links:activeLinks,
    pilots:actualPilots,fleetShips
   }))return false;
   if(process.env.EVEJS_COOP_NPC_CAPSULEER_AGENCY!=="1")return true;
   if(!huntPolicy)return false;
   const pirateLink=activeLinks.find(x=>Number(x.entityID)===Number(pirateID));
   const targetRole=fleetShips.find(x=>Number(x.id)===Number(targetID))?.role;
   if(!pirateLink||!targetRole)return false;
   const report=squads?.permit({systemID,scene,pirateID,targetID});
   if(report&&!report.allowed)return false;
   const damage=require("./combat/damage");
   const scramble=require("./modules/hostileModuleRuntime");
   const decision=huntPolicy.assess({systemID,scene,pirateID,targetID,
    targetRole,piratePilotID:pirateLink.pilotID,contacts:squadContacts,
    sharedIntel:report?.report||null,
    getHealth:entity=>{
     const maximum=damage.getEntityMaxHealthLayers(entity);
     const actual=damage.getEntityCurrentHealthLayers(entity,maximum);
     if(!maximum||!actual||![maximum.shield,maximum.armor,maximum.structure].some(x=>Number(x)>0))return NaN;
     const armor=Number(maximum.armor)>0?Number(actual.armor)/Number(maximum.armor):1;
     const structure=Number(maximum.structure)>0?
       Number(actual.structure)/Number(maximum.structure):1;
     return Math.min(armor,structure);
    },
    isScrambled:entity=>scramble.isEntityWarpScrambled(entity)
   });
   const seen=assessments.get(Number(pirateID))||[];
   seen.push(decision.decision);
   assessments.set(Number(pirateID),seen);
   return decision.decision==="RAID";
  };
  const result=raidDirector.tick({
   systemID,scene,pirates,fleetShips,canAttack,
   getCargo:id=>nativeStore.listNativeCargoForEntity(id),
   getController:id=>controllers.getControllerByEntityID(id)
  });
  if(goals){
   const points=npcRealPoints(scene),active=new Set(result.actions.map(a=>Number(a.pirateID)));
   const leased=raidDirector.activePirateIDs(sys=>
    runtime.ensureScene(sys,{refreshStargates:false}));
   for(const rawID of pirates){
    const id=Number(rawID),link=activeLinks.find(a=>Number(a.entityID)===id);
    const ship=scene.getEntityByID(id);
    if(!link||!ship||ship.nativeNpc!==true||ship.session?.characterID)continue;
    const decisions=assessments.get(id)||[];
    const assessment=decisions.includes("RETREAT")?"RETREAT":
      (active.has(id)||leased.has(id))?"RAID":
      decisions.includes("WORK")?"WORK":
      decisions.includes("RAID")?"RAID":"SCOUT";
    const planned=goals.decide({pilotID:link.pilotID,systemID,assessment,
      verifiedRaid:active.has(id)||leased.has(id),...points});
    if(planned.status==="PLANNED")
     require("./coopRuntimeProbe").observe("living-npc-personal-goal",null,
      {spaceState:{systemID}},{pilotID:link.pilotID,intent:planned.intent,
       reason:planned.reason,verifiedRaid:active.has(id)||leased.has(id)});
   }
  }
  if(result.actions.length){
   // Only a successful native ATTACK order against another named NPC
   // is faction tension evidence. Warp approaches aren't battles.
   if(factionDirector&&identityRegistry){
    const actualLinks=Object.values(identityRegistry.snapshot().links||{})
     .filter(link=>Number(link.systemID)===Number(systemID)&&
      scene.getEntityByID(Number(link.entityID)));
    const byEntity=new Map(actualLinks.map(link=>[Number(link.entityID),link]));
    const factions=new Map(world.snapshot().pilots.map(p=>[p.id,p.faction]));
    for(const action of result.actions){
     if(action.action!=="attack")continue;
     const attacker=byEntity.get(Number(action.pirateID));
     const defender=byEntity.get(Number(action.targetID));
     if(!attacker||!defender)continue;
     const aggressorFaction=factions.get(attacker.pilotID);
     const defenderFaction=factions.get(defender.pilotID);
     if(!aggressorFaction||!defenderFaction||aggressorFaction===defenderFaction)continue;
     factionDirector.onEngagement({
      eventID:"native-raid:"+systemID+":"+action.pirateID+":"+action.targetID+":"+Math.floor(Date.now()/600000),
      systemID,aggressorFaction,defenderFaction,
      attackerPilotID:attacker.pilotID,defenderPilotID:defender.pilotID
     });
    }
   }
   console.info("[CoopLivingWorld] Native pirate raid",JSON.stringify({systemID,actions:result.actions}));
   require("./coopWorldSignals").notifyRaid(scene,result.actions);
   require("./coopRuntimeProbe").observe("living-pirate-raid",null,
    {spaceState:{systemID}},{actions:result.actions});
  }
 }
}
// PVE-002: no scheduler, spawn, wallet, or objective side effects.
// Only existing transient native-combat defenders recorded in an exact
// authored dungeon encounter are allowed to assist after verified aggression.
// PVE-003A: only existing waves' source-proven transient NPCs may warp.
// No new site, native NPC spawn, reward, or timer.
// PVE-003B: original destructible dungeon objectives + native combat
// target / warp / orbit commands, never virtual HP, damage or payouts.
// PVE-004A: never spawn boss NPCs, mint drops or advance missions here.
// Verify original authored combat hull/HP, native death and existing wreck rows.
function advanceNativePveBossWreck(){
 if(process.env.EVEJS_COOP_PVE_NATIVE_BOSSES!=="1"||
    process.env.EVEJS_COOP_PVE_SITE_DEFENSE!=="1"||!bridge||!visitedSystems.size)return;
 const runtime=require("./runtime"),dungeon=require("../services/dungeon/dungeonRuntime"),
  npc=require("./npc/npcRuntime"),ctrl=require("./npc/npcRegistry"),
  store=require("./npc/nativeNpcStore"),damage=require("./combat/damage");
 if(!(runtime.scenes instanceof Map))return;
 if(!pveNativeBossDirector)
  pveNativeBossDirector=require("./coopPveNativeBossDirector").createNativeBossDirector({
   getNativeEntity:id=>store.getNativeEntity(id),
   getController:id=>ctrl.getControllerByEntityID(id),
   resolveVerifiedPlayer:(scene,ship)=>
    require("./coopNativeConsequences").resolveVerifiedPlayerID(scene,ship),
   getHealth:ship=>{
    const max=damage.getEntityMaxHealthLayers(ship),
     hp=damage.getEntityCurrentHealthLayers(ship,max);
    if(!max||!hp||[max.shield,max.armor,max.structure].some(n=>Number(n)<=0))return null;
    return {shield:Number(hp.shield)/Number(max.shield),
     armor:Number(hp.armor)/Number(max.armor),
     structure:Number(hp.structure)/Number(max.structure)};
   },
   issueAttack:(id,targetID,options)=>npc.issueAttackOrder(id,targetID,options),
   listWrecks:()=>store.listNativeWrecks(),
   listWreckItems:id=>store.listNativeWreckItemsForWreck(id)
  });
 const reserved=new Set([...(bridge.snapshot()||[]),
  ...Object.values(identityRegistry?.snapshot()?.links||{})]
  .map(x=>Number(x.entityID)).filter(x=>Number.isSafeInteger(x)&&x>0));
 for(const systemID of [...visitedSystems].slice(0,12)){
  const scene=runtime.scenes.get(systemID);
  if(!scene||Number(scene.systemID)!==Number(systemID))continue;
  const excluded=new Set(reserved);
  for(const id of pveObjectiveDoctrineDirector?.activeIDs()||[])excluded.add(id);
  for(const lease of pveWaveReinforcementsDirector?.snapshot()||[])
   if(Number(lease.systemID)===Number(systemID)&&Number.isSafeInteger(lease.helperID))
    excluded.add(lease.helperID);
  for(const id of tacticsDirector?.activeIDs()||[])excluded.add(id);
  for(const lease of nativeOrderBridge?.snapshot()?.leases||[])
   if(Number(lease.systemID)===Number(systemID)&&
      ["ACTIVE","ISSUING","OUTCOME_UNKNOWN"].includes(lease.phase)&&
      Number.isSafeInteger(lease.entityID)&&lease.entityID>0)
    excluded.add(lease.entityID);
  if(excluded.size>1024)continue;
  const instances=dungeon.listActiveInstancesBySystem(systemID,{full:true});
  const output=pveNativeBossDirector.tick({systemID,scene,instances,
   excludedIDs:[...excluded]});
  for(const event of output.events)
   require("./coopObserve").observe(require("./coopRuntimeProbe"),
    "living-pve-native-boss-wreck",{systemID},{...event,
     evidence:"NATIVE_HP_OR_WRECK_SOURCE_OBSERVATION_NOT_NEW_LOOT_OR_PAYOUT"});
 }
}
function advanceNativePveObjectiveDoctrine(){
 if(process.env.EVEJS_COOP_PVE_OBJECTIVE_DOCTRINE!=="1"||
    process.env.EVEJS_COOP_PVE_SITE_DEFENSE!=="1"||!bridge||!visitedSystems.size)return;
 const runtime=require("./runtime"),dungeon=require("../services/dungeon/dungeonRuntime"),
  npc=require("./npc/npcRuntime"),ctrl=require("./npc/npcRegistry"),
  nativeStore=require("./npc/nativeNpcStore"),
  damage=require("./combat/damage"),scramble=require("./modules/hostileModuleRuntime");
 if(!(runtime.scenes instanceof Map))return;
 if(!pveObjectiveDoctrineDirector)
  pveObjectiveDoctrineDirector=require("./coopPveObjectiveDoctrine").createObjectiveDoctrine({
   getNativeEntity:id=>nativeStore.getNativeEntity(id),
   getController:id=>ctrl.getControllerByEntityID(id),
   resolveVerifiedPlayer:(scene,ship)=>
    require("./coopNativeConsequences").resolveVerifiedPlayerID(scene,ship),
   getHealth:ship=>{
    const max=damage.getEntityMaxHealthLayers(ship),
     actual=damage.getEntityCurrentHealthLayers(ship,max);
    if(!max||!actual||Number(max.armor)<=0||Number(max.structure)<=0)return null;
    return {armor:Number(actual.armor)/Number(max.armor),
     structure:Number(actual.structure)/Number(max.structure)};
   },
   isScrambled:ship=>scramble.isEntityWarpScrambled(ship),
   getStructureHP:obj=>{
    const max=damage.getEntityMaxHealthLayers(obj),
     actual=damage.getEntityCurrentHealthLayers(obj,max);
    return Number(actual?.structure);
   },
   attack:(id,targetID,options)=>npc.issueAttackOrder(id,targetID,options),
   warpToPoint:(id,point,options)=>npc.warpToPoint(id,point,options),
   orbit:(id,targetID,distance,options)=>npc.orbit(id,targetID,distance,options)
  });
 const reserved=new Set([...(bridge.snapshot()||[]),
  ...Object.values(identityRegistry?.snapshot()?.links||{})]
  .map(x=>Number(x.entityID)).filter(x=>Number.isSafeInteger(x)&&x>0));
 for(const systemID of [...visitedSystems].slice(0,12)){
  const scene=runtime.scenes.get(systemID);
  if(!scene||Number(scene.systemID)!==Number(systemID))continue;
  const excluded=new Set(reserved);
  for(const lease of pveWaveReinforcementsDirector?.snapshot()||[])
   if(Number(lease.systemID)===Number(systemID)&&Number.isSafeInteger(lease.helperID))
    excluded.add(lease.helperID);
  for(const receipt of pveSiteDefenseDirector?.snapshot()||[]){
   const id=Number(String(receipt.key||"").split(":").pop());
   if(Number.isSafeInteger(id)&&id>0)excluded.add(id);
  }
  for(const id of tacticsDirector?.activeIDs()||[])excluded.add(id);
  for(const id of pveNativeBossDirector?.activeIDs()||[])excluded.add(id);
  // Do not override any native lease owned by the already shared A-Life
  // arbiter. This remains read-only; original owners keep order authority.
  for(const lease of nativeOrderBridge?.snapshot()?.leases||[])
   if(Number(lease.systemID)===Number(systemID)&&
      ["ACTIVE","ISSUING","OUTCOME_UNKNOWN"].includes(lease.phase)&&
      Number.isSafeInteger(lease.entityID)&&lease.entityID>0)
    excluded.add(lease.entityID);
  if(excluded.size>1024)continue;
  const instances=dungeon.listActiveInstancesBySystem(systemID,{full:true});
  const output=pveObjectiveDoctrineDirector.tick({
   systemID,scene,instances,excludedIDs:[...excluded],
   waypoints:require("./coopNpcTopology").waypoints(scene)
  });
  for(const event of output.events)
   require("./coopObserve").observe(require("./coopRuntimeProbe"),
    "living-pve-objective-doctrine",{systemID},{...event,
     evidence:"NATIVE_ATTACK_OR_MOVEMENT_ACK_NOT_DAMAGE_HIT_OR_MISSION_REWARD"});
 }
}
function advanceNativePveWaveReinforcements(){
 if(process.env.EVEJS_COOP_PVE_WAVE_REINFORCEMENTS!=="1"||
    process.env.EVEJS_COOP_PVE_SITE_DEFENSE!=="1"||
    !bridge||!visitedSystems.size)return;
 const native=require("./runtime"),dungeon=require("../services/dungeon/dungeonRuntime"),
  npc=require("./npc/npcRuntime"),ctrl=require("./npc/npcRegistry"),
  nativeStore=require("./npc/nativeNpcStore");
 if(!(native.scenes instanceof Map))return;
 if(!pveWaveReinforcementsDirector)
  pveWaveReinforcementsDirector=require("./coopPveWaveReinforcements")
   .createWaveReinforcements({
    getNativeEntity:id=>nativeStore.getNativeEntity(id),
    getController:id=>ctrl.getControllerByEntityID(id),
    resolveVerifiedPlayer:(scene,ship)=>
     require("./coopNativeConsequences").resolveVerifiedPlayerID(scene,ship),
    warpToEntity:(npcID,targetID,options)=>npc.warpToEntity(npcID,targetID,options),
    attack:(npcID,targetID,options)=>npc.issueAttackOrder(npcID,targetID,options)
   });
 const reserved=new Set([...(bridge.snapshot()||[]),
  ...Object.values(identityRegistry?.snapshot()?.links||{})]
  .map(x=>Number(x.entityID)).filter(x=>Number.isSafeInteger(x)&&x>0));
 if(reserved.size>1024)return;
 for(const systemID of [...visitedSystems].slice(0,12)){
  const scene=native.scenes.get(systemID);
  if(!scene||Number(scene.systemID)!==Number(systemID))continue;
  const instances=dungeon.listActiveInstancesBySystem(systemID,{full:true});
  const excluded=new Set(reserved);
  for(const id of pveNativeBossDirector?.activeIDs()||[])excluded.add(id);
  for(const id of pveObjectiveDoctrineDirector?.activeIDs()||[])excluded.add(id);
  if(excluded.size>1024)continue;
  const output=pveWaveReinforcementsDirector.tick({
   systemID,scene,instances,excludedIDs:[...excluded]
  });
  for(const event of output.events)
   require("./coopObserve").observe(require("./coopRuntimeProbe"),
    "living-pve-native-wave-reinforcement",{systemID},{...event,
     evidence:"NATIVE_ORDER_ACK_NOT_SPAWN_DAMAGE_OR_REWARD_PROOF"});
 }
}
function advanceNativePveSiteDefense(){
 if(process.env.EVEJS_COOP_PVE_SITE_DEFENSE!=="1"||!bridge||!visitedSystems.size)return;
 const runtime=require("./runtime"),dungeon=require("../services/dungeon/dungeonRuntime"),
  npc=require("./npc/npcRuntime"),controllers=require("./npc/npcRegistry"),
  nativeStore=require("./npc/nativeNpcStore");
 if(!(runtime.scenes instanceof Map))return;
 if(!pveSiteDefenseDirector){
  pveSiteDefenseDirector=require("./coopPveNativeSiteDefense").createDirector({
   getController:id=>controllers.getControllerByEntityID(id),
   getNativeEntity:id=>nativeStore.getNativeEntity(id),
   resolveVerifiedPlayer:(scene,ship)=>
    require("./coopNativeConsequences").resolveVerifiedPlayerID(scene,ship),
   issueAttack:(npcID,playerID,options)=>
    npc.issueAttackOrder(npcID,playerID,options)
  });
 }
 const reserved=new Set([...(bridge.snapshot()||[]),
  ...Object.values(identityRegistry?.snapshot()?.links||{})]
  .map(x=>Number(x.entityID)).filter(x=>Number.isSafeInteger(x)&&x>0));
 for(const systemID of [...visitedSystems].slice(0,12)){
  const scene=runtime.scenes.get(systemID);
  if(!scene||Number(scene.systemID)!==Number(systemID))continue;
  const instances=dungeon.listActiveInstancesBySystem(systemID,{full:true});
  // If ownership reservations exceed the bounded audit budget, fail closed.
  // A site warp lease retains custody of its physical hull across ticks.
  // Never let the closer-range site director preempt the warp/attack handoff.
  const waveLeases=pveWaveReinforcementsDirector?.snapshot()||[];
  const excluded=new Set(reserved);
  for(const id of pveNativeBossDirector?.activeIDs()||[])excluded.add(id);
  for(const lease of waveLeases)
   if(Number(lease.systemID)===Number(systemID)&&Number.isSafeInteger(lease.helperID)&&
      lease.helperID>0)excluded.add(lease.helperID);
  for(const id of pveObjectiveDoctrineDirector?.activeIDs()||[])excluded.add(id);
  if(excluded.size>1024)continue;
  const result=pveSiteDefenseDirector.tick({
   systemID,scene,instances,excludedIDs:[...excluded]
  });
  if(result.events.length)for(const event of result.events){
   require("./coopObserve").observe(require("./coopRuntimeProbe"),
    "living-pve-site-defense",{systemID},{...event,
     evidence:"NATIVE_ORDER_ACK_NOT_WEAPON_OR_DAMAGE_PROOF"});
  }
  if(result.status==="ORDER_JOURNAL_CAP_REACHED")
   console.warn("[CoopLivingWorld] PVE native order replay fence full");
 }
}
function advanceNativeTactics(){
 if(process.env.EVEJS_COOP_NATIVE_TACTICS!=="1"||!bridge||!visitedSystems.size)return;
 const runtime=require("./runtime"),npc=require("./npc/npcRuntime");
 const controllers=require("./npc/npcRegistry");
 const damage=require("./combat/damage"),scramble=require("./modules/hostileModuleRuntime");
 if(!tacticsDirector){
  tacticsDirector=require("./coopNpcTactics").createTactics({
   warpToPoint:(id,point,options)=>npcNativeOrder("TACTICS",id,"retreat-warp",
    ()=>npc.warpToPoint(id,point,options)),
   warpToEntity:(id,targetID,options)=>{
    const systemID=Number(controllers.getControllerByEntityID(id)?.systemID);
    if(nativeAmmoSupply?.activeIDs(systemID).has(Number(id)))
     return {success:false,errorMsg:"NATIVE_AMMO_EXHAUSTED"};
    return npcNativeOrder("TACTICS",id,"rescue-warp",
     ()=>npc.warpToEntity(id,targetID,options));
   },
   attack:(id,targetID,options)=>{
    const systemID=Number(controllers.getControllerByEntityID(id)?.systemID);
    if(nativeAmmoSupply?.activeIDs(systemID).has(Number(id)))
     return {success:false,errorMsg:"NATIVE_AMMO_EXHAUSTED"};
    return npcNativeOrder("TACTICS",id,"rescue-attack",
     ()=>npc.issueAttackOrder(id,targetID,options));
   },
   resumeBehavior:id=>npcNativeOrder("TACTICS",id,"resume",
    ()=>npc.resumeBehavior(id)),
   stopOrder:id=>npcNativeOrder("TACTICS",id,"stop",
    ()=>npc.issueOrder(id,{type:"stop"})),
   authorizePlayerDefense:({systemID,scene,victim,helper,attacker,session})=>{
    if(process.env.EVEJS_COOP_PVE_NPC_RETALIATION!=="1")return false;
    const verified=require("./coopNativeConsequences").resolveVerifiedPlayerID(scene,attacker);
    const aggression=controllers.getControllerByEntityID(Number(victim?.itemID));
    return require("./coopPveRetaliationGuard").authorize({
     systemID,scene,victim,helper,attacker,session,
     verifiedCharacterID:verified,aggression,now:Date.now()
    });
   },
   notify:event=>{
    require("./coopRuntimeProbe").observe("living-npc-tactical-event",null,
     {spaceState:{systemID:event.systemID}},{...event});
    if(!["npc-help-request","npc-retreat"].includes(event.kind))return;
    const scene=runtime.ensureScene(event.systemID,{refreshStargates:false});
    const ship=scene?.getEntityByID(event.entityID);
    const name=String(ship?.itemName||ship?.name||"An NPC").slice(0,70);
    const message=event.kind==="npc-help-request"
     ?"[Living Universe] "+name+" called "+event.responders+" allied NPCs for help after coming under fire."
     :"[Living Universe] "+name+" is badly damaged and trying to warp away.";
    const chat=require("../services/chat/chatHub");
    for(const session of scene?.sessions?.values?.()||[]){
     if(session?._space?.initialStateSent!==true||!session.characterID)continue;
     try{chat.sendSystemMessage(session,message);}catch(error){console.warn("[CoopNpcTactics] chat",error.message);}
    }
   }
  });
 }
 const ships=[...new Map([...bridge.snapshot(),...Object.values(identityRegistry?.snapshot().links||{})]
  .filter(x=>x.entityID&&x.pilotID).map(x=>[Number(x.entityID),x])).values()],
  pilotData=new Map(world.snapshot().pilots.map(p=>[p.id,p]));
 const roles=economy?.snapshot().pilots||{};
 for(const systemID of visitedSystems){
  const scene=runtime.ensureScene(systemID,{refreshStargates:false});
  const assignments=ships.filter(p=>Number(p.systemID)===Number(systemID))
    .map(a=>({...a,role:roles[a.pilotID]?.role||"patrol",
      faction:pilotData.get(a.pilotID)?.faction||"independent"}));
  if(!assignments.length)continue;
  const activeControllers={};
  for(const a of assignments)activeControllers[a.entityID]=controllers.getControllerByEntityID(a.entityID);
  const output=tacticsDirector.tick({
   systemID,scene,assignments,controllers:activeControllers,
   waypoints:require("./coopNpcTopology").waypoints(scene),
   isScrambled:entity=>scramble.isEntityWarpScrambled(entity),
   additionalResponders:(victim,attackerID,liveScene)=>{
    if(process.env.EVEJS_COOP_NPC_MEMORY!=="1")return 0;
    const aggressor=liveScene?.getEntityByID(attackerID);
    const characterID=require("./coopNativeConsequences").resolveAuthenticatedPlayerID(liveScene,aggressor);
    if(!characterID)return 0;
    const memory=require("./coopNpcMemory").getNativeMemory().recall({
     pilotID:victim.pilotID,characterID
    });
    return memory.status==="KNOWN"&&memory.score<=-30?1:0;
   },
   health:entity=>{
    const max=damage.getEntityMaxHealthLayers(entity),
      now=damage.getEntityCurrentHealthLayers(entity,max);
    return {
     armor:max.armor>0?now.armor/max.armor:1,
     structure:max.structure>0?now.structure/max.structure:1
    };
   }
  });
  // Persist only genuine successful native NPC attack orders, not virtual
  // background timers or imagined battle outcomes.
  if(factionDirector)for(const event of output.events){
   if(event.kind!=="reinforcement-attack")continue;
   const byEntity=new Map(assignments.map(x=>[Number(x.entityID),x]));
   const aggressor=byEntity.get(Number(event.responderID));
   const defender=byEntity.get(Number(event.targetID));
   if(!aggressor||!defender||aggressor.faction===defender.faction)continue;
   factionDirector.onEngagement({
    eventID:"native-order:"+systemID+":"+event.responderID+":"+event.targetID+":"+Math.floor(Date.now()/600000),
    aggressorFaction:aggressor.faction,defenderFaction:defender.faction,systemID,
    attackerPilotID:aggressor.pilotID,defenderPilotID:defender.pilotID
   });
  }
  if(output.events.length)console.info("[CoopLivingWorld] Native tactics",JSON.stringify({systemID,events:output.events}));
 }
}

function advanceNpcRecognition(){
 if(process.env.EVEJS_COOP_NPC_MEMORY!=="1"||!identityRegistry||!visitedSystems.size)return;
 const runtime=require("./runtime");
 if(!recognitionAnnouncer){
  const {createRecognition}=require("./coopNpcRecognition");
  recognitionAnnouncer=createRecognition({
   lookup:query=>require("./coopNpcMemory").getNativeMemory().recall(query),
   send:(session,message)=>require("../services/chat/chatHub").sendSystemMessage(session,message)
  });
 }
 const links=Object.values(identityRegistry.snapshot().links||{});
 for(const systemID of visitedSystems){
  const scene=runtime.ensureScene(systemID,{refreshStargates:false});
  if(!scene?.sessions?.values)continue;
  for(const session of scene.sessions.values()){
   const result=recognitionAnnouncer.tick({session,scene,links});
   if(result.status==="DELIVERED")require("./coopRuntimeProbe").observe(
    "living-npc-recognizes-player",session,null,result);
  }
 }
}
function observeSession(session,ship){
 if(process.env.EVEJS_COOP_VIRTUAL_WORLD!=="1")return;
 try{
  start();
  const systemID=Number(ship?.spaceState?.systemID||session?._space?.systemID||session?.solarsystemid);
  if(!Number.isSafeInteger(systemID)||systemID<=0)return;
  if(session)visitedSystems.add(systemID);
  const allResidents=world.residents(systemID);
  const roles=economy?.snapshot().pilots||{};
  // Reserve scarce named hull slots for pirates and genuine patrol NPCs;
  // role sorting is shared with isolated regression tests.
  const residents=require("./coopNpcRolePriority").orderForMaterialization(
   allResidents.map(p=>({
    ...p,role:roles[p.id]?.role||
      ["miner","hauler","patrol","trader","pirate"][(Number(p.id.slice(-3))-1)%5]
   })).filter(p=>life?.canFly(p.id)!==false)
  );
  for(const p of residents)life?.recover(p.id);
  if(economy)economy.advance(world.snapshot().pilots);
   safeNpcPhase("observed-native-depot",syncNativeDeliveries);
  if(process.env.EVEJS_COOP_MATERIALIZE_NPCS==="1"){
    try{
      const runtime=require("./runtime");
      const npc=require("./npc/npcRuntime");
      const scene=runtime.ensureScene(systemID,{refreshStargates:false});
      // A passing TCP test can still run against an empty virtual space.
      // Record real topology of the authoritative EveJS scene on arrival.
      if(session||process.env.EVEJS_COOP_HEADLESS_WORLD_BOOT==="1"){
        const points=require("./coopNpcTopology").waypoints(scene);
        require("./coopRuntimeProbe").observe("living-world-topology",session,ship,{
          systemID,realWaypoints:points.length,
          realAsteroidBelts:points.filter(p=>p.kind==="asteroidBelt").length,
          realStations:points.filter(p=>p.kind==="station").length,
          realStargates:points.filter(p=>p.kind==="stargate").length,
          sceneReady:Boolean(scene),evidenceSource:session?"CLIENT_SESSION":"HEADLESS_NATIVE_SCENE"
        });
      }
      safeNpcPhase("observed-native-mining",()=>ensureNativeMining(scene,systemID));
      const nativeMining=process.env.EVEJS_COOP_NATIVE_MINING==="1";
      if(!bridge){
        const {createBridge}=require("./coopNpcMaterializer");
        const {createRegistry}=require("./coopIdentityRegistry");
        identityRegistry=createRegistry({
          file:process.env.EVEJS_COOP_IDENTITY_FILE||"/var/lib/evejs/coop-npc-links.json",
          exists:(system,id)=>{
           const ship=runtime.ensureScene(system,{refreshStargates:false})?.getEntityByID(id);
           return ship?.kind==="ship"&&ship.nativeNpc===true;
          }
        });
        // Recover an interrupted native gate movement first; then restore
        // saved real NPC hulls before the materializer may prune stale links.
        ensureNativeGateTransfer(runtime);
        ensureNativeWarGateHandoff(runtime);
        if(process.env.EVEJS_COOP_DURABLE_NPC_SHIPS==="1"){
          const recovered=require("./coopNativeRestore").restoreNamedShips({
            registry:identityRegistry,sceneForSystem:id=>
             runtime.ensureScene(id,{refreshStargates:false}),
            store:require("./npc/nativeNpcStore"),
            service:require("./npc/nativeNpcService"),
            lostShips:Object.values(life?.snapshot()?.wrecks||{})
          });
          require("./coopRuntimeProbe").observe("living-native-durable-recovery",null,null,
           {status:recovered.status,recovered:recovered.recovered,
            alreadyPhysical:recovered.alreadyPhysical,
            legacyTransient:recovered.legacyTransient,
            confirmedLosses:recovered.confirmedLosses,
            errors:recovered.errors});
          if(recovered.status!=="OK")
           throw Error("DURABLE_NPC_RECOVERY_REQUIRES_REPAIR: "+JSON.stringify(recovered.errors).slice(0,210));
        }
        bridge=createBridge({
          registry:identityRegistry,
          limit:Number(process.env.EVEJS_COOP_MATERIALIZE_LIMIT||2),
          exemptRoles:nativeMining?["miner","hauler"]:[],
          exists:(system,id)=>{
           const ship=runtime.ensureScene(system,{refreshStargates:false})?.getEntityByID(id);
           return ship?.kind==="ship"&&ship.nativeNpc===true;
          },
          spawn:(system,pilot)=>{
            const nativeScene=runtime.ensureScene(system,{refreshStargates:false});
            const anchor=require("./coopNpcTopology").anchorOptionsForRole(nativeScene,pilot.role);
            if(!anchor)return {success:false,errorMsg:"NO_NATIVE_SYSTEM_ANCHOR"};
            const pool=require("./coopNpcSpawnPools").spawnPoolForRole(pilot.role,
             {enabled:process.env.EVEJS_COOP_NPC_ROLE_POOLS==="1"});
            return npc.spawnBatchInSystem(system,{
              ...anchor,amount:1,entityType:"npc",
              transient:process.env.EVEJS_COOP_DURABLE_NPC_SHIPS!=="1",
              broadcast:true,
              ...pool,
              // Pirates actively hunt players and rival NPCs; civilians and
              // ordinary guards move and work without attacking a capsuleer.
              ...require("./coopNpcSpawnPools").behaviorOverridesForRole(pilot.role,
               {enabled:process.env.EVEJS_COOP_NPC_ROLE_POOLS==="1"})
            });
          }
        });
      }
      const present=require("./coopNpcPresentation").presentVirtualPilot;
      let industry={status:"DISABLED",fleets:[],assignments:[]};
      if(nativeMining){
        try{
          const mining=require("../services/mining/miningNpcOperations");
          const cargo=require("./npc/nativeNpcStore");
          industry=require("./coopNativeIndustry").observe({
            systemID,scene,pilots:residents,registry:identityRegistry,
            getFleets:id=>mining.getMiningFleetsForSystem(id),
            getCargo:id=>cargo.listNativeCargoForEntity(id),
            getController:id=>require("./npc/npcRegistry").getControllerByEntityID(id),
            present
          });
          require("./coopRuntimeProbe").observe("living-native-industry",session,ship,{
            status:industry.status,fleets:industry.fleets,
            linkedPilots:industry.assignments
          });
          const unsynced=industry.assignments.filter(x=>
           x.presented==="BROADCAST_FAILED"||x.presented==="BROADCAST_UNAVAILABLE");
          if(unsynced.length)require("./coopRuntimeProbe").observe(
           "living-native-presentation-pending",session,ship,{systemID,
            unresolved:unsynced.map(x=>({pilotID:x.pilotID,entityID:x.entityID,
             reason:x.presented}))});
        }catch(error){console.warn("[CoopNativeIndustry]",error.message);}
      }
      // Never create a generic fake miner/hauler when EveJS already has
      // physical mining NPCs with actual mining lasers and ore cargo.
      const materialize=(nativeMining?residents.filter(p=>p.role!=="miner"&&p.role!=="hauler"):residents)
       .map(p=>({...p,durable:process.env.EVEJS_COOP_DURABLE_NPC_SHIPS==="1"}));
      // Trust EveJS's active mining-fleet ship IDs, never a persisted
      // "miner" label alone, when making stock NPC capacity exemptions.
      const stockMiningIDs=industry.fleets.flatMap(f=>[
       ...(f.minerIDs||[]),...(f.haulerIDs||[])
      ]);
      const result=bridge.reconcile(systemID,materialize,{
       exemptEntityIDs:stockMiningIDs
      });
      // Explicit actionable failures. Previously the World report only saw
      // "0 assignments" and hid whether the pilot had no residents,
      // no native spawn anchor, an invalid pool, or a failed native service.
      require("./coopRuntimeProbe").observe("living-native-materialization-attempt",session,
       {spaceState:{systemID}},{systemID,
        residents:allResidents.length,eligibleResidents:residents.length,
        requestedSpawns:materialize.length,
        realAnchors:require("./coopNpcTopology").waypoints(scene).length,
        nativeMiningEnabled:nativeMining,
        miningFleetShips:stockMiningIDs.length,
        linkedIndustryPilots:industry.assignments.length,
        successfulAssignments:result.filter(x=>Number(x.entityID)>0).length,
        spawnErrors:result.filter(x=>x.error).slice(0,10).map(x=>({
         pilotID:x.pilotID,error:String(x.error).slice(0,120),
         ...(x.nativeReason?{nativeReason:String(x.nativeReason).slice(0,100)}:{}),
         ...(x.occupied!==undefined?{occupied:x.occupied,limit:x.limit}:{})
        })),
        pendingTransit:result.filter(x=>x.pendingTransit).length
       });
      ensureCivilianOrders(runtime,npc);
      // Optional voice for NPCs that are already physical in this scene. The
      // module refuses to speak about a ship it cannot see, and throttles both
      // per pilot and per system so Local never becomes spam.
      if(process.env.EVEJS_COOP_NPC_CHATTER==="1"){try{
        const chatter=runtime.__coopNpcChatter||(runtime.__coopNpcChatter=require("./coopNpcChatter")
         .createChatter({send:(target,text)=>require("../services/chat/chatHub").sendSystemMessage(target,text),
          observe:event=>require("./coopRuntimeProbe").observe("living-npc-chatter",null,null,event)}));
        const spoke=chatter.speak({systemID,residents,
         scene,sessions:require("../services/chat/sessionRegistry").getSessions()});
        if(spoke.sent)require("./coopRuntimeProbe").observe("living-npc-chatter-delivered",null,null,
         {spaceState:{systemID},...spoke});
      }catch(error){console.warn("[CoopNpcChatter]",error.message);}}
      // ALIFE news: the same observed events become a short in-client digest.
      // It never invents an event and is throttled per system.
      if(process.env.EVEJS_COOP_ALIFE_NEWS==="1"){try{
        const probe=require("./coopRuntimeProbe");
        const sessions=require("../services/chat/sessionRegistry").getSessions();
        const news=runtime.__coopAlifeNews||(runtime.__coopAlifeNews=require("./coopAlifeNews").createNews());
        if(!runtime.__coopAlifeNewsSubscribed){
          probe.subscribe(record=>{
            if(process.env.EVEJS_COOP_ALIFE_NEWS!=="1")return;
            news.record(record.event,{...record,
             systemID:Number(record.systemID||record.spaceState?.systemID||0)});
          });
          runtime.__coopAlifeNewsSubscribed=true;
        }
        const digest=news.digest(systemID);
        if(digest){
          let delivered=0;
          for(const session of sessions){
            if(!session||Number(session?._space?.systemID)!==Number(systemID))continue;
            try{require("../services/chat/chatHub").sendSystemMessage(session,digest.text);delivered++;}
            catch(_error){}
          }
          if(delivered){
            news.markSent(systemID);
            probe.observe("living-alife-news-delivered",null,{spaceState:{systemID}},
             {items:digest.items,delivered,text:digest.text});
          }
        }
      }catch(error){console.warn("[CoopAlifeNews]",error.message);}}
      const pilotsByID=new Map(residents.map(p=>[p.id,p]));
      const presented=[];
      for(const link of result){
        if(!link.entityID||!pilotsByID.has(link.pilotID))continue;
        const change=present(scene,link.entityID,pilotsByID.get(link.pilotID));
        if(change.status==="UPDATED"||change.status==="BROADCAST_FAILED"||
           change.status==="BROADCAST_UNAVAILABLE")
          presented.push({pilotID:link.pilotID,...change});
      }
      if(presented.length)require("./coopRuntimeProbe").observe("virtual-world-identity-projected",session,ship,{presented});
      // A reused durable pirate keeps the controller it was born with, so the
      // new aggression policy above only reaches fresh spawns. Push the same
      // target classes onto the live controller, otherwise a pirate that was
      // already linked still ignores a capsuleer parked next to it.
      if(process.env.EVEJS_COOP_NPC_ROLE_POOLS==="1"){
        const aggression=require("./coopNpcSpawnPools")
          .behaviorOverridesForRole("pirate",{enabled:true}).behaviorOverrides;
        for(const link of result){
          if(!link.entityID||pilotsByID.get(link.pilotID)?.role!=="pirate")continue;
          try{
            const behavior=require("./npc/npcBehaviorLoop");
            const controller=require("./npc/npcRegistry").getControllerByEntityID(link.entityID);
            if(!controller)continue;
            const current=controller.behaviorOverrides||{};
            if(Array.isArray(current.autoAggroTargetClasses)&&
               current.autoAggroTargetClasses.includes("player")&&current.autoAggro===true)continue;
            const applied=behavior.setBehaviorOverrides(link.entityID,{...current,...aggression});
            if(applied?.success)
              require("./coopRuntimeProbe").observe("living-pirate-aggression",session,ship,{
                pilotID:link.pilotID,entityID:link.entityID,
                previousClasses:Array.isArray(current.autoAggroTargetClasses)
                  ?current.autoAggroTargetClasses:null
              });
          }catch(_error){/* controller index is optional during startup */}
        }
      }
      for(const entry of result){
        if(!entry.entityID||observedNpcIDs.has(entry.entityID))continue;
        const npcID=entry.entityID;
        // Headless boot has no authenticated player ship. Do not open
        // a bogus 0-ship combat probe; native wreck hooks still record losses.
        if(!session||!Number.isSafeInteger(Number(ship?.itemID))||Number(ship.itemID)<=0)continue;
        observedNpcIDs.add(npcID);
        const probe=require("./coopRuntimeProbe");
        require("./coopCombatProbe").launch({
          scene,shipIDs:[Number(ship.itemID)],npcIDs:[npcID],
          session,ship,probe,intervalMs:1000,maxSamples:180,
          onConfirmedWreck:wreck=>confirmedWreck(session,ship,wreck.sourceNpcID,wreck.wreckID)
        });
      }
      if(session&&process.env.EVEJS_COOP_LOCAL_INTEL==="1"){
        try{
          if(!intelAnnouncer){
            const {createAnnouncer}=require("./coopSystemIntel");
            intelAnnouncer=createAnnouncer({
              send:(pilot,message)=>require("../services/chat/chatHub").sendSystemMessage(pilot,message)
            });
          }
          const pirateIDs=result.filter(x=>x.entityID&&pilotsByID.get(x.pilotID)?.role==="pirate")
            .map(x=>x.entityID);
          const intel=intelAnnouncer.announce(session,scene,{fleets:industry.fleets,pirateIDs});
          if(intel.status==="DELIVERED")
            require("./coopRuntimeProbe").observe("living-local-intel",session,ship,{
              locationCount:intel.activity.length,messages:intel.messages
            });
        }catch(error){console.warn("[CoopSystemIntel]",error.message);}
      }
      // Stage J: use an already materialized REAL A-Life trader hull, never
       // manufacture a rival, an ISK reward or a virtual wreck item.
       if(process.env.EVEJS_COOP_RESCUE_NPC_RIVALS==="1"&&
          process.env.EVEJS_COOP_ALIFE_SALVAGE_RIVALS!=="1"&&
          alifeOrderArbitrationEnabled(process.env)){
        try{
         const nativeStore=require("./npc/nativeNpcStore");
         const npcRuntime=require("./npc/npcRuntime");
         const controllers=require("./npc/npcRegistry");
         if(!runtime.__coopRescueNpcRivals){
          runtime.__coopRescueNpcRivals=
           require("./coopRescueNpcRivalry").createRescueRivalry({
            getWrecks:nativeStore.listNativeWrecks,
            getWreckItems:nativeStore.listNativeWreckItemsForWreck,
            readVerifiedLoss:()=>require("./coopConvoyOutcomeProof").createOutcomes().snapshot(),
            atomicRows:(tables,fn)=>require("../gameStore").coopAtomicNativeRows.transact(tables,fn),
            warpToEntity:(entityID,wreckID)=>npcNativeOrder("CIVILIAN",
             entityID,"rescue-rival-warp",
             ()=>npcRuntime.warpToEntity(entityID,wreckID)),
            orbit:(entityID,wreckID,meters)=>npcNativeOrder("CIVILIAN",
             entityID,"rescue-rival-orbit",
             ()=>npcRuntime.orbit(entityID,wreckID,meters)),
            readController:controllers.getControllerByEntityID});
         }
         const blockedIDs=new Set();
         if(tacticsDirector)for(const id of tacticsDirector.activeIDs())blockedIDs.add(id);
         if(gateTravelDirector)for(const id of gateTravelDirector.activeIDs())blockedIDs.add(id);
         if(lootCommerce)for(const id of lootCommerce.activeIDs(systemID))blockedIDs.add(id);
         addNpcOrderBlocks(blockedIDs,systemID,"CIVILIAN");
         const candidates=result.filter(x=>x.entityID&&
          pilotsByID.get(x.pilotID)?.role==="trader").map(x=>{
          const row=nativeStore.getNativeEntity(x.entityID);
          return {role:"trader",entityID:Number(x.entityID),systemID:Number(systemID),
           corporationID:Number(row?.corporationID)||0};
         });
         const claimed=runtime.__coopRescueNpcRivals.tick({scene,candidates,blockedIDs});
         if(!runtime.__coopRescueNpcDepot)
          runtime.__coopRescueNpcDepot=
           require("./coopRescueNpcDepot").createRescueNpcDepot({
            getCargo:nativeStore.listNativeCargoForEntity,
            getStations:require("./worldData").getStationsForSystem,
            atomicRows:(tables,fn)=>require("../gameStore").coopAtomicNativeRows.transact(tables,fn),
            warpToPoint:(entityID,target)=>npcNativeOrder("CIVILIAN",
             entityID,"rescue-rival-delivery-warp",
             ()=>npcRuntime.warpToPoint(entityID,target)),
            orbit:(entityID,stationID,meters)=>npcNativeOrder("CIVILIAN",
             entityID,"rescue-rival-delivery-orbit",
             ()=>npcRuntime.orbit(entityID,stationID,meters)),
            getMetadata:require("../services/inventory/itemStore").getItemMetadata
           });
         const delivered=runtime.__coopRescueNpcDepot.tick({
          scene,candidates,blockedIDs});
         if(delivered.events?.length)
          require("./coopRuntimeProbe").observe("living-alife-native-rescue-depot",
           session,ship,{systemID,events:delivered.events});
         if(claimed.orders?.length)
          require("./coopRuntimeProbe").observe("living-alife-native-rescue-rivals",
           session,ship,{systemID,orders:claimed.orders});
        }catch(error){console.warn("[CoopRescueRivals]",
         String(error?.message||error).slice(0,120))}
       }
      const civilianActions=advanceNativeCivilianOrders();
      require("./coopRuntimeProbe").observe("virtual-world-materialization",session,ship,{
        civilianActions,
        assignments:result,sceneReady:Boolean(scene),
        livingShips:[
          ...result.filter(x=>x.entityID).map(x=>({pilotID:x.pilotID,entityID:x.entityID,role:pilotsByID.get(x.pilotID)?.role})),
          ...industry.assignments.map(x=>({pilotID:x.pilotID,entityID:x.entityID,role:x.role}))
        ],
        realMiningFleets:industry.fleets.length
      });
    }catch(error){console.warn("[CoopMaterializer]",error.message);}
  }
  if(process.env.EVEJS_COOP_FACTION_PATROLS==="1"&&factionDirector){
    try{
      const runtime=require("./runtime"),npc=require("./npc/npcRuntime");
      if(!patrolDirector){
        const {createPatrolDirector}=require("./coopFactionPatrolRuntime");
        patrolDirector=createPatrolDirector({
          spawn:(id)=>{
            const nativeScene=runtime.ensureScene(id,{refreshStargates:false});
            const anchor=require("./coopNpcTopology").anchorOptions(nativeScene);
            if(!anchor)return {success:false,errorMsg:"NO_NATIVE_SYSTEM_ANCHOR"};
            return npc.spawnBatchInSystem(id,{
              ...anchor,amount:1,entityType:"npc",transient:true,broadcast:true,
              // Faction patrols are law enforcement, not pirates: CONCORD-owned
              // hulls read as friendly/neutral brackets in the client.
              ...require("./coopNpcSpawnPools").spawnPoolForRole("patrol",
               {enabled:process.env.EVEJS_COOP_NPC_ROLE_POOLS==="1"}),
              behaviorOverrides:{autoAggro:false,autoActivateWeapons:false,targetPreference:"none"}
            });
          },
          exists:(id,entityID)=>Boolean(runtime.ensureScene(id,{refreshStargates:false})?.getEntityByID(entityID))
        });
      }
      const factions=Object.values(factionDirector.snapshot().factions);
      const deployment=patrolDirector.reconcile(systemID,factions);
      if(deployment.active?.length){
        // Real point-of-interest warps; no player ship orbit anchor.
        ensurePatrolNavigator(runtime,npc);
        const routeOrders=patrolNavigator.tick(systemID,deployment.active);
        require("./coopRuntimeProbe").observe("virtual-faction-patrol-route",session,ship,routeOrders);
      }
      require("./coopRuntimeProbe").observe("virtual-faction-patrol",session,ship,deployment);
    }catch(error){console.warn("[CoopFactionPatrol]",error.message);}
  }
  require("./coopRuntimeProbe").observe("virtual-world-presence",session,ship,{
    residentCount:residents.length,residents:residents.map(p=>({id:p.id,name:p.name,role:p.role,faction:p.faction,journeys:p.journeys})),
    virtualEconomy:economy?.snapshot().systems[String(systemID)]||null
  });
 }catch(error){console.warn("[CoopVirtualWorld] observe",error.message);}
}
function confirmedWreck(session,ship,npcID,wreckID){
 if(!economy)return;
 try{
  if(!lossBridge){
   const {createLossBridge}=require("./coopNpcLossBridge");
   lossBridge=createLossBridge({
    file:process.env.EVEJS_COOP_LOSS_LEDGER_FILE||"/var/lib/evejs/coop-loss-ledger.json",
    recordLoss:(system,amount)=>economy.recordLoss(system,amount)
   });
  }
  const systemID=Number(ship?.spaceState?.systemID||session?._space?.systemID||session?.solarsystemid);
  const result=lossBridge.accept({systemID,npcID,wreckID});
  if(result.status==="COMMITTED"&&factionDirector){
    factionDirector.onLoss({
      eventID:"wreck:"+wreckID,
      faction:"independent",systemID
    });
  }
  require("./coopRuntimeProbe").observe("virtual-economy-npc-loss",session,ship,{npcID,wreckID,status:result.status});
 }catch(e){console.warn("[CoopVirtualWorld] loss",e.message);}
}
function confirmedNativeNpcWreck(systemID,npcID,wreckID,destroyedShip=null){
 if(process.env.EVEJS_COOP_VIRTUAL_WORLD!=="1")return;
 try{
  // A real wreck is the ONLY authority to mark a named pilot as defeated.
  const fs=require("node:fs");
  const linksFile=process.env.EVEJS_COOP_IDENTITY_FILE||"/var/lib/evejs/coop-npc-links.json";
  let registry;
  try{registry=JSON.parse(fs.readFileSync(linksFile,"utf8"));}
  catch(error){if(error.code==="ENOENT")registry={links:{}};else throw error;}
  const link=Object.values(registry?.links||{}).find(x=>
   Number(x.entityID)===Number(npcID)&&Number(x.systemID)===Number(systemID));
  // Stock miners have no co-op pilot link. Verify an actual upstream
  // mining-fleet membership and physical wreck without granting the
  // unnamed victim a synthetic pilot or fabricated ship loss.
  if(!link&&destroyedShip&&process.env.EVEJS_COOP_NPC_RAIDS==="1"){
   const mining=require("../services/mining/miningNpcOperations");
   const fleets=mining.getMiningFleetsForSystem(Number(systemID));
   const belonged=fleets.some(f=>Number(f?.systemID)===Number(systemID)&&
    [...(f.minerEntityIDs||[]),...(f.haulerEntityIDs||[])]
     .some(id=>Number(id)===Number(npcID)));
   if(belonged){
    const runtime=require("./runtime"),store=require("./npc/nativeNpcStore");
    // The actual ship has already been removed by upstream EveJS, but
    // the destruction callback still owns its source object. Capture
    // real last-moment HP loss before recording the verified wreck.
    if(stockCombatEvidenceDirector){
     try{
      const damage=require("./combat/damage");
      const terminal=stockCombatEvidenceDirector.terminalDamage({
       systemID,entityID:npcID,ship:destroyedShip,wreckID,
       getHealth:entity=>{
        const max=damage.getEntityMaxHealthLayers(entity);
        if(!Object.values(max).some(n=>n>0))return null;
        return damage.getEntityCurrentHealthLayers(entity,max);
       }
      });
      if(terminal.status==="NATIVE_STOCK_TERMINAL_HP_DROP")
       require("./coopRuntimeProbe").observe("living-native-stock-fleet-combat",null,
        {spaceState:{systemID}},{status:"SAMPLED",systemID,
         damageEvents:1,terminalNativeWreckID:wreckID,events:[terminal.event]});
     }catch(error){console.warn("[CoopStockCombatEvidence] terminal",error.message);}
    }
    const proof=require("./coopStockFleetWreckEvidence").verifyStockFleetWreck({
     systemID,ship:destroyedShip,wreckID,fleets,
     scene:runtime.ensureScene(Number(systemID),{refreshStargates:false}),
     getWreck:id=>store.getNativeWreck(id),
     getWreckItems:id=>store.listNativeWreckItemsForWreck(id)
    });
    require("./coopRuntimeProbe").observe("living-native-stock-fleet-wreck-evidence",
     null,{spaceState:{systemID}},proof);
    // Physical hauler destruction must be observed before any native convoy outcome.
    if(process.env.EVEJS_COOP_CONVOY_OPERATIONS==="1"&&
       proof.status==="PHYSICAL_NATIVE_STOCK_FLEET_WRECK_VERIFIED"&&
       proof.victimRole==="hauler"){
     try{require("./coopConvoyOutcomeProof").noteLoss(proof)}
     catch(error){console.warn("[CoopConvoyOutcomeProof] hauler loss",String(error?.message||error))}
    }
   }
   return;
  }
  if(!link)return;
  // This callback is invoked only after EveJS successfully spawned the
  // wreck. Verify that its physical entity and stored loot really exist.
  // Never invent a loss from a missing or failed native wreck.
  const runtime=require("./runtime");
  const store=require("./npc/nativeNpcStore");
  const proof=require("./coopNativeCombatEvidence").verifyWreck({
   systemID,npcID,wreckID,
   scene:runtime.ensureScene(Number(systemID),{refreshStargates:false}),
   links:Object.values(registry.links||{}),
   getWreck:id=>store.getNativeWreck(id),
   getWreckItems:id=>store.listNativeWreckItemsForWreck(id)
  });
  if(proof.status!=="PHYSICAL_NATIVE_WRECK_VERIFIED"){
   require("./coopRuntimeProbe").observe("living-native-wreck-evidence",null,
    {spaceState:{systemID}},proof);
   return;
  }
  // FW-009A: native casualty evidence uses the same verified physical
  // wreck callback, never combat orders, hit counters or missing NPCs.
  // This is a SQLite ledger of actual victim ships, NOT victory or kill
  // credit. Any ambiguous SQLite commit is inspected on next callback
  // with this SAME physical wreck ID, never a synthetic replacement ID.
  if(process.env.EVEJS_COOP_FACTION_WAR_NATIVE_CASUALTIES==="1"&&
     process.env.EVEJS_COOP_FACTION_WAR==="1"&&
     process.env.EVEJS_COOP_FACTION_WAR_FLEETS==="1"&&
     process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS==="1"){
   try{
    if(!warCasualtyLedger)
     warCasualtyLedger=require("./coopWarCasualtyLedger").createWarCasualtyLedger({
      gameStore:require("../gameStore"),
      getFactionForCorporation:id=>
       require("../services/faction/factionState").getFactionIDForCorporation(id),
      verifyNativeWreck:({systemID:sys,entityID:id,wreckID:wid,pilotID:pid})=>{
       // The authoritative callback already read the on-disk native
       // pilot link; do not require the virtual A-Life registry to be
       // initialized before this synchronous physical wreck hook.
       const links=Object.values(registry.links||{});
       return require("./coopNativeCombatEvidence").verifyWreck({
        systemID:sys,npcID:id,wreckID:wid,
        scene:runtime.ensureScene(sys,{refreshStargates:false}),
        links:links.filter(x=>x?.pilotID===pid),
        getWreck:w=>store.getNativeWreck(w),
        getWreckItems:w=>store.listNativeWreckItemsForWreck(w)
       });
      }
     });
    const casualty=warCasualtyLedger.record({
     systemID:Number(systemID),entityID:Number(npcID),
     wreckID:Number(wreckID),pilotID:link.pilotID
    });
    if(casualty.status==="RECORDED"||
       casualty.status==="DUPLICATE")
     require("./coopRuntimeProbe").observe(
      "living-native-war-casualty",null,{spaceState:{systemID}},
      {status:casualty.status,receipt:casualty.receipt,
       captureAuthorized:false,killCreditAssigned:false});
   }catch(error){
    console.warn("[CoopNativeWarCasualty] strict native evidence",error.message);
   }
  }
  // The ship is already removed from the EveJS scene at this point,
  // but its authoritative source object is still held by the wreck
  // service. Capture a missed final HP delta only against a fresh
  // earlier native scene sample; never synthesize a fatal hit.
  if(combatEvidenceDirector&&destroyedShip){
   try{
    const damage=require("./combat/damage");
    const terminal=combatEvidenceDirector.terminalDamage({
     systemID,entityID:npcID,pilotID:link.pilotID,
     ship:destroyedShip,wreckID,
     getHealth:entity=>{
      const max=damage.getEntityMaxHealthLayers(entity);
      if(!Object.values(max).some(n=>n>0))return null;
      return damage.getEntityCurrentHealthLayers(entity,max);
     }
    });
    if(terminal.status==="NATIVE_TERMINAL_HP_DROP")
     require("./coopRuntimeProbe").observe("living-native-combat-damage",null,
      {spaceState:{systemID}},{status:"SAMPLED",systemID,
       damageEvents:1,correlatedNpcDamage:terminal.event.attackerPilotIDs.length?1:0,
       terminalNativeWreckID:wreckID,events:[terminal.event]});
   }catch(error){console.warn("[CoopNativeCombatEvidence] terminal HP",error.message);}
  }
  // Emit the authoritative physical wreck *after* its terminal HP
  // observation. The strict report requires damage before wreck, not
  // the reverse order imposed by the callback's bookkeeping.
  require("./coopRuntimeProbe").observe("living-native-wreck-evidence",null,
   {spaceState:{systemID}},proof);
  start();
  const killed=life.markLoss({pilotID:link.pilotID,systemID,shipID:npcID,wreckID});
  require("./coopRuntimeProbe").observe("living-npc-destroyed",null,
   {itemID:npcID,spaceState:{systemID}},{
    pilotID:link.pilotID,name:link.name,faction:link.faction,
    status:killed.status,recoveryAt:killed.readyAt,wreckID
   });
  if(killed.status!=="RECOVERING"||!economy)return;
  const {createLossBridge}=require("./coopNpcLossBridge");
  if(!lossBridge)lossBridge=createLossBridge({
   file:process.env.EVEJS_COOP_LOSS_LEDGER_FILE||"/var/lib/evejs/coop-loss-ledger.json",
   recordLoss:(system,amount)=>economy.recordLoss(system,amount)
  });
  const result=lossBridge.accept({systemID,npcID,wreckID,pilotID:link.pilotID});
  if(result.status==="COMMITTED"&&factionDirector)
   factionDirector.onLoss({eventID:"wreck:"+wreckID,faction:link.faction||"independent",systemID});
  require("./coopRuntimeProbe").observe("living-npc-economic-loss",null,
   {itemID:npcID,spaceState:{systemID}},{
    pilotID:link.pilotID,name:link.name,wreckID,status:result.status
   });
 }catch(error){console.warn("[CoopVirtualWorld] native wreck consequence",error.message);}
}
// Option A: the merchant sells at the station BEFORE the warehouse takes the
// cargo. The native arrival tick is synchronous, so the first call starts the
// market job and the arrival pauses until it settles, bounded by a hard
// timeout: a hung RPC can never freeze a hauler or fake a sale.
const arrivalSales=new Map();
const saleNotes=new Map();
// A sale that silently does not happen is indistinguishable from a bug, so every
// skip reason is reported once per hauler and reason per five minutes.
function noteSaleSkip(systemID,stationID,haulerID,reason){
 const key=String(systemID)+":"+String(haulerID)+":"+String(reason);
 const now=Date.now();
 if(now-(saleNotes.get(key)||0)<300000)return;
 saleNotes.set(key,now);
 try{
  require("./coopRuntimeProbe").observe("living-npc-sale-skipped",null,
   {spaceState:{systemID:Number(systemID)||0}},
   {stationID:Number(stationID)||0,haulerID:Number(haulerID)||0,
    reason:String(reason||"").slice(0,80)});
 }catch(_error){/* telemetry must never break a delivery */}
}
function sellOnArrival({systemID,stationID,haulerID,types=[],scene=null}={}){
 if(process.env.EVEJS_COOP_NPC_MARKET_SELL_ON_ARRIVAL!=="1")return {status:"DISABLED"};
 if(process.env.EVEJS_COOP_NATIVE_NPC_MARKET!=="1")return {status:"MARKET_OFF"};
 const sellTypes=nativeMarketAllowlist("EVEJS_COOP_NPC_MARKET_SELL_TYPES");
 if(!sellTypes.length)return {status:"NO_SELL_TYPES"};
 const key=Number(stationID)+":"+Number(haulerID);
 const running=arrivalSales.get(key);
 if(running){
  if(running.settled)return running.settled;
  if(Date.now()-running.startedAt>45000){
   arrivalSales.delete(key);
   noteSaleSkip(systemID,stationID,haulerID,"SALE_TIMEOUT");
   return {status:"NOT_SOLD",reason:"SALE_TIMEOUT"};
  }
  return {status:"PENDING"};
 }
 // Reuse the identity mechanism that already names the mining fleet: a real
// fleet hauler is adopted by a free miner/hauler resident exactly the way
// coopNativeIndustry.observe does, so it keeps a NORMAL coop-pilot identity and
// ledger instead of inventing a second identifier scheme.
 function adoptMerchant(scene,haulerID,systemID){
  const registry=identityRegistry;
  if(!registry||typeof registry.link!=="function"||typeof registry.get!=="function")
   return null;
  const pilots=(world?.snapshot()?.pilots||[]).filter(p=>p?.role==="hauler"||p?.role==="miner");
  const links=Object.values(registry.snapshot()?.links||{});
  if(links.some(x=>Number(x.entityID)===Number(haulerID)))return null;
  for(const pilot of pilots){
    if(registry.get(pilot.id))continue;
    let linked=null;
    try{linked=registry.link(pilot,Number(systemID),Number(haulerID));}
    catch(_error){continue;}
    if(!linked||Number(linked.entityID)!==Number(haulerID))continue;
    try{require("./coopNpcPresentation").presentVirtualPilot(scene,Number(haulerID),pilot);}
    catch(_error){/* a failed name broadcast must not block the sale */}
    return linked;
  }
  return null;
 }
 let link=Object.values(identityRegistry?.snapshot()?.links||{})
  .find(entry=>Number(entry.entityID)===Number(haulerID)&&
   Number(entry.systemID)===Number(systemID));
 if(!link)link=adoptMerchant(scene||require("./runtime").ensureScene(Number(systemID),
  {refreshStargates:false}),haulerID,systemID);
 if(!link){noteSaleSkip(systemID,stationID,haulerID,"HAULER_NOT_NAMED");return {status:"NOT_SOLD",reason:"HAULER_NOT_NAMED"};}
 const trader=ensureMarketTrader();
 if(!trader){noteSaleSkip(systemID,stationID,haulerID,"MARKET_UNAVAILABLE");return {status:"NOT_SOLD",reason:"MARKET_UNAVAILABLE"};}
 const wanted=[...new Set(sellTypes.filter(typeID=>
  !types.length||types.map(Number).includes(Number(typeID))))];
 if(!wanted.length){noteSaleSkip(systemID,stationID,haulerID,"NO_ALLOWED_ORE");return {status:"NOT_SOLD",reason:"NO_ALLOWED_ORE"};}
 const job={startedAt:Date.now(),settled:null};
 arrivalSales.set(key,job);
 void (async()=>{
  const sold=[];let last="NO_ELIGIBLE_STACK",settlements=0;
  try{
   const scene=require("./runtime").ensureScene(Number(systemID),{refreshStargates:false});
   for(const typeID of wanted){
    // Several stacks of one ore type are still one merchant action. Keep going
    // while the market really buys, so a haul is liquidated instead of decaying
    // in the warehouse, but stay strictly bounded in count and time.
    for(;;){
     if(settlements>=8||Date.now()-job.startedAt>30000)break;
     const result=await trader.execute({scene,pilotID:link.pilotID,
      entityID:Number(haulerID),stationID:Number(stationID),
      side:"sell",typeID,buyTypes:[],sellTypes},
      {withinBatch:settlements>0});
     if(result.status!=="TRADE_SETTLED"){last=String(result.status||"UNKNOWN");break;}
     settlements++;
     sold.push({typeID,quantity:result.quantity,price:result.price,
      isk:Math.round(result.price*result.quantity),balance:result.balance});
    }
   }
  }catch(error){last="SALE_ERROR:"+String(error?.message||error).slice(0,60);}
  job.settled=sold.length?
   {status:"SOLD",sold:JSON.parse(JSON.stringify(sold)),lastStatus:last,
    quantity:sold.reduce((sum,entry)=>sum+entry.quantity,0),
    isk:sold.reduce((sum,entry)=>sum+entry.isk,0)}:
   {status:"NOT_SOLD",reason:last};
 })().finally(()=>{
  // Keep the settled result readable for the next arrival tick only.
  const timer=setTimeout(()=>{if(arrivalSales.get(key)===job)arrivalSales.delete(key);},5000);
  if(typeof timer?.unref==="function")timer.unref();
 });
 return {status:"PENDING"};
}
// This is deliberately NOT an EveJS client RPC or HTTP admin endpoint.
// The caller must be trusted in-process server code providing a separately
// authenticated admin/RBAC decision for every inspection and mutation.
function createWarRecoveryAdmin({authorizeOperator}={}){
 if(process.env.EVEJS_COOP_WAR_RECOVERY_ADMIN!=="1")
  throw Error("WAR_RECOVERY_ADMIN_DISABLED");
 if(typeof authorizeOperator!=="function")
  throw Error("WAR_RECOVERY_AUTHORITY_MISSING");
 if(!warGateHandoff)throw Error("WAR_GATE_HANDOFF_NOT_INITIALIZED");
 return warGateHandoff.recovery({authorizeOperator});
}
function livingWorldPhases(){return worldPhaseCoordinator?.snapshot()||{active:false,sequence:0,last:null}}
module.exports={createWarRecoveryAdmin,start,observeSession,confirmedWreck,confirmedNativeNpcWreck,nextHeadlessRetryMs,isHeadlessNativeReady,alifeOrderArbitrationEnabled,sellOnArrival,nativeWarFleetRegistry,livingWorldPhases};
