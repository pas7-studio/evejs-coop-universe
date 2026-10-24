"use strict";
// Organic native NPC raids: pirates target real ore-bearing mining ships.
// EveJS handles locking, damage, pursuit, aggression response and wrecks.
// No scripted kills, fake mining, arena bubbles or player-target selection.
const pos=v=>Number.isSafeInteger(Number(v))&&Number(v)>0?Number(v):null;
const valid=p=>!!p&&["x","y","z"].every(k=>Number.isFinite(p[k]));
const range=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
function createRaids({warp,attack,clock=()=>Date.now(),cooldownMs=480000}){
 if(typeof warp!=="function"||typeof attack!=="function"||cooldownMs<60000)throw Error("invalid native raid API");
 const leases=new Map();
 function tick({systemID,scene,pirates=[],fleetShips=[],getCargo=()=>[],getController=()=>null,canAttack=()=>true}){
  if(!pos(systemID)||!scene?.getEntityByID)return {status:"SCENE_MISSING",actions:[]};
  const candidates=fleetShips.filter(t=>pos(t.id)&&["miner","hauler"].includes(t.role))
    .map(t=>{
      const ship=scene.getEntityByID(t.id);
      const ore=(getCargo(t.id)||[]).filter(x=>Number(x?.moduleID||0)===0)
       .reduce((n,x)=>n+Math.max(0,Number(x.quantity)||0),0);
      return {...t,ship,ore};
    }).filter(t=>t.ship&&t.ore>0&&valid(t.ship.position));
  const actions=[];
  for(const rawID of pirates){
   const id=pos(rawID),ship=id&&scene.getEntityByID(id);
   if(!ship||!valid(ship.position)||String(ship.mode||"").includes("WARP"))continue;
   const key=systemID+":"+id,old=leases.get(key);
   if(old&&clock()<old.nextAt&&scene.getEntityByID(old.targetID))continue;
   const activeTarget=pos(getController(id)?.currentTargetID);
   if(activeTarget&&scene.getEntityByID(activeTarget))continue;
   const target=candidates.filter(x=>x.id!==id&&canAttack({systemID,pirateID:id,targetID:x.id}))
     .sort((a,b)=>(b.role==="hauler"?1:0)-(a.role==="hauler"?1:0)||
       range(ship.position,a.ship.position)-range(ship.position,b.ship.position))[0];
   if(!target)continue;
   const distance=range(ship.position,target.ship.position);
   let result,action;
   if(distance>250000){
    result=warp(id,target.id,{forceImmediateStart:true});
    action="warp-to-hauler";
   }else{
    result=attack(id,target.id,{allowWeapons:true,keepLock:true});
    action="attack";
   }
   // Warping to the convoy is only the approach, not the raid itself:
   // reevaluate soon after landing and issue a genuine weapon attack.
   const retryMs=result?.success===true?(action==="attack"?cooldownMs:15000):60000;
   leases.set(key,{nextAt:clock()+retryMs,targetID:target.id,phase:action});
   if(result?.success===true)actions.push({pirateID:id,targetID:target.id,targetRole:target.role,action});
  }
  return {status:"OK",eligibleTargetCount:candidates.length,actions};
 }
 function activePirateIDs(sceneForSystem){
  const active=new Set();
  const now=clock();
  for(const [key,lease] of leases){
   if(lease.nextAt<=now)continue;
   const [system,id]=key.split(":").map(Number);
   const scene=sceneForSystem(system);
   if(scene?.getEntityByID?.(id)&&scene.getEntityByID(lease.targetID))active.add(id);
  }
  return active;
 }
 return {tick,activePirateIDs,snapshot:()=>Array.from(leases,([id,value])=>({id,...value}))};
}
module.exports={createRaids};
