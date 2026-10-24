"use strict";
// Native activity must start only AFTER EVE client Ballpark initialization.
// Coalesces login/undock/stargate transitions and cancels stale arrivals.
const scheduled=new WeakMap();
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
   scheduled.delete(session);
   require("./coopRuntimeProbe").observe("space-arrival",session,ship,{reason,ballparkReady:true});
   require("./coopDuoPresence").observe(session,ship,reason);
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
module.exports={schedule};
