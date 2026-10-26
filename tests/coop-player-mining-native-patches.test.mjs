import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {patch:patchSql,FILE,INJECT}=require("../scripts/coop-player-mining-storage-patch.cjs");
const {patch:patchAgent,ACTION_HOOK,BRIEF_HOOK}=require("../scripts/coop-player-mining-agent-patch.cjs");
const job=require("../scripts/coop-native-job-agent-patch.cjs");
const faction=require("../scripts/coop-faction-war-agent-patch.cjs");
const vm=require("node:vm");
const originalSql=String.raw`const ROW_KEY_SEP = "\u001f";
const ROW_GROUPS = {
 corporationRuntime: [
    "corporations", "alliances", "wars", "warNegotiations",
    "mutualWarInvites", "mutualWarInviteBlocks", "peaceTreaties",
  ],
};
module.exports={ROW_GROUPS,ROW_KEY_SEP};`;
const originalAgent=String.raw`class Agent {
 Handle_DoAction(args, session) {
    const agentID=this._resolveBoundAgentID(session);
  const actionID = args && args.length > 0 ? args[0] : null;
    if (Number(actionID) === agentMissionRuntime.AGENT_DIALOGUE_BUTTON_DECLINE) {
      return null;
    }
    return buildDoActionResponsePayload(null);
 }
  Handle_GetMissionBriefingInfo(args, session) {
    return toMarshalSafe(null);
  }
}`;
test("mining company SQLite groups match native row group separator and are only added once",()=>{
 const result=patchSql(originalSql,FILE);
 assert.match(result,/coopPlayerMiningShift/);
 assert.match(result,/coopPlayerMiningFleet/);
 assert.match(result,/coopPlayerMiningOreTitle/);
 assert.equal(result.split(INJECT).length-1,1);
 assert.equal(patchSql(result,FILE),result);
 new vm.Script(result);
});
test("mining company SQLite group patch restores original LF and CRLF sources",()=>{
 for(const source of [originalSql,originalSql.replaceAll("\n","\r\n")]){
  const installed=patchSql(source,FILE);
  assert.equal(patchSql(installed,FILE,true),source);
 }
});
test("mining company SQLite group patch fails closed when pinned source moves",()=>{
 assert.throws(()=>patchSql("module.exports={}",FILE),/MISMATCH/);
});
test("native agent mining hook installs AFTER paid job and faction mission hooks",()=>{
 const prior=faction.patch(job.patch(originalAgent,{remove:false}),{remove:false});
 const installed=patchAgent(prior,false);
 assert.ok(installed.indexOf(ACTION_HOOK)>installed.indexOf("EVEJS_COOP_NATIVE_JOB_AGENT"));
 assert.ok(installed.indexOf(ACTION_HOOK)>installed.indexOf("EVEJS_COOP_FACTION_MILITIA_AGENT"));
 assert.ok(installed.indexOf(ACTION_HOOK)<installed.indexOf("AGENT_DIALOGUE_BUTTON_DECLINE"));
 assert.ok(installed.includes(BRIEF_HOOK));new vm.Script(installed);
});
test("native agent hook reinstall and uninstall round-trip LF and CRLF",()=>{
 for(const raw of [originalAgent,originalAgent.replaceAll("\n","\r\n")]){
  const prior=faction.patch(job.patch(raw,{remove:false}),{remove:false});
  const installed=patchAgent(prior,false);
  assert.equal(patchAgent(installed,false),installed);
  assert.equal(patchAgent(installed,true),prior);
 }
});
test("no new client action hook accepted without existing native job+militia priority",()=>{
 assert.throws(()=>patchAgent(originalAgent,false),/PRIORITY_REQUIRED/);
});
