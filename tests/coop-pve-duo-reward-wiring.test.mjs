import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const root=path.resolve(path.dirname(new URL(import.meta.url).pathname),"..");
const read=file=>fs.readFileSync(path.join(root,file),"utf8");
const turnin=read("integration/coopFleetMissionTurnin.cjs");
const source=read("integration/coopPveDuoNativeRewardGuard.cjs");
const {names}=require("../scripts/overlay-spec.cjs");
const flags=JSON.parse(read("docs/coop-flags.json")).flags;
test("PVE-005A is default OFF and installed through the only shared overlay",()=>{
 assert.equal(flags.EVEJS_COOP_PVE_DUO_REWARD_GUARD,1);
 assert.equal(names.filter(name=>name==="coopPveDuoNativeRewardGuard").length,1);
 assert.equal(source.includes("EVEJS_COOP_PVE_DUO_REWARD_GUARD"),false,
  "the pure preflight must never silently enable itself");
});
test("strict preflight runs before original leader payout journal and native DoAction",()=>{
 const p=turnin.indexOf('require("./coopPveDuoNativeRewardGuard").preflight(ticket)');
 const leader=turnin.indexOf("const result=beginLeaderFence(ticket,file);");
 assert.ok(p>=0&&leader>p);
 assert.match(turnin,/COOP_PVE_DUO_REWARD_BLOCKED/);
 assert.match(turnin,/_pveRewardPreflight=proof/);
});
test("second personal mission rechecks source link BEFORE peer native payout fence",()=>{
 const p=turnin.indexOf('require("./coopPveDuoNativeRewardGuard").beforePeer(ticket,second)');
 const intent=turnin.indexOf("const intent=safeMode?beginPeerSettlement(ticket,file):null;");
 const native=turnin.indexOf("result=missionRuntime.doAgentAction(ticket.peerID,ticket.agentID,");
 assert.ok(p>=0&&intent>p&&native>intent);
 assert.match(turnin,/PVE_DUO_PEER_NATIVE_REWARD_BLOCKED/);
});
test("existing leader and peer payout fences remain native source authority",()=>{
 assert.match(turnin,/beginLeaderFence\(ticket,file\)/);
 assert.match(turnin,/beginPeerSettlement\(ticket,file\)/);
 assert.match(turnin,/advanceLeaderFence\(ticket,"LEADER_NATIVE_CLEARED"\)/);
 assert.match(turnin,/advanceLeaderFence\(ticket,"BOTH_NATIVE_CLEARED"\)/);
 assert.match(turnin,/missionRuntime\.getMissionRecord\(ticket\.leader,ticket\.agentID\)/);
});
test("mission event is observational only, AFTER original two native deletions",()=>{
 const original=turnin.indexOf('if(safeMode&&!durableWrite(file,intent.key,"AWARDED"))');
 const telemetry=turnin.indexOf('"TWO_NATIVE_PERSONAL_MISSION_RECORDS_CLEARED"');
 assert.ok(original>=0&&telemetry>original);
 assert.match(turnin,/NATIVE_PERSONAL_MISSION_DELETION_NOT_WALLET_OR_LP_DELTA/);
 assert.doesNotMatch(source,/grantISK|grantLP|grantItem|mintReward/);
});
