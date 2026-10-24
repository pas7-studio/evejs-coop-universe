"use strict";
// Real EveJS stargate approach for autonomous, persistent NPC ships.
// No virtual system jumps, synthetic gate coordinates or fake transfers.
// Native cross-system transfer is a separate verified capability.
const pos=x=>Number.isSafeInteger(Number(x))&&Number(x)>0?Number(x):null;
const vector=p=>!!p&&["x","y","z"].every(k=>typeof p[k]==="number"&&Number.isFinite(p[k]));
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
const named=x=>typeof x==="string"&&/^coop-pilot-[0-9]{3,}$/.test(x);
function connectedGates({sourceSystemID,targetSystemID,sourceScene,getGate}={}){
 const source=pos(sourceSystemID),target=pos(targetSystemID);
 if(!source||!target||source===target||!Array.isArray(sourceScene?.staticEntities)||
  typeof getGate!=="function")return [];
 const result=[];
 for(const entry of sourceScene.staticEntities){
  const id=pos(entry?.itemID);
  if(entry?.kind!=="stargate"||!id||!vector(entry.position))continue;
  const gate=getGate(id);
  if(!gate||Number(gate.itemID)!==id||Number(gate.solarSystemID)!==source)continue;
  const destID=pos(gate.destinationID);
  if(!destID)continue;
  const arrival=getGate(destID);
  if(!arrival||Number(arrival.itemID)!==destID||
   Number(arrival.solarSystemID)!==target||
   Number(gate.destinationSolarSystemID||target)!==target||
   Number(arrival.destinationID)!==id)continue;
  result.push({sourceGateID:id,destinationGateID:destID,
   sourceSystemID:source,destinationSystemID:target,
   position:{...entry.position}});
 }
 return result.sort((a,b)=>a.sourceGateID-b.sourceGateID);
}
function createGateTravel({warp,getGate,clock=()=>Date.now(),dwellMs=180000,
 approachMeters=30000,maxShipsPerTick=2,transfer=null}={}){
 if(typeof warp!=="function"||typeof getGate!=="function"||typeof clock!=="function"||
  !Number.isSafeInteger(dwellMs)||dwellMs<30000||
  !Number.isFinite(approachMeters)||approachMeters<1000||approachMeters>100000||
  !Number.isSafeInteger(maxShipsPerTick)||maxShipsPerTick<1||maxShipsPerTick>5||
  (transfer!==null&&typeof transfer!=="function"))throw Error("invalid native gate travel options");
 const pending=new Map();
 function tick({systemID,scene,assignments=[],route=[],roles={},
  getController=()=>null,blockedIDs=new Set()}={}){
  const system=pos(systemID);
  if(!system||!scene||typeof scene.getEntityByID!=="function"||!Array.isArray(route)||
   !Array.isArray(assignments)||typeof getController!=="function")
   return {status:"NO_NATIVE_SCENE",orders:[],observations:[]};
  const hop=route.indexOf(system);
  if(hop<0||route.length<2)return {status:"NO_ROUTE",orders:[],observations:[]};
  const destination=pos(route[(hop+1)%route.length]);
  if(!destination||destination===system)return {status:"NO_ROUTE",orders:[],observations:[]};
  const gates=connectedGates({sourceSystemID:system,targetSystemID:destination,sourceScene:scene,getGate});
  if(!gates.length)return {status:"NO_RECIPROCAL_NATIVE_GATE",orders:[],observations:[]};
  const now=clock(),orders=[],observations=[],candidates=[];
  for(const a of assignments){
   const id=pos(a?.entityID);
   if(!id||!named(a.pilotID)||Number(a.systemID)!==system||blockedIDs.has(id))continue;
   const role=String(roles[a.pilotID]?.role||a.role||"");
   if(role!=="trader"&&role!=="patrol")continue;
   const ship=scene.getEntityByID(id);
   if(!ship||ship.kind!=="ship"||ship.nativeNpc!==true||
    !vector(ship.position)||ship.session?.characterID)continue;
   const c=getController(id);
   if(!c||Number(c.entityID)!==id||Number(c.systemID)!==system||
    Number(c.currentTargetID)>0||Number(c.lastAggressorID)>0&&
      now-Number(c.lastAggressedAtMs)<120000||c.manualOrder?.type==="attack")continue;
   if(String(ship.mode||"").toUpperCase().includes("WARP")||
    ship.pendingWarp||ship.warpState)continue;
   candidates.push({id,pilotID:a.pilotID,role,ship});
  }
  let issued=0;
  for(const pilot of candidates.sort((a,b)=>a.pilotID.localeCompare(b.pilotID))){
   if(issued>=maxShipsPerTick)break;
   const key=system+":"+pilot.id;
   const old=pending.get(key);
   if(old&&now<old.nextAt)continue;
   const gate=gates.reduce((best,g)=>!best||distance(pilot.ship.position,g.position)<
    distance(pilot.ship.position,best.position)?g:best,null);
   if(!gate)continue;
   const meters=distance(pilot.ship.position,gate.position);
   if(meters>approachMeters){
    const result=warp(pilot.id,gate.sourceGateID,{forceImmediateStart:true,
     broadcastWarpStartToVisibleSessions:true});
    pending.set(key,{pilotID:pilot.pilotID,sourceSystemID:system,
     targetSystemID:destination,gateID:gate.sourceGateID,
     nextAt:now+(result?.success===true?dwellMs:60000),
     phase:result?.success===true?"NATIVE_GATE_WARP":"WARP_FAILED"});
    if(result?.success===true){
     issued++;orders.push({pilotID:pilot.pilotID,entityID:pilot.id,
      sourceGateID:gate.sourceGateID,targetSystemID:destination,
      action:"NATIVE_WARP_TO_REAL_GATE"});
    }
    continue;
   }
   // Being within actual stargate range only proves physical arrival,
   // not a system transition. Never alter virtual pilot location here.
   observations.push({pilotID:pilot.pilotID,entityID:pilot.id,
    sourceGateID:gate.sourceGateID,destinationGateID:gate.destinationGateID,
    destinationSystemID:destination,status:"AT_REAL_GATE"});
   if(!transfer){
    pending.set(key,{pilotID:pilot.pilotID,sourceSystemID:system,
     targetSystemID:destination,gateID:gate.sourceGateID,
     nextAt:now+dwellMs,phase:"AWAITING_NATIVE_TRANSFER"});
    continue;
   }
   const result=transfer({pilotID:pilot.pilotID,entityID:pilot.id,gate,
    sourceScene:scene,ship:pilot.ship,controller:getController(pilot.id)});
   if(result?.success===true&&result.verifiedSourceAbsent===true&&
    result.verifiedDestinationPresent===true&&
    Number(result.entityID)===pilot.id&&Number(result.systemID)===destination){
    pending.delete(key);issued++;
    orders.push({pilotID:pilot.pilotID,entityID:pilot.id,
     sourceGateID:gate.sourceGateID,targetSystemID:destination,
     action:"VERIFIED_NATIVE_GATE_TRANSFER"});
   }else{
    pending.set(key,{pilotID:pilot.pilotID,sourceSystemID:system,
     targetSystemID:destination,gateID:gate.sourceGateID,
     nextAt:now+60000,phase:"TRANSFER_NOT_VERIFIED"});
   }
  }
  if(pending.size>500)for(const [key,p] of pending)if(p.nextAt<now-3600000)pending.delete(key);
  return {status:"OK",gateCount:gates.length,orders,observations};
 }
 return {tick,snapshot:()=>[...pending].map(([key,p])=>({key,...p}))};
}
module.exports={connectedGates,createGateTravel};
