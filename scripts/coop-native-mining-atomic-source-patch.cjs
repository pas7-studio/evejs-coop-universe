"use strict";
// Run AFTER ALIFE-06's pinned transformation; uninstall BEFORE ALIFE-06.
const FROM='    const conserved = require("../../space/coopNativeMiningCycleConservation").settle({';
const TO='    const conserved = (process.env.EVEJS_COOP_NATIVE_MINING_CYCLE_ATOMIC === "1" ? require("../../space/coopNativeMiningAtomic") : require("../../space/coopNativeMiningCycleConservation")).settle({';
const SRC='      credit: () => appendNpcCargo(entity,mineableState.yieldTypeID,transferredQuantity),';
const DST=[
'      credit: () => appendNpcCargo(entity,mineableState.yieldTypeID,transferredQuantity),',
'      moduleItem,',
'      commitScene: () => applyMiningDelta(scene,targetEntity,',
'        transferredQuantity,miningResult.wastedQuantity,{',
'          broadcast:true,nowMs:cycleBoundaryMs,sourceEntity:entity,moduleItem,',
'          quantityAdded:transferredQuantity,amountWasted:miningResult.wastedQuantity,',
'          amountCritBonus:miningResult.criticalHitQuantity,',
'          hasRewards:miningResult.rewardedQuantity>0,',
'          coopNativeAtomicCommitConfirmed:true,',
'        }),',
].join("\n");
const STATE_FROM="  if (shouldPersistMineableState(entity)) {";
const STATE_TO="  if (shouldPersistMineableState(entity) && options.coopNativeAtomicCommitConfirmed !== true) {";
function once(text,a,b){
 if(text.split(a).length!==2)throw Error("ALIFE07_SOURCE_ANCHOR_MISMATCH");
 return text.replace(a,b);
}
function patch(source,file,remove=false){
 const eol=String(source).includes("\r\n")?"\r\n":"\n";
 const norm=x=>x.replace(/\n/g,eol);
 let text=String(source);
 if(file.endsWith("/miningRuntime.js")){
  const a=norm(FROM),b=norm(TO),c=norm(SRC),d=norm(DST);
  const done=text.includes(b)&&text.includes(d);
  if(text.includes(b)!==text.includes(d))throw Error("ALIFE07_TORN_CYCLE_PATCH");
  if(remove&&!done)return text;
  if(!remove&&done)return text;
  text=remove?once(once(text,b,a),d,c):once(once(text,a,b),c,d);
 }else if(file.endsWith("/miningRuntimeState.js")){
  const a=norm(STATE_FROM),b=norm(STATE_TO);
  const done=text.includes(b);
  if(done && !text.includes("ALIFE06_MINING_STATE_WRITE_UNCONFIRMED"))
    throw Error("ALIFE07_MINING_STATE_DEPENDENCY_MISSING");
  if(remove&&!done)return text;
  if(!remove&&done)return text;
  text=remove?once(text,b,a):once(text,a,b);
 }else throw Error("ALIFE07_UNKNOWN_PATCH_FILE");
 return text;
}
module.exports={patch};
