"use strict";
// Native-world gate. Never infer playable NPCs from virtual-resident counts,
// a healthy Docker server, transport-only sockets or isolated upstream tests.
const fs=require("node:fs");
const positive=x=>Number.isSafeInteger(Number(x))&&Number(x)>0?Number(x):null;
function summarize(input,{now=Date.now(),windowMinutes=20}={}){
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
 const topology=[...rows].reverse().find(e=>e.event==="living-world-topology"&&positive(e.systemID));
 const systemID=positive(topology?.systemID);
 const related=rows.filter(e=>systemID&&positive(e.systemID)===systemID&&e._time>=topology._time-1000);
 const headless=[...rows].reverse().find(e=>e.event==="living-headless-boot-system"&&positive(e.systemID)===systemID);
 const industry=[...related].reverse().find(e=>e.event==="living-native-industry"&&Array.isArray(e.fleets));
 const materialization=[...related].reverse().find(e=>e.event==="virtual-world-materialization"&&Array.isArray(e.livingShips));
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
 return {status,systemID,topologyAt:topology?.at||null,
  evidenceSource:topology?.evidenceSource||"UNSPECIFIED_NATIVE_SCENE",
  headlessBootStatus:headless?.status||null,
  evidenceWindowMinutes:windowMinutes,scenery,
  actualMiningFleets:realFleets.length,actualMinerShips:minerShips,
  actualHaulerShips:haulerShips,
  physicalNpcShipAssignments:Object.values(roles).reduce((a,b)=>a+b,0),
  physicalNpcRoles:roles,oreOnRealHaulers:realFleets.reduce((n,f)=>n+Math.max(0,Number(f.loadedHaulerOreQuantity)||0),0),
  invalidLogLines:invalid,blockers,
  limits:[
   "Server-side actual EveJS scene observations only; headless evidence does not imply a game client has logged in.",
   "Does not prove client rendering, real mining laser behavior, damage/loot, second-client login or friend-PC networking."
  ]};
}
if(require.main===module){
 try{
  const args=process.argv.slice(2),p=args.indexOf("--window-minutes");
  const minutes=p>=0?Number(args[p+1]):20;
  if(!Number.isInteger(minutes)||minutes<1||minutes>240)throw Error("--window-minutes must be 1..240");
  const report=summarize(fs.readFileSync(0,"utf8"),{windowMinutes:minutes});
  console.log(JSON.stringify(report,null,2));
  if(report.status!=="READY_FOR_CLIENT_PLAYTEST")process.exitCode=2;
 }catch(error){console.error("Living world verification failed:",error.message);process.exitCode=1;}
}
module.exports={summarize};
