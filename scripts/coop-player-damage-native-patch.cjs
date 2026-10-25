"use strict";
// Reversible, exact-source helper. Integration with the main overlay installer
// remains a separate gated handoff; this helper never mutates a checkout.
const needle = [
 "  ledger.attackers[attackerKey] = currentEntry;",
 "  ledger.damageTaken = toFiniteNumber(ledger.damageTaken, 0) + damageAmount;",
 "  ledger.lastUpdatedAtMs = whenMs;"
].join("\n");
const hook = [
 "  if (process.env.EVEJS_COOP_PLAYER_DAMAGE_EVIDENCE === \"1\") {",
 "    try { require(\"../coopPlayerCombatWitness\").note(attackerEntity, targetEntity, damageAmount); }",
 "    catch (error) { console.warn(\"[CoopPlayerCombatWitness]\", error.message); }",
 "  }"
].join("\n");
function patch(source,{remove=false}={}){
 if(typeof source!=="string" || !source.includes("function noteDamage(attackerEntity, targetEntity, appliedDamage, options = {}) {"))
  throw Error("UNKNOWN_PINNED_KILLMAIL_TRACKER_SOURCE");
 const count=(s,sub)=>s.split(sub).length-1;
 if(count(source,needle)!==1)throw Error("UNKNOWN_PINNED_DAMAGE_HOOK_ANCHOR");
 const installed=needle+"\n"+hook;
 if(count(source,"coopPlayerCombatWitness")>1)throw Error("DUPLICATE_NATIVE_DAMAGE_HOOK");
 if(remove){
  if(count(source,installed)===1)return source.replace(installed,needle);
  if(!source.includes("coopPlayerCombatWitness"))return source;
  throw Error("PARTIAL_NATIVE_DAMAGE_HOOK");
 }
 if(count(source,installed)===1)return source;
 if(source.includes("coopPlayerCombatWitness"))throw Error("PARTIAL_NATIVE_DAMAGE_HOOK");
 return source.replace(needle,installed);
}
module.exports={patch};
