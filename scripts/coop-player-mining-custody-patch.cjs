"use strict";
// Reversible standalone integration; Chat 01 owns central installer wiring.
// Requires the existing ALIFE-06 strict persistence acknowledgment patch.
const FLAG='process.env.EVEJS_COOP_PLAYER_MINING_CUSTODY === "1"';
const marker='  // COOP24_PLAYER_MINING_SOURCE_FIRST';
const oldCritical='  const transferredQuantity = miningResult.getTotalTransferredQuantity();';
const critical=`${marker}
  if (${FLAG} && !isNativeNpcEntity(entity))
    require("../../space/coopPlayerMiningCustody").clampCritical(mineableState, miningResult);
${oldCritical}`;
const oldStart='  if (isNativeNpcEntity(entity)) {\n    appendNpcCargo';
const npcStrictStart='  if (isNativeNpcEntity(entity)) {\n    if (!coopStrictNative) appendNpcCargo';
const anchor='  if (isNativeNpcEntity(entity)) {';
const injected=`  // COOP24_PLAYER_MINING_CUSTODY_V1
  const coopPlayerCustody = ${FLAG} && !isNativeNpcEntity(entity)
    ? require("../../space/coopPlayerMiningCustody").settle({
      scene,entity,sourceModuleID:moduleItem.itemID,targetEntity,mineableState,miningResult,transferredQuantity,
      destinationFlagID,availableVolume,cycleBoundaryMs,
      readState:()=>getMineableState(scene,targetID),
      debit:()=>applyMiningDelta(scene,targetEntity,
        miningResult.normalQuantity + miningResult.criticalHitQuantity,
        miningResult.wastedQuantity,{
          broadcast:true,nowMs:cycleBoundaryMs,sourceEntity:entity,moduleItem,
          quantityAdded:transferredQuantity,amountWasted:miningResult.wastedQuantity,
          amountCritBonus:miningResult.criticalHitQuantity,
          hasRewards:miningResult.rewardedQuantity>0,
          requireNativeMiningPersistence:true,
        }),
      credit:()=>grantItemsToCharacterLocation(resolveEntityCharacterID(entity),
        toInt(entity.itemID,0),destinationFlagID,[{
          itemType:mineableState.yieldTypeID,quantity:transferredQuantity,
        }]),
      onCredit:changes=>{if(entity.session)syncMinedOreChangesToSession(
        entity.session,toInt(entity.itemID,0),changes);},
    }) : null;
  if (coopPlayerCustody && !coopPlayerCustody.success)
    return {success:false,stopReason:coopPlayerCustody.stopReason||"cargo"};
`;
function one(s,a,b){const count=s.split(a).length-1;
 if(count!==1)throw Error('COOP24 pinned source anchor mismatch: '+a.slice(0,80)+' count='+count);
 return s.replace(a,b);
}
function patch(source,remove=false){
 const eol=String(source).includes('\r\n')?'\r\n':'\n';
 let s=String(source).replace(/\r\n/g,'\n');
 const has=s.includes(marker),hasMain=s.includes('// COOP24_PLAYER_MINING_CUSTODY_V1');
 if(has!==hasMain)throw Error('COOP24 partial player mining overlay');
 if(remove&&!has)return source;
 if(!remove&&has)return source;
 const strict=s.includes('// COOP_ALIFE_NATIVE_MINING_CONSERVATION_V1');
 if(!remove&&(!strict||!s.includes('requireNativeMiningPersistence: options.requireNativeMiningPersistence === true')&&
   !s.includes('coopStrictNative')))throw Error('COOP24 needs existing ALIFE06 strict native persistence writer');
 // Anchor a single downstream native player-ship branch, not NPC mining.
 const oldBranch='  } else {\n    const grantResult = grantItemsToCharacterLocation(';
 const newBranch='  } else if (!coopPlayerCustody) {\n    const grantResult = grantItemsToCharacterLocation(';
 const deltaOld=strict?'  const deltaResult = coopStrictDelta || applyMiningDelta(':
  '  const deltaResult = applyMiningDelta(';
 const deltaNew=strict?'  const deltaResult = coopPlayerCustody ? coopPlayerCustody.deltaResult : coopStrictDelta || applyMiningDelta(':
  '  const deltaResult = coopPlayerCustody ? coopPlayerCustody.deltaResult : applyMiningDelta(';
 if(remove){
  s=one(s,critical,oldCritical);
  s=one(s,injected,'');
  s=one(s,newBranch,oldBranch);
  s=one(s,deltaNew,deltaOld);
 }else{
  s=one(s,oldCritical,critical);
  s=one(s,oldBranch,newBranch);
  s=one(s,deltaOld,deltaNew);
  // Scope insertion AFTER the transferredQuantity guard and BEFORE the
  // original player grant branch. The same script never touches the NPC path.
  const after=s.indexOf('  if (transferredQuantity <= 0 && miningResult.wastedQuantity <= 0) {');
  const start=s.indexOf('  if (isNativeNpcEntity(entity)) {',after);
  if(after<0||start<after)throw Error('COOP24 native mining cycle scope mismatch');
  s=s.slice(0,start)+injected+s.slice(start);
 }
 return eol==='\n'?s:s.replace(/\n/g,eol);
}
const droneMarker='  // COOP24_PLAYER_DRONE_MINING_SOURCE_FIRST';
const droneGrant='  const grantResult = grantItemToCharacterLocation(';
const droneSync=`  syncDroneInventoryChangesToSession(
    resolveDroneControllerSession(droneEntity, controllerEntity),
    grantResult.data && grantResult.data.changes,
  );`;
