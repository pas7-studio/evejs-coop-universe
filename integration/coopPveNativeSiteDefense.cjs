"use strict";
// PVE-002: native dungeon encounter IDs are the ONLY site-defender provenance.
// This director never spawns NPCs, completes objectives or pays rewards.
// Called on the EXISTING Living World tick and gated OFF by its caller.
const id=n=>Number.isSafeInteger(n)&&n>0?n:null;
const point=p=>p&&["x","y","z"].every(k=>typeof p[k]==="number"&&Number.isFinite(p[k]));
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
const maxAgeMs=120000,maxRange=250000;
const busy=c=>Boolean(c?.currentTargetID)||
  (Boolean(c?.manualOrder?.type)&&String(c.manualOrder.type).toLowerCase()!=="resumebehavior");
// A defender that cannot even lock the attacker cannot shoot it either. Until now it got a plain
// attack order anyway, which a sniper 150 km away never felt: the NPC burned toward him at subwarp
// speed and never fired. Owner report 2026-11-05: "he sat at 150 km and sniped, they did not react
// at all - they should warp into his face". The reach here is the hull's OWN lock range
// (`maxTargetRange`, derived from dogma by space/npc/nativeNpcService.js), so a sentry that really
// can shoot 150 km keeps doing exactly that and only a blind one closes the distance.
const defaultEngagementRangeMeters=65000;
const engagementReach=ship=>{
 const lock=Number(ship?.maxTargetRange);
 return Number.isFinite(lock)&&lock>0?lock:defaultEngagementRangeMeters;
};
const inWarp=ship=>String(ship?.mode||"").toUpperCase().includes("WARP")||
 Boolean(ship?.pendingWarp||ship?.warpState||ship?.isWarping);
