"use strict";
// CH24+31: original SQLite uses group\u001fentity row keys but reconstructs
// wrapper maps only for names explicitly listed in ROW_GROUPS.
// Without this registration subsequent stock flush may regroup our rows.
const FILE="server/src/gameStore/sqliteStore.js";
const ANCHOR='    "mutualWarInvites", "mutualWarInviteBlocks", "peaceTreaties",';
const INJECT='    "coopPlayerMiningShift", "coopPlayerMiningFleet", "coopPlayerMiningOreTitle", "coopPlayerMiningCorpSell", "coopPlayerMiningCorpFill",';
function patch(source,file,remove=false){
 if(file!==FILE)return source;
 const eol=source.includes("\r\n")?"\r\n":"\n";
 const original=ANCHOR+eol;
 const installed=ANCHOR+eol+INJECT+eol;
 const count=(s,part)=>s.split(part).length-1;
 if(!source.includes('corporationRuntime: [')||!source.includes('const ROW_KEY_SEP = "\\u001f"'))
  throw Error("MINING_CORPORATION_PINNED_SQLITE_GROUPS_MISMATCH");
 if(remove){
  if(count(source,INJECT)===0)return source;
  if(count(source,installed)!==1||count(source,INJECT)!==1)
   throw Error("MINING_CORPORATION_SQLITE_GROUP_DRIFT");
  return source.replace(installed,original);
 }
 if(count(source,installed)===1)return source;
 if(count(source,ANCHOR)!==1||count(source,INJECT)!==0)
  throw Error("MINING_CORPORATION_SQLITE_GROUP_DRIFT");
 return source.replace(original,installed);
}
module.exports={patch,FILE,ANCHOR,INJECT};
