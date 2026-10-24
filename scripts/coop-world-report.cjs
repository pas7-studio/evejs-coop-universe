"use strict";
// Native-world gate. Never infer playable NPCs from virtual-resident counts,
// a healthy Docker server, transport-only sockets or isolated upstream tests.
const fs=require("node:fs");
const positive=x=>Number.isSafeInteger(Number(x))&&Number(x)>0?Number(x):null;
function summarize(input,{now=Date.now(),windowMinutes=20,requireActivity=false,requireCombat=false,requireWeapon=false,requireFinalAttacker=false,requireMarket=false,requireStockRaid=false,requireStockWreckLoot=false,systemID:requestedSystemID=null}={}){
 const after=now-windowMinutes*60000;
 const rows=[];
 let invalid=0;
 for(const line of String(input).split(/\r?\n/)){
  if(!line.trim())continue;
  try{
   const event=JSON.parse(line),time=Date.parse(event.at);
   if(!Number.isFinite(time)||time<after||time>now+60000)continue;
   rows.push({...event,_time:time});
  }catch{invalid++;}
 }
 rows.sort((a,b)=>a._time-b._time);
 const latestBoot=[...rows].reverse().find(e=>e.event==="living-headless-boot-requested");
 const targetID=positive(requestedSystemID);
 const topology=[...rows].reverse().find(e=>e.event==="living-world-topology"&&positive(e.systemID)&&
  (!targetID||positive(e.systemID)===targetID)&&
  (!latestBoot||e._time>=latestBoot._time));
 const systemID=targetID||positive(topology?.systemID);
 const related=rows.filter(e=>systemID&&topology&&positive(e.systemID)===systemID&&e._time>=topology._time-1000);
 const headless=[...rows].reverse().find(e=>e.event==="living-headless-boot-system"&&positive(e.systemID)===systemID&&(!latestBoot||e._time>=latestBoot._time));
 const headlessAttempt=[...rows].reverse().find(e=>e.event==="living-headless-boot-attempt"&&
  (!latestBoot||e._time>=latestBoot._time));
 const durableRecovery=[...rows].reverse().find(e=>
  e.event==="living-native-durable-recovery"&&
  (!latestBoot||e._time>=latestBoot._time));
 const industry=[...related].reverse().find(e=>e.event==="living-native-industry"&&Array.isArray(e.fleets));
 const materialization=[...related].reverse().find(e=>e.event==="virtual-world-materialization"&&Array.isArray(e.livingShips));
 const siteReadiness=[...rows].reverse().find(e=>e.event==="living-native-system-site-readiness"&&
  positive(e.systemID)===systemID&&(!latestBoot||e._time>=latestBoot._time));
 const presentationPending=[...rows].reverse().find(e=>e.event==="living-native-presentation-pending"&&
  positive(e.systemID)===systemID&&(!latestBoot||e._time>=latestBoot._time));
 const spawnAttempt=[...rows].reverse().find(e=>e.event==="living-native-materialization-attempt"&&
  positive(e.systemID)===systemID&&(!latestBoot||e._time>=latestBoot._time));
 const miningStartupEvents=rows.filter(e=>e.event==="living-native-mining-startup-slot"&&
  positive(e.systemID)===systemID&&(!latestBoot||e._time>=latestBoot._time));
 const latestMiningStartup=miningStartupEvents.at(-1)||null;
 const availableMiningSystems=[...new Map(rows.filter(e=>e.event==="living-world-topology"&&
  positive(e.systemID)&&(!latestBoot||e._time>=latestBoot._time))
  .map(e=>[positive(e.systemID),e])).values()]
  .filter(e=>Number(e.realAsteroidBelts)>0).map(e=>positive(e.systemID)).sort((a,b)=>a-b);
 // Activity may precede a fresh topology refresh. Restrict it to the
 // current server boot, never borrow evidence from a previous process.
 const activitySamples=rows.filter(e=>systemID&&positive(e.systemID)===systemID&&
  e.event==="living-native-activity"&&e.status==="SAMPLED"&&
  (!latestBoot||e._time>=latestBoot._time));
 // Movement and cargo growth must be measured between two native scene
 // samples; a flag, controller order or stationary ship cannot fake them.
 const activity={
  samples:activitySamples.length,
  movedShips:activitySamples.reduce((n,e)=>n+Math.max(0,Number(e.observedMovement)||0),0),
  oreGrowth:activitySamples.reduce((n,e)=>n+Math.max(0,Number(e.oreGrowth)||0),0),
  targetingSamples:activitySamples.reduce((n,e)=>n+Math.max(0,Number(e.engagedNativeNpcs)||0),0),
  lastPhysicalNpcShips:Math.max(0,Number(activitySamples.at(-1)?.physicalNpcShips)||0)
 };
 activity.status=activity.movedShips>0&&(activity.oreGrowth>0||activity.targetingSamples>0)
  ?"MOVEMENT_AND_INTERACTION_OBSERVED":activity.movedShips||activity.oreGrowth||activity.targetingSamples
  ?"PARTIAL_NATIVE_ACTIVITY":"NO_PHYSICAL_ACTIVITY_EVIDENCE";
 const combatRows=rows.filter(e=>systemID&&positive(e.systemID)===systemID&&
  (!latestBoot||e._time>=latestBoot._time));
 const damage= combatRows.filter(e=>e.event==="living-native-combat-damage")
  .flatMap(row=>(Array.isArray(row.events)?row.events:[])
   .filter(e=>positive(e.victimEntityID)&&positive(e.systemID)===systemID&&
    /^coop-pilot-[0-9]{3,}$/.test(String(e.victimPilotID||""))&&
    Number(e.healthLossHP)>0&&Array.isArray(e.attackerPilotIDs)&&
    e.attackerPilotIDs.some(x=>/^coop-pilot-[0-9]{3,}$/.test(String(x))))
   .map(e=>({...e,_observedAt:row._time})));
 const weapons=combatRows.filter(e=>e.event==="living-native-weapon-event"&&
  e.status==="VERIFIED_NATIVE_WEAPON_EVENT"&&
  (e.kind==="missile-launch"||e.kind==="module-activation")&&
  positive(e.attackerEntityID)&&positive(e.victimEntityID)&&
  /^coop-pilot-[0-9]{3,}$/.test(String(e.attackerPilotID||""))&&
  /^coop-pilot-[0-9]{3,}$/.test(String(e.victimPilotID||"")));
 const linkedWeaponDamage=damage.filter(d=>weapons.some(w=>
  Number(w.victimEntityID)===Number(d.victimEntityID)&&
  w.victimPilotID===d.victimPilotID&&
  d.attackerPilotIDs.includes(w.attackerPilotID)&&
  (!Array.isArray(d.attackerEntityIDs)||
   d.attackerEntityIDs.includes(Number(w.attackerEntityID)))&&
  w._time<=d._observedAt&&
  d._observedAt-w._time<=10*60000));
 const wrecks=combatRows.filter(e=>e.event==="living-native-wreck-evidence"&&
  e.status==="PHYSICAL_NATIVE_WRECK_VERIFIED"&&positive(e.wreckID)&&
  positive(e.victimEntityID)&&
  /^coop-pilot-[0-9]{3,}$/.test(String(e.victimPilotID||"")));
 const matched=wrecks.find(w=>damage.some(d=>
  Number(d.victimEntityID)===Number(w.victimEntityID)&&
  d.victimPilotID===w.victimPilotID&&
  d._observedAt<=w._time&&w._time-d._observedAt<=10*60000));
 const nativeWeaponChain=wrecks.find(w=>w.lootStatus==="ITEMS_STORED"&&Number(w.storedItemCount)>0&&
  linkedWeaponDamage.some(d=>Number(d.victimEntityID)===Number(w.victimEntityID)&&
   d.victimPilotID===w.victimPilotID&&
   d._observedAt<=w._time&&w._time-d._observedAt<=10*60000));
 // Only the native destruction call's explicit attackerEntity parameter
 // may qualify as upstream attribution. A recent lock or weapon event is
 // not a substitute if EveJS omits that parameter.
 const upstreamAttackers=combatRows.filter(e=>
  e.event==="living-native-destruction-attacker"&&
  e.status==="NATIVE_DESTRUCTION_ATTACKER_PROVIDED"&&
  positive(e.wreckID)&&positive(e.attackerEntityID)&&positive(e.victimEntityID)&&
  /^coop-pilot-[0-9]{3,}$/.test(String(e.attackerPilotID||""))&&
  /^coop-pilot-[0-9]{3,}$/.test(String(e.victimPilotID||"")));
 const nativeAttackerChain=upstreamAttackers.find(e=>wrecks.some(w=>
  Number(w.wreckID)===Number(e.wreckID)&&
  Number(w.victimEntityID)===Number(e.victimEntityID)&&
  w.victimPilotID===e.victimPilotID&&
  w.lootStatus==="ITEMS_STORED"&&Number(w.storedItemCount)>0)&&
  linkedWeaponDamage.some(d=>
   Number(d.victimEntityID)===Number(e.victimEntityID)&&
   d.victimPilotID===e.victimPilotID&&
   d.attackerPilotIDs.includes(e.attackerPilotID)&&
   (!Array.isArray(d.attackerEntityIDs)||
    d.attackerEntityIDs.includes(Number(e.attackerEntityID)))&&
   d._observedAt<=e._time&&e._time-d._observedAt<=10*60000)&&
  weapons.some(w=>
   w.attackerPilotID===e.attackerPilotID&&
   Number(w.attackerEntityID)===Number(e.attackerEntityID)&&
   Number(w.victimEntityID)===Number(e.victimEntityID)&&
   w._time<=e._time&&e._time-w._time<=10*60000));
 const combat={
  upstreamAttackerEvents:upstreamAttackers.length,
  nativeAttackerChainWreckID:nativeAttackerChain?.wreckID||null,
  nativeAttackerPilotID:nativeAttackerChain?.attackerPilotID||null,
  witnessedNativeWeaponEvents:weapons.length,
  weaponCorrelatedDamageEvents:linkedWeaponDamage.length,
  nativeWeaponDamageWreckLootID:nativeWeaponChain?.wreckID||null,
  observedNpcOnNpcDamage:damage.length,physicalWrecks:wrecks.length,
  storedLootWrecks:wrecks.filter(w=>w.lootStatus==="ITEMS_STORED"&&Number(w.storedItemCount)>0).length,
  matchingWreckID:matched?.wreckID||null,
  // A target lock is not authoritative killer attribution; real hits and
  // physical wreck plus stored loot are facts, not proof of the specific shooter.
  status:matched?.lootStatus==="ITEMS_STORED"&&Number(matched.storedItemCount)>0
   ?"CORRELATED_DAMAGE_WRECK_AND_LOOT":
   matched?"CORRELATED_DAMAGE_WITH_EMPTY_WRECK":
   damage.length&&wrecks.length?"UNMATCHED_DAMAGE_AND_WRECK":
   damage.length?"DAMAGE_ONLY":wrecks.length?"WRECK_ONLY":"NO_NPC_COMBAT_EVIDENCE"
 };
 // Only the native market adapter's settled proof can qualify. A virtual
 // ISK change, projected NPC identity or raw order-book row is not a trade.
 const nativeTrades=rows.filter(e=>e.event==="living-native-market-trade"&&
  e.status==="TRADE_SETTLED"&&e.marketOrderSource==="EVEJS_SEED"&&
  e.nativeCargoVerified===true&&e.marketRPCAcknowledged===true&&
  positive(e.systemID)&&/^coop-pilot-[0-9]{3,}$/.test(String(e.pilotID||""))&&
  positive(e.entityID)&&positive(e.stationID)&&positive(e.typeID)&&
  Number.isInteger(Number(e.quantity))&&Number(e.quantity)>0&&
  Number(e.price)>0&&Number.isFinite(Number(e.price))&&
  /^[0-9]+$/.test(String(e.marketOrderID||""))&&
  ((e.side==="sell"&&e.marketRPC==="FillOrder")||
   (e.side==="buy"&&e.marketRPC==="AdjustSeedStock"))&&
  (!latestBoot||e._time>=latestBoot._time));
 const nativeSystemTrades=nativeTrades.filter(e=>e.systemID===systemID);
 const nativeSell=nativeSystemTrades.filter(e=>e.side==="sell");
 const nativeBuy=nativeSystemTrades.filter(e=>e.side==="buy");
 const chain=nativeBuy.find(b=>nativeSell.some(s=>
  s.pilotID===b.pilotID&&Number(s.entityID)===Number(b.entityID)&&
  s._time<=b._time&&b._time-s._time<=60*60000));
 // Native weapon + measured native HP loss for named pirate versus
 // genuine but unnamed stock miner/hauler, NOT a claim of a kill.
 const stockWeapons=rows.filter(e=>e.event==="living-native-weapon-event"&&
  e.status==="VERIFIED_NATIVE_STOCK_FLEET_WEAPON_EVENT"&&
  positive(e.systemID)===systemID&&positive(e.attackerEntityID)&&
  positive(e.victimEntityID)&&/^coop-pilot-[0-9]{3,}$/.test(String(e.attackerPilotID||""))&&
  (!latestBoot||e._time>=latestBoot._time));
 const stockDamage=rows.filter(e=>e.event==="living-native-stock-fleet-combat"&&
  positive(e.systemID)===systemID&&(!latestBoot||e._time>=latestBoot._time))
  .flatMap(e=>(e.events||[]).filter(d=>positive(d.victimEntityID)&&
    Number(d.healthLossHP)>0&&Array.isArray(d.attackerPilotIDs)&&
    d.attackerPilotIDs.length>0).map(d=>({...d,_time:e._time})));
 const pairedStock=stockDamage.find(d=>stockWeapons.some(w=>
  Number(w.victimEntityID)===Number(d.victimEntityID)&&
  d.attackerPilotIDs.includes(w.attackerPilotID)&&
  (!Array.isArray(d.attackerEntityIDs)||
   d.attackerEntityIDs.includes(Number(w.attackerEntityID)))&&
  w._time<=d._time&&d._time-w._time<=10*60000));
 const stockWrecks=rows.filter(e=>e.event==="living-native-stock-fleet-wreck-evidence"&&
  e.status==="PHYSICAL_NATIVE_STOCK_FLEET_WRECK_VERIFIED"&&
  positive(e.systemID)===systemID&&positive(e.victimEntityID)&&
  positive(e.wreckID)&&(!latestBoot||e._time>=latestBoot._time));
 const matchedStockWreck=stockWrecks.find(w=>pairedStock&&
  Number(w.victimEntityID)===Number(pairedStock.victimEntityID)&&
  w._time>=pairedStock._time&&w._time-pairedStock._time<=10*60000);
 const stockLootWreck=matchedStockWreck?.lootStatus==="ITEMS_STORED"&&
  Number(matchedStockWreck.storedItemCount)>0?matchedStockWreck:null;
 const stockRaid={
  verifiedNativeWeaponEvents:stockWeapons.length,
  measuredStockFleetHpLossEvents:stockDamage.length,
  correlatedVictimEntityID:pairedStock?.victimEntityID||null,
  actualPhysicalWrecks:stockWrecks.length,
  correlatedPhysicalWreckID:matchedStockWreck?.wreckID||null,
  correlatedWreckWithStoredLootID:stockLootWreck?.wreckID||null,
  status:stockLootWreck?"CORRELATED_STOCK_WEAPON_HP_WRECK_AND_STORED_LOOT":
   pairedStock?"CORRELATED_STOCK_FLEET_WEAPON_AND_HP_LOSS":
   stockDamage.length?"STOCK_FLEET_HP_LOSS_ONLY":
   stockWeapons.length?"STOCK_FLEET_WEAPON_ONLY":"NO_STOCK_FLEET_PVE_EVIDENCE",
  limits:"Real native weapon launch/activation and measured hull HP loss. No wreck, killer, loot or client evidence inferred"
 };
 const market={
  settledTrades:nativeSystemTrades.length,
  nativeSeedSales:nativeSell.length,
  nativeSeedPurchases:nativeBuy.length,
  sellThenBuyPilotID:chain?.pilotID||null,
  status:chain?"NATIVE_SEED_SALE_AND_PURCHASE_VERIFIED":
   nativeSell.length?"NATIVE_SEED_SALE_ONLY":
   nativeBuy.length?"NATIVE_SEED_PURCHASE_ONLY":"NO_NATIVE_MARKET_TRADE"
 };
 const realFleets=industry?.fleets||[];
 const minerShips=realFleets.reduce((sum,f)=>sum+(f.minerIDs?.length||0),0);
 const haulerShips=realFleets.reduce((sum,f)=>sum+(f.haulerIDs?.length||0),0);
 const roles=(materialization?.livingShips||[]).reduce((map,x)=>{
  const role=String(x?.role||"unknown");
  if(positive(x?.entityID))map[role]=(map[role]||0)+1;
  return map;
 },{});
 const scenery={
  waypoints:Math.max(0,Number(topology?.realWaypoints)||0),
  asteroidBelts:Math.max(0,Number(topology?.realAsteroidBelts)||0),
  stargates:Math.max(0,Number(topology?.realStargates)||0),
  stations:Math.max(0,Number(topology?.realStations)||0)
 };
 let status="AWAITING_INGAME_ARRIVAL";
 const blockers=[];
 if(!topology)blockers.push("No native topology evidence. Start LivingCoop headless world boot or enter space with a real permitted EVE client; TCP reconnect is insufficient.");
 else {
  if(!scenery.waypoints){
   blockers.push("The target system has no authoritative static waypoints; inspect its real EveJS scene generation.");
   status="MISSING_NATIVE_WORLD_DATA";
  }else if(!scenery.asteroidBelts){
   blockers.push(siteReadiness?.status==="SDE_SYSTEM_HAS_NO_BELTS"?
    "This system legitimately has zero SDE asteroid belts (Jita is a trade hub). Select a real belt-bearing system, e.g. -WorldSystemID 30000144 for Perimeter; no synthetic belts will be spawned.":
    "The target scene has no real asteroid belts; compare system-specific SDE belt count with physical scene count.");
   status=siteReadiness?.status==="SDE_SYSTEM_HAS_NO_BELTS"?"SYSTEM_HAS_NO_NATIVE_MINING_BELTS":"MISSING_NATIVE_WORLD_DATA";
  }else if(!industry||minerShips<1||haulerShips<1){
   const startup=siteReadiness?.stockMiningStartup;
   const explanation=startup&&startup.status!=="MINING_STARTUP_ELIGIBLE"?
    " Stock mining startup policy: "+startup.status+
    " (enabled="+String(startup.startupEnabled)+
    ", includesSystem="+String(startup.startupSystemIncluded)+").":"";
   const nativeFailure=latestMiningStartup?.status==="FAILED"?
    " Last EveJS native fleet spawn failure (slot "+latestMiningStartup.fleetSlot+
     "): "+String(latestMiningStartup.error||"UNKNOWN").slice(0,120)+".":"";
   const lastSeeded=latestMiningStartup?.status==="SEEDED"?
    " A startup slot was seeded earlier but no complete physical miner/hauler fleet is visible now.":"";
   blockers.push("No physical EveJS miner and hauler fleet observed in this solar system."+
    explanation+nativeFailure+lastSeeded);
   status="NO_NATIVE_MINING_FLEET";
  }else if(!materialization||!Object.values(roles).some(n=>n>0)){
   const details=spawnAttempt?.spawnErrors?.length?
    " Native spawn failures: "+spawnAttempt.spawnErrors.map(x=>
     x.pilotID+":"+x.error+(x.nativeReason?" ("+x.nativeReason+")":"")+
     (x.error==="SPAWN_LIMIT_REACHED"?" ["+x.occupied+"/"+x.limit+"]":"")
    ).join("; "):
    spawnAttempt?" Native pilot attempts: residents="+spawnAttempt.residents+
     " eligible="+spawnAttempt.eligibleResidents+
     " candidateSpawns="+spawnAttempt.requestedSpawns+
     " successes="+spawnAttempt.successfulAssignments+
     " stockFleetShips="+spawnAttempt.miningFleetShips+".":" No materializer-attempt event yet.";
   blockers.push("No real named NPC assignment observed in this authoritative EveJS scene."+details);
   status="NO_LIVING_NPC_SHIPS";
  }else status="READY_FOR_CLIENT_PLAYTEST";
 }
 // Combat is an independent native-world gate: miner+hauler economic
 // readiness is not a prerequisite for combat between two other named NPCs.
 // It still requires actual authoritative scene topology and the strict
 // source-weapon -> HP -> physical wreck -> stored loot evidence below.
 if(requireCombat||requireWeapon||requireFinalAttacker||requireMarket||requireStockRaid||requireStockWreckLoot){
  if(topology&&scenery.waypoints>0){
   status="READY_FOR_CLIENT_PLAYTEST";
   blockers.length=0;
  }
 }
 if(requireStockRaid&&status==="READY_FOR_CLIENT_PLAYTEST"&&!pairedStock){
  status="AWAITING_STOCK_FLEET_WEAPON_HP_CHAIN";
  blockers.push("No native pirate missile launch or weapon activation matched a measured HP drop on the same real stock mining fleet ship. Attack orders and target locks alone do not prove damage.");
 }
 if(requireStockWreckLoot&&status==="READY_FOR_CLIENT_PLAYTEST"&&!stockLootWreck){
  status="AWAITING_STOCK_FLEET_WRECK_LOOT_CHAIN";
  blockers.push("No physical EveJS stock miner wreck with nonempty persisted loot correlated to native pirate weapon activation and measured HP loss on the same real victim. An attack order, empty wreck or fabricated inventory is insufficient.");
 }
 if(requireFinalAttacker&&status==="READY_FOR_CLIENT_PLAYTEST"&&!nativeAttackerChain){
  status="AWAITING_UPSTREAM_DESTRUCTION_ATTACKER";
  blockers.push("No matching explicit attackerEntity from native EveJS wreck creation joined to the same attacker/victim weapon, HP loss, real wreck and stored loot. Target selection is not final-blow identity.");
 }
 if(requireWeapon&&status==="READY_FOR_CLIENT_PLAYTEST"&&!nativeWeaponChain){
  status="AWAITING_NATIVE_WEAPON_CHAIN";
  blockers.push("No verified native NPC weapon activation or missile launch linked to same-victim HP loss, physical wreck and persisted loot. This does not certify final-hit attribution.");
 }
 if(requireCombat&&status==="READY_FOR_CLIENT_PLAYTEST"&&
    combat.status!=="CORRELATED_DAMAGE_WRECK_AND_LOOT"){
  status="AWAITING_NPC_COMBAT_LOOT";
  blockers.push("No matching same-victim native NPC-on-NPC HP drop, physical wreck and persisted loot items observed. A target lock alone is insufficient.");
 }
 if(requireMarket&&status==="READY_FOR_CLIENT_PLAYTEST"&&!chain){
  status="AWAITING_NATIVE_MARKET_TRADE";
  blockers.push("No matching physically settled native NPC sale into EveJS seed demand followed by an actual stock purchase with the same ship and earned ISK.");
 }
 if(requireActivity&&status==="READY_FOR_CLIENT_PLAYTEST"&&
    activity.status!=="MOVEMENT_AND_INTERACTION_OBSERVED"){
  status="AWAITING_NATIVE_ACTIVITY";
  blockers.push("Physical NPC ships are present, but genuine movement AND cargo growth or active native targeting have not both been observed across native snapshots.");
 }
 // A corrupt durable NPC record is a safety-critical blocker even if
 // mining activity or a separate combat/market gate otherwise passed.
 if(durableRecovery?.status==="NEEDS_OPERATOR_REPAIR"){
  status="BLOCKED_DURABLE_NPC_RECOVERY";
  blockers.unshift("Persistent named NPC cannot be restored safely: "+
   (durableRecovery.errors||[]).slice(0,5).map(x=>
    String(x.pilotID||"unknown")+":"+String(x.reason||"UNKNOWN")
   ).join("; ")+". Preserve evejs-data and the co-op registry; operator repair required.");
 }
 return {status,systemID,topologyAt:topology?.at||null,
  evidenceSource:topology?.evidenceSource||"UNSPECIFIED_NATIVE_SCENE",
  headlessBootStatus:headless?.status||null,
  headlessAttemptCount:Math.max(0,Number(headlessAttempt?.attempt)||0),
  headlessPendingSystems:headlessAttempt?.pendingSystems||[],
  nativeDurableRecovery:durableRecovery?{
   status:durableRecovery.status,
   recovered:Number(durableRecovery.recovered)||0,
   alreadyPhysical:Number(durableRecovery.alreadyPhysical)||0,
   legacyTransient:Number(durableRecovery.legacyTransient)||0,
   confirmedLosses:Number(durableRecovery.confirmedLosses)||0,
   errors:durableRecovery.errors||[]}:null,
  evidenceWindowMinutes:windowMinutes,scenery,activity,combat,market,stockRaid,
  systemSiteReadiness:siteReadiness?{
   status:siteReadiness.status,authoritativeSdeBelts:siteReadiness.authoritativeSdeBelts,
   realAsteroidBelts:siteReadiness.realAsteroidBelts,
   trackingForReconcile:siteReadiness.trackingForReconcile===true,
   stockMiningStartup:siteReadiness.stockMiningStartup||null}:null,
  nativeMiningStartupOutcome:latestMiningStartup?{
   status:latestMiningStartup.status,fleetSlot:latestMiningStartup.fleetSlot,
   ...(latestMiningStartup.error?{error:latestMiningStartup.error}:{}),
   ...(latestMiningStartup.miners!==undefined?{miners:latestMiningStartup.miners}:{}),
   ...(latestMiningStartup.haulers!==undefined?{haulers:latestMiningStartup.haulers}:{})
  }:null,
  nativePresentationPending:presentationPending?.unresolved||[],
  nativeMaterializerAttempt:spawnAttempt?{
   residents:spawnAttempt.residents,eligibleResidents:spawnAttempt.eligibleResidents,
   requestedSpawns:spawnAttempt.requestedSpawns,
   successfulAssignments:spawnAttempt.successfulAssignments,
   spawnErrors:spawnAttempt.spawnErrors||[],
   miningFleetShips:spawnAttempt.miningFleetShips,
   linkedIndustryPilots:spawnAttempt.linkedIndustryPilots}:null,
  availableMiningSystems,
  actualMiningFleets:realFleets.length,actualMinerShips:minerShips,
  actualHaulerShips:haulerShips,
  physicalNpcShipAssignments:Object.values(roles).reduce((a,b)=>a+b,0),
  physicalNpcRoles:roles,oreOnRealHaulers:realFleets.reduce((n,f)=>n+Math.max(0,Number(f.loadedHaulerOreQuantity)||0),0),
  invalidLogLines:invalid,blockers,
  limits:[
   "Server-side actual EveJS scene observations only; headless evidence does not imply a game client has logged in.",
   "Correlated NPC controller target and HP loss do not identify the actual killer without native damage attribution.",
   "Native active targeting is not proof of weapon damage, destroyed ships or real player/NPC combat.",
   "NPC market gate verifies existing EveJS seed-order trades only; independent player-compatible NPC order ownership, wallet and escrow still need implementation.",
   "Does not prove client rendering, real mining laser behavior, damage/loot, second-client login or friend-PC networking."
  ]};
}
if(require.main===module){
 try{
  const args=process.argv.slice(2),p=args.indexOf("--window-minutes");
  const minutes=p>=0?Number(args[p+1]):20;
  if(!Number.isInteger(minutes)||minutes<1||minutes>240)throw Error("--window-minutes must be 1..240");
  const sysParam=args.indexOf("--system-id");
  const selected=sysParam>=0?Number(args[sysParam+1]):null;
  if(sysParam>=0&&!(positive(selected)))throw Error("--system-id must be positive integer");
  const report=summarize(fs.readFileSync(0,"utf8"),{
   systemID:selected,windowMinutes:minutes,requireActivity:args.includes("--require-activity"),
   requireCombat:args.includes("--require-combat"),requireWeapon:args.includes("--require-weapon"),
   requireFinalAttacker:args.includes("--require-final-attacker"),
   requireMarket:args.includes("--require-market"),
   requireStockRaid:args.includes("--require-stock-raid"),
   requireStockWreckLoot:args.includes("--require-stock-wreck-loot")
  });
  console.log(JSON.stringify(report,null,2));
  if(report.status!=="READY_FOR_CLIENT_PLAYTEST")process.exitCode=2;
 }catch(error){console.error("Living world verification failed:",error.message);process.exitCode=1;}
}
module.exports={summarize};
