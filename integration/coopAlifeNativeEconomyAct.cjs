"use strict";
// COOP-045: opt-in ACT adapter; ALWAYS reuses native director and its durable
// operation journal. This module does not register a scheduler or own a wallet.
// Do not bind it to a live runtime without pinned native GameStore/Rust gates.
const pos=x=>Number.isSafeInteger(x)&&x>0;
const SAFE_STAGES=new Set(["MANUFACTURE","COMPLETE_JOB","LIST_OUTPUT"]);
const completed=new Set(["INSTALLED","READY","DELIVERED","LISTED","SOLD","ALREADY_SOLD"]);
function createAlifeNativeAct({resolveActor,resolveDirector,resolveProductTypes,
 env=process.env}={}){
 if([resolveActor,resolveDirector,resolveProductTypes].some(f=>typeof f!=="function"))
  throw Error("ALIFE_NATIVE_ACT_AUTHORITIES_REQUIRED");
 const busy=new Set();
 async function dispatch(intent){
  if(env.EVEJS_COOP_ALIFE_ECONOMY_ACT!=="1"||
     env.EVEJS_COOP_NATIVE_NPC_ECONOMY!=="1")
   return {status:"DISABLED",nativeMutation:false};
  if(!intent||!SAFE_STAGES.has(intent.stage)||intent.provenance!=="NATIVE_READ_ONLY"||
     intent.nativeMutation!==false||!pos(intent.entityID)||!pos(intent.systemID)||
     !pos(intent.stationID)||!/^coop-pilot-[0-9]{3,}$/.test(intent.pilotID||"")||
     typeof intent.intentID!=="string"||intent.intentID.length>180)
   return {status:"BLOCKED",reason:"ALIFE_NATIVE_ACT_INTENT_NOT_ATTESTED"};
  const actor=await resolveActor(intent.entityID);
  if(!actor||actor.nativeVerified!==true||actor.isNpc!==true||!pos(actor.ownerID)||
     actor.pilotID!==intent.pilotID||actor.entityID!==intent.entityID||
     actor.stationID!==intent.stationID||actor.systemID!==intent.systemID||
     actor.role!=="trader"||actor.playerControlled===true||
     actor.underAttack===true||actor.inWarp===true||actor.activeNativeOrder===true)
   return {status:"BLOCKED",reason:"ALIFE_NATIVE_ACT_ACTOR_CHANGED"};
  const types=await resolveProductTypes(actor.ownerID,actor.stationID,actor.systemID);
  if(!Array.isArray(types)||types.length<1||types.length>8||
     types.some(x=>!pos(x))||new Set(types).size!==types.length)
   return {status:"BLOCKED",reason:"ALIFE_NATIVE_ACT_PRODUCT_PROOF_MISSING"};
  const key=actor.ownerID+":"+actor.stationID;
  if(busy.has(key))return {status:"BLOCKED",reason:"ALIFE_NATIVE_ACT_STATION_IN_FLIGHT"};
  busy.add(key);
  try{
   const director=await resolveDirector(actor.ownerID,actor.stationID);
   if(!director||typeof director.tick!=="function"||
      director.mode!=="NATIVE_AUTHORITIES_ONLY")
    return {status:"BLOCKED",reason:"ALIFE_NATIVE_ACT_DIRECTOR_NOT_NATIVE"};
   // The director (not this intent) decides the next durable step under its
   // native station lock, with verified receipts before any settlement.
   const result=await director.tick({ownerID:actor.ownerID,stationID:actor.stationID,
    productTypeIDs:types});
   if(!result||typeof result.status!=="string")
    return {status:"BLOCKED",reason:"ALIFE_NATIVE_ACT_RESULT_UNVERIFIED"};
   return {status:"NATIVE_DIRECTOR_RESULT",directorStatus:result.status,
    reason:result.reason||null,operationID:result.operationID||null,
    source:"EXISTING_NATIVE_DIRECTOR",nativeMutation:completed.has(result.status),
    proof:"DIRECTOR_STATUS_ONLY_NOT_GAMEPLAY_E2E"};
  }finally{busy.delete(key)}
 }
 return Object.freeze({dispatch,mode:"EXISTING_NATIVE_DIRECTOR_ONLY",
  supportsLiveRuntime:false});
}
module.exports={createAlifeNativeAct};
