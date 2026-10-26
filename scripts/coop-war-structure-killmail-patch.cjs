"use strict";
// Reversible, exact-source native combat killmail hook. Admin structure
// damage does not call recordKillmailFromDestruction; it cannot satisfy
// this origin. Never modify stock killmail, loot, damage, XP or payouts.
const BEFORE='  ledgersByVictim.delete(ledgerKey);\n  return record;';
const CALL=[
 '  if (process.env.EVEJS_COOP_FACTION_WAR_NATIVE_OBJECTIVES === "1" &&',
 '      record && toPositiveInt(record.killID, 0) > 0 &&',
 '      String(targetEntity.kind || "").toLowerCase() === "structure") {',
 '    try {',
 '      require("../coopWarNativeStructureCombatProof").noteNativeStructureKill({',
 '        targetEntity, destroyResult, record,',
 '        attackerEntity: options.attackerEntity || null,',
 '      });',
 '    } catch (error) {',
 '      console.warn("[CoopWarStructureCombat] witness", error.message);',
 '    }',
 '  }'
].join("\n");
function patch(source,{remove=false}={}){
 const eol=source.includes("\r\n")?"\r\n":"\n";
 const original=BEFORE.replace(/\n/g,eol);
 const hooked=(CALL+"\n"+BEFORE).replace(/\n/g,eol);
 const count=(needle)=>source.split(needle).length-1;
 if(count(original)!==1)return (()=>{throw Error("FW_009B_NATIVE_KILLMAIL_ANCHOR_CHANGED")})();
 if(remove){
  if(count(hooked)===1)return source.replace(hooked,original);
  if(count(CALL.replace(/\n/g,eol))!==0)
   throw Error("FW_009B_NATIVE_KILLMAIL_UNEXPECTED_PATCH");
  return source;
 }
 if(count(hooked)===1)return source;
 if(count(CALL.replace(/\n/g,eol))!==0)
  throw Error("FW_009B_NATIVE_KILLMAIL_DUPLICATE_HOOK");
 return source.replace(original,hooked);
}
module.exports={patch};
