import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {offer}=require("../integration/coopFleetMissionJoin.cjs");
const {prepare}=require("../integration/coopFleetMissionTurnin.cjs");
const station=60003760,agentID=501;
function scenario(){
 const leader={characterID:101,stationid:station,socket:{destroyed:false}};
 const peer={characterID:102,stationid:station,socket:{destroyed:false}};
 const fleet={fleetID:77,creatorCharID:101,members:new Map([[101,{job:1}],[102,{job:0}]])};
 const fleetRuntime={
  getFleetForCharacter:id=>fleet.members.has(id)?fleet:null,
  getMemberRecord:(f,id)=>f.members.get(id)||null
 };
 const leaderMission={agentID,contentID:2391,missionTemplateID:"client-mission:2391",
  missionSequence:1,runtimeStatus:"accepted",objectiveMode:"dungeon",
  objectiveCompleted:false,dungeonInstanceID:93301,missionSystemID:30000142,
  gmCompleted:false};
 const missions=new Map([[101,leaderMission]]);
 const missionRuntime={
  getMissionRecord:(id,agent)=>agent===agentID?missions.get(id)||null:null
 };
 const opts={characterID:102,agentRecord:{agentID,stationID:station},
  fleetRuntime,sessions:[leader,peer],
  getDockedLocationID:s=>s.stationid,
  getMissionRecord:missionRuntime.getMissionRecord,
  getClientMissionRecord:()=>({missionID:2391}),
  offerSpecificMission:()=>{const m={agentID,contentID:2391,
    missionTemplateID:"client-mission:2391",missionSequence:2,
    runtimeStatus:"offered",objectiveMode:"dungeon",
    objectiveCompleted:false,gmCompleted:false};
    missions.set(102,m);
    return {success:true,data:{kind:"offered",missionRecord:m}};
  },
  isMissionOfferAllowedForAgent:()=>true,
  canUseAgent:()=>true,
  getReplayUntilFileTime:()=>null,
  resolveReplayRemainingTicks:()=>0};
 const ready=()=>prepare({session:leader,agentID,actionID:6,
  fleetRuntime,missionRuntime,sessions:[leader,peer],
  getDockedLocationID:s=>s.stationid});
 return {opts,ready,missions,leaderMission};
}
test("native Request generates offer only; shared reward gate still DENIES unaccepted peer",()=>{
 const f=scenario();
 assert.equal(offer(f.opts).status,"PEER_NATIVE_MATCHING_MISSION_OFFERED");
 assert.equal(f.missions.get(102).runtimeStatus,"offered");
 f.leaderMission.objectiveCompleted=true;
 assert.equal(f.ready().reason,"NATIVE_MISSIONS_NOT_BOTH_COMPLETED");
});
test("after BOTH independent native Accept and objective completion, existing duo turn-in gate recognizes aligned offers",()=>{
 const f=scenario();
 assert.equal(offer(f.opts).status,"PEER_NATIVE_MATCHING_MISSION_OFFERED");
 const peer=f.missions.get(102);
 peer.runtimeStatus="accepted";peer.objectiveCompleted=true;
 f.leaderMission.objectiveCompleted=true;
 const ticket=f.ready();
 assert.equal(ticket.ok,true);
 assert.equal(ticket.reason,"NATIVE_SHARED_TURNIN_READY");
 assert.equal(ticket.leaderMission.missionSequence,1);
 assert.equal(ticket.peerMission.missionSequence,2);
 assert.equal(f.missions.get(102).runtimeStatus,"accepted");
});
test("different native content or template cannot collect shared payout after aligned offer",()=>{
 const f=scenario();offer(f.opts);
 const p=f.missions.get(102);
 p.runtimeStatus="accepted";p.objectiveCompleted=true;
 f.leaderMission.objectiveCompleted=true;
 p.contentID=2392;
 assert.equal(f.ready().reason,"NATIVE_MISSIONS_NOT_BOTH_COMPLETED");
 p.contentID=2391;p.missionTemplateID="different";
 assert.equal(f.ready().reason,"NATIVE_MISSIONS_NOT_BOTH_COMPLETED");
});
