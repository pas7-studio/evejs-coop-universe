"use strict";
// P0 safe cooperative turn-in for two independently completed native
// EveJS agent missions. Both players must have ACCEPTED the same
// real agent/content objective and each must ALREADY have native
// objectiveCompleted=true. Never call GM completion or clone rewards.
const id=v=>Number.isSafeInteger(Number(v))&&Number(v)>0?Number(v):null;
const str=v=>String(v===null||v===undefined?"":v).trim();
const equivalent=(a,b)=>Boolean(a&&b&&
 id(a.agentID)===id(b.agentID)&&
 str(a.contentID)!==""&&str(a.contentID)===str(b.contentID)&&
 str(a.missionTemplateID)===str(b.missionTemplateID)&&
 a.objectiveMode==="dungeon"&&b.objectiveMode==="dungeon"&&
 a.runtimeStatus==="accepted"&&b.runtimeStatus==="accepted"&&
 a.objectiveCompleted===true&&b.objectiveCompleted===true&&
 a.gmCompleted!==true&&b.gmCompleted!==true);
function prepare({session,agentID,actionID,fleetRuntime,missionRuntime,
 sessions=[],getDockedLocationID}={}){
 const leader=id(session?.characterID),agent=id(agentID),action=Number(actionID);
 if(!leader||!agent||![6,7].includes(action)||
  !fleetRuntime||!missionRuntime||
  typeof missionRuntime.getMissionRecord!=="function"||
  !Array.isArray(sessions)||typeof getDockedLocationID!=="function")
  return {ok:false,reason:"NOT_NATIVE_MISSION_TURNIN"};
 const fleet=fleetRuntime.getFleetForCharacter?.(leader);
 if(!fleet||fleet.members?.size!==2||!fleet.members.has(leader))
  return {ok:false,reason:"NOT_TWO_NATIVE_FLEET_MEMBERS"};
 const peerID=[...fleet.members.keys()].map(id).find(x=>x&&x!==leader);
 if(!peerID)return {ok:false,reason:"INVALID_FLEET_PEER"};
 const matches=sessions.filter(s=>id(s?.characterID)===peerID&&
  s?.socket?.destroyed!==true);
 const self=sessions.filter(s=>id(s?.characterID)===leader&&
  s?.socket?.destroyed!==true);
 if(matches.length!==1||self.length!==1||self[0]!==session)
  return {ok:false,reason:"NOT_TWO_DISTINCT_ACTIVE_SESSIONS"};
 const peer=matches[0];
 const member=require("./coopNativeFleetParty").membership({
  leaderSession:session,peerSession:peer,fleetRuntime});
 if(!member.ok||member.fleetID!==id(fleet.fleetID))
  return {ok:false,reason:"NATIVE_FLEET_CHANGED"};
 const station=id(getDockedLocationID(session));
 if(!station||station!==id(getDockedLocationID(peer)))
  return {ok:false,reason:"NOT_DOCKED_AT_SAME_AGENT_STATION"};
 const leaderMission=missionRuntime.getMissionRecord(leader,agent);
 const peerMission=missionRuntime.getMissionRecord(peerID,agent);
 if(!equivalent(leaderMission,peerMission))
  return {ok:false,reason:"NATIVE_MISSIONS_NOT_BOTH_COMPLETED"};
 return {ok:true,reason:"NATIVE_SHARED_TURNIN_READY",
  fleetID:member.fleetID,leader,peerID,agentID:agent,
  actionID:action,station,leaderMission,peerMission,session,peer};
}
function finish({ticket,missionRuntime,fleetRuntime,getDockedLocationID}={}){
 if(!ticket?.ok||!missionRuntime||!fleetRuntime)
  return {status:"NO_AUTHORIZED_SHARED_TURNIN"};
 // This is called ONLY after the real captain's original DoAction,
 // and only if native EveJS deleted that accepted mission. A failed
 // attempt or a conversation does not close a peer's mission.
 if(missionRuntime.getMissionRecord(ticket.leader,ticket.agentID))
  return {status:"LEADER_NATIVE_MISSION_NOT_COMPLETED"};
 const ready=require("./coopNativeFleetParty").membership({
  leaderSession:ticket.session,peerSession:ticket.peer,fleetRuntime});
 if(!ready.ok||ready.fleetID!==ticket.fleetID||
  ticket.session?.socket?.destroyed===true||
  ticket.peer?.socket?.destroyed===true||
  id(getDockedLocationID?.(ticket.session))!==ticket.station||
  id(getDockedLocationID?.(ticket.peer))!==ticket.station)
  return {status:"NATIVE_FLEET_OR_STATION_CHANGED"};
 const second=missionRuntime.getMissionRecord(ticket.peerID,ticket.agentID);
 if(!equivalent(ticket.peerMission,second)||
  str(second.missionSequence)!==str(ticket.peerMission.missionSequence))
  return {status:"PEER_NATIVE_OBJECTIVE_NOT_READY"};
 // Normal EveJS per-character completion applies its own journal,
 // standing, rewards and mission cleanup exactly once. Never copy
 // the leader's items or wallets directly to the other player.
 const result=missionRuntime.doAgentAction(ticket.peerID,ticket.agentID,
  ticket.actionID);
 if(result?.success!==true||
  missionRuntime.getMissionRecord(ticket.peerID,ticket.agentID))
  return {status:"PEER_NATIVE_TURNIN_NOT_COMPLETED"};
 return {status:"TWO_NATIVE_MISSIONS_COMPLETED",fleetID:ticket.fleetID,
  characterIDs:[ticket.leader,ticket.peerID],agentID:ticket.agentID};
}
module.exports={prepare,finish,equivalent};
