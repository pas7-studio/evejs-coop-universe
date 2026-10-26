"use strict";
// Unique, reversible L1 insertion in the pinned native stargate transition.
// Only its own gate method is changed; wormholeMgr and generic solar jump stay intact.
const FILE="server/src/space/transitions.js";
const ANCHOR='  if (!beginTransition(session, "stargate-jump", sourceGate.itemID)) {';
const HOOK='  if (process.env.EVEJS_COOP_POCHVEN_CONDUIT_GUARD === "1" && !require("./coopPochvenConduit").allowJump({session,sourceGate,destinationGate,worldData,getRawStanding:require("../services/character/standingRuntime").getCharacterRawStanding,activeShip:getActiveShipRecord(session.characterID),resolveItemByTypeID:require("../services/inventory/itemTypeRegistry").resolveItemByTypeID})) return {success:false,errorMsg:"POCHVEN_CONDUIT_ACCESS_DENIED"};';
function patch(source,file=FILE,remove=false){
 if(file!==FILE)throw Error("POCHVEN_UNSUPPORTED_NATIVE_FILE");
 const s=String(source),eol=s.includes("\r\n")?"\r\n":"\n";
 const one=(s.match(new RegExp(ANCHOR.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"),"g"))||[]).length;
 if(one!==1)throw Error("POCHVEN_NATIVE_STARGATE_ANCHOR_MISMATCH");
 if(s.split(HOOK).length>2)throw Error("POCHVEN_NATIVE_PARTIAL_PATCH");
 const inserted=HOOK+eol+ANCHOR;
 const applied=s.includes(inserted);
 if(!applied&&s.includes(HOOK))throw Error("POCHVEN_NATIVE_PARTIAL_PATCH");
 if(remove)return applied?s.replace(inserted,ANCHOR):s;
 return applied?s:s.replace(ANCHOR,inserted);
}
module.exports={patch,FILE,ANCHOR,HOOK};
