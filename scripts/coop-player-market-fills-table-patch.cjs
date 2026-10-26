"use strict";
// Native GameStore SQLite table, distinct from NPC receipts.
// Apply after coop-npc-market-fills-table-patch, remove before it.
const file="server/src/gameStore/index.js";
const ANCHOR='  "npcMarketFills", // COOP-035 durable NPC buy idempotency receipts';
const ENTRY='  "playerMarketFills", // COOP-P2P durable native player wallet/item receipts';
function patch(source,requestedFile,remove=false){
 if(requestedFile!==file)return source;
 if(typeof source!=="string")throw Error("P2P_TABLE_SOURCE_REQUIRED");
 const eol=source.includes("\r\n")?"\r\n":"\n";
 let s=source.replace(/\r\n/g,"\n");
 if(!s.includes("const SQLITE_TABLES = new Set(["))throw Error("P2P_TABLE_SQLITE_REGISTRY_MISSING");
 if(s.split(ENTRY).length>2)throw Error("P2P_TABLE_DUPLICATE");
 if(remove){
  if(s.includes(ENTRY))s=s.replace(ENTRY+"\n","");
  else if(s.includes('"playerMarketFills"'))throw Error("P2P_TABLE_UNRECOGNIZED_ENTRY");
 }else if(!s.includes(ENTRY)){
  if(s.includes('"playerMarketFills"')||s.split(ANCHOR).length!==2)
    throw Error("P2P_TABLE_SOURCE_DRIFT");
  s=s.replace(ANCHOR,ANCHOR+"\n"+ENTRY);
 }
 return eol==="\r\n"?s.replace(/\n/g,"\r\n"):s;
}
module.exports={patch,file,ENTRY};
