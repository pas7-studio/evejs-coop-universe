"use strict";
// FW-005A: bind the war budget to actual NPC corp SDE identity.
// Does not publish an RPC, job, agent payment or AI spending authority.
const pos=x=>Number.isSafeInteger(x)&&x>0;
function createNativeWarTreasury({gameStore,corporationState,factionState,
 authorizeRefund=()=>false,clock=()=>Date.now(),env=process.env}={}){
 if(typeof corporationState?.getCorporationRecord!=="function"||
  typeof factionState?.getFactionIDForCorporation!=="function"||
  typeof factionState?.getFactionRecord!=="function"||
  typeof authorizeRefund!=="function")
  throw Error("WAR_NATIVE_TREASURY_BINDINGS_REQUIRED");
 const {createWarTreasury}=require("./coopWarTreasury"+
  (__filename.endsWith(".js")?"":".cjs"));
 return createWarTreasury({gameStore,clock,env,authorizeRefund,
  verifyCorporation({corporationID,factionID},stored){
   if(!pos(corporationID)||!pos(factionID)||
    stored?.corporationID!==corporationID)return false;
   try{
    const corporation=corporationState.getCorporationRecord(corporationID),
     faction=factionState.getFactionRecord(factionID);
    // Only real NPC corporation wallets are eligible for war escrow.
    // Player corporation funds can never be selected by an AI director.
    return corporation?.corporationID===corporationID&&
     corporation.isNPC===true&&faction?.factionID===factionID&&
     pos(faction.militiaCorporationID)&&
     factionState.getFactionIDForCorporation(corporationID)===factionID;
   }catch{return false}
  }
 });
}
module.exports={createNativeWarTreasury};
