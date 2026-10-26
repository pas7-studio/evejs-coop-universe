"use strict";
// CH24+31 opt-in adapter called FROM the existing stock miningNpcOperations
// tick. Never creates a separate timer, ship, wallet or ore store.
function load(name){
 try{return require("./"+name);}
 catch(e){
  if(e?.code!=="MODULE_NOT_FOUND"||
   !String(e.message).includes("Cannot find module './"+name+"'"))throw e;
  return require("./"+name+".cjs");
 }
}
const {createShiftOrders}=load("coopPlayerMiningShiftOrders");
const pos=x=>Number.isSafeInteger(x)&&x>0;
const array=x=>Array.isArray(x)&&x.length>0&&x.length<=32&&
 x.every(pos)&&new Set(x).size===x.length;
function createAdapter({gameStore,store,access,getFleetRecord,getScene,
 clock=()=>Date.now(),enabled=()=>false,observe=()=>{}}={}){
 if(!store||!access||typeof getFleetRecord!=="function"||
   typeof getScene!=="function"||
   ["getNativeEntity","getNativeController","listNativeCargoForEntity"].some(x=>typeof store[x]!=="function"))
   throw Error("MINING_SHIFT_NATIVE_ADAPTER_AUTHORITIES_REQUIRED");
 function verified({systemID,fleetID}){
  const scene=getScene(systemID),f=getFleetRecord(systemID,fleetID);
  if(!scene||scene.systemID!==systemID||!f||f.systemID!==systemID||
    f.fleetID!==fleetID||f.source!=="startup"||
    !array(f.minerEntityIDs)||!array(f.haulerEntityIDs)||
    f.minerEntityIDs.length+f.haulerEntityIDs.length>32||
    new Set([...f.minerEntityIDs,...f.haulerEntityIDs]).size!==
      f.minerEntityIDs.length+f.haulerEntityIDs.length)return null;
  const ids=[...f.minerEntityIDs,...f.haulerEntityIDs];
  let owner=0;
  for(const id of ids){
   const ship=scene.getEntityByID?.(id),entity=store.getNativeEntity(id),
    controller=store.getNativeController(id);
   if(!ship||ship.kind!=="ship"||ship.nativeNpc!==true||
      ship.itemID!==id||ship.transient===true||ship.session?.characterID||
      !entity||entity.entityID!==id||entity.systemID!==systemID||
      entity.transient===true||!pos(entity.ownerID)||
      !controller||controller.entityID!==id||controller.systemID!==systemID||
      controller.transient===true||
      (owner&&owner!==entity.ownerID))return null;
   owner=entity.ownerID;
  }
  return {systemID,fleetID,ownerID:owner,minerIDs:[...f.minerEntityIDs],
   haulerIDs:[...f.haulerEntityIDs]};
 }
 const orders=createShiftOrders({gameStore,access,getFleet:verified,
  verifyNativeFleet:f=>{const current=verified(f);return !!current&&
   current.ownerID===f.ownerID&&
   JSON.stringify(current.minerIDs)===JSON.stringify(f.minerIDs)&&
   JSON.stringify(current.haulerIDs)===JSON.stringify(f.haulerIDs);},
  clock,enabled,observe});
 function assign(input){return orders.assign(input);}
 function beforeTick({scene,fleetRecord,now,hooks,startHaul,deactivate,retreat}={}){
  if(enabled()!==true)return false;
  if(!scene||!fleetRecord||typeof startHaul!=="function"||
    typeof deactivate!=="function"||typeof retreat!=="function"||
    typeof scene.getEntityByID!=="function")return true;
  if(fleetRecord.source!=="startup")return false;
  const fleet=verified({systemID:scene.systemID,fleetID:fleetRecord.fleetID});
  // An unbound fleet is never changed by this feature: dispatch checks
  // its native GameStore index before writing any shift command.
  if(!fleet)return true;
  const miners=fleet.minerIDs.map(id=>scene.getEntityByID(id));
  const ships=[...fleet.minerIDs,...fleet.haulerIDs].map(id=>scene.getEntityByID(id));
  const native={
   hasOriginalMinerCargo:()=>{
    const ids=new Set();
    for(const id of fleet.minerIDs){
     const rows=store.listNativeCargoForEntity(id);
     if(!Array.isArray(rows))return false;
     for(const row of rows){
      if(!pos(row?.cargoID)||!pos(row?.typeID)||!pos(row?.quantity)||
       row.entityID!==id||row.ownerID!==fleet.ownerID||
       row.transient!==false||Number(row.moduleID||0)!==0||
       ids.has(row.cargoID))return false;
      ids.add(row.cargoID);
     }
    }
    return ids.size>0;
   },
   canResume:()=>["coop-hold","retreating","mining"].includes(fleetRecord.state)&&
    ships.every(ship=>ship&&!ship.pendingWarp&&!ship.warpState&&
      !ship.isWarping&&String(ship.mode||"").toUpperCase()!=="WARP"),
   deactivate:()=>{
    deactivate();
    return miners.every(ship=>ship?.activeModuleEffects instanceof Map&&
     ship.activeModuleEffects.size===0);
   },
   startHaul:()=>startHaul()===true,
   retreat:()=>retreat()
  };
  const result=orders.dispatch({fleet,native});
  if(result.status==="BLOCKED"&&result.reason!=="MINING_SHIFT_NATIVE_FLEET_CHANGED")
   try{observe("player-mining-shift-blocked",{systemID:scene.systemID,
    fleetID:fleet.fleetID,status:"BLOCKED",reason:result.reason});}catch{}
  return result.skipNativeTick===true;
 }
 return Object.freeze({assign,beforeTick,lookup:orders.lookup,verified});
}
let singleton=null;
function native(){
 if(!singleton){
  const gameStore=require("../gameStore"),
   store=require("./npc/nativeNpcStore"),
   access=load("coopPlayerCorporationAccess"),
   operations=require("../services/mining/miningNpcOperations");
  singleton=createAdapter({gameStore,store,access,
   getFleetRecord:(systemID,fleetID)=>{
    const matches=operations.getMiningFleetsForSystem(systemID).filter(x=>x?.fleetID===fleetID);
    return matches.length===1?matches[0]:null;},
   getScene:systemID=>{
    // Native tick supplies the ONLY permitted live scene for this call.
    return activeScene?.systemID===systemID?activeScene:null;},
   enabled:()=>load("coopFlags").on("EVEJS_COOP_PLAYER_NPC_MINING_COMPANY")
  });
 }
 return singleton;
}
let activeScene=null;
function beforeTick(input){
 if(process.env.EVEJS_COOP_PLAYER_NPC_MINING_COMPANY!=="1")return false;
 activeScene=input?.scene||null;
 try{return native().beforeTick(input);}
 catch(error){
  console.warn("[CH24+31] native mining shift gate blocked:",String(error?.message||error).slice(0,130));
  return true;
 }finally{activeScene=null;}
}
module.exports={createAdapter,beforeTick};
