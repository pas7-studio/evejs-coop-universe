"use strict";
// Native-world gate. Never infer playable NPCs from virtual-resident counts,
// a healthy Docker server, transport-only sockets or isolated upstream tests.
const fs=require("node:fs");
const positive=x=>Number.isSafeInteger(Number(x))&&Number(x)>0?Number(x):null;
function summarize(input,{now=Date.now(),windowMinutes=20,requireActivity=false,requireCombat=false}={}){
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
 const topology=[...rows].reverse().find(e=>e.event==="living-world-topology"&&positive(e.systemID)&&
  (!latestBoot||e._time>=latestBoot._time));
 const systemID=positive(topology?.systemID);
 const related=rows.filter(e=>systemID&&positive(e.systemID)===systemID&&e._time>=topology._time-1000);
 const headless=[...rows].reverse().find(e=>e.event==="living-headless-boot-system"&&positive(e.systemID)===systemID&&(!latestBoot||e._time>=latestBoot._time));
 const industry=[...related].reverse().find(e=>e.event==="living-native-industry"&&Array.isArray(e.fleets));
 const materialization=[...related].reverse().find(e=>e.event==="virtual-world-materialization"&&Array.isArray(e.livingShips));
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
    Number(e.healthLossHP)>0&&Array.isArray(e.attackerPilotIDs)&&
    e.attackerPilotIDs.some(x=>/^coop-pilot-[0-9]{3,}$/.test(String(x))))
   .map(e=>({...e,_observedAt:row._time})));
 const wrecks=combatRows.filter(e=>e.event==="living-native-wreck-evidence"&&
  e.status==="PHYSICAL_NATIVE_WRECK_VERIFIED"&&positive(e.wreckID)&&
  positive(e.victimEntityID));
 const matched=wrecks.find(w=>damage.some(d=>
  Number(d.victimEntityID)===Number(w.victimEntityID)&&
  d._observedAt<=w._time&&w._time-d._observedAt<=10*60000));
 const combat={
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
  if(!scenery.waypoints||!scenery.asteroidBelts){
   blockers.push("The authoritative runtime scene has no real mining belt/waypoints. Check database generation and static reference data.");
   status="MISSING_NATIVE_WORLD_DATA";
  }else if(!industry||minerShips<1||haulerShips<1){
   blockers.push("No physical EveJS miner and hauler fleet observed in this solar system.");
   status="NO_NATIVE_MINING_FLEET";
  }else if(!materialization||!Object.values(roles).some(n=>n>0)){
   blockers.push("No real NPC ship assignment observed in a physical EveJS scene.");
   status="NO_LIVING_NPC_SHIPS";
  }else status="READY_FOR_CLIENT_PLAYTEST";
 }
 if(requireCombat&&status==="READY_FOR_CLIENT_PLAYTEST"&&
    combat.status!=="CORRELATED_DAMAGE_WRECK_AND_LOOT"){
  status="AWAITING_NPC_COMBAT_LOOT";
  blockers.push("No matching same-victim native NPC-on-NPC HP drop, physical wreck and persisted loot items observed. A target lock alone is insufficient.");
 }
 if(requireActivity&&status==="READY_FOR_CLIENT_PLAYTEST"&&
    activity.status!=="MOVEMENT_AND_INTERACTION_OBSERVED"){
  status="AWAITING_NATIVE_ACTIVITY";
  blockers.push("Physical NPC ships are present, but genuine movement AND cargo growth or active native targeting have not both been observed across native snapshots.");
 }
 return {status,systemID,topologyAt:topology?.at||null,
  evidenceSource:topology?.evidenceSource||"UNSPECIFIED_NATIVE_SCENE",
  headlessBootStatus:headless?.status||null,
  evidenceWindowMinutes:windowMinutes,scenery,activity,combat,
  actualMiningFleets:realFleets.length,actualMinerShips:minerShips,
  actualHaulerShips:haulerShips,
  physicalNpcShipAssignments:Object.values(roles).reduce((a,b)=>a+b,0),
  physicalNpcRoles:roles,oreOnRealHaulers:realFleets.reduce((n,f)=>n+Math.max(0,Number(f.loadedHaulerOreQuantity)||0),0),
  invalidLogLines:invalid,blockers,
  limits:[
   "Server-side actual EveJS scene observations only; headless evidence does not imply a game client has logged in.",
   "Correlated NPC controller target and HP loss do not identify the actual killer without native damage attribution.",
   "Native active targeting is not proof of weapon damage, destroyed ships or real player/NPC combat.",
   "Does not prove client rendering, real mining laser behavior, damage/loot, second-client login or friend-PC networking."
  ]};
}
if(require.main===module){
 try{
  const args=process.argv.slice(2),p=args.indexOf("--window-minutes");
  const minutes=p>=0?Number(args[p+1]):20;
  if(!Number.isInteger(minutes)||minutes<1||minutes>240)throw Error("--window-minutes must be 1..240");
  const report=summarize(fs.readFileSync(0,"utf8"),{
   windowMinutes:minutes,requireActivity:args.includes("--require-activity"),
   requireCombat:args.includes("--require-combat")
  });
  console.log(JSON.stringify(report,null,2));
  if(report.status!=="READY_FOR_CLIENT_PLAYTEST")process.exitCode=2;
 }catch(error){console.error("Living world verification failed:",error.message);process.exitCode=1;}
}
module.exports={summarize};
