"use strict";
// Exact pinned source transformer. Only changes the opt-in native NPC combat
// path; normal player/legacy combat executes the original expressions.
function once(text,before,after,where){
 const n=text.split(before).length-1;
 if(n!==1)throw Error("Native ammo patch source drift "+where+" ("+n+")");
 return text.replace(before,after);
}
function segment(text,name,fn){
 const start=text.indexOf("function "+name+"(");
 if(start<0)throw Error("Unknown pinned fire function "+name);
 const stop=text.indexOf("\nfunction ",start+10);
 if(stop<0)throw Error("Unbounded pinned fire function "+name);
 const old=text.slice(start,stop),next=fn(old);
 return text.slice(0,start)+next+text.slice(stop);
}
const sourceProof=[
 '  if (isNativeNpcEntity(attackerEntity) && process.env.EVEJS_COOP_NPC_STRICT_AMMO === "1") {',
 '    const proof = require("./coopNpcFireDebitProof").verify({',
 '      entity: attackerEntity, moduleItem, chargeItem, quantity: consumeQuantity,',
 '    });',
 '    if (!proof.allowed) return { success: false, errorMsg: "NO_AMMO", stopReason: "ammo" };',
 '  }',
].join("\n");
const persistVerification=[
 '    if (isNativeNpcEntity(attackerEntity) && process.env.EVEJS_COOP_NPC_STRICT_AMMO === "1") {',
 '      let observed;',
 '      try {',
 '        observed = nativeNpcStore.listNativeCargoForEntity(entityID)',
 '          .filter((row) => toInt(row && row.cargoID, 0) === chargeItemID);',
 '      } catch (_) {',
 '        return { success: false, errorMsg: "AMMO_WRITE_UNVERIFIED", stopReason: "ammo" };',
 '      }',
 '      if (!Array.isArray(observed) ||',
 '        (nextQuantity > 0 ?',
 '          observed.length !== 1 ||',
 '          Number(observed[0].quantity) !== nextQuantity ||',
 '          toInt(observed[0].moduleID, 0) !== moduleID ||',
 '          Number(observed[0].typeID) !== Number(chargeItem.typeID) ||',
 '          Number(observed[0].ownerID) !== Number(attackerEntity.ownerID)',
 '          : observed.length !== 0)) {',
 '        return { success: false, errorMsg: "AMMO_WRITE_UNVERIFIED", stopReason: "ammo" };',
 '      }',
 '    }',
].join("\n");
const turretPreDebit=[
 '  // P0: before actual native fire or turret damage, verify the real',
 '  // fitted cargo. Stack ammo is debited before shot resolution; crystals',
 '  // are checked before firing but keep their native volatility semantics.',
 '  const strictNativeTurretProof = isNativeNpcEntity(attackerEntity) &&',
 '    process.env.EVEJS_COOP_NPC_STRICT_AMMO === "1" &&',
 '    !chargeOptionalTurretWeapon;',
 '  const strictNativeStackDebit = strictNativeTurretProof &&',
 '    resolvedWeaponSnapshot.chargeMode === "stack";',
 '  let strictNativeDebitResults = null;',
 '  if (strictNativeTurretProof) {',
 '    const proof = require("./coopNpcFireDebitProof").verifyBank({',
 '      entity: attackerEntity, entries: activeTurretEntries,',
 '    });',
 '    if (!proof.allowed) return { success: false, errorMsg: "NO_AMMO", stopReason: "ammo" };',
 '    if (effectState._coopStrictAmmoLastBoundaryMs === cycleBoundaryMs)',
 '      return { success: false, errorMsg: "NATIVE_FIRE_CYCLE_REPLAY", stopReason: "ammo" };',
 '    effectState._coopStrictAmmoLastBoundaryMs = cycleBoundaryMs;',
 '  }',
 '  if (strictNativeStackDebit) {',
 '    strictNativeDebitResults = new Map();',
 '    for (const entry of activeTurretEntries) {',
 '      const debit = consumeTurretAmmoCharge(',
 '        attackerEntity, entry.moduleItem, entry.chargeItem, cycleBoundaryMs,',
 '      );',
 '      if (!debit.success) return { success: false, errorMsg: "AMMO_UPDATE_FAILED", stopReason: "ammo" };',
 '      strictNativeDebitResults.set(toInt(entry.moduleItem.itemID, 0), debit);',
 '    }',
 '  }',
].join("\n");
const turretOld=[
 '    const chargeResult = resolvedWeaponSnapshot.chargeMode === "crystal"',
 '      ? applyCrystalVolatilityDamage(',
 '        scene,',
 '        attackerEntity,',
 '        currentModuleItem,',
 '        currentChargeItem,',
 '        cycleBoundaryMs,',
 '      )',
 '      : consumeTurretAmmoCharge(',
 '        attackerEntity,',
 '        currentModuleItem,',
 '        currentChargeItem,',
 '        cycleBoundaryMs,',
 '      );',
].join("\n");
const turretNew=[
 '    const chargeResult = strictNativeDebitResults',
 '      ? strictNativeDebitResults.get(toInt(currentModuleItem.itemID, 0))',
 '      : resolvedWeaponSnapshot.chargeMode === "crystal"',
 '        ? applyCrystalVolatilityDamage(',
 '          scene,',
 '          attackerEntity,',
 '          currentModuleItem,',
 '          currentChargeItem,',
 '          cycleBoundaryMs,',
 '        )',
 '        : consumeTurretAmmoCharge(',
 '          attackerEntity,',
 '          currentModuleItem,',
 '          currentChargeItem,',
 '          cycleBoundaryMs,',
 '        );',
].join("\n");
const missilePreflight=[
 '  if (isNativeNpcEntity(attackerEntity) && process.env.EVEJS_COOP_NPC_STRICT_AMMO === "1") {',
 '    const proof = require("./coopNpcFireDebitProof").verifyBank({',
 '      entity: attackerEntity, entries: armedEntries,',
 '    });',
 '    if (!proof.allowed) return { success: false, errorMsg: "NO_AMMO", stopReason: "ammo" };',
 '    if (effectState._coopStrictAmmoLastBoundaryMs === cycleBoundaryMs)',
 '      return { success: false, errorMsg: "NATIVE_FIRE_CYCLE_REPLAY", stopReason: "ammo" };',
 '    effectState._coopStrictAmmoLastBoundaryMs = cycleBoundaryMs;',
 '  }',
].join("\n");
const missileFail=[
 '  if (groupedAmmoFailure && isNativeNpcEntity(attackerEntity) &&',
 '      process.env.EVEJS_COOP_NPC_STRICT_AMMO === "1") {',
 '    return { success: false, errorMsg: "AMMO_UPDATE_FAILED", stopReason: "ammo" };',
 '  }',
].join("\n");
function patch(source,{remove=false}={}){
 let text=source;
 const eol=text.includes("\r\n")?"\r\n":"\n",e=x=>x.replace(/\n/g,eol);
 // Each section has a unique before/after anchor, and the presence of an
 // insertion is checked per section. This supports repeated apply + remove.
 const modify=(name,changes)=>{
  text=segment(text,name,body=>{
   for(const [base,added,where] of changes){
    const old=e(base),fresh=e(added);
    if(remove){
     if(body.includes(fresh))body=once(body,fresh,old,where);
     else if(!body.includes(old))throw Error("Unknown patched fire source "+where);
    }else{
     if(body.includes(fresh))continue;
     body=once(body,old,fresh,where);
    }
   }
   return body;
  });
 };
 const quantity='  const nextQuantity = Math.max(0, previousQuantity - consumeQuantity);';
 const nativeCargoCache='    if (Array.isArray(attackerEntity.nativeCargoItems)) {';
 modify("consumeTurretAmmoCharge",[
  [quantity,sourceProof+"\n"+quantity,"native-source-proof"],
  [nativeCargoCache,persistVerification+"\n"+nativeCargoCache,"native-debit-commit-proof"]
 ]);
 const fire='  const shotResult = resolveTurretShot({';
 modify("executeTurretCycle",[
  [fire,turretPreDebit+"\n\n"+fire,"pre-damage debit"],
  [turretOld,turretNew,"single native debit"]
 ]);
 const start='  const chargeResults = [];';
 const check='  if (groupedAmmoFailure && chargeResults.every((entry) => !entry.result || !entry.result.success)) {';
 modify("executeMissileCycle",[
  [start,missilePreflight+"\n"+start,"missile bank preflight"],
  [check,missileFail+"\n"+check,"block partial bank launch"]
 ]);
 // Syntax validation is performed by the caller's existing vm.Script.
 return text;
}
module.exports={patch};
