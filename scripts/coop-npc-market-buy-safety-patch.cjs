"use strict";
// COOP-034: reject NPC corporation sell orders in legacy character-seller path.
// This guard must be replaced only by a native corporate seller settlement.
const LINE='    if (String(sellOrder?.source || "").toLowerCase() === "coop-npc") continue; // COOP-034 NPC corporate seller not yet settled';
const ANCHOR='    const tradedQuantity = Math.min(remainingQuantity, availableQuantity);';
function patch(source,{remove=false}={}){
 const eol=source.includes("\r\n")?"\r\n":"\n",lf=source.replace(/\r\n/g,"\n");
 let text=lf;
 if(remove){
  if(text.includes(LINE)){
   if(text.split(LINE+"\n").length!==2)throw Error("NPC_BUY_GUARD_CORRUPT");
   text=text.replace(LINE+"\n","");
  }else if(text.includes("COOP-034 NPC corporate seller"))throw Error("NPC_BUY_GUARD_CORRUPT");
 }else{
  // The COOP-035 guarded corporate purchase branch replaces COOP-034.
  // A repeated central install must not append an unconditional skip after it.
  if(text.includes("COOP-035 native NPC corporate seller branch"))return source;
  if(text.includes(LINE))throw Error("NPC_BUY_GUARD_ALREADY_PATCHED");
  if(text.split(ANCHOR).length!==2)throw Error("NPC_BUY_GUARD_UPSTREAM_ANCHOR_MISMATCH");
  text=text.replace(ANCHOR,LINE+"\n"+ANCHOR);
 }
 return eol==="\r\n"?text.replace(/\n/g,"\r\n"):text;
}
module.exports={patch,LINE,ANCHOR};
