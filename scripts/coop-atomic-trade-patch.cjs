"use strict";
// L1: one-statement native hooks. Actual state logic belongs to the L2 module.
const inventoryPath='server/src/services/inventory/itemStore.js';
const tradePath='server/src/services/trade/tradeMgrService.js';
const invAnchor='  writeItemCustomInfo,';
const invHook='  transferCoopManifestAtomically: (trade,roots,active) => require("../../space/coopNativeTradeAtomic").commitNative({trade,roots,activeShipIDs:active,readItems,writeItems,normalizeInventoryItem,buildInventoryItem,indexDeltaFromChanges,cloneValue,readCharacters,flushItems:()=>repo.flushTableSync(ITEMS_TABLE)}),';
const moneyAnchor='    const moneyTransferResult = this._completeMoneyTransfer(trade);';
const moneyHook='    if (process.env.EVEJS_COOP_ATOMIC_TRADE === "1") require("../../space/coopNativeTradeAtomic").assertZeroMoney(trade,this);';
const tradeOld='    const itemTransferResult = this._completeItemTransfers(trade);';
const tradeNew='    const itemTransferResult = process.env.EVEJS_COOP_ATOMIC_TRADE === "1" ? require("../inventory/itemStore").transferCoopManifestAtomically(trade,this._listTradeItems(trade),trade.traders.flatMap(id=>{const p=this._getParticipantSession(id,session);return p?[p.activeShipID,p._space?.shipID]:[]})) : this._completeItemTransfers(trade);';
function count(s,q){return s.split(q).length-1;}
function patch(text,file,remove=false){
 const eol=text.includes('\r\n')?'\r\n':'\n';
 const replace=(from,to)=>{if(count(text,from)!==1)throw Error('Unknown/duplicated source anchor: '+file+' '+from.slice(0,80));text=text.replace(from,to);};
 if(file===inventoryPath){
   if(remove){if(count(text,invHook)===1)replace(invHook+eol,'');return text;}
   if(count(text,invHook)===1)return text;
   replace(invAnchor,invHook+eol+invAnchor);return text;
 }
 if(file===tradePath){
   if(remove){
     if(count(text,tradeNew)===1)replace(tradeNew,tradeOld);
     if(count(text,moneyHook)===1)replace(moneyHook+eol,'');
     return text;
   }
   if(count(text,tradeNew)===1&&count(text,moneyHook)===1)return text;
   replace(moneyAnchor,moneyHook+eol+moneyAnchor);
   replace(tradeOld,tradeNew);return text;
 }
 throw Error('Unsupported pinned atomic trade source '+file);
}
module.exports={patch,inventoryPath,tradePath};