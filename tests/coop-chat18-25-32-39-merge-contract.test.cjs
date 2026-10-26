"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const installer=require("../scripts/patch-evejs-coop.cjs");
const ore=require("../scripts/coop-player-ore-atomic-patch.cjs");
const warehouse=require("../scripts/coop-native-warehouse-item-patch.cjs");
const refinery=require("../scripts/coop-native-refinery-item-patch.cjs");
const structure=require("../scripts/coop-structure-alliance-guard-patch.cjs");
const social=require("../scripts/coop-social-native-guards-patch.cjs");
const targets=[
 ore.ITEMS,ore.RUNTIME,ore.SERVICE,
 structure.ALLIANCE,structure.STRUCTURES,
 social.CHAT_RUNTIME,social.CHAT_STORE,social.MAIL
];
test("all Chat 25/32/39 original native source paths are registered exactly once",()=>{
 for(const file of targets){
  const matches=installer.specs.filter(s=>s.file===file);
  assert.equal(matches.length,1,file);
 }
 assert.equal(new Set(targets).size,8);
});
test("the copied helper modules exist in the one central source-only installer",()=>{
 for(const name of ["coopFactionDirector","coopNpcMemory","coopNpcHostility",
  "coopPlayerOreReprocessing","coopSocialRoomAuthority","coopStructureAllianceAuthority"]){
  assert.equal(installer.names.filter(x=>x===name).length,1,name);
  assert.equal(fs.existsSync(path.join(__dirname,"../integration",name+".cjs")),true,name);
 }
});
test("Chat 25 ore export composes with current warehouse and NPC refinery exports",()=>{
 const file=ore.ITEMS;
 const original="function writeItems(){}\nfunction nextItemID(){}\nmodule.exports = {\n  existing,\n};\n";
 let value=refinery.patch(original,file,false);
 value=warehouse.patch(value,file,false);
 value=ore.patch(value,file,false);
 new vm.Script(value);
 assert.equal(warehouse.patch(value,file,false),value,"warehouse reinstall must stay idempotent");
 assert.equal(ore.patch(value,file,false),value,"ore reinstall must stay idempotent");
 assert.equal(ore.patch(value,file,true).includes(ore.BEGIN),false);
 value=ore.patch(value,file,true);
 value=warehouse.patch(value,file,true);
 value=refinery.patch(value,file,true);
 assert.equal(value,original,"all three original inventory helpers must rollback byte-for-byte");
});
test("Chat 32 rejects invalid alliance RPC explicitly, not as silent success",()=>{
 const input="const path=require('path');\nclass Alliance {\n"+
  structure.ACTIONS.map(action=>"  Handle_"+action+"(args, session) {\n    return null;\n  }\n").join("")+"}\n";
 const out=structure.patch(input,structure.ALLIANCE,false);
 assert.match(out,/throwWrappedUserError\("CrpAccessDenied"/);
 assert.doesNotMatch(out,/admitAlliance\([^\n]+\) return null/);
 assert.equal(structure.patch(out,structure.ALLIANCE,true),input);
});
test("default production flag is OFF for staged native mutations",()=>{
 assert.match(ore.RPC_HOOK,/EVEJS_COOP_PLAYER_ORE_ATOMIC === "1"/);
 assert.match(social.FLAG,/EVEJS_COOP_SOCIAL_NATIVE_GUARDS/);
 assert.match(structure.patch("const path=require('path');\nfunction requireValidDeploymentSession(session) {\n}\nfunction requireStructureManagementSession(session, structure) {\n}\nfunction requireStructureDecommissionSession(session, structure) {\n}\n",
  structure.STRUCTURES,false),/EVEJS_COOP_STRUCTURE_ALLIANCE_GUARD === "1"/);
});
test("optional actual pinned EveJS unified install/reinstall/remove source gate",()=>{
 const code=process.env.EVEJS_COOP_CODE_PATH;
 if(!code)return;
 for(const file of targets){
  const original=fs.readFileSync(path.join(code,file),"utf8");
  const spec=installer.specs.find(s=>s.file===file);
  const installed=installer.transform(original,spec,false);
  new vm.Script(installed,{filename:file});
  assert.equal(installer.transform(installed,spec,false),installed,file+" install");
  assert.equal(installer.transform(installed,spec,true),original,file+" rollback");
 }
});
