import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const installer=require("../scripts/patch-evejs-coop.cjs");

test("P0 native leader DoAction receipt reaches the exact existing duo completion hook",()=>{
 const spec=installer.specs.find(s=>s.file==="server/src/services/agent/agentMgrService.js");
 assert.ok(spec,"native agentMgrService spec is registered");
 const lead=spec.patches.filter(x=>x.line.includes("coopFleetMissionTurnin")).map(x=>x.line);
 assert.equal(lead.length,2);
 const pre=lead.find(x=>x.includes(".prepare("));
 const post=lead.find(x=>x.includes(".finish("));
 assert.ok(pre);assert.ok(post);
 assert.match(pre,/EVEJS_COOP_FLEET_MISSION_TURNIN === "1"/);
 assert.match(post,/leaderActionResult:result/);
 assert.match(post,/coop-fleet-native-mission-turnin/);
 assert.doesNotMatch(post,/adjustCharacterBalance|adjustCharacterWalletLPBalance|grantItemsToCharacter/);
});
test("P0 two journal guards require explicit operator opt-in; no silent LivingCoop payout",()=>{
 const script=fs.readFileSync(new URL("../scripts/Deploy-Coop-RuntimeProbe.ps1",import.meta.url),"utf8");
 assert.match(script,/\[switch\]\$EnableDuoMissionSettlement/);
 assert.match(script,/if \(\$EnableDuoMissionSettlement -and -not \$LivingCoop\)/);
 const guarded=script.match(/if \(\$EnableDuoMissionSettlement\) \{([\s\S]*?)\}/);
 assert.ok(guarded);
 assert.match(guarded[1],/EVEJS_COOP_FLEET_MISSION_TURNIN: '1'/);
 assert.match(guarded[1],/EVEJS_COOP_FLEET_LEADER_FENCE: '1'/);
 assert.match(script,/EVEJS_COOP_NPC_CHATTER: '1'/);
 assert.match(script,/EVEJS_COOP_ATOMIC_TRADE: '1'/);
});
const codePath=process.env.EVEJS_COOP_CODE_PATH||"";
test("P0 pinned agent native manager retains reversible source-level DoAction receipt",
 {skip:!codePath||!fs.existsSync(path.join(codePath,"server/src/services/agent/agentMgrService.js"))},()=>{
  const file="server/src/services/agent/agentMgrService.js";
  const before=fs.readFileSync(path.join(codePath,file),"utf8");
  const spec=installer.specs.find(x=>x.file===file);
  const after=installer.transform(before,spec,false);
  assert.match(after,/leaderActionResult:result/);
  assert.equal(installer.transform(after,spec,false),after);
  assert.equal(installer.transform(after,spec,true),before);
 });
