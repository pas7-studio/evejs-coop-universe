"use strict";
// Defer co-op world NPC activity until the client has time to enter Ballpark.
// Covers undock and stargate transitions, not just login already in space.
const scheduled=new WeakMap();
function schedule(session,ship,reason="transition"){
 if(!session||typeof session!=="object"||!ship?.itemID)return false;
 const previous=scheduled.get(session);
 if(previous){clearTimeout(previous.timer);}
 const expectedID=Number(ship.itemID),expectedSystem=Number(ship.spaceState?.systemID||session?._space?.systemID||session?.solarsystemid);
 const timer=setTimeout(()=>{
  scheduled.delete(session);
  try{
   if(Number(session?._space?.shipID||expectedID)!==expectedID)return;
   const currentSystem=Number(session?._space?.systemID||session?.solarsystemid||expectedSystem);
   if(expectedSystem&&currentSystem&&expectedSystem!==currentSystem)return;
   require("./coopDuoPresence").observe(session,ship,reason);
   require("./coopVirtualWorldRuntime").observeSession(session,ship);
   require("./coopNativeNpcDemo").maybeSpawn(session,ship);
  }catch(error){console.warn("[CoopSessionPresence]",reason,error.message);}
 },2500);
 timer.unref?.();
 scheduled.set(session,{timer,expectedID,reason});
 return true;
}
module.exports={schedule};
