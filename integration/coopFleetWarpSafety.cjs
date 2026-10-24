"use strict";
// Opt-in guard for the pinned EveJS native Fleet Warp service.
// Never generates a ship, fleet, EVE session, warp target or fake arrival.
// Only checks real shared-scene physical ships and records the engine's
// accepted/rejected warp command for two-player gameplay diagnostics.
const positive=value=>{
 const n=Number(value);
 return Number.isSafeInteger(n)&&n>0?n:null;
};
const vec=p=>p&&["x","y","z"].every(axis=>Number.isFinite(p[axis]));
const system=s=>positive(s?._space?.systemID||
 s?.solarsystemid2||s?.solarsystemid);
const char=s=>positive(s?.characterID);
function inspect({commanderSession,followerSession,spaceRuntime}={}){
 const commander=char(commanderSession),follower=char(followerSession);
 if(!commander||!follower||commander===follower)
  return {ok:false,reason:"INVALID_MEMBER_ID"};
 if(commanderSession?.socket?.destroyed===true||
    followerSession?.socket?.destroyed===true)
  return {ok:false,reason:"DISCONNECTED"};
 const a=system(commanderSession),b=system(followerSession);
 if(!a||a!==b)return {ok:false,reason:"SYSTEM_MISMATCH"};
 if(!spaceRuntime||typeof spaceRuntime.getSceneForSession!=="function")
  return {ok:false,reason:"NATIVE_SCENE_UNAVAILABLE"};
 const scene=spaceRuntime.getSceneForSession(commanderSession);
 if(!scene||spaceRuntime.getSceneForSession(followerSession)!==scene||
    typeof scene.getEntityByID!=="function"||
    typeof scene.getShipEntityForSession!=="function"||
    typeof scene.sessions?.values!=="function")
  return {ok:false,reason:"NOT_SAME_NATIVE_SCENE"};
 const joined=[...scene.sessions.values()];
 if(!joined.includes(commanderSession)||!joined.includes(followerSession))
  return {ok:false,reason:"SESSION_NOT_IN_SCENE"};
 if(commanderSession?._space?.initialStateSent!==true||
    followerSession?._space?.initialStateSent!==true)
  return {ok:false,reason:"SPACE_NOT_READY"};
 if(positive(commanderSession?._space?.systemID)!==a||
    positive(followerSession?._space?.systemID)!==a)
  return {ok:false,reason:"UNVERIFIED_SPACE_SYSTEM"};
 const leaderID=positive(commanderSession?._space?.shipID);
 const followerID=positive(followerSession?._space?.shipID);
 if(!leaderID||!followerID||leaderID===followerID)
  return {ok:false,reason:"SHIP_ID_MISSING_OR_SHARED"};
 const leader=scene.getShipEntityForSession(commanderSession),
  ship=scene.getShipEntityForSession(followerSession);
 if(!leader||!ship||Number(leader.itemID)!==leaderID||
  Number(ship.itemID)!==followerID||
  scene.getEntityByID(leaderID)!==leader||
  scene.getEntityByID(followerID)!==ship||
  leader.kind!=="ship"||ship.kind!=="ship"||
  !vec(leader.position)||!vec(ship.position))
  return {ok:false,reason:"PHYSICAL_SHIP_NOT_READY"};
 // A ship already in warp cannot reliably accept another warp order.
 if(String(ship.mode||"").toUpperCase().includes("WARP")||
    ship.pendingWarp||ship.warpState)
  return {ok:false,reason:"FOLLOWER_ALREADY_WARPING"};
 return {ok:true,systemID:a,commanderCharacterID:commander,
  followerCharacterID:follower,commanderShipID:leaderID,
  followerShipID:followerID};
}
function report(event,commanderSession,details){
 try{
  require("./coopRuntimeProbe").observe(event,commanderSession,null,details);
 }catch(_){/* telemetry must not affect live EveJS native warp */}
}
function eligible({commanderSession,followerSession,spaceRuntime}={}){
 try{
  const verdict=inspect({commanderSession,followerSession,spaceRuntime});
  if(!verdict.ok)report("coop-fleet-warp-skip",commanderSession,{
   followerCharacterID:char(followerSession),reason:verdict.reason});
  return verdict.ok;
 }catch(error){
  report("coop-fleet-warp-skip",commanderSession,{
   followerCharacterID:char(followerSession),reason:"SAFETY_CHECK_FAILED"});
  return false;
 }
}
function recordFollowerWarp({commanderSession,followerSession,spaceRuntime,
 result,targetEntityID,minimumRange}={}){
 try{
  const check=inspect({commanderSession,followerSession,spaceRuntime});
  const accepted=result?.success===true;
  const details={
   commanderCharacterID:char(commanderSession),
   followerCharacterID:char(followerSession),
   commanderShipID:check.commanderShipID||positive(commanderSession?._space?.shipID),
   followerShipID:check.followerShipID||positive(followerSession?._space?.shipID),
   systemID:system(commanderSession),
   targetEntityID:positive(targetEntityID),
   minimumRangeMeters:Number.isFinite(Number(minimumRange))?
     Math.max(0,Number(minimumRange)):0,
   status:accepted?"NATIVE_WARP_ORDER_ACCEPTED":"NATIVE_WARP_ORDER_FAILED",
   error:accepted?null:String(result?.errorMsg||"UNKNOWN_NATIVE_WARP_ERROR").slice(0,90),
   arrivalVerified:false
  };
  report("coop-fleet-warp-native-order",commanderSession,details);
  return details;
 }catch(_){
  return {status:"TELEMETRY_ERROR",arrivalVerified:false};
 }
}
module.exports={inspect,eligible,recordFollowerWarp};
