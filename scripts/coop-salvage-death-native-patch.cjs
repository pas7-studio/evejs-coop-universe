"use strict";
// Reversible source hook for the exact pinned EveJS NPC death routine.
const FILE="server/src/space/npc/nativeNpcWreckService.js";
const changes=[
 ["  const nativeEntityRecord = nativeNpcStore.getNativeEntity(entityID);",
  ["  const nativeEntityRecord = nativeNpcStore.getNativeEntity(entityID);",
   "  if (process.env.EVEJS_COOP_SALVAGE_NATIVE_DEATH === \"1\" &&",
   "      nativeNpcStore.listNativeWrecks().some(w=>w.sourceEntityID === entityID)) {",
   "    return {success:false,errorMsg:\"SALVAGE_EXISTING_NATIVE_WRECK_NEEDS_RECONCILIATION\"};",
   "  }"].join("\n")],
 ["  const cargoDrops = nativeNpcStore.buildNativeCargoItems(entityID);",
  ["  const cargoDrops = nativeNpcStore.buildNativeCargoItems(entityID);",
   "  let coopSalvageCargoMoved=false;",
   "  if (process.env.EVEJS_COOP_SALVAGE_NATIVE_DEATH === \"1\" && cargoDrops.length) {",
   "    const prepared=[];",
   "    for(const original of cargoDrops){",
   "      if(!Number.isSafeInteger(original.itemID)||original.itemID<=0||",
   "         !Number.isSafeInteger(original.quantity)||original.quantity<=0){",
   "        nativeNpcStore.removeNativeWreckCascade(wreckRecord.wreckID);",
   "        return {success:false,errorMsg:\"SALVAGE_SOURCE_CARGO_ID_UNVERIFIED\"};",
   "      }",
   "      const itemType=resolveItemByTypeID(original.typeID)||",
   "       {typeID:original.typeID,name:original.itemName};",
   "      const result=buildNativeWreckItemRecord(wreckRecord,itemType,{",
   "       quantity:original.quantity,singleton:original.singleton,",
   "       moduleState:original.moduleState,moduleID:original.moduleID,",
   "       sourceKind:\"cargo\"});",
   "      if(result.success!==true||!result.data){",
   "       nativeNpcStore.removeNativeWreckCascade(wreckRecord.wreckID);",
   "       return result;",
   "      }",
   "      prepared.push({...result.data,sourceCargoID:original.itemID});",
   "    }",
   "    const committed=require(\"../coopSalvageDeathAtomic\").movePinned({",
   "      wreckRecord,originalCargo:cargoDrops,preparedWreckItems:prepared});",
   "    if(committed?.status!==\"SALVAGE_NATIVE_CARGO_TO_WRECK_COMMITTED\"){",
   "      nativeNpcStore.removeNativeWreckCascade(wreckRecord.wreckID);",
   "      return {success:false,errorMsg:committed?.status||",
   "       \"SALVAGE_NATIVE_CARGO_MOVE_UNVERIFIED\"};",
   "    }",
   "    coopSalvageCargoMoved=true;",
   "  }"].join("\n")],
 ["  for (const cargoEntry of cargoDrops) {",
  ["  for (const cargoEntry of cargoDrops) {",
   "    if(coopSalvageCargoMoved)break;"].join("\n")]
];
function patch(source,remove=false){
 let s=source;
 for(const [oldLine,newLine] of changes){
  const from=remove?newLine:oldLine,to=remove?oldLine:newLine;
  const count=s.split(from).length-1;
  if(count===0&&s.includes(to))continue;
  if(count!==1||s.includes(to))throw Error("SALVAGE_PINNED_NATIVE_DEATH_DRIFT:"+oldLine.slice(0,90));
  s=s.replace(from,to);
 }
 return s;
}
module.exports={patch,FILE};
