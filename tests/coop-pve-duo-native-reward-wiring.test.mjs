import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const root=path.resolve(path.dirname(new URL(import.meta.url).pathname),"..");
const read=file=>fs.readFileSync(path.join(root,file),"utf8");
const turnin=read("integration/coopFleetMissionTurnin.cjs");
const evidence=read("integration/coopPveDuoNativeRewardEvidence.cjs");
const guard=read("integration/coopPveDuoNativeRewardGuard.cjs");
const {names}=require("../scripts/overlay-spec.cjs");
const flags=JSON.parse(read("docs/coop-flags.json")).flags;
test("new P0-5B module installs through one existing overlay, default OFF",()=>{
 assert.equal(flags.EVEJS_COOP_PVE_DUO_REWARD_EVIDENCE,1);
 assert.equal(names.filter(x=>x==="coopPveDuoNativeRewardEvidence").length,1);
 assert.match(turnin,/process\.env\.EVEJS_COOP_PVE_DUO_REWARD_EVIDENCE==="1"/);
});
test("preflight and reward evidence capture both occur before durable native leader intent",()=>{
 const preflight=turnin.indexOf('require("./coopPveDuoNativeRewardGuard").preflight(ticket)');
 const evidenceBefore=turnin.indexOf('const before=evidence.snapshot(leader,agent);');
 const leaderFence=turnin.indexOf('const result=beginLeaderFence(ticket,file);');
 assert.ok(preflight>=0&&evidenceBefore>preflight&&leaderFence>evidenceBefore);
 assert.match(turnin,/COOP_PVE_REWARD_SOURCE_UNAVAILABLE/);
});
test("native leader wallet LP and journal proof occurs before continuing peer payout",()=>{
 const leaderProof=turnin.indexOf('const proof=evidence.assess({before:ticket._pveLeaderRewardBefore,');
 const leaderFence=turnin.indexOf('advanceLeaderFence(ticket,"LEADER_NATIVE_CLEARED")');
 const peerNative=turnin.indexOf("result=missionRuntime.doAgentAction(ticket.peerID,ticket.agentID,");
 assert.ok(leaderProof>=0&&leaderFence>leaderProof&&peerNative>leaderFence);
 assert.match(turnin,/PVE_LEADER_NATIVE_REWARD_RECONCILIATION_REQUIRED/);
});
test("peer source snapshot precedes durable intent and peer verification precedes AWARDED",()=>{
 const capture=turnin.indexOf("peerRewardBefore=require(\"./coopPveDuoNativeRewardEvidence\").snapshot(");
 const intent=turnin.indexOf("const intent=safeMode?beginPeerSettlement(ticket,file):null;");
 const peerNative=turnin.indexOf("result=missionRuntime.doAgentAction(ticket.peerID,ticket.agentID,");
 const after=turnin.indexOf("peerRewardVerified=evidence.assess({before:peerRewardBefore,");
 const awarded=turnin.indexOf('durableWrite(file,intent.key,"AWARDED")');
 assert.ok(capture>=0&&intent>capture&&peerNative>intent&&after>peerNative&&awarded>after);
 assert.match(turnin,/PVE_PEER_NATIVE_REWARD_RECONCILIATION_REQUIRED/);
});
test("original native wallet and LP readers are used; no second economy",()=>{
 assert.match(evidence,/getCharacterWallet\(char\)/);
 assert.match(evidence,/getCharacterWalletJournal\(char\)/);
 assert.match(evidence,/getCharacterWalletLPBalance\(char,corp\)/);
 assert.match(evidence,/getCharacterStateSnapshot\(char\)/);
 assert.match(evidence,/getCharacterRawStanding\(char,owner\)/);
 assert.doesNotMatch(evidence,/adjustCharacterBalance|adjustCharacterWalletLPBalance|applyMissionStandingChanges|grantItems/);
});
test("two-recipient evidence emitted only after both original native payout fences",()=>{
 const finish=turnin.indexOf('advanceLeaderFence(ticket,"BOTH_NATIVE_CLEARED")');
 const event=turnin.indexOf('"TWO_INDEPENDENT_NATIVE_WALLET_LP_AND_HISTORY_VERIFIED"');
 assert.ok(finish>=0&&event>finish);
 assert.match(turnin,/NATIVE_PER_RECIPIENT_SOURCE_DELTAS_NOT_ITEM_OR_STANDING_GRANT_PROOF/);
});
test("original independent recipient identities and personal mission guards remain",()=>{
 assert.match(guard,/a\.missionSequence/);
 assert.match(guard,/nativeSharedObjectiveMatches/);
 assert.match(turnin,/missionRuntime\.doAgentAction\(ticket\.peerID,ticket\.agentID/);
 assert.match(turnin,/beginPeerSettlement\(ticket,file\)/);
 assert.match(turnin,/beginLeaderFence\(ticket,file\)/);
});
