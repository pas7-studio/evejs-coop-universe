"use strict";
// EX03B18 exact source-anchored reversible native NPC wreck custody.
const WRECK="server/src/space/npc/nativeNpcWreckService.js",STORE="server/src/space/npc/nativeNpcStore.js";
const edits={
  "server/src/space/npc/nativeNpcWreckService.js": [
    {
      "before": "  const removeResult = spaceRuntime.removeDynamicEntity(normalizedSystemID, entityID, {",
      "after": "  // EX03B18_NATIVE_WRECK_STAGE\n  if (process.env.EVEJS_COOP_NPC_EXPEDITION_WRECK===\"1\") {\n    const staged=require(path.join(__dirname, \"../coopNpcExpeditionWreckCustody\")).createNpcExpeditionWreckCustody({items:require(path.join(__dirname, \"../../services/inventory/itemStore\")),npcStore:nativeNpcStore,gameStore:require(path.join(__dirname, \"../../gameStore\"))}).stage({\n      wreckID:wreckRecord.wreckID,shipID:entityID,\n      corporationID:nativeEntityRecord?.corporationID\n    });\n    if(staged?.success!==true)\n      return {success:false,errorMsg:staged?.errorMsg||\"EX03_WRECK_CUSTODY_REPAIR_REQUIRED\"};\n  }\n  const removeResult = spaceRuntime.removeDynamicEntity(normalizedSystemID, entityID, {"
    },
    {
      "before": "  const wreckItemRecord = nativeNpcStore.getNativeWreckItem(wreckItemID);",
      "after": "  // EX03B18_NATIVE_ORIGINAL_ITEM_PICKUP\n  if (process.env.EVEJS_COOP_NPC_EXPEDITION_WRECK===\"1\") {\n    const original=require(path.join(__dirname, \"../coopNpcExpeditionWreckCustody\")).createNpcExpeditionWreckCustody({items:require(path.join(__dirname, \"../../services/inventory/itemStore\")),npcStore:nativeNpcStore,gameStore:require(path.join(__dirname, \"../../gameStore\"))}).claim({\n      characterID,wreckID,itemID:wreckItemID,\n      destinationLocationID,destinationFlagID,quantity:options.quantity\n    });\n    if(original?.status===\"HANDLED\") {\n      if(original.success===true)refreshNativeWreckRuntimeEntity(wreckRecord.systemID,wreckID,{broadcast:true});\n      return original.success===true?{success:true,data:original.data}:\n        {success:false,errorMsg:original.errorMsg||\"EX03_WRECK_CLAIM_UNCERTAIN\"};\n    }\n  }\n  const wreckItemRecord = nativeNpcStore.getNativeWreckItem(wreckItemID);"
    },
    {
      "before": "  const systemID = toPositiveInt(options.systemID, toPositiveInt(wreckRecord.systemID, 0));",
      "after": "  // EX03B18_NATIVE_WRECK_DECAY_GUARD\n  if (process.env.EVEJS_COOP_NPC_EXPEDITION_WRECK===\"1\" && !require(path.join(__dirname, \"../coopNpcExpeditionWreckCustody\")).createNpcExpeditionWreckCustody({items:require(path.join(__dirname, \"../../services/inventory/itemStore\")),npcStore:nativeNpcStore,gameStore:require(path.join(__dirname, \"../../gameStore\"))}).canDestroy(wreckID))\n    return {success:false,errorMsg:\"EX03_ORIGINAL_ITEMSTORE_WRECK_NOT_EMPTY\"};\n  const systemID = toPositiveInt(options.systemID, toPositiveInt(wreckRecord.systemID, 0));"
    },
    {
      "before": "  entity.isEmpty = nativeNpcStore.listNativeWreckItemsForWreck(normalizedWreckID).length === 0;",
      "after": "  // EX03B18_NATIVE_WRECK_SLIM_REFRESH\n  entity.isEmpty = nativeNpcStore.listNativeWreckItemsForWreck(normalizedWreckID).length === 0 &&\n    (!process.env.EVEJS_COOP_NPC_EXPEDITION_WRECK===\"1\" || require(path.join(__dirname, \"../coopNpcExpeditionWreckCustody\")).createNpcExpeditionWreckCustody({items:require(path.join(__dirname, \"../../services/inventory/itemStore\")),npcStore:nativeNpcStore,gameStore:require(path.join(__dirname, \"../../gameStore\"))}).list({wreckID:normalizedWreckID}).length===0);"
    },
    {
      "before": "    ).length === 0;\n  entity.launcherID =",
      "after": "    ).length === 0 &&\n    (!process.env.EVEJS_COOP_NPC_EXPEDITION_WRECK===\"1\" || require(path.join(__dirname, \"../coopNpcExpeditionWreckCustody\")).createNpcExpeditionWreckCustody({items:require(path.join(__dirname, \"../../services/inventory/itemStore\")),npcStore:nativeNpcStore,gameStore:require(path.join(__dirname, \"../../gameStore\"))}).list({wreckID:wreckRecord.wreckID}).length===0);\n  entity.launcherID ="
    },
    {
      "before": "  if (!removeResult.success) {\n    nativeNpcStore.removeNativeWreckCascade(wreckRecord.wreckID);\n    return removeResult;\n  }",
      "after": "  if (!removeResult.success) {\n    // EX03B18_NATIVE_DEATH_FAILURE_FENCE: original item IDs may already\n    // be in a durable wreck. Do not cascade-delete their authoritative home.\n    if (process.env.EVEJS_COOP_NPC_EXPEDITION_WRECK===\"1\" &&\n        !require(path.join(__dirname, \"../coopNpcExpeditionWreckCustody\"))\n          .createNpcExpeditionWreckCustody({\n           items:require(path.join(__dirname, \"../../services/inventory/itemStore\")),\n           npcStore:nativeNpcStore,gameStore:require(path.join(__dirname, \"../../gameStore\"))\n          }).canDestroy(wreckRecord.wreckID))\n      return {success:false,errorMsg:\"EX03_WRECK_DEATH_DESTRUCTION_NEEDS_OPERATOR_REPAIR\"};\n    nativeNpcStore.removeNativeWreckCascade(wreckRecord.wreckID);\n    return removeResult;\n  }"
    },
    {
      "before": "    sourceEntityID: entityID,\n    systemID: normalizedSystemID,",
      "after": "    sourceEntityID: entityID,\n    // EX03B18_SOURCE_CORPORATION: killer/loot-right corporation may differ\n    // from the original NPC corporation which owns the physical loot.\n    coopNpcExpeditionSourceCorpID: process.env.EVEJS_COOP_NPC_EXPEDITION_WRECK===\"1\"\n      ? Number(nativeEntityRecord?.corporationID)||0 : 0,\n    systemID: normalizedSystemID,"
    }
  ],
  "server/src/space/npc/nativeNpcStore.js": [
    {
      "before": "  }));\n}\n\nmodule.exports = {",
      "after": "  })).concat(process.env.EVEJS_COOP_NPC_EXPEDITION_WRECK===\"1\" ?\n    require(path.join(__dirname, \"../coopNpcExpeditionWreckCustody\")).createNpcExpeditionWreckCustody({items:require(path.join(__dirname, \"../../services/inventory/itemStore\")),npcStore:require(path.join(__dirname, \"./nativeNpcStore\")),gameStore:database}).list({wreckID:normalizedWreckID}) : []);\n}\n// EX03B18_NATIVE_WRECK_CONTENTS\nmodule.exports = {"
    }
  ]
};
function patch(source,file,remove=false){
 if(!edits[file])return source;
 if(!remove){
  const marks=file===WRECK?
   ["EX03B18_NATIVE_WRECK_STAGE","EX03B18_NATIVE_ORIGINAL_ITEM_PICKUP",
    "EX03B18_NATIVE_WRECK_DECAY_GUARD","EX03B18_NATIVE_WRECK_SLIM_REFRESH",
    "EX03B18_NATIVE_DEATH_FAILURE_FENCE","EX03B18_SOURCE_CORPORATION"]:
   ["EX03B18_NATIVE_WRECK_CONTENTS"];
  const present=marks.filter(x=>source.includes(x));
  if(present.length===marks.length)return source;
  if(present.length)throw Error("EX03B18_PARTIAL_NATIVE_SOURCE_PATCH:"+file);
 }
 const eol=source.includes("\r\n")?"\r\n":"\n";
 let result=source;
 const list=remove?[...edits[file]].reverse():edits[file];
 for(const entry of list){
  const before=(remove?entry.after:entry.before).replace(/\n/g,eol);
  const after=(remove?entry.before:entry.after).replace(/\n/g,eol);
  if((!remove&&result.includes(after))||(remove&&result.includes(after)&&!result.includes(before)))continue;
  if(result.split(before).length!==2)throw Error("EX03B18_PINNED_WRECK_SOURCE_DRIFT:"+file);
  result=result.replace(before,after);
 }
 return result;
}
module.exports={patch,WRECK,STORE};
