"use strict";
// PVE catalog validation: original pinned, source-backed, never a loot roll.
// A configured lootTable is not playable until a real NPC profile binds it.
const fs=require("node:fs"),path=require("node:path");
const tableName="parity_deadspace_overseer_pending_loot";
function rows(data,field){
 if(Array.isArray(data))return data;
 if(data&&typeof data==="object"){
  if(Array.isArray(data[field]))return data[field];
  const arrays=Object.values(data).filter(Array.isArray);
  if(arrays.length===1)return arrays[0];
 }
 return null;
}
function inspect({profiles,lootTables}={}){
 const p=rows(profiles,"npcProfiles"),t=rows(lootTables,"lootTables");
 if(!p||!t||p.length>100000||t.length>20000)return {
  status:"ORIGINAL_NPC_CATALOG_INVALID",bossProfiles:0,rareSelectors:0,actualRareDropVerified:false};
 const tables=t.filter(x=>x?.lootTableID===tableName);
 if(tables.length!==1)return {status:"OVERSEER_TABLE_UNAVAILABLE",
  bossProfiles:0,rareSelectors:0,actualRareDropVerified:false};
 const table=tables[0];
 const selectors=Array.isArray(table.selectors)?table.selectors:[];
 const valid=selectors.filter(x=>x&&typeof x==="object"&&
  Number.isFinite(Number(x.weight))&&Number(x.weight)>0);
 const rare=valid.filter(x=>["special","faction","deadspace","officer"]
  .includes(String(x.grade||"").toLowerCase()));
 const linked=p.filter(x=>x?.lootTableID===tableName&&
  typeof x.profileID==="string"&&x.profileID.trim());
 const ids=linked.map(x=>x.profileID);
 if(new Set(ids).size!==ids.length)return {
  status:"AMBIGUOUS_ORIGINAL_BOSS_PROFILE_BINDING",
  bossProfiles:linked.length,rareSelectors:rare.length,actualRareDropVerified:false};
 const status=linked.length>0&&rare.length>0&&table.mode==="rule"?
  "SOURCE_AUTHORED_BOSS_TABLE_LINK_PRESENT":
  "ORIGINAL_BOSS_RARE_LOOT_UNBOUND_OR_EMPTY";
 return {status,bossProfiles:linked.length,
  profileIDs:linked.map(x=>x.profileID).slice(0,15),
  rareSelectors:rare.length,configuredSelectors:valid.length,
  actualRareDropVerified:false,candidatePoolProven:false,
  evidence:"ORIGINAL_STATIC_CATALOG_LINK_ONLY_NOT_NATIVE_LOOT_ROLL"};
}
function inspectCode(code){
 try{
  const root=path.join(code,"tools","DatabaseCreator","staticTables");
  const profiles=JSON.parse(fs.readFileSync(path.join(root,"npcProfiles","data.json"),"utf8"));
  const tables=JSON.parse(fs.readFileSync(path.join(root,"npcLootTables","data.json"),"utf8"));
  return inspect({profiles,lootTables:tables});
 }catch{return {status:"ORIGINAL_NPC_CATALOG_UNREADABLE",
  bossProfiles:0,rareSelectors:0,actualRareDropVerified:false};}
}
if(require.main===module){
 const loc=process.argv[2],result=loc?inspectCode(loc):{status:"ORIGINAL_CODE_PATH_REQUIRED"};
 console.log("[PVE_NATIVE_CATALOG] "+JSON.stringify(result));
 if(result.status!=="SOURCE_AUTHORED_BOSS_TABLE_LINK_PRESENT")process.exitCode=2;
}
module.exports={inspect,inspectCode};