const droneInsert=`${droneMarker}
  const coopDroneCustody = ${FLAG} && controllerEntity.nativeNpc !== true
    ? require("../../space/coopPlayerMiningCustody").settle({
      scene,entity:controllerEntity,droneEntity,targetEntity,mineableState,
      miningResult,transferredQuantity,destinationFlagID:destination.flagID,
      availableVolume:destination.availableVolume,cycleBoundaryMs:now,
      readState:()=>getMineableState(scene,targetID),
      debit:()=>applyMiningDelta(scene,targetEntity,
        miningResult.normalQuantity,miningResult.wastedQuantity,{
          broadcast:true,nowMs:now,sourceDroneID:droneEntity.itemID,
          sourceEntity:controllerEntity,moduleItem:buildDronePseudoModuleItem(droneEntity),
          quantityAdded:transferredQuantity,amountWasted:miningResult.wastedQuantity,
          moduleItemID:droneEntity.itemID,moduleTypeID:droneEntity.typeID,
          moduleGroupID:droneEntity.groupID,requireNativeMiningPersistence:true,
        }),
      credit:()=>grantItemToCharacterLocation(
        destination.storageSnapshot.characterID,destination.storageSnapshot.shipID,
        destination.flagID,yieldTypeRecord,transferredQuantity),
      onCredit:changes=>syncDroneInventoryChangesToSession(
        resolveDroneControllerSession(droneEntity,controllerEntity),changes),
    }) : null;
  if (coopDroneCustody && !coopDroneCustody.success) {
    resetDroneToIdle(droneEntity,controllerEntity,{scene,stopMovement:true});
    return;
  }
`;
function patchDrone(source,remove=false){
 const eol=String(source).includes("\r\n")?"\r\n":"\n";
 let s=String(source).replace(/\r\n/g,"\n");
 const already=s.includes(droneMarker);
 if(remove&&!already||!remove&&already)return source;
 const oldDelta=`  const deltaResult = applyMiningDelta(
    scene,
    targetEntity,
    miningResult.normalQuantity,`;
 const newDelta=`  const deltaResult = coopDroneCustody ? coopDroneCustody.deltaResult : applyMiningDelta(
    scene,
    targetEntity,
    miningResult.normalQuantity,`;
 const beforeGrant=droneInsert+`  if (!coopDroneCustody) {
  const grantResult = grantItemToCharacterLocation(`;
 const afterSync=droneSync+`
  }`;
 if(remove){
  s=one(s,beforeGrant,droneGrant);
  s=one(s,afterSync,droneSync);
  s=one(s,newDelta,oldDelta);
 }else{
  // The original drone source uses the same native grant/debit split, and
  // must share the rock and ship fence with player mining lasers.
  s=one(s,droneGrant,beforeGrant);
  s=one(s,droneSync,afterSync);
  s=one(s,oldDelta,newDelta);
 }
 return eol==='\n'?s:s.replace(/\n/g,eol);
}
module.exports={patch,patchDrone};
