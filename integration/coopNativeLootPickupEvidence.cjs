"use strict";
// Read-only witness after a real upstream EveJS native wreck-item transfer.
// Never grants items or changes source inventory. A successful grant is NOT
// enough: verify the physical wreck, authenticated looter, and source debit.
const positive=n=>Number.isSafeInteger(Number(n))&&Number(n)>0?Number(n):null;
function verify({scene,wreck,characterID,wreckItemID,sourceBefore,sourceAfter,
 availableQuantity,requestedQuantity,grantResult}={}){
 const systemID=positive(scene?.systemID),wreckID=positive(wreck?.wreckID);
 const character=positive(characterID),item=positive(wreckItemID);
 const available=positive(availableQuantity),taken=positive(requestedQuantity);
 if(!systemID||!wreckID||!character||!item||!available||!taken||
  taken>available||Number(wreck?.systemID)!==systemID||
  !sourceBefore||Number(sourceBefore.wreckItemID)!==item||
  Number(sourceBefore.wreckID)!==wreckID||
  typeof scene?.getEntityByID!=="function")
  return {status:"INVALID_LOOT_WITNESS"};
 if(grantResult?.success!==true)return {status:"NATIVE_GRANT_NOT_CONFIRMED"};
 const nativeWreck=scene.getEntityByID(wreckID);
 if(nativeWreck?.nativeNpcWreck!==true||
  Number(nativeWreck.itemID)!==wreckID||
  Number(nativeWreck.launcherID)!==Number(wreck.sourceEntityID))
  return {status:"NO_PHYSICAL_NATIVE_WRECK"};
 const sessions=Array.from(scene.sessions?.values?.()||[]);
 const matching=sessions.filter(s=>Number(s?.characterID)===character&&
  positive(s?._space?.shipID)&&
  Number(s?._space?.systemID)===systemID&&
  scene.getEntityByID(Number(s._space.shipID))?.kind==="ship");
 if(matching.length!==1)return {status:"NO_UNIQUE_AUTHENTICATED_SPACE_LOOTER"};
 const expected=available-taken;
 if(expected===0&&sourceAfter!=null)
  return {status:"NATIVE_LOOT_SOURCE_NOT_REMOVED"};
 if(expected>0&&(!sourceAfter||
  Number(sourceAfter.wreckItemID)!==item||
  Number(sourceAfter.wreckID)!==wreckID||
  Number(sourceAfter.typeID)!==Number(sourceBefore.typeID)||
  Number(sourceAfter.quantity)!==expected))
  return {status:"NATIVE_LOOT_SOURCE_NOT_DECREMENTED"};
 return {
  status:"VERIFIED_NATIVE_LOOT_PICKUP",systemID,wreckID,
  sourceEntityID:positive(wreck.sourceEntityID),
  characterID:character,shipID:Number(matching[0]._space.shipID),
  clientID:positive(matching[0].clientID),
  wreckItemID:item,typeID:positive(sourceBefore.typeID),
  quantity:taken,remainingQuantity:expected,
  evidence:"NATIVE_GRANT_SUCCESS_PLUS_PHYSICAL_WRECK_AND_POST_TRANSFER_SOURCE_STORE"
 };
}
function note(args){
 if(process.env.EVEJS_COOP_NATIVE_LOOT_EVIDENCE!=="1")
  return {status:"DISABLED"};
 const result=verify(args);
 if(result.status==="VERIFIED_NATIVE_LOOT_PICKUP"||
  result.status==="NATIVE_LOOT_SOURCE_NOT_REMOVED"||
  result.status==="NATIVE_LOOT_SOURCE_NOT_DECREMENTED")
  require("./coopRuntimeProbe").observe("living-native-loot-pickup",null,
   {spaceState:{systemID:args?.scene?.systemID}},{...result,
    ...(result.status!=="VERIFIED_NATIVE_LOOT_PICKUP"?{
     wreckID:positive(args?.wreck?.wreckID),
     wreckItemID:positive(args?.wreckItemID)}:{})});
 return result;
}
module.exports={verify,note};