function siteEntries(systemID,scene,instances){
 if(!id(systemID)||scene?.systemID!==systemID||typeof scene.getEntityByID!=="function"||
    !Array.isArray(instances)||instances.length>256)return {status:"INVALID_SITE_SOURCE",sites:[],owners:new Map()};
 const sites=[],owners=new Map();
 for(const instance of instances){
  const instanceID=id(instance?.instanceID),siteID=id(instance?.metadata?.siteID);
  if(!instanceID||!siteID||instance.solarSystemID!==systemID||
     instance.lifecycleState!=="active"||instance.instanceScope!=="shared"||
     !["anomaly","signature"].includes(instance.siteKind)||
     typeof instance.templateID!=="string"||!instance.templateID.trim()||
     typeof instance.siteKey!=="string"||!instance.siteKey.trim())continue;
  const beacon=scene.getEntityByID(siteID);
  if(!beacon||beacon.itemID!==siteID||
     beacon.dungeonSiteID!==siteID||beacon.dungeonSiteInstanceID!==instanceID||
     beacon.kind!==(instance.siteKind==="anomaly"?"universeAnomalySite":"universeSignatureSite")||
     !point(beacon.position))continue;
  const waves=instance.spawnState?.encounterStatesByKey;
  if(!waves||typeof waves!=="object"||Array.isArray(waves))continue;
  const site={instanceID,siteID,systemID,templateID:instance.templateID,defenderIDs:[]};
  for(const [key,wave] of Object.entries(waves)){
   if(!key||!wave||!Number.isSafeInteger(wave.spawnedAtMs)||wave.spawnedAtMs<=0||
      !Array.isArray(wave.spawnedEntityIDs)||wave.spawnedEntityIDs.length>96)continue;
   const unique=new Set(wave.spawnedEntityIDs);
   if(unique.size!==wave.spawnedEntityIDs.length)continue;
   for(const entityID of unique){
    if(!id(entityID))continue;
    const owner=owners.get(entityID)||[];
    owner.push({site,encounterKey:key,spawnedAtMs:wave.spawnedAtMs});
    owners.set(entityID,owner);
    site.defenderIDs.push(entityID);
   }
  }
  if(site.defenderIDs.length)sites.push(site);
 }
 return {status:"OK",sites,owners};
}
function createDirector({clock=()=>Date.now(),getController,getNativeEntity,resolveVerifiedPlayer,issueAttack,
 notify=()=>{},warpToAttacker=null,aggressionFor=null,cooldownMs=120000,warpCooldownMs=30000,
 maxOrdersPerTick=4,engagementRangeMeters=0}={}){
 if(typeof clock!=="function"||typeof getController!=="function"||
    typeof getNativeEntity!=="function"||
    typeof resolveVerifiedPlayer!=="function"||typeof issueAttack!=="function"||
    typeof notify!=="function"||!Number.isSafeInteger(cooldownMs)||cooldownMs<30000||
    !Number.isSafeInteger(warpCooldownMs)||warpCooldownMs<5000||
    (warpToAttacker!==null&&typeof warpToAttacker!=="function")||
    (aggressionFor!==null&&typeof aggressionFor!=="function")||
    !Number.isSafeInteger(engagementRangeMeters)||engagementRangeMeters<0||
    !Number.isSafeInteger(maxOrdersPerTick)||maxOrdersPerTick<1||maxOrdersPerTick>8)
  throw Error("INVALID_PVE_SITE_DEFENSE_CONFIG");
 const reach=ship=>engagementRangeMeters>0?engagementRangeMeters:engagementReach(ship);
 const issued=new Map();
 function tick({systemID,scene,instances=[],excludedIDs=[]}={}){
  const now=clock(),out={status:"NO_NATIVE_SITES",sites:0,defenders:0,events:[],orders:0};
  if(!Number.isSafeInteger(now)||now<=0)return {...out,status:"INVALID_CLOCK"};
  if(issued.size>=8192)return {...out,status:"ORDER_JOURNAL_CAP_REACHED"};
  if(!Array.isArray(excludedIDs)||excludedIDs.length>1024)return {...out,status:"INVALID_EXCLUSIONS"};
  const excluded=new Set(excludedIDs);
  const proof=siteEntries(systemID,scene,instances);
  if(proof.status!=="OK")return {...out,status:proof.status};
  out.sites=proof.sites.length;
  if(!out.sites)return out;
  out.status="OBSERVED_NATIVE_SITES";
  const validNpc=entityID=>{
   const ship=scene.getEntityByID(entityID);
   if(excluded.has(entityID)||!ship||ship.itemID!==entityID||ship.kind!=="ship"||
      ship.nativeNpc!==true||ship.session?.characterID||!point(ship.position)||
      (id(ship.systemID)&&ship.systemID!==systemID))return null;
   // Recycled IDs, two waves, and cross-site collisions cannot get ownership.
   if(proof.owners.get(entityID)?.length!==1)return null;
   const original=getNativeEntity(entityID),c=getController(entityID);
   const bornAt=proof.owners.get(entityID)[0].spawnedAtMs;
   if(!original||original.entityID!==entityID||original.systemID!==systemID||
      original.nativeNpc!==true||original.transient!==true||
      !id(original.typeID)||original.typeID!==ship.typeID||
      !Number.isSafeInteger(original.createdAtMs)||original.createdAtMs<=0||
      original.createdAtMs>bornAt+2000||bornAt-original.createdAtMs>120000||
      !c||c.entityID!==entityID||c.systemID!==systemID||
      c.runtimeKind!=="nativeCombat")return null;
   return {ship,controller:c};
  };
  const players=[...(scene.sessions?.values?.()||[])];
  function playerFor(attackerID){
   const attacker=id(attackerID)&&scene.getEntityByID(attackerID);
   if(!attacker||attacker.itemID!==attackerID||attacker.kind!=="ship"||
      attacker.nativeNpc===true||!point(attacker.position))return null;
   const live=players.filter(s=>s?.socket&&s.socket.destroyed!==true&&
      s?._space?.initialStateSent===true&&s._space.systemID===systemID&&
      s._space.shipID===attackerID&&id(s.characterID));
   if(live.length!==1)return null;
   if(players.filter(s=>s?.socket&&s.socket.destroyed!==true&&
      s?._space?.initialStateSent===true&&s.characterID===live[0].characterID).length!==1)
    return null;
   try{if(resolveVerifiedPlayer(scene,attacker)!==live[0].characterID)return null;}
   catch{return null;}
   return attacker;
  }
  for(const site of proof.sites){
   const members=site.defenderIDs.map(validNpc).filter(Boolean);
   out.defenders+=members.length;
   if(members.length<2)continue;
   let siteOrders=0;
   for(const victim of members){
    if(siteOrders>=2||out.orders>=maxOrdersPerTick)break;
    const witnessed=!id(victim.controller.lastAggressorID)&&typeof aggressionFor==="function"
      ?aggressionFor({systemID,victimEntityID:victim.ship.itemID,nowMs:now})
      :null;
    // A native controller does not always record a player aggressor. The verified damage witness
    // fills exactly that gap (same victim, same system, fresh window) and nothing else.
    const aggressorID=id(victim.controller.lastAggressorID)||id(witnessed?.attackerShipID),
      at=Number.isSafeInteger(victim.controller.lastAggressedAtMs)&&victim.controller.lastAggressedAtMs>0
        ?victim.controller.lastAggressedAtMs
        :Number(witnessed?.atMs);
    if(!aggressorID||!Number.isSafeInteger(at)||at<=0||at>now||now-at>maxAgeMs)continue;
    if(witnessed&&!id(victim.controller.lastAggressorID))
      out.events.push({status:"NATIVE_SITE_DEFENSE_FROM_WITNESS",instanceID:site.instanceID,
       siteID:site.siteID,victimID:victim.ship.itemID,targetID:aggressorID,
       characterID:id(witnessed.characterID)});
    const attacker=playerFor(aggressorID);
    if(!attacker||distance(attacker.position,victim.ship.position)>maxRange)continue;
    const faction=id(victim.ship.factionID),corp=id(victim.ship.corporationID);
    if(!faction&&!corp)continue;
    for(const helper of members){
     if(siteOrders>=2||out.orders>=maxOrdersPerTick)break;
     const helperID=helper.ship.itemID,key=site.instanceID+":"+helperID;
     if(helperID===victim.ship.itemID||
        (faction?helper.ship.factionID!==faction:helper.ship.corporationID!==corp)||
        busy(helper.controller)||inWarp(helper.ship)||
        distance(helper.ship.position,attacker.position)>maxRange)continue;
     const previous=issued.get(key);
     // An UNKNOWN native ACK permanently fences auto-reissue until operator action.
     if(previous&&previous.phase==="UNKNOWN")continue;
     const gap=distance(helper.ship.position,attacker.position);
     const far=gap>reach(helper.ship);
     // A warping defender is not given the attack order until the SAME physical hull actually
     // arrived in reach: the native ACK is a command, not a position.
     const arrivedFromWarp=Boolean(previous&&previous.phase==="WARPING")&&!far;
     if(previous&&!arrivedFromWarp&&now-previous.at<(far?warpCooldownMs:cooldownMs))continue;
     if(far&&typeof warpToAttacker!=="function")continue; // no warp capability: never pretend
     issued.set(key,{phase:"ISSUING",at:now,targetID:aggressorID,siteID:site.siteID,gap});
     let result;
     try{
      result=far
       ?warpToAttacker(helperID,aggressorID,
         {forceImmediateStart:true,broadcastWarpStartToVisibleSessions:true})
       :issueAttack(helperID,aggressorID,{allowWeapons:true,keepLock:true});
     }
     catch{result=null;}
     if(result?.success===false){issued.delete(key);continue;}
     if(result?.success!==true){
      issued.set(key,{phase:"UNKNOWN",at:now,targetID:aggressorID,siteID:site.siteID,gap});
      out.events.push({status:"NATIVE_ATTACK_OUTCOME_UNKNOWN",instanceID:site.instanceID,
       siteID:site.siteID,helperID,targetID:aggressorID,far,gapMeters:Math.round(gap)});continue;
     }
     issued.set(key,{phase:far?"WARPING":"ACCEPTED",at:now,targetID:aggressorID,
      siteID:site.siteID,gap});
     out.events.push({status:far?"NATIVE_SITE_DEFENSE_WARP_ISSUED"
       :"NATIVE_SITE_DEFENSE_ORDER_ACCEPTED",instanceID:site.instanceID,
      siteID:site.siteID,victimID:victim.ship.itemID,helperID,targetID:aggressorID,
      gapMeters:Math.round(gap),reachMeters:Math.round(reach(helper.ship))});
     siteOrders++;out.orders++;
    }
   }
  }
  if(out.orders)out.status="NATIVE_ORDERS_ACCEPTED";
  else if(out.events.length)out.status="OUTCOME_UNKNOWN";
  for(const event of out.events)try{notify(event);}catch(_error){}
  // Bounded process memory; unknown outcomes are NEVER garbage collected here.
  if(issued.size>8192)out.status="ORDER_JOURNAL_CAP_REACHED";
  return out;
 }
 return {tick,snapshot:()=>[...issued].map(([key,lease])=>({key,...lease}))};
}
module.exports={siteEntries,createDirector};
