"use strict";
// Player-facing intel derived only from REAL native EveJS objects/cargo.
// Deliberately no scripted quest marker, made-up fleet or fake coordinate.
const {waypoints}=require("./coopNpcTopology");
const positive=v=>Number.isSafeInteger(Number(v))&&Number(v)>0?Number(v):null;
const point=p=>p&&["x","y","z"].every(k=>Number.isFinite(Number(p[k])));
const meters=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
function nearest(scene,entity,kinds=["asteroidBelt","station","stargate"]){
 if(!point(entity?.position))return null;
 const found=waypoints(scene).filter(p=>kinds.includes(p.kind))
  .map(p=>({...p,distance:meters(entity.position,p.position)}))
  .sort((a,b)=>a.distance-b.distance)[0];
 if(!found||found.distance>300000)return null;
 return {id:found.id,name:found.name.slice(0,72),kind:found.kind,km:Math.round(found.distance/1000)};
}
function build(scene,{fleets=[],pirateIDs=[]}={}){
 if(!scene?.getEntityByID)return {status:"NO_SCENE",messages:[],activity:[]};
 const activity=[];
 for(const fleet of fleets){
  const miners=(fleet.minerIDs||fleet.minerEntityIDs||[])
   .map(id=>scene.getEntityByID(Number(id))).filter(Boolean);
  const haulers=(fleet.haulerIDs||fleet.haulerEntityIDs||[])
   .map(id=>scene.getEntityByID(Number(id))).filter(Boolean);
  const at=nearest(scene,miners[0]||haulers[0],["asteroidBelt","station","stargate"]);
  const location=at?at.name:"unknown position";
  if(miners.length||haulers.length){
   activity.push({type:"mining",fleetID:positive(fleet.fleetID),
    location,waypointID:at?.id||null,
    miners:miners.length,haulers:haulers.length,
    oreOnHaulers:Math.max(0,Number(fleet.loadedHaulerOreQuantity)||0),
    defenders:(fleet.responseIDs||fleet.responseEntityIDs||[]).length});
  }
 }
 const pirates=(pirateIDs||[]).map(id=>scene.getEntityByID(Number(id))).filter(Boolean);
 if(pirates.length){
  const at=nearest(scene,pirates[0]);
  activity.push({type:"pirates",count:pirates.length,location:at?.name||"unknown position",waypointID:at?.id||null});
 }
 const messages=[];
 for(const x of activity.slice(0,4)){
  if(x.type==="mining"){
   messages.push("[Living Universe] "+x.miners+" miners and "+x.haulers+
    " haulers active"+(x.location!=="unknown position"?" near "+x.location:" in this system")+
    (x.oreOnHaulers>0?"; loaded transport carrying "+x.oreOnHaulers+" ore units":"")+
    (x.defenders>0?"; "+x.defenders+" defenders responding":"")+
    ". You may escort, follow or attack these actual ships.");
  }else{
   messages.push("[Living Universe] "+x.count+" roaming pirate ship(s) detected"+
    (x.location!=="unknown position"?" near "+x.location:" in this system")+
    ". Take care near mining operations.");
  }
 }
 return {status:messages.length?"ACTIVE":"QUIET",messages,activity};
}
function createAnnouncer({send,clock=()=>Date.now(),cooldownMs=90000}={}){
 if(typeof send!=="function")throw Error("Chat delivery required");
 const last=new Map();
 function announce(session,scene,options={}){
  const charID=positive(session?.characterID),systemID=positive(session?._space?.systemID);
  if(!charID||!systemID||session?._space?.initialStateSent!==true)return {status:"CLIENT_NOT_READY"};
  const data=build(scene,options),key=charID+":"+systemID,previous=last.get(key)||0;
  if(data.status!=="ACTIVE")return {status:"QUIET",activity:data.activity};
  if(clock()-previous<cooldownMs)return {status:"COOLDOWN",activity:data.activity};
  let delivered=0;
  for(const message of data.messages.slice(0,3)){
   try{send(session,message);delivered++;}catch(e){console.warn("[CoopIntel] chat",e.message);break;}
  }
  if(delivered)last.set(key,clock());
  return {status:delivered?"DELIVERED":"FAILED",messages:delivered,activity:data.activity};
 }
 return {announce};
}
module.exports={build,nearest,createAnnouncer};
