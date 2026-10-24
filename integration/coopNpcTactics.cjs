"use strict";
// Living Universe tactics: issue genuine EveJS orders to already-living NPCs.
// No NPC spawning, fake HP changes, scripted kills or imaginary warp positions.
const positive=x=>Number.isSafeInteger(Number(x))&&Number(x)>0?Number(x):null;
const pos=x=>x&&["x","y","z"].every(k=>Number.isFinite(Number(x[k])));
const meters=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
function createTactics({
 clock=()=>Date.now(),warpToPoint,warpToEntity,attack,resumeBehavior,
 maxResponders=2,callCooldownMs=120000,retreatCooldownMs=300000,
 notify=()=>{}
}){
 if([warpToPoint,warpToEntity,attack,resumeBehavior].some(x=>typeof x!=="function")||
  !Number.isInteger(maxResponders)||maxResponders<1||maxResponders>3||
  callCooldownMs<30000||retreatCooldownMs<60000)throw Error("invalid native NPC tactics");
 const calls=new Map(),retreats=new Map(),responses=new Map();
 const fresh=(id,map,ms)=>clock()-(map.get(id)||-Infinity)>=ms;
 function tick({systemID,scene,assignments=[],controllers={},health,waypoints=[],isScrambled=()=>false}={}){
  const system=positive(systemID);
  if(!system||!scene?.getEntityByID||typeof health!=="function")return {status:"NO_SCENE",events:[],engagedIDs:[]};
  const now=clock(),events=[],present=new Map();
  for(const a of assignments){
   const id=positive(a?.entityID),ship=id&&scene.getEntityByID(id);
   if(!id||!ship||ship.kind!=="ship"||!a.pilotID||present.has(id))continue;
   present.set(id,{...a,entityID:id,ship});
  }
  const engaged=new Set();
  // Continue a previous rescue after physical warp-in. Do not duplicate
  // a warp or assign another target to the same rescue ship.
  for(const [id,aid] of responses){
   if(aid.systemID!==system)continue;
   const helper=present.get(id),target=scene.getEntityByID(aid.attackerID);
   if(!helper||!target||now>=aid.expiresAt){
    if(helper&&controllers[id]?.manualOrder?.targetID===aid.attackerID)
     resumeBehavior(id);
    responses.delete(id);continue;
   }
   engaged.add(id);
   if(!pos(helper.ship.position)||!pos(target.position)||
      String(helper.ship.mode||"").includes("WARP"))continue;
   if(meters(helper.ship.position,target.position)>250000){
    if(now>=aid.nextAt){
     const result=warpToEntity(id,aid.attackerID,{forceImmediateStart:true,broadcastWarpStartToVisibleSessions:true});
     aid.nextAt=now+(result?.success?30000:60000);
     if(result?.success)events.push({kind:"reinforcement-warp",systemID:system,responderID:id,targetID:aid.attackerID,victimID:aid.victimID});
    }
   }else if(aid.phase!=="attack"&&now>=aid.nextAt){
    const result=attack(id,aid.attackerID,{allowWeapons:true,keepLock:true});
    aid.nextAt=now+(result?.success?120000:30000);
    if(result?.success){
     aid.phase="attack";
     events.push({kind:"reinforcement-attack",systemID:system,responderID:id,targetID:aid.attackerID,victimID:aid.victimID});
    }
   }
  }
  for(const victim of present.values()){
   const c=controllers[victim.entityID];
   if(!c)continue;
   const attackerID=positive(c.lastAggressorID),attacker=attackerID&&scene.getEntityByID(attackerID);
   const aggroAt=Number(c.lastAggressedAtMs)||0;
   if(!attacker||!attackerID||aggroAt<=0||now-aggroAt>120000||aggroAt>now+30000)continue;
   const allyAttacker=present.get(attackerID);
   if(allyAttacker&&allyAttacker.faction===victim.faction)continue;
   const ratio=health(victim.ship);
   const danger=ratio&&Number.isFinite(ratio.armor)&&Number.isFinite(ratio.structure)&&
     (ratio.structure<0.72||ratio.armor<0.28);
   // Retreat to a REAL station or stargate that is far from the attacker.
   // On scramble or no suitable anchor, keep native combat running.
   if(danger&&!isScrambled(victim.ship)&&!engaged.has(victim.entityID)&&
     fresh(victim.entityID,retreats,retreatCooldownMs)&&pos(attacker.position)){
    const safe=waypoints.filter(p=>["station","stargate"].includes(p.kind)&&
      pos(p.position)&&meters(p.position,attacker.position)>500000)
      .sort((a,b)=>meters(b.position,attacker.position)-meters(a.position,attacker.position))[0];
    if(safe){
     const result=warpToPoint(victim.entityID,safe.position,{
      forceImmediateStart:true,broadcastWarpStartToVisibleSessions:true});
     if(result?.success){
      retreats.set(victim.entityID,now);
      resumeBehavior(victim.entityID);
      engaged.add(victim.entityID);
      events.push({kind:"npc-retreat",systemID:system,entityID:victim.entityID,
       pilotID:victim.pilotID,attackerID,destinationID:safe.id});
     }
    }
   }
   // Same-faction escorts defend actual victims. Pirates help pirates;
   // security patrols defend miners, haulers and traders.
   const key=system+":"+victim.entityID+":"+attackerID;
   if(!fresh(key,calls,callCooldownMs))continue;
   const helpers=[...present.values()].filter(helper=>{
    if(helper.entityID===victim.entityID||helper.entityID===attackerID||
      helper.faction!==victim.faction||engaged.has(helper.entityID)||responses.has(helper.entityID))return false;
    if(victim.role==="pirate")return helper.role==="pirate";
    return helper.role==="patrol";
   }).filter(helper=>!positive(controllers[helper.entityID]?.currentTargetID) &&
     !positive(controllers[helper.entityID]?.lastAggressorID) &&
     pos(helper.ship.position)&&pos(attacker.position))
     .sort((a,b)=>meters(a.ship.position,attacker.position)-meters(b.ship.position,attacker.position))
     .slice(0,maxResponders);
   let mobilized=0;
   for(const helper of helpers){
    const far=meters(helper.ship.position,attacker.position)>250000;
    const action=far
     ?warpToEntity(helper.entityID,attackerID,{forceImmediateStart:true,broadcastWarpStartToVisibleSessions:true})
     :attack(helper.entityID,attackerID,{allowWeapons:true,keepLock:true});
    if(action?.success!==true)continue;
    responses.set(helper.entityID,{systemID:system,victimID:victim.entityID,
     attackerID,expiresAt:now+180000,nextAt:now+(far?30000:120000),
     phase:far?"approach":"attack"});
    engaged.add(helper.entityID);mobilized++;
    events.push({kind:far?"reinforcement-warp":"reinforcement-attack",systemID:system,
     responderID:helper.entityID,victimID:victim.entityID,targetID:attackerID});
   }
   if(mobilized){
    calls.set(key,now);
    events.push({kind:"npc-help-request",systemID:system,entityID:victim.entityID,
     pilotID:victim.pilotID,attackerID,responders:mobilized});
   }
  }
  // Bound process-local incident memory on busy long-running worlds.
  if(calls.size>1000)for(const [key,time] of calls)if(now-time>callCooldownMs)calls.delete(key);
  if(retreats.size>1000)for(const [key,time] of retreats)if(now-time>retreatCooldownMs)retreats.delete(key);
  for(const e of events)try{notify(e);}catch(error){console.warn("[CoopNpcTactics] notify",error.message);}
  return {status:"OK",events,engagedIDs:[...engaged]};
 }
 function activeIDs(){return new Set([...responses.keys()].filter(id=>responses.get(id).expiresAt>clock()).concat(
  [...retreats].filter(([,when])=>clock()-when<45000).map(([id])=>id)
 ));}
 return {tick,activeIDs,snapshot:()=>({
  rescuers:[...responses].map(([id,s])=>({entityID:id,...s})),
  retreats:[...retreats].map(([id,at])=>({entityID:id,at}))
 })};
}
module.exports={createTactics};
