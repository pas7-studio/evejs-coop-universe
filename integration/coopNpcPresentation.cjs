"use strict";
// Project a virtual NPC's stable identity into the native EveJS slim item.
// Physical entity IDs and combat stats still belong entirely to EveJS.
function presentVirtualPilot(scene,entityID,pilot){
 if(!scene||typeof scene.getEntityByID!=="function"||!pilot?.id)return {status:"INVALID"};
 const ship=scene.getEntityByID(Number(entityID));
 if(!ship||ship.kind!=="ship")return {status:"NOT_A_SHIP"};
 const name=String(pilot.name||pilot.id).trim().slice(0,90);
 if(!name)return {status:"NO_NAME"};
 if(ship.coopVirtualPilotID&&ship.coopVirtualPilotID!==pilot.id)return {status:"IDENTITY_CONFLICT"};
 if(ship.coopVirtualPilotID===pilot.id&&ship.itemName===name)return {status:"UNCHANGED"};
 ship.coopVirtualPilotID=pilot.id;
 ship.itemName=name;
 ship.slimName=name;
 // Same native notification channel used by EveJS's own wreck state updates.
 if(typeof scene.sendSlimItemChangesToAllSessions==="function"){
  try{scene.sendSlimItemChangesToAllSessions([ship]);}
  catch(error){return {status:"BROADCAST_FAILED",error:error.message};}
 }
 return {status:"UPDATED",entityID:Number(entityID),name};
}
module.exports={presentVirtualPilot};
