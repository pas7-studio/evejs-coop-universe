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
const turretPreDebit=[
 '  // P0: in strict mode a real NPC shell is debited BEFORE calculating',
 '  // damage or a miss. The original post-shot code then reuses this exact',
 '  // result instead of debiting the same charge stack a second time.',
 '  const strictNativeStackDebit = isNativeNpcEntity(attackerEntity) &&',
 '    process.env.EVEJS_COOP_NPC_STRICT_AMMO === "1" &&',
 '    resolvedWeaponSnapshot.chargeMode === "stack" &&',
 '    !chargeOptionalTurretWeapon;',
 '  let strictNativeDebitResults = null;',
 '  if (strictNativeStackDebit) {',
 '    const proof = require("./coopNpcFireDebitProof").verifyBank({',
 '      entity: attackerEntity, entries: activeTurretEntries,',
 '    });',
 '    if (!proof.allowed) return { success: false, errorMsg: "NO_AMMO", stopReason: "ammo" };',
 '    if (effectState._coopStrictAmmoLastBoundaryMs === cycleBoundaryMs)',
 '      return { success: false, errorMsg: "NATIVE_FIRE_CYCLE_REPLAY", stopReason: "ammo" };',
 '    effectState._coopStrictAmmoLastBoundaryMs = cycleBoundaryMs;',
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
 modify("consumeTurretAmmoCharge",[[quantity,sourceProof+"\n"+quantity,"native-source-proof"]]);
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
