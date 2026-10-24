"use strict";
// Match two different, Ballpark-ready player ships on the same physical grid.
// Runs at low frequency while at least one registered player stays in space.
const registered=new Map();
let timer=null;
const lastSceneObservation=new Map();
let notices=null;
function pos(x){const n=Number(x);return Number.isSafeInteger(n)&&n>0?n:null;}
function readyPilots(scene,systemID){
 if(!scene?.sessions||typeof scene.sessions.values!=="function")return [];
 const byChar=new Map();
 for(const session of scene.sessions.values()){
  const charID=pos(session?.characterID);
  const shipID=pos(session?._space?.shipID);
  if(!charID||!shipID||session?._space?.initialStateSent!==true||session?.socket?.destroyed===true)continue;
  if(pos(session._space.systemID)!==systemID)continue;
  const ship=scene.getEntityByID?.(shipID);
  if(!ship?.position||["x","y","z"].some(k=>!Number.isFinite(ship.position[k])))continue;
  if(String(ship.mode||"").toUpperCase().includes("WARP"))continue;
  byChar.set(charID,{session,ship,characterID:charID,shipID});
 }
 return [...byChar.values()];
}
function findParty(scene,systemID,maxDistance=250000){
 const pilots=readyPilots(scene,systemID);
 for(let i=0;i<pilots.length;i++)for(let j=i+1;j<pilots.length;j++){
  const a=pilots[i].ship.position,b=pilots[j].ship.position;
  const separation=Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
  if(Number.isFinite(separation)&&separation<=maxDistance)
   return {pilots:[pilots[i],pilots[j]],separation};
 }
 return null;
}
function tick(){
 const runtime=require("./runtime");
 let current=0;
 for(const [id,item] of registered){
  if(item.session?.socket?.destroyed===true||pos(item.session?._space?.systemID)!==item.systemID||
     pos(item.session?._space?.shipID)!==item.shipID){
   registered.delete(id);
  }else current++;
 }
 if(!current){clearInterval(timer);timer=null;return;}
 const systemIDs=new Set([...registered.values()].map(x=>x.systemID));
 for(const systemID of systemIDs){
  try{
   const owner=[...registered.values()].find(x=>x.systemID===systemID);
   const scene=runtime.getSceneForSession(owner.session);
   if(!scene)continue;
   const party=findParty(scene,systemID,Number(process.env.EVEJS_COOP_PARTY_RANGE_METERS||250000));
   const signature=party?.pilots.map(p=>p.characterID).sort((a,b)=>a-b).join(":")||"waiting";
   const changed=owner.lastParty!==signature;
   const time=Date.now();
   if(changed){
    for(const item of registered.values())if(item.systemID===systemID)item.lastParty=signature;
    require("./coopRuntimeProbe").observe("coop-party-proximity",owner.session,owner.ship,{
     ready:Boolean(party),characterIDs:party?.pilots.map(p=>p.characterID)||[],separationMeters:party?.separation||null
    });
    if(party&&process.env.EVEJS_COOP_PARTY_NOTICES==="1"){
     try{
      if(!notices)notices=require("./coopPartyNotices").createNotices();
      notices.rendezvous({scene,party,systemID});
     }catch(error){console.warn("[CoopDuoCoordinator] party notice",error.message);}
    }
   }
   // Ballpark may initially attach before both ships have reciprocal
   // visibility. Re-sample while the party remains on grid, not only on
   // first rendezvous, so operator evidence can converge to real state.
   if(changed||(party&&time-(lastSceneObservation.get(systemID)||0)>=15000)){
    lastSceneObservation.set(systemID,time);
    require("./coopDuoPresence").observe(owner.session,owner.ship,signature==="waiting"?"party-waiting":"party-grid-refresh");
   }
   if(party){
    const chosen=party.pilots[0];
    const record=registered.get(chosen.characterID)?.ship||
      {itemID:chosen.shipID,spaceState:{systemID}};
    require("./coopNativeNpcDemo").maybeSpawn(chosen.session,record);
   }
  }catch(error){console.warn("[CoopDuoCoordinator] tick",error.message);}
 }
}
function register(session,ship){
 if(process.env.EVEJS_COOP_REQUIRE_TWO_PILOTS!=="1")return false;
 const characterID=pos(session?.characterID);
 const shipID=pos(session?._space?.shipID);
 const systemID=pos(session?._space?.systemID);
 if(!characterID||!shipID||!systemID||session._space.initialStateSent!==true)return false;
 registered.set(characterID,{session,ship,systemID,shipID,lastParty:null});
 // Use the shared server state; never create an alternative scene or player.
 if(!timer){
  timer=setInterval(tick,4000);
  timer.unref?.();
 }
 tick();
 return true;
}
module.exports={register,findParty,readyPilots,tick};
