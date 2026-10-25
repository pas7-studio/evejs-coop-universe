"use strict";
// Native activity must start only AFTER EVE client Ballpark initialization.
// Coalesces login/undock/stargate transitions and cancels stale arrivals.
const scheduled=new WeakMap();

// Once a client completed Ballpark, admit it to co-op side effects only if
// the current native scene still owns one active session and physical ship.
// This does not alter stock EveJS session or ship ownership.
function admission(session,ship,getSceneForSession){
 const characterID=Number(session?.characterID),shipID=Number(ship?.itemID),
  systemID=Number(session?._space?.systemID);
 if(!Number.isSafeInteger(characterID)||characterID<=0||
  !Number.isSafeInteger(shipID)||shipID<=0||
  !Number.isSafeInteger(systemID)||systemID<=0||
  session?.socket?.destroyed===true)return {status:"STALE_SESSION"};
 if(session?._space?.initialStateSent!==true)
  return {status:"PENDING_BALLPARK"};
 if(Number(session._space.shipID)!==shipID||
  Number(ship?.spaceState?.systemID||systemID)!==systemID)
  return {status:"REPLACED_OR_WRONG_SYSTEM_SHIP"};
 let scene;
 try{scene=getSceneForSession(session);}catch{return {status:"SCENE_UNAVAILABLE"}}
 if(!scene||Number(scene.systemID)!==systemID||
  typeof scene.getEntityByID!=="function"||
  typeof scene.sessions?.values!=="function")
  return {status:"SCENE_UNAVAILABLE"};
 const sessions=[...scene.sessions.values()];
 if(!sessions.includes(session))return {status:"SESSION_NOT_IN_NATIVE_SCENE"};
 const active=sessions.filter(s=>Number(s?.characterID)===characterID&&
  s?._space?.initialStateSent===true&&s?.socket?.destroyed!==true);
 if(active.length!==1)return {status:"AMBIGUOUS_NATIVE_CHARACTER_SESSION"};
 const conflicting=sessions.some(s=>s!==session&&
  Number(s?._space?.shipID)===shipID&&
  s?._space?.initialStateSent===true&&s?.socket?.destroyed!==true);
 if(conflicting)return {status:"AMBIGUOUS_NATIVE_SHIP_OWNER"};
 const physical=scene.getEntityByID(shipID);
 if(!physical||physical.kind!=="ship"||Number(physical.itemID)!==shipID)
  return {status:"NATIVE_HULL_NOT_READY"};
 const owner=Number(physical.pilotCharacterID??physical.characterID);
 if(Number.isSafeInteger(owner)&&owner>0&&owner!==characterID)
  return {status:"WRONG_PHYSICAL_PILOT"};
 return {status:"ADMITTED_NATIVE_SESSION",scene,physical};
}

function schedule(session,ship,reason="transition"){
 if(!session||typeof session!=="object"||!ship?.itemID)return false;
 const previous=scheduled.get(session);
 if(previous)clearTimeout(previous.timer);
 const expectedID=Number(ship.itemID);
 const expectedSystem=Number(ship.spaceState?.systemID||session?._space?.systemID||session?.solarsystemid);
 const job={expectedID,expectedSystem,reason,attempts:0,timer:null};
 scheduled.set(session,job);
 function poll(){
  if(scheduled.get(session)!==job)return;
  try{
   const space=session._space;
   if(!space||session.socket?.destroyed===true){scheduled.delete(session);return;}
   if(Number(space.shipID)!==expectedID||Number(space.systemID)!==expectedSystem){
    scheduled.delete(session);return;
   }
   // Do not inject dynamic NPCs before the client has initialized Ballpark.
   if(space.initialStateSent!==true){
    if(++job.attempts>=30){
     scheduled.delete(session);
     require("./coopRuntimeProbe").observe("coop-client-not-ready",session,ship,{reason});
     return;
    }
    job.timer=setTimeout(poll,1000);
    job.timer.unref?.();
    return;
   }
   const verified=admission(session,ship,s=>
    require("./runtime").getSceneForSession(s));
   if(verified.status!=="ADMITTED_NATIVE_SESSION"){
    if(++job.attempts>=30||[
     "AMBIGUOUS_NATIVE_CHARACTER_SESSION","AMBIGUOUS_NATIVE_SHIP_OWNER",
     "WRONG_PHYSICAL_PILOT","REPLACED_OR_WRONG_SYSTEM_SHIP",
     "STALE_SESSION"].includes(verified.status)){
     scheduled.delete(session);
     require("./coopRuntimeProbe").observe("coop-session-admission-blocked",
      session,ship,{reason,status:verified.status});
     return;
    }
    job.timer=setTimeout(poll,1000);
    job.timer.unref?.();
    return;
   }
   scheduled.delete(session);
   require("./coopRuntimeProbe").observe("space-arrival",session,ship,
    {reason,ballparkReady:true,authoritativeScene:true});
   require("./coopDuoPresence").observe(session,ship,reason);
   require("./coopDuoCoordinator").register(session,ship);
   require("./coopVirtualWorldRuntime").observeSession(session,ship);
   require("./coopNativeNpcDemo").maybeSpawn(session,ship);
  }catch(error){
   scheduled.delete(session);
   console.warn("[CoopSessionPresence]",reason,error.message);
  }
 }
 job.timer=setTimeout(poll,2500);
 job.timer.unref?.();
 return true;
}
module.exports={schedule,admission};
