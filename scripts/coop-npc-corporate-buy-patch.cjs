"use strict";
// COOP-035: guarded replacement for COOP-034's unconditional NPC skip.
// Only user-authenticated marketProxyService's existing buy loop may call this.
// Keep feature OFF until real pinned game/market tests pass.
const OLD='    if (String(sellOrder?.source || "").toLowerCase() === "coop-npc") continue; // COOP-034 NPC corporate seller not yet settled';
const NEW=String.raw`
    // COOP-035 native NPC corporate seller branch: never use character-seller wallet.
    if (String(sellOrder?.source || "").toLowerCase() === "coop-npc") {
      if (process.env.EVEJS_COOP_NATIVE_NPC_CORP_SETTLEMENT !== "1" ||
          process.env.EVEJS_COOP_NATIVE_NPC_CORP_SETTLEMENT_PROOF !== "1" ||
          process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS !== "1" ||
          !chargeBuyerWallet || remainingQuantity < availableQuantity) continue;
      const npcPurchase = await require("../../space/coopNpcCorporateBuyRuntime").buyFromOrder({
        session, sellOrder, quantity: availableQuantity,
      });
      if (npcPurchase?.status !== "PURCHASED") {
        throw Error("NPC_CORPORATE_MARKET_BUY_BLOCKED:" + String(npcPurchase?.error || npcPurchase?.status));
      }
      totalSpent = roundIsk(totalSpent + npcPurchase.grossCents / 100);
      totalBought += availableQuantity;
      remainingQuantity -= availableQuantity;
      continue;
    }
    // COOP-035 END
`;
function patch(source,{remove=false}={}){
 const eol=source.includes("\r\n")?"\r\n":"\n";
 let s=source.replace(/\r\n/g,"\n");
 if(remove){
  if(!s.includes(NEW)){if(s.includes("COOP-035 native NPC corporate seller branch"))throw Error("NPC_CORP_BUY_GUARD_DRIFT");return source;}
  if(s.split(NEW).length!==2)throw Error("NPC_CORP_BUY_DUPLICATE");
  s=s.replace(NEW,OLD+"\n");
 }else{
  if(s.includes(NEW))return source;
  if(s.split(OLD).length!==2)throw Error("NPC_CORP_BUY_MISSING_COOP034_DEPENDENCY");
  s=s.replace(OLD+"\n",NEW);
 }
 return eol==="\r\n"?s.replace(/\n/g,"\r\n"):s;
}
module.exports={patch,OLD,NEW};
