import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
test("original pinned source resolves actual rare candidate item pools for linked overseer NPCs",(t)=>{
 const code=process.env.EVEJS_CODE_PATH||process.env.EVEJS_COOP_CODE_PATH;
 if(!code){t.skip("not installed in an original pinned EveJS tree");return;}
 // Original npcData -> GameStore refuses unisolated node:test imports.
 // Do not bypass that native safety guard or read a live player's DB.
 // This test remains a HARD release gate, not a silently skipped proof.
 if(process.env.EVEJS_TEST_STORE_ISOLATED!=="1"||
    !process.env.EVEJS_TEST_STORE_ROOT||
    !process.env.EVEJS_GAMESTORE_DATA_DIR)
  assert.fail("NATIVE_RARE_RNG_NOT_RUN: original EveJS requires an attested isolated GameStore with genuine NPC/itemTypes reference data; the clean pinned checkout alone does not provide an executable native RNG test.");
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
 // Exercise the ORIGINAL rule-backed RNG with a deterministic local
 // random stream. This tests native item-type selection, not itemStore,
 // spawned wreck contents, or physical game-client pickup.
 for(const p of pools)assert.ok(Number.isSafeInteger(p.candidateCount)&&p.candidateCount>=0);
 const candidateIDs=new Set(selected.flatMap(selector=>
  loot._testing.getRuleCandidatePool(selector).map(item=>item.typeID)));
 const originalRandom=Math.random;
 let seed=0x1970a11f;
 let rolled=[],rareNativeSelections=0;
 try{
  Math.random=()=>{
   seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;
   return (seed>>>0)/4294967296;
  };
  for(let i=0;i<32;i++){
   const entries=loot.rollNpcLootEntries(table);
   assert.ok(Array.isArray(entries));
   for(const item of entries){
    assert.ok(Number.isSafeInteger(item.typeID)&&item.typeID>0);
    if(candidateIDs.has(item.typeID))rareNativeSelections++;
   }
   rolled.push(...entries.map(e=>e.typeID));
  }
 }finally{Math.random=originalRandom}
 assert.ok(rareNativeSelections>0,
  "original source RNG did not select any configured overseer rare candidate");
 console.log("[PVE_NATIVE_LOOT_CANDIDATES] "+JSON.stringify({
  profileID:profile.profileID,lootTableID:table.lootTableID,
  pools,actualNativeRngRolls:32,actualNativeSelectedItems:rolled.length,
  selectedNativeCandidateItems:rareNativeSelections,
  actualDropVerified:false,actualPhysicalItemVerified:false}));
});