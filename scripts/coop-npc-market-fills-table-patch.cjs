"use strict";
// COOP-035 must register durable idempotent fill receipts as a REAL pinned
// GameStore SQLite table. An allowlisted raw SQL table alone is insufficient.
const file="server/src/gameStore/index.js";
const ANCHOR='  "marketEscrow",';
const NEW=ANCHOR+'\n  "npcMarketFills", // COOP-035 durable NPC buy idempotency receipts';
function patch(src,requestedFile,remove=false){
 if(requestedFile!==file)return src;
 const eol=src.includes("\r\n")?"\r\n":"\n";
 let s=src.replace(/\r\n/g,"\n");
 if(!s.includes("const SQLITE_TABLES = new Set(["))throw Error("NPC_FILLS_MISSING_SQLITE_TABLES");
 if(s.split(NEW).length>2)throw Error("NPC_FILLS_DUPLICATE_SQLITE_TABLE");
 if(remove){
  if(s.includes(NEW))s=s.replace(NEW,ANCHOR);
  else if(s.includes("npcMarketFills"))throw Error("NPC_FILLS_SQLITE_DRIFT");
  return eol==="\r\n"?s.replace(/\n/g,"\r\n"):s;
 }
 if(s.includes(NEW))return src;
 if(s.includes('"npcMarketFills"'))throw Error("NPC_FILLS_SQLITE_DRIFT");
 if(s.split(ANCHOR).length!==2)throw Error("NPC_FILLS_MARKET_ESCROW_ANCHOR_MISMATCH");
 s=s.replace(ANCHOR,NEW);
 return eol==="\r\n"?s.replace(/\n/g,"\r\n"):s;
}
module.exports={patch,file,ANCHOR,NEW};
