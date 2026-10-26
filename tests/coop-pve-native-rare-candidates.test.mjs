import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
test("original pinned source resolves actual rare candidate item pools for linked overseer NPCs",()=>{
 const code=process.env.EVEJS_CODE_PATH||process.env.EVEJS_COOP_CODE_PATH;
 if(!code)return test.skip("not installed in an original pinned EveJS tree");
 const native=path.resolve(code,"server/src/space/npc");
 const npcData=require(path.join(native,"npcData.js"));
 const loot=require(path.join(native,"npcLoot.js"));
 const profiles=npcData.listNpcProfiles();
 const profile=profiles.find(x=>x.lootTableID==="parity_deadspace_overseer_pending_loot");
 assert.ok(profile,"no actual original overseer NPC profile binds this native loot table");
 const def=npcData.buildNpcDefinition(profile.profileID);
 assert.ok(def&&def.profile?.profileID===profile.profileID);
 const table=npcData.getNpcLootTable("parity_deadspace_overseer_pending_loot");
 assert.equal(table?.mode,"rule");
 const selected=(table.selectors||[]).filter(s=>
  ["special","deadspace","faction","officer"].includes(String(s.grade||"").toLowerCase()));
 assert.ok(selected.length>0);
 const pools=selected.map(selector=>({
  kind:selector.kind,grade:selector.grade,
  candidateCount:loot._testing.getRuleCandidatePool(selector).length
 }));
 assert.ok(pools.some(x=>x.candidateCount>0),
  "configured source selector has no resolved real native item types");
 // This validates real candidates, NOT RNG selection or spawned rewards.
 for(const p of pools)assert.ok(Number.isSafeInteger(p.candidateCount)&&p.candidateCount>=0);
 console.log("[PVE_NATIVE_LOOT_CANDIDATES] "+JSON.stringify({
  profileID:profile.profileID,lootTableID:table.lootTableID,
  pools,actualDropVerified:false}));
});