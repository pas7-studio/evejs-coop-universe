import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import fs from "node:fs";
import path from "node:path";
const require=createRequire(import.meta.url);
const {patch,ALLIANCE,STRUCTURES,ACTIONS}=require("../scripts/coop-structure-alliance-guard-patch.cjs");
function fixture(){
 const lines=ACTIONS.map(a=>"  Handle_"+a+"(args, session) {\n    return null;\n  }");
 return {alliance:"const path=require('path');\nclass Registry {\n"+lines.join("\n")+"\n}\n",
  structure:"const path=require('path');\nfunction requireValidDeploymentSession(session) {\n return null;\n}\nfunction requireStructureManagementSession(session, structure) {\n return null;\n}\nfunction requireStructureDecommissionSession(session, structure) {\n return null;\n}\n"};
}
test("24 native alliance mutation RPCs are reversible, default OFF and idempotent",()=>{
 const original=fixture().alliance;
 for(const eol of ["\n","\r\n"]){
  const src=original.replace(/\n/g,eol),p=patch(src,ALLIANCE);
  assert.equal((p.match(/EVEJS_COOP_STRUCTURE_ALLIANCE_GUARD/g)||[]).length,ACTIONS.length);
  assert.equal(patch(p,ALLIANCE),p);
  assert.equal(patch(p,ALLIANCE,true),src);
 }
});
test("deployment, management and decommission guard remain on native source path",()=>{
 const original=fixture().structure,p=patch(original,STRUCTURES);
 assert.equal((p.match(/EVEJS_COOP_STRUCTURE_ALLIANCE_GUARD/g)||[]).length,3);
 assert.equal(patch(p,STRUCTURES),p);
 assert.equal(patch(p,STRUCTURES,true),original);
});
test("upstream drift or unknown target is rejected",()=>{
 assert.throws(()=>patch("not a valid module",ALLIANCE),/EMPTY_SOURCE|MISSING_ALLIANCE_METHOD/);
 assert.throws(()=>patch(fixture().alliance+fixture().alliance,ALLIANCE),/ANCHOR_DRIFT/);
 assert.throws(()=>patch(fixture().structure,"server/src/services/ship.js"),/SOURCE_TARGET_MISMATCH/);
});
test("optional read-only pinned upstream source roundtrip",()=>{
 const root=process.env.EVEJS_COOP_CODE_PATH;
 if(!root)return;
 for(const [file,target] of [
  ["server/src/services/corporation/allianceRegistryRuntime.js",ALLIANCE],
  ["server/src/services/sovereignty/sovPlayerDeployment.js",STRUCTURES]]){
  const original=fs.readFileSync(path.join(root,file),"utf8");
  const next=patch(original,target);
  assert.equal(patch(next,target,true),original);
 }
});
