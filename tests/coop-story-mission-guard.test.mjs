import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createStoryMissionGuard}=require("../integration/coopStoryMissionGuard.cjs");
const NOW="133400000000000000", FUTURE=(BigInt(NOW)+100000000n).toString();
function make(){
 const catalog=[
  {missionID:1,isEpicArc:true,epicArcID:100,sourceAgentID:11,nextMissionIDs:[2]},
  {missionID:2,isEpicArc:true,epicArcID:100,sourceAgentID:11,nextMissionIDs:[3,4]},
  {missionID:3,isEpicArc:true,epicArcID:100,sourceAgentID:12,nextMissionIDs:[]},
  {missionID:4,isEpicArc:true,epicArcID:200,sourceAgentID:12,nextMissionIDs:[]},
  {missionID:5,isStoryline:true,sourceAgentID:13,nextMissionIDs:[]},
  {missionID:6,sourceAgentID:14,nextMissionIDs:[7]},
  {missionID:7,sourceAgentID:14,nextMissionIDs:[]},
  {missionID:8,sourceAgentID:15,nextMissionIDs:[]}
 ];
 const agents=[{agentID:11},{agentID:12},{agentID:13,importantMission:true},
  {agentID:14,careerID:1},{agentID:15}];
 const init=id=>({characterID:id,missionsByAgentID:{},history:[],
  declineTimersByAgentID:{},completedCareerAgentIDs:{},
  epicArcProgress:{completedArcsByID:{}},storylineProgress:{pendingOffersByAgentID:{}}});
 const first={characterID:1001,userid:201,socket:{destroyed:false}};
 const second={characterID:1002,userid:202,socket:{destroyed:false}};
 const sessions=[first,second];
 const states=new Map([[1001,init(1001)],[1002,init(1002)]]);
 const guard=createStoryMissionGuard({
  getSessions:()=>sessions,
  getCharacterRecord:id=>({accountId:id-800}),
  getCharacterStateSnapshot:id=>JSON.parse(JSON.stringify(states.get(id))),
  getAgentByID:id=>agents.find(a=>a.agentID===id),
  getMissionByID:id=>catalog.find(m=>String(m.missionID)===String(id)),
  listAuthoredMissions:()=>catalog,
  isMissionOfferAllowedForAgent:(a,m)=>a.agentID===m.sourceAgentID,
  checkAgentEligibility:()=>true,nowFiletime:()=>NOW
 });
 const doCheck=(s,action,agentID,missionID,rest={})=>
  guard.check({session:s,action,agentID,missionID,...rest});
 const active=(s,agentID,contentID,missionSequence,status="offered",completed=false,mode="dungeon")=>{
  states.get(s.characterID).missionsByAgentID[String(agentID)]={
   agentID,contentID,missionSequence,runtimeStatus:status,objectiveCompleted:completed,
   objectiveMode:mode,missionTemplateID:"client-"+contentID};
 };
 const history=(s,agentID,contentID,missionSequence)=>{
  const st=states.get(s.characterID);
  delete st.missionsByAgentID[String(agentID)];
  st.history.unshift({agentID,contentID,missionSequence,runtimeStatus:"completed"});
 };
 return {first,second,sessions,states,guard,doCheck,active,history};
}
test("independent character Epic cooldown",()=>{
 const x=make(),a=x.states.get(1001);
 assert.equal(x.doCheck(x.first,"offer",11,1).ok,true);
 a.epicArcProgress.completedArcsByID["100"]={replayUntilFileTime:FUTURE};
 assert.equal(x.doCheck(x.first,"offer",11,1).reason,"EPIC_ARC_REPLAY_COOLDOWN");
 assert.equal(x.doCheck(x.second,"offer",11,1).ok,true);
});
test("account theft, duplicate login and disconnect denied",()=>{
 const x=make();x.first.userid=5;
 assert.equal(x.doCheck(x.first,"offer",11,1).reason,"NATIVE_ACCOUNT_MISMATCH");
 x.first.userid=201;x.sessions.push({...x.first});
 assert.equal(x.doCheck(x.first,"offer",11,1).reason,"AMBIGUOUS_NATIVE_CHARACTER_SESSION");
 x.sessions.pop();x.first.socket.destroyed=true;
 assert.equal(x.doCheck(x.first,"offer",11,1).reason,"INVALID_NATIVE_SESSION");
});
test("Epic Arc branch skipping and cross-arc links rejected",()=>{
 const x=make();assert.equal(x.doCheck(x.first,"offer",11,2).reason,"SCRIPTED_PREDECESSOR_NOT_VERIFIED");
 assert.equal(x.doCheck(x.first,"advance",12,null,{sourceAgentID:11,
  sourceMissionID:2,sourceSequence:60,nextMissionID:4}).reason,"EPIC_ARC_BRANCH_MISMATCH");
});
test("native timers fail closed on active or corrupt FILETIME",()=>{
 const x=make(),s=x.states.get(1001);s.declineTimersByAgentID["11"]=FUTURE;
 assert.equal(x.doCheck(x.first,"offer",11,1).reason,"NATIVE_AGENT_COOLDOWN_ACTIVE");
 s.declineTimersByAgentID["11"]="corrupt";
 assert.equal(x.doCheck(x.first,"offer",11,1).reason,"INVALID_NATIVE_FILETIME");
 delete s.declineTimersByAgentID["11"];
 s.epicArcProgress.completedArcsByID["100"]={replayUntilFileTime:"bad"};
 assert.equal(x.doCheck(x.first,"offer",11,1).reason,"INVALID_NATIVE_FILETIME");
});
test("Accept requires exact offered native mission and owner sequence",()=>{
 const x=make();x.active(x.first,11,1,60);
 assert.equal(x.doCheck(x.first,"accept",11,1,{expectedSequence:60}).ok,true);
 assert.equal(x.doCheck(x.first,"accept",11,1,{expectedSequence:59}).reason,
  "STALE_OR_DIFFERENT_NATIVE_MISSION");
 assert.equal(x.doCheck(x.second,"accept",11,1,{expectedSequence:60}).reason,
  "STALE_OR_DIFFERENT_NATIVE_MISSION");
 x.active(x.first,11,1,60,"accepted");
 assert.equal(x.doCheck(x.first,"accept",11,1,{expectedSequence:60}).reason,
  "NATIVE_STAGE_NOT_OFFERED");
});
test("Complete preflight never awards, requires objective and no prior completed history",()=>{
 const x=make();x.active(x.first,11,1,60,"accepted");
 assert.equal(x.doCheck(x.first,"complete",11,1,{expectedSequence:60}).reason,
  "NATIVE_OBJECTIVE_NOT_COMPLETE");
 x.active(x.first,11,1,60,"accepted",true);
 const r=x.doCheck(x.first,"complete",11,1,{expectedSequence:60});
 assert.equal(r.ok,true);assert.equal(r.rewardAtomicityVerified,false);
 x.states.get(1001).history.unshift({agentID:11,contentID:1,missionSequence:60,runtimeStatus:"completed"});
 assert.equal(x.doCheck(x.first,"complete",11,1,{expectedSequence:60}).reason,
  "NATIVE_STAGE_ALREADY_COMPLETED");
});
test("career once-only flag prevents root reoffer, allows authored next mission",()=>{
 const x=make(),s=x.states.get(1001);s.completedCareerAgentIDs["14"]=true;
 assert.equal(x.doCheck(x.first,"offer",14,6).reason,"CAREER_AGENT_ONCE_ONLY");
 assert.equal(x.doCheck(x.second,"offer",14,6).ok,true);
 x.history(x.first,14,6,7);
 assert.equal(x.doCheck(x.first,"offer",14,7,{sourceAgentID:14,sourceSequence:7}).ok,true);
});
test("storyline offer requires own matching pending milestone",()=>{
 const x=make(),p=x.states.get(1001).storylineProgress.pendingOffersByAgentID;
 assert.equal(x.doCheck(x.first,"offer",13,5).reason,"STORYLINE_MILESTONE_OFFER_MISSING");
 p["13"]={contentID:5,status:"pending"};
 assert.equal(x.doCheck(x.first,"offer",13,5).ok,true);
 p["13"].status="expired";
 assert.equal(x.doCheck(x.first,"offer",13,5).reason,"STORYLINE_MILESTONE_OFFER_MISSING");
});
test("same-agent and other-agent authored advance, not unaccepted stage",()=>{
 const x=make();x.active(x.first,11,1,71,"accepted",false,"agent");
 assert.equal(x.doCheck(x.first,"advance",11,null,{sourceAgentID:11,sourceMissionID:1,
  sourceSequence:71,nextMissionID:2}).reason,"AUTHORED_CHAIN_ADVANCE_AUTHORIZED");
 x.active(x.first,11,2,72,"accepted",false,"agent");
 assert.equal(x.doCheck(x.first,"advance",12,null,{sourceAgentID:11,sourceMissionID:2,
  sourceSequence:72,nextMissionID:3}).reason,"AUTHORED_CHAIN_ADVANCE_AUTHORIZED");
 x.active(x.first,11,2,72,"offered",false,"agent");
 assert.equal(x.doCheck(x.first,"advance",12,null,{sourceAgentID:11,sourceMissionID:2,
  sourceSequence:72,nextMissionID:3}).reason,"NATIVE_SOURCE_STAGE_NOT_ACCEPTED");
});
test("post-reconnect recovery offers next without re-paying last",()=>{
 const x=make();x.history(x.first,11,2,72);
 const opts={sourceAgentID:11,sourceMissionID:2,sourceSequence:72,nextMissionID:3};
 const r=x.doCheck(x.first,"recover",12,null,opts);
 assert.equal(r.reason,"NATIVE_CONTINUATION_OFFER_RECOVERABLE");
 assert.equal(r.personalProgressOnly,true);
 x.active(x.first,12,3,73);
 assert.equal(x.doCheck(x.first,"recover",12,null,opts).reason,
  "TARGET_AGENT_HAS_ACTIVE_NATIVE_MISSION");
});
test("stale history and other player's mission cannot resume",()=>{
 const x=make();x.history(x.first,11,2,72);
 const opts={sourceAgentID:11,sourceMissionID:2,sourceSequence:72,nextMissionID:3};
 x.states.get(1001).history.unshift({agentID:11,contentID:1,missionSequence:73,runtimeStatus:"completed"});
 assert.equal(x.doCheck(x.first,"recover",12,null,opts).reason,
  "NATIVE_SOURCE_COMPLETION_NOT_LATEST");
 assert.equal(x.doCheck(x.second,"recover",12,null,opts).reason,
  "NATIVE_SOURCE_COMPLETION_NOT_LATEST");
});
test("ordinary missions are out of scope and receive no synthetic progress",()=>{
 const x=make(),r=x.doCheck(x.first,"offer",15,8);
 assert.equal(r.reason,"ORDINARY_MISSION_OUT_OF_SCOPE");
 assert.equal(r.skip,true);
});
