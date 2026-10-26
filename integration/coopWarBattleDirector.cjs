"use strict";
// FW-003B: one tiny battle pass on the existing A-Life 30s tick.
// No spawn, jump, scripted hit, loot, kill credit, sovereignty or payout.
const pos=x=>Number.isSafeInteger(x)&&x>0;
const vec=x=>x&&["x","y","z"].every(k=>typeof x[k]==="number"&&Number.isFinite(x[k]));
const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
const warp=x=>String(x?.mode||"").toUpperCase().includes("WARP")||
 !!(x?.pendingWarp||x?.warpState||x?.isWarping);
const {combatEnabled,ammoEnabled}=require("./coopWarCombatAuthority"+
 (__filename.endsWith(".js")?"":".cjs"));
function createWarBattleDirector({authority,bridge,sceneForSystem,
 issueNativeAttack,getController,isAmmoDepleted=()=>false,isTactical=()=>false,
 clock=()=>Date.now(),env=process.env,maxOrders=2,cooldownMs=120000}={}){
 if(!authority?.snapshots||!authority?.evaluatePair||!bridge?.issue||
  [sceneForSystem,issueNativeAttack,getController,isAmmoDepleted,isTactical,clock].some(x=>typeof x!=="function")||
  !Number.isSafeInteger(maxOrders)||maxOrders<1||maxOrders>3||
  !Number.isSafeInteger(cooldownMs)||cooldownMs<30000)
  throw Error("FW_NATIVE_BATTLE_AUTHORITIES_REQUIRED");
 const nextAt=new Map();
 function tick({systemIDs=[]}={}){
  if(!combatEnabled(env)||!ammoEnabled(env))
   return {status:"DISABLED_OR_UNSAFE_AMMO",orders:[]};
  if(!Array.isArray(systemIDs)||systemIDs.length>20)
   return {status:"INVALID_SYSTEMS",orders:[]};
  const at=clock(),orders=[];
  if(!pos(at))return {status:"INVALID_CLOCK",orders};
  let snapshots;
  try{snapshots=authority.snapshots()}catch{}
  if(!snapshots)return {status:"WAR_STATE_UNAVAILABLE",orders};
  const grouped=Object.values(snapshots.fleetState.ships||{})
   .filter(x=>pos(x?.entityID)&&pos(x.systemID)&&pos(x.factionID))
   .sort((a,b)=>a.entityID-b.entityID);
  const eligibleSystems=[...new Set(systemIDs)].filter(pos).sort((a,b)=>a-b);
  for(const systemID of eligibleSystems){
   if(orders.length>=maxOrders)break;
   const scene=sceneForSystem(systemID);
   if(scene?.systemID!==systemID||typeof scene.getEntityByID!=="function")continue;
   const fleet=grouped.filter(x=>x.systemID===systemID).slice(0,80);
   const players=new Set([...(scene.sessions?.values?.()||[])]
    .map(s=>Number(s?._space?.shipID)).filter(pos));
   for(const shipRow of fleet){
    if(orders.length>=maxOrders)break;
    const id=shipRow.entityID,attacker=scene.getEntityByID(id),
      key=String(id),controller=getController(id);
    if(players.has(id)||!attacker||!vec(attacker.position)||warp(attacker)||
      controller?.entityID!==id||controller.systemID!==systemID||
      Number(controller.currentTargetID)>0||
      (controller.manualOrder&&controller.manualOrder.type!=="resumeBehavior")||
      nextAt.get(key)>at||isAmmoDepleted(systemID,id)||isTactical(id))
      continue;
    const opponents=fleet.filter(x=>x.entityID!==id&&
     x.factionID!==shipRow.factionID&&x.campaignID===shipRow.campaignID&&
     x.warID===shipRow.warID).map(row=>{
       const entity=scene.getEntityByID(row.entityID);
       return {row,entity};
     }).filter(x=>!players.has(x.row.entityID)&&
       x.entity?.nativeNpc===true&&vec(x.entity.position)&&!warp(x.entity)&&
       dist(attacker.position,x.entity.position)<=250000)
     .sort((a,b)=>dist(attacker.position,a.entity.position)-
       dist(attacker.position,b.entity.position)||a.row.entityID-b.row.entityID);
    for(const opponent of opponents){
     // Use the native authority twice: preselect and again immediately
     // before issuing the synchronous native command.
     const authorized=authority.evaluatePair(attacker,opponent.entity,
      {requireAttackIntent:false,proof:snapshots});
     if(authorized.status!=="AUTHORIZED")continue;
     const targetID=opponent.row.entityID;
     const targetController=getController(targetID);
     // A war fleet does not steal a ship already engaged by a player,
     // raid, rescue or another active manual native order.
     if(targetController?.entityID!==targetID||
        targetController.systemID!==systemID||
        (Number(targetController.currentTargetID)>0&&
         Number(targetController.currentTargetID)!==id)||
        (targetController.manualOrder&&
         targetController.manualOrder.type!=="resumeBehavior"&&
         !(targetController.manualOrder.type==="attack"&&
           Number(targetController.manualOrder.targetID)===id)))continue;
     let answer;
     try{
      answer=bridge.issue({entityID:id,systemID,owner:"WAR",action:"attack",
       holdMs:120000,execute:()=>{
        if(!combatEnabled(env)||!ammoEnabled(env)||
          isAmmoDepleted(systemID,id)||isTactical(id)||
          warp(attacker)||warp(opponent.entity)||
          Number(getController(id)?.currentTargetID)>0||
          (Number(getController(targetID)?.currentTargetID)>0&&
           Number(getController(targetID)?.currentTargetID)!==id))
          return {success:false,errorMsg:"WAR_NATIVE_UNSAFE_RECHECK"};
        const fresh=authority.evaluatePair(attacker,opponent.entity,
         {requireAttackIntent:false});
        if(fresh.status!=="AUTHORIZED")return {success:false,errorMsg:"WAR_NATIVE_PROOF_CHANGED"};
        return issueNativeAttack(id,targetID,{allowWeapons:true,
         keepLock:true,allowPodKill:false});
       }});
     }catch{answer={success:false,errorMsg:"WAR_ORDER_OUTCOME_UNCERTAIN"}}
     // An accepted attack order does NOT prove fired ammo, hits or death.
     if(answer?.success===true){
      orders.push({status:"NATIVE_ATTACK_ORDER_ACCEPTED",systemID,attackerID:id,
       targetID,warID:authorized.warID,campaignID:authorized.campaignID});
      nextAt.set(key,at+cooldownMs);
     }else if(answer?.errorMsg==="WAR_ORDER_OUTCOME_UNCERTAIN")
      // If the bridge itself escaped with an ambiguous outcome, keep the
      // local hull quarantined rather than retrying after a cooldown.
      nextAt.set(key,Number.POSITIVE_INFINITY);
     else if(answer?.errorMsg==="COOP_NPC_ORDER_REPAIR_REQUIRED")
      nextAt.set(key,Number.POSITIVE_INFINITY);
     // No target-hopping after a potentially ambiguous native command.
     break;
    }
   }
  }
  if(nextAt.size>1024)for(const [key,time] of nextAt)if(time<=at)nextAt.delete(key);
  return {status:"OBSERVED",orders};
 }
 return Object.freeze({tick});
}
module.exports={createWarBattleDirector};
