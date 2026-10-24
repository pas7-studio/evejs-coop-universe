"use strict";
// Read-only report from actual EveJS co-op JSONL; no guessed network login.
// Use: docker compose exec -T server cat /var/lib/evejs/coop-events.jsonl | node scripts/coop-party-report.cjs
const fs=require("node:fs");
function positive(x){const n=Number(x);return Number.isSafeInteger(n)&&n>0?n:null;}
function summarize(input,{now=Date.now(),windowMinutes=120}={}){
 const cutoff=now-windowMinutes*60000;
 const events=[];let invalidLines=0;
 for(const line of String(input).split(/\r?\n/)){
  if(!line.trim())continue;
  try{
   const entry=JSON.parse(line),at=Date.parse(entry.at);
   if(Number.isFinite(at)&&at>=cutoff&&at<=now+60000)events.push({...entry,_at:at});
  }catch{invalidLines++;}
 }
 events.sort((a,b)=>a._at-b._at);
 const pilots=new Map();let lastScene=null,lastLivingShips=null,lastNativeIndustry=null,encounters=0,kills=0,coopWrecks=0,partyReady=0,livingLosses=0,pirateRaids=0,haulerLoads=0,haulerDeliveries=0;
 for(const e of events){
  const id=positive(e.characterID);
  if(e.event==="coop-shared-scene"&&Array.isArray(e.pilots)){
   lastScene=e;
   for(const p of e.pilots){
    const pid=positive(p.characterID);
    if(!pid)continue;
    const prev=pilots.get(pid)||{};
    pilots.set(pid,{...prev,characterID:pid,shipID:positive(p.shipID),systemID:positive(e.systemID),lastSeen:e.at,active:true});
   }
  }else if(id&&["space-login-attach","space-arrival"].includes(e.event)){
   pilots.set(id,{...(pilots.get(id)||{}),characterID:id,shipID:positive(e.shipID),systemID:positive(e.systemID),lastSeen:e.at,active:true});
  }else if(id&&e.event==="disconnect-after-persist"){
   pilots.set(id,{...(pilots.get(id)||{}),characterID:id,lastSeen:e.at,active:false});
  }
  if(e.event==="virtual-world-materialization"&&Array.isArray(e.livingShips)){
    lastLivingShips=e.livingShips;
  }
  if(e.event==="living-native-industry"&&Array.isArray(e.fleets))lastNativeIndustry=e;
  if(e.event==="living-pirate-raid")pirateRaids+=(e.actions||[]).length;
  if(e.event==="living-hauler-loaded")haulerLoads++;
  if(e.event==="living-hauler-delivered")haulerDeliveries++;
  if(e.event==="living-npc-destroyed"&&e.status==="RECOVERING")livingLosses++;
  if(e.event==="native-npc-spawn"&&e.success)encounters++;
  if(e.event==="coop-encounter-kill")coopWrecks++;
  if(e.event==="coop-party-proximity"&&e.ready)partyReady++;
  if(e.event==="native-npc-kill-consequence"&&e.status==="COMMITTED")kills++;
 }
 const active=[...pilots.values()].filter(p=>p.active);
 const lastActiveIDs=new Set(active.map(x=>x.characterID));
 const scenePilots=Array.isArray(lastScene?.pilots)?lastScene.pilots:[];
 const sceneActive=scenePilots.filter(p=>{
  const id=positive(p.characterID),latest=pilots.get(id);
  return lastActiveIDs.has(id)&&latest?.systemID===positive(lastScene?.systemID)&&Date.parse(latest.lastSeen)<=lastScene._at;
 });
 const bothInScene=sceneActive.length>=2&&sceneActive.every(p=>p.shipExists===true);
 const mutualSeen=bothInScene&&lastScene?.mutualVisibility===true&&sceneActive.length===2;
 let status="NO_ACTIVE_PILOT_EVIDENCE";
 if(active.length===1)status="ONE_PILOT_OBSERVED";
 else if(active.length>=2)status=bothInScene?"TWO_PILOTS_SHARED_SCENE_OBSERVED":"TWO_PILOTS_NOT_CONFIRMED_IN_SAME_SCENE";
 if(mutualSeen)status="MUTUAL_SERVER_VISIBILITY_OBSERVED";
 return {status,clientRenderingVerified:false,windowMinutes,
   activeCharacterIDs:active.map(p=>p.characterID),activePilotCount:active.length,
   sharedScenePilotCount:sceneActive.length,serverMutualVisibility:mutualSeen,
   livingNpcShipAssignmentsObserved:lastLivingShips?.length||0,
   livingNpcRolesObserved:lastLivingShips?.map(x=>({pilotID:x.pilotID,role:x.role}))||[],
   livingNpcShipLossesObserved:livingLosses,
   realMiningFleetsLastSeen:lastNativeIndustry?.fleets?.map(f=>({
    fleetID:f.fleetID,state:f.state,miners:f.minerIDs?.length||0,
    haulers:f.haulerIDs?.length||0,defenders:f.responseIDs?.length||0,
    oreQuantityInRealNpcCargo:f.oreQuantity||0
   }))||[],
   organicPirateRaidOrdersObserved:pirateRaids,
   physicalHaulerLoadsObserved:haulerLoads,
   physicalHaulerUnloadsObserved:haulerDeliveries,
   legacyArenaEncountersObserved:encounters,legacyArenaWreckKillsObserved:coopWrecks,
   partyRendezvousObserved:partyReady,npcEconomicLossesObserved:kills,
   evidenceEvents:events.length,invalidLines,lastSceneAt:lastScene?.at||null,
   warnings:[
    "Live client rendering, controls, authenticated gameplay and friend-PC network access are not certified by JSONL evidence.",
    ...(lastScene&&!bothInScene?["Last shared-scene snapshot may be stale or show only one pilot."]:[])
   ]};
}
if(require.main===module){
 try{
  const args=process.argv.slice(2),at=args.indexOf("--window-minutes");
  const minutes=at>=0?Number(args[at+1]):120;
  if(!Number.isFinite(minutes)||minutes<=0||minutes>1440)throw Error("window must be 1..1440 minutes");
  console.log(JSON.stringify(summarize(fs.readFileSync(0,"utf8"),{windowMinutes:minutes}),null,2));
 }catch(error){console.error("Co-op report failed:",error.message);process.exitCode=1;}
}
module.exports={summarize};
