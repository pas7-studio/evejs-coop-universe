"use strict";
// Reversible modifications to the EXACT pinned native mining cycle and source-state writer.
const runtimeAnchor="  if (isNativeNpcEntity(entity)) {\n    appendNpcCargo(entity, mineableState.yieldTypeID, transferredQuantity);";
const runtimeReplace="  if (isNativeNpcEntity(entity)) {\n    if (!coopStrictNative) appendNpcCargo(entity, mineableState.yieldTypeID, transferredQuantity);";
const oldDelta="  const deltaResult = applyMiningDelta(";
const newDelta="  const deltaResult = coopStrictDelta || applyMiningDelta(";
const guard=`  // COOP_ALIFE_NATIVE_MINING_CONSERVATION_V1
  const coopStrictNative = isNativeNpcEntity(entity) &&
    process.env.EVEJS_COOP_NATIVE_MINING_CYCLE_CONSERVATION === "1";
  let coopStrictDelta = null;
  if (coopStrictNative) {
    const conserved = require("../../space/coopNativeMiningCycleConservation").settle({
      scene,entity,targetEntity,mineableState,miningResult,transferredQuantity,cycleBoundaryMs,
      debit: () => applyMiningDelta(scene,targetEntity,
        miningResult.normalQuantity,miningResult.wastedQuantity,{
          broadcast:true,nowMs:cycleBoundaryMs,sourceEntity:entity,moduleItem,
          quantityAdded:transferredQuantity,amountWasted:miningResult.wastedQuantity,
          amountCritBonus:miningResult.criticalHitQuantity,
          hasRewards:miningResult.rewardedQuantity>0,
          requireNativeMiningPersistence:true,
        }),
      credit: () => appendNpcCargo(entity,mineableState.yieldTypeID,transferredQuantity),
      readState: () => getMineableState(scene,targetID),
    });
    if (!conserved.success)
      return {success:false,stopReason:conserved.stopReason||"cargo"};
    coopStrictDelta = conserved.deltaResult;
  }
`;
const stateNeedle=`  repo.write(
    MINING_RUNTIME_TABLE,
    \`/systems/\${String(toInt(scene && scene.systemID, 0))}/entities/\${String(toInt(state && state.entityID, 0))}\`,
    cloneValue(state),
  );`;
const stateReplacement=stateNeedle.replace("  repo.write(","  const coopMiningPersistResult = repo.write(")+`
  if (options.requireNativeMiningPersistence === true &&
      (!coopMiningPersistResult || coopMiningPersistResult.success !== true))
    throw new Error("ALIFE06_MINING_STATE_WRITE_UNCONFIRMED");`;
const stateProp=`      persistBaseline: true,
    });
  }
  cache.byEntityID.set(normalizedState.entityID, normalizedState);`;
const statePropNew=`      persistBaseline: true,
      requireNativeMiningPersistence: options.requireNativeMiningPersistence === true,
    });
  }
  cache.byEntityID.set(normalizedState.entityID, normalizedState);`;
function transform(text,oldValue,newValue,remove){const a=remove?newValue:oldValue,b=remove?oldValue:newValue;if(text.split(a).length!==2)throw Error("ALIFE06 pinned anchor mismatch");return text.replace(a,b);}
function patch(source,file,remove=false){
 const eol=String(source).includes("\r\n")?"\r\n":"\n";
 const normalize=s=>s.replace(/\n/g,eol);
 let text=String(source);
 if(file.endsWith("/miningRuntime.js")){
  const marker=normalize(guard);
  const already=text.includes(marker);
  if(remove&&!already)return text;
  if(!remove&&already)return text;
  if(remove){
   text=transform(text,normalize(runtimeReplace),normalize(runtimeAnchor),true===false);
   text=transform(text,normalize(newDelta),normalize(oldDelta),false);
   text=transform(text,marker,"",false);
  }else{
   const start=text.indexOf(normalize(runtimeAnchor));
   if(start<0||text.indexOf(normalize(oldDelta),start)<0)throw Error("ALIFE06 missing stock mining cycle");
   text=text.slice(0,start)+marker+text.slice(start);
   text=transform(text,normalize(runtimeAnchor),normalize(runtimeReplace),false);
   text=transform(text,normalize(oldDelta),normalize(newDelta),false);
  }
 }else if(file.endsWith("/miningRuntimeState.js")){
  const a=normalize(stateNeedle),b=normalize(stateReplacement),c=normalize(stateProp),d=normalize(statePropNew);
  const already=text.includes(b)&&text.includes(d);
  if(remove&&!already)return text;
  if(!remove&&already)return text;
  if(remove){text=transform(text,b,a,false);text=transform(text,d,c,false);}
  else {text=transform(text,a,b,false);text=transform(text,c,d,false);}
 }else throw Error("Unsupported ALIFE06 module "+file);
 return text;
}
module.exports={patch};
