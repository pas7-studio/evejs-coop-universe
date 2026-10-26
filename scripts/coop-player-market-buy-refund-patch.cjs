"use strict";
// Reversible original native BUY cancel/expiry bypass, layered AFTER
// installed BUY reserve/atomic source guards. All paths default OFF.
const f='process.env.EVEJS_COOP_PLAYER_MARKET_BUY_REFUND === "1"';
function patch(source,{remove=false}={}){
 if(typeof source!=="string")throw Error("P2P_BUY_REFUND_MARKET_SOURCE_REQUIRED");
 const nl=source.includes("\r\n")?"\r\n":"\n";
 let text=source;
 function edit(start,stop,anchor,code,{after=true}={}){
  const i=text.indexOf(start),j=text.indexOf(stop,i+start.length);
  if(i<0||j<0||text.indexOf(start,i+start.length)>=0)
   throw Error("P2P_BUY_REFUND_NATIVE_SCOPE_DRIFT");
  const part=text.slice(i,j),base=anchor.replace(/\n/g,nl),
   hook=code.replace(/\n/g,nl);
  const installed=after?base+nl+hook:hook+nl+base;
  const count=(a,b)=>a.split(b).length-1;
  if(count(part,installed)===1){
   if(remove)text=text.slice(0,i)+part.replace(installed,base)+text.slice(j);
  }else if(count(part,base)===1&&!part.includes(hook)){
   if(!remove)text=text.slice(0,i)+part.replace(base,installed)+text.slice(j);
  }else throw Error("P2P_BUY_REFUND_SOURCE_HOOK_DRIFT");
 }
 const expiry="async function applyExpiredOrderEvent(event) {",
  cancelled="function applyCancelledStructureMarketOrder(order) {",
  cancel="  async Handle_CancelCharOrder(args, session) {",
  place="  async Handle_PlaceBuyOrder(args, session) {";
 edit(expiry,cancelled,'  if (normalizeBoolean(orderRow && orderRow.bid)) {',
  '    if ('+f+') {\n'+
  '      await require("../../space/coopPlayerMarketBuyRefundRuntime").expire({client:marketDaemonClient,order});\n'+
  '      const acct=require("../account/walletState");\n'+
  '      acct.notifyCharacterWalletChange(ownerID,acct.getCharacterWallet(ownerID));\n'+
  '      notifyOwnOrdersChanged(ownerID,[{...order,state:"expired"}],ORDER_REASON_EXPIRED);\n'+
  '      return;\n'+
  '    }');
 edit(cancel,place,'      ensureStructureMarketServiceAccess(session, stationID);',
  '      if ('+f+' && normalizeBoolean(orderRow && orderRow.bid)) {\n'+
  '        await require("../../space/coopPlayerMarketBuyRefundRuntime").cancel({client:marketDaemonClient,order});\n'+
  '        const ownerID=normalizePositiveInteger(order && order.owner_id,0);\n'+
  '        const acct=require("../account/walletState");\n'+
  '        acct.notifyCharacterWalletChange(ownerID,acct.getCharacterWallet(ownerID));\n'+
  '        notifyOwnOrdersChanged(ownerID,[{...order,state:"cancelled"}],ORDER_REASON_CANCELLED);\n'+
  '        return null;\n'+
  '      }');
 return text;
}
module.exports={patch};
