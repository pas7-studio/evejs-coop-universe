"use strict";
// The only L1 bridge for persistent native trade staging custody.
// This patch is additive to (not a replacement for) coop-atomic-trade-patch.
const inventoryPath="server/src/services/inventory/itemStore.js";
const tradePath="server/src/services/trade/tradeMgrService.js";
const inventoryAnchor="  writeItemCustomInfo,";
const inventoryHook='  recoverCoopTradeStaging: (changes)=>require("../../space/coopNativeTradeCustody").applyRecovery({changes,readItems,writeItems,normalizeInventoryItem,buildInventoryItem,indexDeltaFromChanges,cloneValue,flushItems:()=>repo.flushTableSync(ITEMS_TABLE)}),';
const injections=[
 {anchor:"    this._tradeOrdinal = 1;",
  hook:'    if (process.env.EVEJS_COOP_ATOMIC_TRADE === "1") require("../../space/coopNativeTradeCustody").startup(this,require("../inventory/itemStore"));'},
 {anchor:"  Handle_InitiateTrade(args, session) {",
  hook:'    if (process.env.EVEJS_COOP_ATOMIC_TRADE === "1") require("../../space/coopNativeTradeCustody").assertReady(this);'},
 {anchor:"    trade.status = \"aborted\";",
  hook:'    if (process.env.EVEJS_COOP_ATOMIC_TRADE === "1") require("../../space/coopNativeTradeCustody").finishAbort(this,trade);'},
 {anchor:"    trade.status = \"completed\";",
  hook:'    if (process.env.EVEJS_COOP_ATOMIC_TRADE === "1") require("../../space/coopNativeTradeCustody").finishComplete(this,trade);'}
];
const stageBefore='    const moveResult = moveItemToLocation(';
const stagePre='    if (process.env.EVEJS_COOP_ATOMIC_TRADE === "1") require("../../space/coopNativeTradeCustody").beforeStage(this,trade,session,item,originContext,quantity);';
const stageAfter='    this._notifyChangeList(trade, changes);';
const stagePost='    if (process.env.EVEJS_COOP_ATOMIC_TRADE === "1") require("../../space/coopNativeTradeCustody").afterStage(this,trade,item,stagedRootItemIDs);';
const count=(s,needle)=>s.split(needle).length-1;
function patch(source,file,remove=false){
 let text=String(source);
 const eol=text.includes("\r\n")?"\r\n":"\n";
 const replace=(src,from,to,reason)=>{
  if(count(src,from)!==1)throw Error("UNKNOWN_TRADE_CUSTODY_ANCHOR: "+reason);
  return src.replace(from,to);
 };
 if(file===inventoryPath){
  const at=inventoryHook+eol;
  if(remove){if(count(text,inventoryHook)===0)return text;
   return replace(text,at,"","inventory-remove")}
  if(count(text,inventoryHook)===1)return text;
  return replace(text,inventoryAnchor,at+inventoryAnchor,"inventory-register");
 }
 if(file!==tradePath)throw Error("UNSUPPORTED_TRADE_CUSTODY_SOURCE");
 const start=text.indexOf("  _stageItemIntoTrade(trade, session, itemID, sourceLocationID, quantity = null) {");
 const end=text.indexOf("  _resolveSourceAccessibility(item, session)",start);
 if(start<0||end<start)throw Error("UNKNOWN_TRADE_STAGE_SOURCE");
 const stage=text.slice(start,end);
 if(count(stage,stageBefore)!==1||count(stage,stageAfter)!==1)
  throw Error("UNKNOWN_TRADE_STAGE_ANCHORS");
 const bits=[...injections.map(x=>x.hook),stagePre,stagePost];
 const present=bits.map(x=>text.includes(x));
 if(present.some(x=>x!==present[0]))throw Error("PARTIAL_TRADE_CUSTODY_PATCH");
 if(remove&&present[0]){
  // Remove the stage-only insertions inside the pinned source method.
  let piece=text.slice(start,end);
  piece=replace(piece,stagePre+eol,"","stage-pre-remove");
  piece=replace(piece,stagePost+eol,"","stage-post-remove");
  text=text.slice(0,start)+piece+text.slice(end);
  for(const x of injections)
   text=replace(text,x.hook+eol,"","remove "+x.hook.slice(0,25));
  return text;
 }
 if(remove||present[0])return text;
 for(const x of injections)
  text=replace(text,x.anchor,x.anchor+eol+x.hook,"apply "+x.anchor);
 const nextStart=text.indexOf("  _stageItemIntoTrade(trade, session, itemID, sourceLocationID, quantity = null) {");
 const nextEnd=text.indexOf("  _resolveSourceAccessibility(item, session)",nextStart);
 let piece=text.slice(nextStart,nextEnd);
 piece=replace(piece,stageBefore,stagePre+eol+stageBefore,"stage-pre");
 piece=replace(piece,stageAfter,stagePost+eol+stageAfter,"stage-post");
 return text.slice(0,nextStart)+piece+text.slice(nextEnd);
}
module.exports={patch,inventoryPath,tradePath};
