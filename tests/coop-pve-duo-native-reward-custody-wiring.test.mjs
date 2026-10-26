import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const root=path.resolve(path.dirname(new URL(import.meta.url).pathname),"..");
const read=file=>fs.readFileSync(path.join(root,file),"utf8");
const turnin=read("integration/coopFleetMissionTurnin.cjs");
const custody=read("integration/coopPveDuoNativeRewardCustody.cjs");
const {names}=require("../scripts/overlay-spec.cjs");
const flags=JSON.parse(read("docs/coop-flags.json")).flags;
test("native reward custody stays default OFF with a single pinned overlay module",()=>{
 assert.equal(flags.EVEJS_COOP_PVE_DUO_REWARD_CUSTODY,1);
 assert.equal(names.filter(x=>x==="coopPveDuoNativeRewardCustody").length,1);
 assert.match(turnin,/process\.env\.EVEJS_COOP_PVE_DUO_REWARD_CUSTODY==="1"/);
});
test("leader custody snapshot precedes PREPARED journal and original agent action",()=>{
 const before=turnin.indexOf("ticket._pveLeaderCustodyBefore=before;");
 const intent=turnin.indexOf("const result=beginLeaderFence(ticket,file);");
 assert.ok(before>=0&&intent>before);
 assert.match(turnin,/COOP_PVE_CUSTODY_REQUIRES_REWARD_EVIDENCE_AND_PREFLIGHT/);
});
test("leader native custody is verified before exposing first payout as cleared",()=>{
 const proof=turnin.indexOf("ticket._pveLeaderCustodyVerified=custody;");
 const cleared=turnin.indexOf('advanceLeaderFence(ticket,"LEADER_NATIVE_CLEARED")');
 assert.ok(proof>=0&&cleared>proof);
 assert.match(turnin,/PVE_LEADER_NATIVE_CUSTODY_RECONCILIATION_REQUIRED/);
});
test("peer custody snapshot is before native reward and verification before peer AWARDED",()=>{
 const before=turnin.indexOf('peerCustodyBefore=require("./coopPveDuoNativeRewardCustody").captureNative(');
 const intent=turnin.indexOf("const intent=safeMode?beginPeerSettlement(ticket,file):null;");
 const native=turnin.indexOf("result=missionRuntime.doAgentAction(ticket.peerID,ticket.agentID,");
 const after=turnin.indexOf("peerCustodyVerified=audit.verify({");
 const credited=turnin.indexOf('durableWrite(file,intent.key,"AWARDED")');
 assert.ok(before>=0&&intent>before&&native>intent&&after>native&&credited>after);
 assert.match(turnin,/PVE_PEER_NATIVE_CUSTODY_RECONCILIATION_REQUIRED/);
});
test("native item and standing source readers are used without synthetic mutation",()=>{
 assert.match(custody,/listContainerItems\(char,station,flag\)/);
 assert.match(custody,/getStandingTransactions\(owner,char\)/);
 assert.match(custody,/buildMissionOutcomeStandingChanges\(record,mission,outcome\)/);
 assert.doesNotMatch(custody,/grantItemsToCharacterStationHangar|adjustCharacterWalletLPBalance|applyStandingChanges\(/);
});
test("two original native reward custody receipts are observed only after both cleared",()=>{
 const both=turnin.indexOf('advanceLeaderFence(ticket,"BOTH_NATIVE_CLEARED")');
 const telemetry=turnin.indexOf('"TWO_ORIGINAL_REWARD_ITEMS_AND_STANDING_TRANSACTIONS_VERIFIED"');
 assert.ok(both>=0&&telemetry>both);
});
