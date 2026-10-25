"use strict";
// Optional background driver of virtual world; no NPC ships materialized.
let world=null,timer=null,combatTimer=null,bridge=null,gateTravelDirector=null,nativeGateTransfer=null,nativeMarketTrader=null,nativeMarketTickRunning=false,nativeMarketBlocked=false,economy=null,lossBridge=null,factionDirector=null,patrolDirector=null,patrolNavigator=null,civilianOrders=null,life=null,identityRegistry=null,raidDirector=null,tacticsDirector=null,activityDirector=null,combatEvidenceDirector=null,stockCombatEvidenceDirector=null;
const observedNpcIDs=new Set();
const visitedSystems=new Set();
const initializedNativeMiningScenes=new WeakSet();
let backgroundTicks=0,headlessBootTimer=null;
let intelAnnouncer=null,recognitionAnnouncer=null;
function safeNpcPhase(phase,run){
 try{return run();}
 catch(error){
  console.warn("[CoopLivingWorld] "+phase,error.message);
  try{require("./coopRuntimeProbe").observe("living-world-phase-failed",null,null,
   {phase,reason:String(error.message).slice(0,160)});}catch(_ignored){}
  return null;
 }
}
function syncNativeDeliveries(){
 if(!economy||process.env.EVEJS_COOP_NATIVE_HAUL_CARGO!=="1")return;
 const depot=require("./coopNativeDepot").getNativeDepot();
 const result=economy.syncNativeDeliveries(depot.snapshot().totals);
 if(result.quantity>0){
  console.info("[CoopLivingWorld] Real NPC ore delivered to virtual system supply",JSON.stringify(result));
  require("./coopRuntimeProbe").observe("living-real-ore-delivery",null,null,{
    quantity:result.quantity,systemTotals:depot.snapshot().totals
  });
 }
}
function start(){
 if(process.env.EVEJS_COOP_VIRTUAL_WORLD!=="1"||world)return;
 const route=String(process.env.EVEJS_COOP_VIRTUAL_ROUTE||"30000142,30000144").split(",").map(Number);
 const {createWorld}=require("./coopVirtualWorld");
 const nextWorld=createWorld({file:process.env.EVEJS_COOP_VIRTUAL_STATE_FILE||"/var/lib/evejs/coop-virtual-world.json",
   route,population:Number(process.env.EVEJS_COOP_VIRTUAL_POPULATION||16),
   travelMs:Number(process.env.EVEJS_COOP_VIRTUAL_TRAVEL_MS||120000),
   migrateFactions:process.env.EVEJS_COOP_FACTION_LAYOUT_V2==="1"});
 const {createLife}=require("./coopNpcLife");
 const nextLife=createLife({file:process.env.EVEJS_COOP_LIFE_FILE||"/var/lib/evejs/coop-npc-life.json",
  recoveryMs:Number(process.env.EVEJS_COOP_CLONE_RECOVERY_MS||1800000)});
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
 timer=setInterval(()=>{
  backgroundTicks++;
  safeNpcPhase("virtual-travel",()=>{
   // A real physical EveJS ship is pinned to its actual system.
   const pins={};
   if(bridge)for(const entry of bridge.snapshot())pins[entry.pilotID]=entry.systemID;
   if(identityRegistry)for(const [pilotID,entry] of Object.entries(identityRegistry.snapshot().links)){
    if(!pins[pilotID]&&identityRegistry.get(pilotID))pins[pilotID]=entry.systemID;
   }
   if(process.env.EVEJS_COOP_HEADLESS_WORLD_BOOT!=="1"||identityRegistry)
    world.advance(pins);
  });
  if(economy)safeNpcPhase("virtual-economy",()=>economy.advance(world.snapshot().pilots));
  safeNpcPhase("native-depot",syncNativeDeliveries);
  if(factionDirector&&economy)safeNpcPhase("faction",()=>factionDirector.advance(economy.snapshot().systems));
  safeNpcPhase("native-raids",advanceNativeRaids);
  safeNpcPhase("native-tactics",advanceNativeTactics);
  safeNpcPhase("native-gate-approach",advanceNativeGateApproach);
  safeNpcPhase("native-patrols",advanceNativePatrolRoutes);
  safeNpcPhase("npc-recognition",advanceNpcRecognition);
  safeNpcPhase("native-civilians",advanceNativeCivilianOrders);
  // Real NPC market RPC is async: explicitly handle rejection, never fire
  // overlapping economy transactions from the 30-second timer.
  if(process.env.EVEJS_COOP_NATIVE_NPC_MARKET==="1")
   safeNpcPhase("native-market-schedule",()=>{
    void advanceNativeMarket().catch(error=>console.warn("[CoopNativeMarket] tick",error.message));
   });
  safeNpcPhase("native-activity",observeNativeActivity);
  if(backgroundTicks%4===0&&process.env.EVEJS_COOP_MATERIALIZE_NPCS==="1")
   for(const systemID of visitedSystems)safeNpcPhase("npc-reconcile:"+systemID,
    ()=>observeSession(null,{itemID:0,spaceState:{systemID}}));
 },30000);
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
  warp:(id,point,options)=>npc.warpToPoint(id,point,options),
  orbit:(id,targetID,range)=>npc.orbit(id,targetID,range)
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
   warp:(entityID,gateID,options)=>npc.warpToEntity(entityID,gateID,options),
   getGate:id=>worldData.getStargateByID(id),
   transfer:nativeGateTransfer?nativeGateTransfer.transfer:null
  });
 }
 const roles=economy?.snapshot().pilots||{};
 const links=bridge.snapshot().filter(a=>a?.pilotID&&a.entityID);
 const blockedIDs=tacticsDirector?.activeIDs()||new Set();
 if(raidDirector)for(const id of raidDirector.activePirateIDs(system=>
  runtime.ensureScene(system,{refreshStargates:false})))blockedIDs.add(id);
 for(const systemID of visitedSystems){
  const scene=runtime.ensureScene(systemID,{refreshStargates:false});
  const assignments=links.filter(a=>Number(a.systemID)===Number(systemID));
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
function advanceNativePatrolRoutes(){
 if(!patrolDirector||!patrolNavigator||process.env.EVEJS_COOP_FACTION_PATROLS!=="1")return;
 for(const [systemID,entityIDs] of Object.entries(patrolDirector.snapshot())){
  const blockedIDs=gateTravelDirector?.activeIDs()||new Set();
  const result=patrolNavigator.tick(Number(systemID),entityIDs,{blockedIDs});
  if(result.orders?.length)console.info("[CoopFactionPatrol] native waypoint orders",JSON.stringify({systemID,orders:result.orders}));
 }
}
function ensureNativeMining(scene,systemID){
 if(process.env.EVEJS_COOP_NATIVE_MINING!=="1"||!scene||initializedNativeMiningScenes.has(scene))return;
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
  warp:(id,point,options)=>npc.warpToPoint(id,point,options),
  orbit:(id,targetID,range)=>npc.orbit(id,targetID,range)
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
function nativeMarketAllowlist(name){
 return [...new Set(String(process.env[name]||"").split(",").map(Number)
  .filter(x=>Number.isSafeInteger(x)&&x>0))].slice(0,20);
}
async function advanceNativeMarket(){
 if(process.env.EVEJS_COOP_NATIVE_NPC_MARKET!=="1"||
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
  if(!nativeMarketTrader){
   const {createNpcMarketTrader}=require("./coopNativeNpcMarket");
   const market=createNpcMarketTrader({
    call:(method,params)=>marketClient.call(method,params),
    store,registry:identityRegistry,getStation:id=>worldData.getStationByID(id),
    sceneForSystem:id=>runtime.ensureScene(id,{refreshStargates:false}),
    getController:id=>controllers.getControllerByEntityID(id),
    resolveType:id=>inventory.resolveItemByTypeID(id),
    maxQuantity:Math.max(1,Math.min(20,Number(process.env.EVEJS_COOP_NPC_MARKET_MAX_QTY||5))),
    maxPrice:Math.max(0.01,Math.min(1000000,Number(process.env.EVEJS_COOP_NPC_MARKET_MAX_PRICE||10000))),
    cooldownMs:Math.max(30000,Math.min(3600000,Number(process.env.EVEJS_COOP_NPC_MARKET_COOLDOWN_MS||300000)))
   });
   // A pending RPC of unknown outcome can never be retried automatically.
   const recovered=market.recover();
   if(recovered.status==="NEEDS_OPERATOR_REPAIR"){
    nativeMarketBlocked=true;
    require("./coopRuntimeProbe").observe("living-native-market-repair-required",null,null,recovered);
    return;
   }
   if(recovered.recovered)
    require("./coopRuntimeProbe").observe("living-native-market-recovered",null,null,recovered);
   nativeMarketTrader=market;
  }
  const roles=new Map(world.snapshot().pilots.map(p=>[p.id,p.role]));
  const blocked=tacticsDirector?.activeIDs()||new Set();
  if(gateTravelDirector)for(const id of gateTravelDirector.activeIDs())blocked.add(id);
  if(raidDirector)for(const id of raidDirector.activePirateIDs(id=>
   runtime.ensureScene(id,{refreshStargates:false})))blocked.add(id);
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
    if(!["trader","hauler"].includes(role)||blocked.has(Number(link.entityID)))continue;
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
    const nativeCargo=store.listNativeCargoForEntity(Number(link.entityID))||[];
    const ownedSellTypes=[...new Set(nativeCargo.filter(c=>Number(c.moduleID||0)===0&&
     c.singleton!==true&&Number(c.quantity)>0&&sellTypes.includes(Number(c.typeID)))
     .map(c=>Number(c.typeID)))];
    const tradeCandidates=[
     ...ownedSellTypes.map(typeID=>({side:"sell",typeID})),
     ...buyTypes.map(typeID=>({side:"buy",typeID}))
    ];
    for(const trade of tradeCandidates){
     const result=await nativeMarketTrader.execute({
      scene,pilotID:link.pilotID,entityID:Number(link.entityID),
      stationID:Number(station.itemID),
      ...trade,buyTypes,sellTypes
     });
     if(result.status==="TRADE_SETTLED"){
      completed++;
      require("./coopRuntimeProbe").observe("living-native-market-trade",null,
       {spaceState:{systemID}},result);
      break;
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
 const orders=civilianOrders.tick(assignments,economy?.snapshot().pilots||{},{blockedIDs});
 if(orders.length)console.info("[CoopVirtualWorld] native civilian work routes",JSON.stringify(orders));
 return orders;
}
function advanceNativeRaids(){
 if(process.env.EVEJS_COOP_NPC_RAIDS!=="1"||!bridge||!visitedSystems.size)return;
 const runtime=require("./runtime"),npc=require("./npc/npcRuntime");
 const mining=require("../services/mining/miningNpcOperations");
 const nativeStore=require("./npc/nativeNpcStore");
 const controllers=require("./npc/npcRegistry");
 if(!raidDirector){
  raidDirector=require("./coopNativeRaids").createRaids({
   warp:(pirateID,targetID,options)=>npc.warpToEntity(pirateID,targetID,options),
   attack:(pirateID,targetID,options)=>npc.issueAttackOrder(pirateID,targetID,options)
  });
 }
 const roles=economy?.snapshot().pilots||{};
 for(const systemID of visitedSystems){
  const pirates=bridge.snapshot().filter(p=>p.systemID===systemID&&roles[p.pilotID]?.role==="pirate")
   .map(x=>x.entityID);
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
  const canAttack=({pirateID,targetID})=>raidPolicy.isAuthorizedStockMiningRaid({
   systemID,attacker:scene.getEntityByID(pirateID),
   target:scene.getEntityByID(targetID),links:activeLinks,
   pilots:actualPilots,fleetShips
  });
  const result=raidDirector.tick({
   systemID,scene,pirates,fleetShips,canAttack,
   getCargo:id=>nativeStore.listNativeCargoForEntity(id),
   getController:id=>controllers.getControllerByEntityID(id)
  });
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
function advanceNativeTactics(){
 if(process.env.EVEJS_COOP_NATIVE_TACTICS!=="1"||!bridge||!visitedSystems.size)return;
 const runtime=require("./runtime"),npc=require("./npc/npcRuntime");
 const controllers=require("./npc/npcRegistry");
 const damage=require("./combat/damage"),scramble=require("./modules/hostileModuleRuntime");
 if(!tacticsDirector){
  tacticsDirector=require("./coopNpcTactics").createTactics({
   warpToPoint:(id,point,options)=>npc.warpToPoint(id,point,options),
   warpToEntity:(id,targetID,options)=>npc.warpToEntity(id,targetID,options),
   attack:(id,targetID,options)=>npc.issueAttackOrder(id,targetID,options),
   resumeBehavior:id=>npc.resumeBehavior(id),
   stopOrder:id=>npc.issueOrder(id,{type:"stop"}),
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
            const hostile=pilot.role==="pirate";
            return npc.spawnBatchInSystem(system,{
              ...anchor,amount:1,entityType:"npc",
              transient:process.env.EVEJS_COOP_DURABLE_NPC_SHIPS!=="1",
              broadcast:true,
              defaultPoolID:"npc_hostiles",fallbackProfileID:"generic_hostile",
              // Pirates retain native EveJS aggression. Civilians and ordinary
              // guards move and work without automatically attacking players.
              ...(hostile?{}:{behaviorOverrides:{
                autoAggro:false,autoActivateWeapons:false,targetPreference:"none"
              }})
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
              defaultPoolID:"npc_hostiles",fallbackProfileID:"generic_hostile",
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
module.exports={start,observeSession,confirmedWreck,confirmedNativeNpcWreck,nextHeadlessRetryMs,isHeadlessNativeReady};
