import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {prepare,finish,leaderFenceKey,readLeaderFence,
 beginLeaderFence,advanceLeaderFence}=require("../integration/coopFleetMissionTurnin.cjs");

const originalFlags={
 peer:process.env.EVEJS_COOP_FLEET_MISSION_TURNIN,
 leader:process.env.EVEJS_COOP_FLEET_LEADER_FENCE
};
function flags(callback){
 process.env.EVEJS_COOP_FLEET_MISSION_TURNIN="1";
 process.env.EVEJS_COOP_FLEET_LEADER_FENCE="1";
 try{return callback()}
 finally{
  if(originalFlags.peer===undefined)delete process.env.EVEJS_COOP_FLEET_MISSION_TURNIN;
  else process.env.EVEJS_COOP_FLEET_MISSION_TURNIN=originalFlags.peer;
  if(originalFlags.leader===undefined)delete process.env.EVEJS_COOP_FLEET_LEADER_FENCE;
  else process.env.EVEJS_COOP_FLEET_LEADER_FENCE=originalFlags.leader;
 }
}
function withFiles(callback){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"coop-duo-leader-fence-"));
 try{return callback({leader:path.join(dir,"leader.jsonl"),
  peer:path.join(dir,"peer.jsonl"),dir})}
 finally{fs.rmSync(dir,{recursive:true,force:true})}
}
function fixture(){
 const alice={characterID:101,socket:{destroyed:false}};
 const bob={characterID:102,socket:{destroyed:false}};
 const fleet={fleetID:45,members:new Map([[101,{}],[102,{}]])};
 const fleetRuntime={getFleetForCharacter:id=>fleet.members.has(id)?fleet:null,
  getMemberRecord:(f,id)=>f.members.get(id)||null};
 const missions=new Map([
  [101,{agentID:50,contentID:9000,missionTemplateID:"convoy",
   missionSequence:10,objectiveMode:"dungeon",runtimeStatus:"accepted",
   objectiveCompleted:true,gmCompleted:false}],
  [102,{agentID:50,contentID:9000,missionTemplateID:"convoy",
   missionSequence:20,objectiveMode:"dungeon",runtimeStatus:"accepted",
   objectiveCompleted:true,gmCompleted:false}]
 ]);
 const paid=[];const runtime={
  getMissionRecord:(id,agent)=>agent===50?missions.get(id)||null:null,
  doAgentAction:(id,agent,action)=>{
   if(agent!==50||action!==6||!missions.has(id))return {success:false};
   paid.push(id);missions.delete(id);return {success:true};
  }
 };
 const getDockedLocationID=()=>60000011;
 const opts={session:alice,agentID:50,actionID:6,fleetRuntime,
  missionRuntime:runtime,sessions:[alice,bob],getDockedLocationID};
 const completeLeader=()=>runtime.doAgentAction(101,50,6);
 const finishTicket=(ticket,file)=>finish({ticket,missionRuntime:runtime,
  fleetRuntime,getDockedLocationID,journalPath:file});
 return {opts,paid,missions,completeLeader,finishTicket,
  runtime,fleet,alice,bob};
}
function events(file){return fs.readFileSync(file,"utf8").trim().split("\n").map(JSON.parse)}
test("P0 both native award roles have pre/post durable receipts, before and after native DoAction",()=>flags(()=>withFiles(({leader,peer})=>{
 const f=fixture(),ticket=prepare({...f.opts,leaderFencePath:leader});
 assert.deepEqual(f.paid,[]);
 assert.deepEqual(events(leader).map(x=>x.state),["PREPARED"]);
 f.completeLeader();assert.deepEqual(f.paid,[101]);
 assert.equal(f.finishTicket(ticket,peer).status,"TWO_NATIVE_MISSIONS_COMPLETED");
 assert.deepEqual(f.paid,[101,102]);
 assert.deepEqual(events(leader).map(x=>x.state),
  ["PREPARED","LEADER_NATIVE_CLEARED","BOTH_NATIVE_CLEARED"]);
 assert.deepEqual(events(peer).map(x=>x.state),["PREPARED","AWARDED"]);
 assert.equal(readLeaderFence(leader,leaderFenceKey(ticket)).previous.state,
  "BOTH_NATIVE_CLEARED");
})));
test("P0 a failed precommit fsync/path prevents *first* native payout",()=>flags(()=>withFiles(({dir})=>{
 const f=fixture();
 assert.throws(()=>prepare({...f.opts,leaderFencePath:dir}),
  /COOP_DUO_LEADER_SETTLEMENT_BLOCKED/);
 assert.equal(f.paid.length,0);
 assert.equal(f.missions.has(101),true);
 assert.equal(f.missions.has(102),true);
})));
test("P0 first leader payout interrupted after PREPARED cannot be retried",()=>flags(()=>withFiles(({leader})=>{
 const f=fixture();
 prepare({...f.opts,leaderFencePath:leader});
 // The actual leader may have already received ISK before crashing.
 // No client result was observed; NEVER infer safe retry.
 assert.throws(()=>prepare({...f.opts,leaderFencePath:leader}),
  /LEADER_SETTLEMENT_REQUIRES_MANUAL_RECONCILIATION/);
 assert.equal(f.paid.length,0);
})));
test("P0 leader's native completion alone never awards peer if followup is interrupted",()=>flags(()=>withFiles(({leader,peer})=>{
 const f=fixture(),ticket=prepare({...f.opts,leaderFencePath:leader});
 f.completeLeader();
 assert.deepEqual(f.paid,[101]);
 const fresh=readLeaderFence(leader,leaderFenceKey(ticket));
 assert.equal(fresh.previous.state,"PREPARED");
 assert.equal(fs.existsSync(peer),false);
 // The native leader mission is already absent, so prepare cannot mint a
 // second ticket; the untouched PREPARED journal still signals ambiguity.
 assert.equal(prepare({...f.opts,leaderFencePath:leader}).ok,false);
 assert.equal(readLeaderFence(leader,leaderFenceKey(ticket)).previous.state,"PREPARED");
 assert.deepEqual(f.paid,[101]);
})));
test("P0 leader native action failed without removing mission: peer payout remains blocked",()=>flags(()=>withFiles(({leader,peer})=>{
 const f=fixture(),ticket=prepare({...f.opts,leaderFencePath:leader});
 assert.equal(f.finishTicket(ticket,peer).status,"LEADER_NATIVE_MISSION_NOT_COMPLETED");
 assert.deepEqual(events(leader).map(x=>x.state),["PREPARED"]);
 assert.equal(f.paid.length,0);
 assert.equal(fs.existsSync(peer),false);
})));
test("P0 failed peer native payout leaves leader-cleared evidence, never repeats leader",()=>flags(()=>withFiles(({leader,peer})=>{
 const f=fixture(),ticket=prepare({...f.opts,leaderFencePath:leader});
 f.completeLeader();
 f.runtime.doAgentAction=()=>{throw Error("native reward partial")};
 assert.equal(f.finishTicket(ticket,peer).status,
  "PEER_SETTLEMENT_REQUIRES_MANUAL_RECONCILIATION");
 assert.deepEqual(events(leader).map(x=>x.state),
  ["PREPARED","LEADER_NATIVE_CLEARED"]);
 assert.deepEqual(events(peer).map(x=>x.state),["PREPARED","UNKNOWN"]);
 assert.deepEqual(f.paid,[101]);
})));
test("P0 same native leader mission cannot be rekeyed by changing fleet ID or wingman",()=>flags(()=>withFiles(({leader})=>{
 const f=fixture(),first=prepare({...f.opts,leaderFencePath:leader});
 assert.equal(first.fleetID,45);
 const next={...first,fleetID:9999,peerID:999,peerMission:{
  ...first.peerMission,missionSequence:777}};
 assert.equal(leaderFenceKey(first),leaderFenceKey(next));
 assert.equal(beginLeaderFence(next,leader).status,
  "LEADER_SETTLEMENT_REQUIRES_MANUAL_RECONCILIATION");
 assert.deepEqual(events(leader).map(x=>x.state),["PREPARED"]);
})));
test("P0 corrupt/torn/malformed journal denies leader before original native action",()=>flags(()=>withFiles(({leader})=>{
 for(const corrupted of ['{"v":1',"{nope}\n"]){
  const f=fixture();fs.writeFileSync(leader,corrupted);
  assert.throws(()=>prepare({...f.opts,leaderFencePath:leader}),
   /LEADER_FENCE_CORRUPT/);
  assert.equal(f.paid.length,0);
 }
})));
test("P0 invalid state transition on a durable journal is never treated as fresh",()=>flags(()=>withFiles(({leader})=>{
 const f=fixture(),ticket=prepare({...f.opts,leaderFencePath:leader});
 assert.equal(advanceLeaderFence(ticket,"BOTH_NATIVE_CLEARED").status,
  "LEADER_SETTLEMENT_REQUIRES_MANUAL_RECONCILIATION");
 assert.equal(readLeaderFence(leader,leaderFenceKey(ticket)).previous.state,
  "PREPARED");
})));
test("P0 when peer journal is unavailable, leader receipt cannot falsely claim both native missions cleared",()=>flags(()=>withFiles(({leader,dir})=>{
 const f=fixture(),ticket=prepare({...f.opts,leaderFencePath:leader});
 f.completeLeader();
 assert.equal(f.finishTicket(ticket,dir).status,"SETTLEMENT_JOURNAL_WRITE_FAILED");
 assert.deepEqual(f.paid,[101]);
 assert.equal(readLeaderFence(leader,leaderFenceKey(ticket)).previous.state,
  "LEADER_NATIVE_CLEARED");
})));
test("P0 enabling leader fence without existing peer fence prevents all leader side effects",()=>withFiles(({leader})=>{
 const old=process.env.EVEJS_COOP_FLEET_LEADER_FENCE,
  oldPeer=process.env.EVEJS_COOP_FLEET_MISSION_TURNIN;
 try{
  process.env.EVEJS_COOP_FLEET_LEADER_FENCE="1";
  delete process.env.EVEJS_COOP_FLEET_MISSION_TURNIN;
  const f=fixture();
  assert.throws(()=>prepare({...f.opts,leaderFencePath:leader}),
   /LEADER_FENCE_REQUIRES_PEER_SETTLEMENT_GUARD/);
  assert.equal(f.paid.length,0);assert.equal(fs.existsSync(leader),false);
 }finally{
  if(old===undefined)delete process.env.EVEJS_COOP_FLEET_LEADER_FENCE;
  else process.env.EVEJS_COOP_FLEET_LEADER_FENCE=old;
  if(oldPeer===undefined)delete process.env.EVEJS_COOP_FLEET_MISSION_TURNIN;
  else process.env.EVEJS_COOP_FLEET_MISSION_TURNIN=oldPeer;
 }
}));
