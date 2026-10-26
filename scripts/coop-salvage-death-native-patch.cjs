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
// Stock pickup grants the destination before source removal; original
// salvage sourceIDs must use the two-stage native ACID path.
const vanillaPickupAnchor="  const wreckItemRecord = nativeNpcStore.getNativeWreckItem(wreckItemID);";
const vanillaPickupGuard=[
 vanillaPickupAnchor,
 '  if (process.env.EVEJS_COOP_SALVAGE_ATOMIC_TRANSFER === "1" &&',
 '      Number(wreckItemRecord?.sourceCargoID)>0) {',
 '    return {success:false,errorMsg:"SALVAGE_USE_NATIVE_ATOMIC_PICKUP"};',
 '  }'
].join("\n");
function patch(source,remove=false){
 let s=source;
 if(remove){
  if(s.includes(vanillaPickupGuard))s=s.replace(vanillaPickupGuard,vanillaPickupAnchor);
  else if(!s.includes(vanillaPickupAnchor))throw Error("SALVAGE_NATIVE_PICKUP_ANCHOR_DRIFT");
 }else{
  if(!s.includes(vanillaPickupGuard)){
   if(s.split(vanillaPickupAnchor).length!==2)
    throw Error("SALVAGE_NATIVE_PICKUP_ANCHOR_DRIFT");
   s=s.replace(vanillaPickupAnchor,vanillaPickupGuard);
  }
 }
 for(const [oldLine,newLine] of changes){
  if(remove){
   if(s.includes(newLine)){s=s.replace(newLine,oldLine);continue;}
   if(s.includes(oldLine))continue;
  }else{
   if(s.includes(newLine))continue;
   if(s.split(oldLine).length===2){s=s.replace(oldLine,newLine);continue;}
  }
  throw Error("SALVAGE_PINNED_NATIVE_DEATH_DRIFT:"+oldLine.slice(0,90));
 }
 // The native routine otherwise removes the entire wreck on later loot or
 // physical scene errors. Never erase cargo that was ALREADY ACID moved.
 // Guard every post-cargo cleanup site, without changing default OFF behavior.
 const start=s.indexOf("  const lootTable = nativeEntityRecord && nativeEntityRecord.lootTableID");
 const stop=s.indexOf("  const wreckSpawnResult = spawnNativeWreck",start);
 if(start<0||stop<0||stop<=start)throw Error("SALVAGE_DEATH_CLEANUP_REGION_DRIFT");
 const original="nativeNpcStore.removeNativeWreckCascade(wreckRecord.wreckID);";
 const safe="if(!coopSalvageCargoMoved)nativeNpcStore.removeNativeWreckCascade(wreckRecord.wreckID);";
 const section=s.slice(start,stop);
 // The old replace() recursively wrapped an already guarded cleanup on
 // re-install: if(!moved)if(!moved)removeNativeWreckCascade(...). Normalize
 // all existing guard layers FIRST to make install and uninstall idempotent.
 let canonical=section;
 for(let i=0;i<32&&canonical.includes(safe);i++)
  canonical=canonical.split(safe).join(original);
 if(canonical.includes(safe)||!canonical.includes(original))
  throw Error("SALVAGE_DEATH_CLEANUP_ANCHOR_MISSING");
 const after=remove?canonical:canonical.split(original).join(safe);
 s=s.slice(0,start)+after+s.slice(stop);
 return s;
}
module.exports={patch,FILE};
