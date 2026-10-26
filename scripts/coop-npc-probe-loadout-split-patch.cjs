"use strict";
// EX-03B3: authoring-time *original* NPC scanner charge unitization.
// Each charge is still allocated by pinned nativeNpcStore.allocateCargoID.
// Never rewrite existing cargo stacks or generate synthetic stock at runtime.
const FILE="server/src/space/npc/nativeNpcService.js";
function replaceExactly(source,from,to,remove){
 if(!remove&&source.includes(to))return source;
 if(remove&&!source.includes(to)&&source.includes(from))return source;
 const a=remove?to:from,b=remove?from:to;
 if(source.split(a).length!==2)throw Error("NPC_PROBE_LOADOUT_SOURCE_DRIFT");
 return source.replace(a,b);
}
function patch(source,file,remove=false){
 if(file!==FILE)return source;
 const open=`    const quantityPerModule = Math.max(
      1,
      toPositiveInt(chargeEntry && chargeEntry.quantityPerModule, 1),
    );
    for (const moduleRecord of moduleRecords) {
      if (!isNpcChargeCompatibleWithModule(moduleRecord, chargeType.typeID)) {
        continue;
      }`;
 const guarded=`${open}
      // COOP_EX03B3_SPLIT_OPEN
      const splitNativeScannerCharges =
        process.env.EVEJS_COOP_NPC_PROBE_LOADOUT_SPLIT === "1" &&
        process.env.EVEJS_COOP_NPC_PROBE_LAUNCH === "1" &&
        toPositiveInt(chargeType.groupID, 0) === 479 &&
        toPositiveInt(chargeType.categoryID, 0) === 8 &&
        toPositiveInt(moduleRecord.groupID, 0) === 481 &&
        chargeEntry.singleton !== true &&
        quantityPerModule >= 4 && quantityPerModule <= 8 &&
        transient !== true;
      const originalUnits = splitNativeScannerCharges ? quantityPerModule : 1;
      for (let originalUnit = 0; originalUnit < originalUnits; originalUnit += 1) {
      // COOP_EX03B3_SPLIT_OPEN_END`;
 let s=replaceExactly(source,open,guarded,remove);
 const quantity="        quantity: quantityPerModule,";
 const qtyChanged="        quantity: splitNativeScannerCharges ? 1 : quantityPerModule,";
 s=replaceExactly(s,quantity,qtyChanged,remove);
 const close=`      cargoRecords.push(cargoRecord);
    }
  }

  const authoredCargo = Array.isArray(`;
 const closePatched=`      cargoRecords.push(cargoRecord);
      // COOP_EX03B3_SPLIT_CLOSE
      }
      // COOP_EX03B3_SPLIT_CLOSE_END
    }
  }

  const authoredCargo = Array.isArray(`;
 return replaceExactly(s,close,closePatched,remove);
}
module.exports={patch,FILE};
