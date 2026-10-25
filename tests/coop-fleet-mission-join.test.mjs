import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {offer}=require("../integration/coopFleetMissionJoin.cjs");
function fixture(){
 const station=60003760,agentID=501,leaderID=101,peerID=102;
 const leader={characterID:leaderID,stationid:station,locationid:station,
  socket:{destroyed:false}};
 const peer={characterID:peerID,stationid:station,locationid:station,
  socket:{destroyed:false}};
 const fleet={fleetID:55,creatorCharID:leaderID,
  members:new Map([[leaderID,{job:1}],[peerID,{job:0}]])};
 const leaderMission={agentID,missionSequence:21,contentID:2391,
  missionTemplateID:"client-mission:2391",runtimeStatus:"accepted",
  objectiveMode:"dungeon",missionSystemID:30000142,dungeonInstanceID:98754,
  objectiveCompleted:false,gmCompleted:false};
 const missions=new Map([[leaderID,leaderMission]]);
 let calls=0,allowed=true,standings=true,cooldown=0;
 const params={characterID:peerID,agentRecord:{agentID,stationID:station},
  sessions:[leader,peer],fleetRuntime:{
   getFleetForCharacter:id=>fleet.members.has(id)?fleet:null,
   getMemberRecord:(f,id)=>f.members.get(id)||null},
  getMissionRecord:(id,agent)=>agent===agentID?missions.get(id)||null:null,
  getClientMissionRecord:rec=>rec&&rec.contentID===2391?
   {missionID:2391,missionKind:"encounter",killMission:{dungeonID:74}}:null,
  isMissionOfferAllowedForAgent:()=>allowed,
  canUseAgent:()=>standings,
  getReplayUntilFileTime:()=>10000,
  resolveReplayRemainingTicks:()=>cooldown,
  offerSpecificMission:(id,agent,candidate)=>{
   calls++;
   const created={agentID,missionSequence:77,contentID:candidate.missionID,
    missionTemplateID:leaderMission.missionTemplateID,
    runtimeStatus:"offered",objectiveMode:"dungeon",
    objectiveCompleted:false,gmCompleted:false};
   missions.set(id,created);
   return {success:true,data:{kind:"offered",missionRecord:created}};
  }};
 return {params,leader,peer,leaderMission,missions,fleet,station,agentID,
  calls:()=>calls,setAllowed:x=>{allowed=x},setStandings:x=>{standings=x},
  setCooldown:x=>{cooldown=x}};
}
test("one native wingman Request Mission gets a real matching offered contract, not Accepted",()=>{
 const f=fixture(),res=offer(f.params);
 assert.equal(res.status,"PEER_NATIVE_MATCHING_MISSION_OFFERED");
 assert.equal(res.fleetID,55);
 assert.equal(res.leaderMissionSequence,21);
 assert.equal(res.peerMissionSequence,77);
 assert.equal(f.calls(),1);
 assert.equal(f.missions.get(102).runtimeStatus,"offered");
 assert.equal(f.missions.get(102).objectiveCompleted,false);
 assert.equal(f.missions.get(101).runtimeStatus,"accepted");
});
test("repeating wingman request does not offer or advance a second mission",()=>{
 const f=fixture();
 assert.equal(offer(f.params).status,"PEER_NATIVE_MATCHING_MISSION_OFFERED");
 assert.equal(offer(f.params).status,"PEER_ALREADY_HAS_NATIVE_MISSION");
 assert.equal(f.calls(),1);
});
test("no implicit player acceptance: leader's mission remains separate and intact",()=>{
 const f=fixture();offer(f.params);
 assert.equal(f.missions.get(101),f.leaderMission);
 assert.notEqual(f.missions.get(102).missionSequence,f.leaderMission.missionSequence);
 assert.equal(f.missions.get(102).runtimeStatus,"offered");
});
test("native standing rejection cannot be bypassed by fleet join",()=>{
 const f=fixture();f.setStandings(false);
 assert.equal(offer(f.params).status,"PEER_AGENT_STANDING_BLOCKED");
 assert.equal(f.calls(),0);
});
test("native replay cooldown cannot be bypassed by fleet join",()=>{
 const f=fixture();f.setCooldown(234);
 assert.equal(offer(f.params).status,"PEER_NATIVE_REPLAY_COOLDOWN");
 assert.equal(f.calls(),0);
});
test("the peer's existing native offer is never overwritten",()=>{
 const f=fixture();const existing={agentID:501,contentID:111,runtimeStatus:"offered"};
 f.missions.set(102,existing);
 assert.equal(offer(f.params).status,"PEER_ALREADY_HAS_NATIVE_MISSION");
 assert.equal(f.missions.get(102),existing);
 assert.equal(f.calls(),0);
});
test("no matching mission from unallowlisted client source",()=>{
 const f=fixture();f.setAllowed(false);
 assert.equal(offer(f.params).status,"CLIENT_MISSION_NOT_ALLOWLISTED");
 assert.equal(f.calls(),0);
});
test("reject missing real dungeon, transport/agent, incomplete agent mission context",()=>{
 const edits=[
  {runtimeStatus:"offered"},{objectiveMode:"transport"},{objectiveMode:"fetch"},
  {gmCompleted:true},{objectiveCompleted:true},{dungeonInstanceID:null},
  {missionSystemID:null},{missionTemplateID:""}
 ];
 for(const update of edits){
  const f=fixture();Object.assign(f.leaderMission,update);
  assert.equal(offer(f.params).status,"LEADER_NATIVE_DUNGEON_NOT_READY");
  assert.equal(f.calls(),0);
 }
});
test("only two distinct authenticated active fleet members may join",()=>{
 const f=fixture();f.fleet.members.set(103,{job:0});
 assert.equal(offer(f.params).status,"NOT_CREATOR_LED_NATIVE_DUO");
 f.fleet.members.delete(103);f.fleet.creatorCharID=102;
 assert.equal(offer(f.params).status,"NOT_CREATOR_LED_NATIVE_DUO");
 assert.equal(f.calls(),0);
});
test("other player's fleet cannot be impersonated by reusing an agent",()=>{
 const f=fixture();f.params.fleetRuntime.getFleetForCharacter=id=>id===102?f.fleet:null;
 assert.equal(offer(f.params).status,"NOT_CREATOR_LED_NATIVE_DUO");
 assert.equal(f.calls(),0);
});
test("wrong native station, undocked or remote wingman must request own native offer",()=>{
 for(const change of [
  s=>s.peer.stationid=60000011,s=>s.peer.locationid=30000142,
  s=>s.leader.stationid=60000012,s=>s.leader.locationid=30000142
 ]){
  const f=fixture();change(f);
  assert.equal(offer(f.params).status,"NOT_TWO_AUTHENTIC_DOCKED_PLAYERS");
  assert.equal(f.calls(),0);
 }
});
test("stale disconnected or duplicate peer session is rejected before mutation",()=>{
 const f=fixture();f.peer.socket.destroyed=true;
 assert.equal(offer(f.params).status,"NOT_TWO_AUTHENTIC_DOCKED_PLAYERS");
 f.peer.socket.destroyed=false;
 f.params.sessions.push({...f.peer,socket:{destroyed:false}});
 assert.equal(offer(f.params).status,"NOT_TWO_AUTHENTIC_DOCKED_PLAYERS");
 assert.equal(f.calls(),0);
});
test("native module/API uncertainty fails closed without throwing into agent dialogue",()=>{
 const f=fixture();f.params.offerSpecificMission=null;
 assert.equal(offer(f.params).status,"NATIVE_JOIN_APIS_UNAVAILABLE");
 f.params.offerSpecificMission=()=>{throw Error("SQLite unavailable")};
 assert.equal(offer(f.params).status,"NATIVE_JOIN_PREPARE_FAILED");
});
test("no cross-agent substitution when agent ID changes",()=>{
 const f=fixture();f.params.agentRecord.agentID=502;
 assert.equal(offer(f.params).status,"LEADER_NATIVE_DUNGEON_NOT_READY");
 assert.equal(f.calls(),0);
});
test("native offered contract mismatch never claims duo-ready",()=>{
 const f=fixture();
 f.params.offerSpecificMission=()=>({success:true,data:{kind:"offered",missionRecord:{
  agentID:501,contentID:2392,missionSequence:78,missionTemplateID:"different",
  runtimeStatus:"offered",objectiveMode:"dungeon"}}});
 assert.equal(offer(f.params).status,"JOIN_OFFER_MISMATCH_REQUIRES_MANUAL_REVIEW");
});

test("career, important and storyline native missions cannot be synchronized via co-op offer",()=>{
 for(const patch of [
  f=>{f.leaderMission.importantMission=true},
  f=>{f.leaderMission.storylineOfferProjection=true},
  f=>{f.params.agentRecord.importantMission=true},
  f=>{f.params.agentRecord.isCareerAgent=true}
 ]){
  const f=fixture();patch(f);
  assert.equal(offer(f.params).status,"LEADER_NATIVE_DUNGEON_NOT_READY");
  assert.equal(f.calls(),0);
 }
});
