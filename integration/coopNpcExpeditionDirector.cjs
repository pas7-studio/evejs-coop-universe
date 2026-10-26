"use strict";
// EX-02/03: read-only native scouting and limited same-corp rendezvous.
// NO alternative scanner, new loop, site spawns, inventory or wallet grants.
function loadCompetition() {
 try {return require("./coopNpcExpeditionCompetition");}
 catch(e) {
  if(e?.code!=="MODULE_NOT_FOUND" ||
     !String(e.message).includes("Cannot find module './coopNpcExpeditionCompetition'"))throw e;
  return require("./coopNpcExpeditionCompetition.cjs");
 }
}
const {createExpeditionCompetition}=loadCompetition();
const pos=n=>Number.isSafeInteger(n)&&n>0;
const vector=p=>p&&["x","y","z"].every(k=>typeof p[k]==="number"&&Number.isFinite(p[k]));
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
const named=p=>typeof p==="string"&&/^coop-pilot-[0-9]{3,}$/.test(p);
function createExpeditionDirector({listNativeSites,getNativeEntity,getController,
 orderBridge,warpToPoint,clock=()=>Date.now(),intelTtlMs=600000,
 maxSitesPerTick=32,maxPilotsPerTick=32,maxOrdersPerTick=1}={}) {
 if([listNativeSites,getNativeEntity,getController,warpToPoint].some(f=>typeof f!=="function")||
    !orderBridge||typeof orderBridge.issue!=="function"||
    typeof orderBridge.blocked!=="function"||typeof clock!=="function"||
    !Number.isSafeInteger(intelTtlMs)||intelTtlMs<60000||intelTtlMs>3600000||
    !Number.isSafeInteger(maxSitesPerTick)||maxSitesPerTick<1||maxSitesPerTick>64||
    !Number.isSafeInteger(maxPilotsPerTick)||maxPilotsPerTick<2||maxPilotsPerTick>64||
    !Number.isSafeInteger(maxOrdersPerTick)||maxOrdersPerTick<1||maxOrdersPerTick>3)
  throw Error("NPC_EXPEDITION_NATIVE_AUTHORITIES_REQUIRED");
 const intel=new Map(),pending=new Map();
 let currentScene=null,currentAssignments=[],currentCatalog=null;
 const nativeSite=(systemID,siteID,fresh=false)=>{
  let sites;
  try{sites=!fresh&&currentScene?.systemID===systemID&&currentCatalog?currentCatalog:listNativeSites(systemID)}catch{return null}
  if(!Array.isArray(sites)||sites.length>2048)return null;
  const found=sites.filter(s=>s&&s.siteID===siteID&&
   (s.systemID===systemID||s.solarSystemID===systemID)&&vector(s.actualPosition));
  if(found.length!==1)return null;
  const physical=currentScene?.systemID===systemID?
   currentScene.getEntityByID?.(siteID):null;
  if(!physical||physical.itemID!==siteID||!vector(physical.position)||
     distance(physical.position,found[0].actualPosition)>1)return null;
  return {...found[0],systemID};
 };
 const readPilot=(scene,entityID,assignments)=>{
  const matches=assignments.filter(a=>a.entityID===entityID&&
   a.systemID===scene.systemID&&named(a.pilotID));
  if(matches.length!==1||assignments.some(a=>a.pilotID===matches[0].pilotID&&
   (a.entityID!==entityID||a.systemID!==scene.systemID)))return null;
  const ship=scene.getEntityByID?.(entityID),c=getController(entityID),n=getNativeEntity(entityID);
  if(!ship||ship.kind!=="ship"||ship.nativeNpc!==true||ship.itemID!==entityID||
    ship.session?.characterID||!vector(ship.position)||
    (pos(ship.systemID)&&ship.systemID!==scene.systemID)||
    !n||n.entityID!==entityID||n.systemID!==scene.systemID||
    !pos(n.corporationID)||n.transient===true||ship.transient===true||
    ship.corporationID!==n.corporationID||
    !c||c.entityID!==entityID||c.systemID!==scene.systemID)
   return null;
  return {pilotID:matches[0].pilotID,entityID,systemID:scene.systemID,
   corpID:n.corporationID,ship};
 };
 const competition=createExpeditionCompetition({
  clock,resolveNativeSite:nativeSite,
  resolveNativeNpcPilot:(systemID,entityID)=>{
   if(currentScene?.systemID!==systemID)return null;
   const p=readPilot(currentScene,entityID,currentAssignments);
   return p?{...p,durableLinkVerified:true,nativeControllerVerified:true}:null;
  }
 });
 const key=(systemID,siteID,corpID)=>systemID+":"+siteID+":"+corpID;
 const fingerprint=s=>JSON.stringify([s.siteID,s.targetID??null,s.siteKind??null,
  s.family??null,s.typeID??null,s.instanceID??null,s.pairID??null,
  s.actualPosition.x,s.actualPosition.y,s.actualPosition.z]);
 function tick({scene,assignments=[],roles={}}={}){
  const now=clock();
  if(!pos(scene?.systemID)||typeof scene.getEntityByID!=="function"||
     !Number.isSafeInteger(now)||now<=0||!Array.isArray(assignments)||
     assignments.length>2048||!roles||typeof roles!=="object")
   return {status:"NO_TRUSTED_NATIVE_SCENE",observed:0,orders:0};
  currentScene=scene;currentAssignments=assignments;
  const all=[...new Set(assignments.filter(a=>pos(a?.entityID)).map(a=>a.entityID))]
   .slice(0,maxPilotsPerTick).map(id=>readPilot(scene,id,assignments))
   .filter(Boolean).filter(p=>roles[p.pilotID]==="patrol")
   .sort((a,b)=>a.entityID-b.entityID);
  let sites;
  try{sites=listNativeSites(scene.systemID)}catch{
   return {status:"NATIVE_SITE_CATALOG_UNAVAILABLE",observed:0,orders:0};
  }
  if(!Array.isArray(sites)||sites.length>2048)
   return {status:"NATIVE_SITE_CATALOG_INVALID",observed:0,orders:0};
  currentCatalog=sites;
  const candidates=sites.filter(s=>pos(s?.siteID)&&vector(s?.actualPosition))
   .slice(0,maxSitesPerTick).map(s=>nativeSite(scene.systemID,s.siteID)).filter(Boolean);
  let observed=0,observedPlayers=0,contested=0,orders=0,blocked=0;
  for(const [id,row] of intel)if(row.at>now||now-row.at>intelTtlMs)intel.delete(id);
  for(const [id,row] of pending)if(row.at>now||now-row.at>intelTtlMs)pending.delete(id);
  for(const site of candidates){
   // Native player sessions are competition witnesses, NEVER NPC intel sources.
   const seenPlayerShips=new Set();
   for(const session of [...(scene.sessions?.values?.()||[])].slice(0,32)){
    const shipID=session?._space?.shipID;
    if(!pos(shipID)||seenPlayerShips.has(shipID))continue;
    seenPlayerShips.add(shipID);
    const candidate=scene.getEntityByID(shipID);
    if(!candidate||!vector(candidate.position)||
       distance(candidate.position,site.actualPosition)>150000)continue;
    const witness=competition.observe({scene,siteID:site.siteID,shipID});
    if(witness.status==="NATIVE_SITE_OBSERVED")observedPlayers++;
    if(witness.contested===true&&witness.status==="NATIVE_SITE_OBSERVED")contested++;
   }
   for(const pilot of all){
   if(distance(pilot.ship.position,site.actualPosition)>150000)continue;
   const result=competition.observe({scene,siteID:site.siteID,shipID:pilot.entityID});
   if(!["NATIVE_SITE_OBSERVED","ALREADY_OBSERVED"].includes(result.status))continue;
   if(result.status==="NATIVE_SITE_OBSERVED")observed++;
   if(result.contested===true&&result.status==="NATIVE_SITE_OBSERVED")contested++;
   const id=key(scene.systemID,site.siteID,pilot.corpID),stamp=fingerprint(site),old=intel.get(id);
   if(!old||old.fingerprint!==stamp){
    if(!old&&intel.size>=512)continue;
    intel.set(id,{siteID:site.siteID,systemID:scene.systemID,corpID:pilot.corpID,
     scoutPilotID:pilot.pilotID,fingerprint:stamp,at:now});
   }
   }
  }
  // Scout must have personally arrived on the original grid. Other native
  // same-corp patrol hulls can then approach; never leak player bookmarks.
  for(const [id,tip] of intel){
   if(orders>=maxOrdersPerTick)break;
   if(tip.systemID!==scene.systemID)continue;
   const site=nativeSite(tip.systemID,tip.siteID);
   if(!site||fingerprint(site)!==tip.fingerprint){intel.delete(id);continue}
   const scout=all.find(p=>p.pilotID===tip.scoutPilotID&&p.corpID===tip.corpID);
   if(!scout){blocked++;continue}
   for(const p of all){
    if(orders>=maxOrdersPerTick)break;
    if(p.pilotID===scout.pilotID||p.corpID!==tip.corpID)continue;
    const d=distance(p.ship.position,site.actualPosition);
    if(d<150000||d>2e13)continue;
    const moveKey=p.entityID+":"+id;
    if(pending.get(moveKey)?.fingerprint===tip.fingerprint)continue;
    if(pending.size>=512){blocked++;continue;}
    if(orderBridge.blocked({entityID:p.entityID,systemID:scene.systemID,owner:"EXPEDITION"})){
     blocked++;continue;
    }
    const result=orderBridge.issue({entityID:p.entityID,systemID:scene.systemID,
     owner:"EXPEDITION",action:"expedition-rendezvous",execute:()=>{
      const live=nativeSite(tip.systemID,tip.siteID,true);
      const native=readPilot(scene,p.entityID,assignments);
      if(!live||fingerprint(live)!==tip.fingerprint||!native||native.corpID!==tip.corpID)
       return {success:false,errorMsg:"EXPEDITION_NATIVE_INTEL_STALE"};
      return warpToPoint(p.entityID,{...live.actualPosition},
       {reason:"coop-npc-expedition",scheduleWake:true});
     }});
    if(result?.success===true){pending.set(moveKey,{fingerprint:tip.fingerprint,at:now});orders++;}
    else blocked++;
   }
  }
  return {status:"NATIVE_EXPEDITION_TICK",observed,observedPlayers,contested,orders,blocked,
   source:"LOCAL_NATIVE_SITE_WITNESS",nativeLootGranted:false,nativeWalletMutation:false};
 }
 function snapshot(){
  return {tips:[...intel.values()].map(t=>({...t,fingerprint:"[REDACTED]"})),pending:pending.size};
 }
 return Object.freeze({tick,snapshot});
}
module.exports={createExpeditionDirector};
