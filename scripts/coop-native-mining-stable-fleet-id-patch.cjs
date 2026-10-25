"use strict";
// ALIFE-09: reversible, original pinned EveJS fleetID compatibility layer.
// Native shipment cargo carries fleetID; it cannot change during restart.
const BEGIN='function createMiningFleetRecord(options = {}) {';
const PREPARE=[
 '  const coopStableFleetID=process.env.EVEJS_COOP_NATIVE_MINING_FLEET_DURABLE==="1" &&',
 '    options.source==="startup" && Number.isSafeInteger(Number(options.coopDurableFleetID)) &&',
 '    Number(options.coopDurableFleetID)>0 ? Number(options.coopDurableFleetID) : 0;',
 '  const fleetID=coopStableFleetID||nextMiningFleetID++;',
 '  if(miningFleetStateByID.has(fleetID))throw Error("ALIFE09_NATIVE_FLEET_ID_COLLISION");',
].join("\n");
const ORIGINAL='    fleetID: nextMiningFleetID++,';
const REPLACEMENT='    fleetID,';
const BOOT_OLD='      register:(slot,spawnResult)=>createMiningFleetRecord({';
const BOOT_NEW=BOOT_OLD+'\n        coopDurableFleetID:Number(scene.systemID)*32+Number(slot),';
function exactlyOnce(src,from,to){
 if(src.split(from).length!==2)throw Error("ALIFE09_STABLE_FLEET_ID_ANCHOR_DRIFT");
 return src.replace(from,to);
}
function patch(source,remove=false){
 const eol=String(source).includes("\r\n")?"\r\n":"\n";
 const n=x=>x.replace(/\n/g,eol);
 let text=String(source);
 if(!text.includes(n(BEGIN)))throw Error("ALIFE09_NATIVE_FLEET_CONSTRUCTOR_NOT_FOUND");
 const stageInstalled=text.includes(n(PREPARE))&&text.includes(n(BOOT_NEW));
 const stagePartial=text.includes(n(PREPARE))!==text.includes(n(BOOT_NEW));
 if(stagePartial||stageInstalled&&text.includes(n(ORIGINAL)))throw Error("ALIFE09_STABLE_FLEET_ID_PARTIAL_PATCH");
 if(remove&&!stageInstalled)return text;
 if(!remove&&stageInstalled)return text;
 if(remove){
  text=exactlyOnce(text,n(BOOT_NEW),n(BOOT_OLD));
  text=exactlyOnce(text,n(REPLACEMENT),n(ORIGINAL));
  text=exactlyOnce(text,n(PREPARE)+eol,"");
 }else{
  text=exactlyOnce(text,n(BEGIN),n(BEGIN)+eol+n(PREPARE));
  text=exactlyOnce(text,n(ORIGINAL),n(REPLACEMENT));
  text=exactlyOnce(text,n(BOOT_OLD),n(BOOT_NEW));
 }
 return text;
}
module.exports={patch};
