import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {verify,createAudit}=require("../integration/coopPveBossLootProfileAudit.cjs");
function fixture(){
 const witness={systemID:30000144,instanceID:6001,siteID:7001,
  wreckID:9551,bossEntityID:101,bossTypeID:30001,
  profileID:"overseer-p1",lootTableID:"parity_deadspace_overseer_pending_loot",
  originalItems:[{wreckItemID:9901,typeID:91001,quantity:1,singleton:true}]};
 const wreck={wreckID:9551,sourceEntityID:101,launcherID:101,
  sourceTypeID:30001,systemID:30000144,transient:true,
  profileID:witness.profileID,lootTableID:witness.lootTableID};
 const profile={profileID:witness.profileID,lootTableID:witness.lootTableID};
 const lootTable={lootTableID:witness.lootTableID,mode:"rule",emptyChance:0,
  emptyRule:false,minEntries:2,maxEntries:5,selectors:[
   {kind:"any",grade:"special",weight:8,groupNames:["Overseer Personal Effects"]},
   {kind:"module",grade:"deadspace",weight:1,nameIncludes:["Pith"]}]};
 const definition={profile:{...profile},lootTable:{...lootTable}};
 return {witness,wreck,profile,lootTable,definition};
}
test("an original observed boss links native entity profile and loaded loot table through wreck",()=>{
 const f=fixture(),r=verify(f);
 assert.equal(r.status,"NATIVE_BOSS_LOOT_PROFILE_LINK_VERIFIED");
 assert.equal(r.profileID,"overseer-p1");
 assert.equal(r.lootTableID,"parity_deadspace_overseer_pending_loot");
 assert.deepEqual(r.originalItemIDs,[9901]);
 assert.equal(r.configuredRareSelectorCount,2);
 assert.equal(r.candidatesResolved,false);
 assert.equal(r.actualRareDropVerified,false);
});
test("a table existing in the catalog does not prove profile binding or rare loot",()=>{
 const f=fixture();delete f.witness.lootTableID;
 assert.equal(verify(f).status,"NO_ORIGINAL_NPC_LOOT_BINDING");
});
test("original wreck must preserve the native NPC's exact source type, profile and loot table",()=>{
 const modifications=[
  f=>{f.wreck.sourceEntityID=102},
  f=>{f.wreck.sourceTypeID=30002},
  f=>{f.wreck.launcherID=102},
  f=>{f.wreck.systemID=30000001},
  f=>{f.wreck.transient=false}
 ];
 for(const edit of modifications){const f=fixture();edit(f);
  assert.equal(verify(f).status,"NATIVE_BOSS_WRECK_SOURCE_MISMATCH");}
 for(const edit of [f=>{f.wreck.profileID="other"},
  f=>{f.wreck.lootTableID="generic_random_any"}]){
  const f=fixture();edit(f);
  assert.equal(verify(f).status,"WRECK_PROFILE_LOOT_TABLE_MISMATCH");
 }
});
test("profile/definition/loaded native table must all agree",()=>{
 const edits=[
  f=>{f.profile.lootTableID="generic_random_any"},
  f=>{f.definition.profile.profileID="other"},
  f=>{f.definition.profile.lootTableID="other"},
  f=>{f.definition.lootTable.lootTableID="other"},
  f=>{f.lootTable.lootTableID="other"},
  f=>{f.profile=null},
  f=>{f.definition=null},
  f=>{f.lootTable=null}
 ];
 for(const edit of edits){const f=fixture();edit(f);
  assert.equal(verify(f).status,"NPC_PROFILE_TABLE_NOT_RESOLVED");}
});
test("a configured rule with zero selectors is not a verified loot rule",()=>{
 for(const edit of [
  f=>{f.lootTable.selectors=[]},
  f=>{f.lootTable.emptyRule=true},
  f=>{f.lootTable.disableRandomLoot=true},
  f=>{f.lootTable.mode="explicit"},
  f=>{f.lootTable.selectors=[{kind:"module",weight:0,grade:"deadspace"}]}
 ]){
  const f=fixture();edit(f);
  const result=verify(f);
  assert.equal(result.status,"NATIVE_BOSS_LOOT_PROFILE_EMPTY_OR_UNSUPPORTED");
  assert.equal(result.actualRareDropVerified,false);
 }
});
test("a valid link with no native items cannot be described as a rare item drop",()=>{
 const f=fixture();f.witness.originalItems=[];
 const result=verify(f);
 assert.equal(result.status,"NATIVE_BOSS_LOOT_PROFILE_LINK_VERIFIED");
 assert.equal(result.originalItemCount,0);
 assert.equal(result.actualRareDropVerified,false);
});
test("duplicate/wrong original native item IDs fail closed",()=>{
 for(const edit of [
  f=>{f.witness.originalItems.push({...f.witness.originalItems[0]})},
  f=>{f.witness.originalItems[0].typeID=0},
  f=>{f.witness.originalItems[0].quantity=-1}
 ]){
  const f=fixture();edit(f);
  assert.equal(verify(f).status,"ORIGINAL_NATIVE_ITEM_MANIFEST_INVALID");
 }
});
test("audit emits exactly one receipt after actual native catalog lookups",()=>{
 const f=fixture(),events=[];
 const audit=createAudit({getWreck:()=>f.wreck,getProfile:()=>f.profile,
  getDefinition:()=>f.definition,getLootTable:()=>f.lootTable,
  observe:r=>{events.push(r);return true}});
 assert.equal(audit.note(f.witness).status,"NATIVE_BOSS_LOOT_PROFILE_LINK_VERIFIED");
 assert.equal(audit.note(f.witness).status,"BOSS_PROFILE_ALREADY_AUDITED");
 assert.equal(events.length,1);
 assert.equal(audit.snapshot().auditCount,1);
});
test("catalog outage and telemetry failure never turn into confirmed audit",()=>{
 const f=fixture();
 const absent=createAudit({getWreck:()=>{throw Error("not loaded")},
  getProfile:()=>f.profile,getDefinition:()=>f.definition,
  getLootTable:()=>f.lootTable});
 assert.equal(absent.note(f.witness).status,"NPC_LOOT_CATALOG_UNAVAILABLE");
 const declined=createAudit({getWreck:()=>f.wreck,
  getProfile:()=>f.profile,getDefinition:()=>f.definition,
  getLootTable:()=>f.lootTable,observe:()=>false});
 const result=declined.note(f.witness);
 assert.equal(result.telemetry,"NOT_RECORDED");
 assert.equal(declined.snapshot().auditCount,0);
});
test("a wrong source boss receipt does not satisfy profile audit by table name alone",()=>{
 const f=fixture();f.witness.bossEntityID=0;
 assert.equal(verify(f).status,"INVALID_AUTHORED_BOSS_WITNESS");
});
