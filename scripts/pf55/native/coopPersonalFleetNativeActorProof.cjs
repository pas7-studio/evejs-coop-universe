'use strict';
/** PF78: confirm a physical native NPC and its live controller still represent
 * the same original Personal Fleet ItemStore ship before a native action or a
 * PF56 station-arrival receipt. Never creates or repairs an actor.
 * The caller separately proves the GameStore claim under its authoritative
 * transaction; matching in-memory objects are necessary, not sufficient.
 */
const positive=x=>Number.isSafeInteger(x)&&x>0;
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
function matchesOriginalPersonalFleetActor(row,entity,controller){
 if(!object(row)||!positive(row.shipItemID)||!positive(row.systemID)||
    !positive(row.ownerCharacterID)||typeof row.assignmentID!=='string'||
    row.assignmentID.length===0||typeof row.pilotID!=='string'||
    !/^coop-pilot-[0-9]{3,}$/.test(row.pilotID)||
    !object(entity)||!object(controller))return false;
 if(entity.kind!=='ship'||entity.itemID!==row.shipItemID||
    entity.nativeNpc!==true||entity.nativeNpcOccupied!==true||
    entity.npcEntityType!=='personalFleet'||
    entity.operatorKind!=='PERSONAL_FLEET'||
    entity.selectionKind!=='PERSONAL_FLEET'||
    entity.selectionID!==row.assignmentID||
    entity.ownerID!==row.ownerCharacterID||
    entity.characterID!==0||entity.pilotCharacterID!==0||
    // A session object with no characterID is NOT an absence of a player.
    entity.session!=null)return false;
 if(controller.entityID!==row.shipItemID||
    controller.systemID!==row.systemID||
    controller.personalFleetOriginal!==true||
    controller.operatorKind!=='PERSONAL_FLEET'||
    controller.entityType!=='personalFleet'||
    controller.selectionKind!=='PERSONAL_FLEET'||
    controller.selectionID!==row.assignmentID||
    controller.personalFleetAssignmentID!==row.assignmentID||
    controller.personalFleetPilotID!==row.pilotID||
    controller.runtimeKind!=='nativeAmbient'||
    !positive(controller.personalFleetGeneration))return false;
 // PF56 carries the ship's reservation generation. PF55 manual orders only
 // carry actorGeneration (a distinct PF54 claims epoch): do not conflate them.
 if(row.reservationGeneration!==undefined&&
    (!positive(row.reservationGeneration)||
     row.reservationGeneration!==controller.personalFleetGeneration))return false;
 return true;
}
module.exports={matchesOriginalPersonalFleetActor};
