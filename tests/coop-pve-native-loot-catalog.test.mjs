import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {inspect}=require("../scripts/audit-pve-native-loot-catalog.cjs");
const table={lootTableID:"parity_deadspace_overseer_pending_loot",mode:"rule",
 selectors:[{grade:"deadspace",weight:2},{grade:"faction",weight:5},
 {kind:"ammo",weight:3}]};
const profile={profileID:"native-overseer",lootTableID:table.lootTableID};
const run=(p=[profile],t=[table])=>inspect({profiles:{npcProfiles:p},
 lootTables:{lootTables:t}});
test("original source NPC profile must bind the overseer table, with configured rare rules",()=>{
 const r=run();assert.equal(r.status,"SOURCE_AUTHORED_BOSS_TABLE_LINK_PRESENT");
 assert.equal(r.bossProfiles,1);assert.equal(r.rareSelectors,2);
 assert.equal(r.actualRareDropVerified,false);
 assert.equal(r.candidatePoolProven,false);
});
test("rare table existing alone without any real NPC profile is a release blocker",()=>{
 assert.equal(run([]).status,"ORIGINAL_BOSS_RARE_LOOT_UNBOUND_OR_EMPTY");
});
test("generic NPC profile bound to another table cannot masquerade as actual boss source",()=>{
 assert.equal(run([{profileID:"generic-rat",lootTableID:"generic_random_any"}]).status,
  "ORIGINAL_BOSS_RARE_LOOT_UNBOUND_OR_EMPTY");
});
test("unconfigured rule-only table with zero rare selectors is not an actual rare loot profile",()=>{
 assert.equal(run([profile],[{...table,selectors:[{kind:"ammo",weight:1}]}]).status,
  "ORIGINAL_BOSS_RARE_LOOT_UNBOUND_OR_EMPTY");
});
test("duplicate original profile IDs are ambiguous and rejected",()=>{
 assert.equal(run([profile,{...profile}]).status,
  "AMBIGUOUS_ORIGINAL_BOSS_PROFILE_BINDING");
});
test("invalid and unparseable upstream catalogs never imply real rare drops",()=>{
 assert.equal(inspect({profiles:{},lootTables:{lootTables:[table]}}).status,
  "ORIGINAL_NPC_CATALOG_INVALID");
 assert.equal(run([profile],[]).status,"OVERSEER_TABLE_UNAVAILABLE");
});
