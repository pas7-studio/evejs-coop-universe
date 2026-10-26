"use strict";
// P0 safe cooperative turn-in for two independently completed native
// EveJS agent missions. Both players must have ACCEPTED the same
// real agent/content objective and each must ALREADY have native
// objectiveCompleted=true. Never call GM completion or clone rewards.
const id=v=>Number.isSafeInteger(Number(v))&&Number(v)>0?Number(v):null;
const str=v=>String(v===null||v===undefined?"":v).trim();

// Native per-character agent rewards are not a single atomic fleet operation.
// Never retry an ambiguous second-player payout after an interrupted write.
const fs=require("node:fs"),path=require("node:path");
const DEFAULT_JOURNAL="/var/lib/evejs/coop-mission-turnin.jsonl";
function journalKey(ticket){
 const p=ticket?.peerMission||{},l=ticket?.leaderMission||{};
 const n=id(p.missionSequence),leaderSeq=id(l.missionSequence);
 if(!ticket?.ok||!id(ticket.fleetID)||!id(ticket.leader)||
  !id(ticket.peerID)||!id(ticket.agentID)||!n||!leaderSeq||
  !str(p.contentID)||str(p.contentID)!==str(l.contentID)||
  ![6,7].includes(Number(ticket.actionID)))return null;
 return JSON.stringify([ticket.fleetID,ticket.leader,ticket.peerID,ticket.agentID,
  leaderSeq,n,str(p.contentID),str(p.missionTemplateID)]);
}
function readSettlement(file,key){
 try{
  const data=fs.readFileSync(file,"utf8");
  if(Buffer.byteLength(data,"utf8")>8*1024*1024||data&&!data.endsWith("\n"))
   return {status:"JOURNAL_CORRUPTED"};
  let latest=null;
  for(const line of data.split("\n")){
   if(!line)continue;
   let record;try{record=JSON.parse(line)}catch{return {status:"JOURNAL_CORRUPTED"};}
   if(typeof record?.key!=="string"||
    !["PREPARED","AWARDED","UNKNOWN"].includes(record?.state)||
    !Number.isFinite(record?.at))
    return {status:"JOURNAL_CORRUPTED"};
   if(record.key===key)latest=record;
  }
  return {status:"READY",previous:latest};
 }catch(err){
  if(err?.code==="ENOENT")return {status:"READY",previous:null};
  return {status:"JOURNAL_UNAVAILABLE"};
 }
}
function durableWrite(file,key,state){
 let fd;
 try{
  if(typeof file!=="string"||!path.isAbsolute(file)||!key)return false;
  fs.mkdirSync(path.dirname(file),{recursive:true});
  fd=fs.openSync(file,"a",0o600);
  const data=Buffer.from(JSON.stringify({key,state,at:Date.now()})+"\n");
  // Single bounded append followed by fsync. Partial IO remains an
  // intentionally corrupt/fail-closed journal, never a retry permission.
  if(fs.writeSync(fd,data,0,data.length,null)!==data.length)return false;
  fs.fsyncSync(fd);
  return true;
 }catch{return false}
 finally{if(fd!==undefined)try{fs.closeSync(fd)}catch{}}
}
function beginPeerSettlement(ticket,file){
 const key=journalKey(ticket);
 if(!key)return {status:"INVALID_NATIVE_SETTLEMENT_KEY"};
 const current=readSettlement(file,key);
 if(current.status!=="READY")return current;
 if(current.previous){
  if(current.previous.state==="AWARDED")return {status:"PEER_SETTLEMENT_ALREADY_RECORDED"};
  return {status:"PEER_SETTLEMENT_REQUIRES_MANUAL_RECONCILIATION"};
 }
 if(!durableWrite(file,key,"PREPARED"))return {status:"SETTLEMENT_JOURNAL_WRITE_FAILED"};
 return {status:"READY",key};
}


// Extra durability boundary for the FIRST native recipient. The older peer
// receipt is intentionally independent. This fence is only enabled on an
// explicitly approved two-recipient mission settlement deployment.
const DEFAULT_LEADER_FENCE="/var/lib/evejs/coop-duo-mission-leader-fence.jsonl";
const LEADER_STATES=["PREPARED","LEADER_NATIVE_CLEARED","BOTH_NATIVE_CLEARED"];
function leaderFenceKey(ticket){
 const m=ticket?.leaderMission||{};
 if(!ticket?.ok||!id(ticket.leader)||!id(ticket.peerID)||
  !id(ticket.agentID)||!id(m.missionSequence)||
  !id(ticket.peerMission?.missionSequence)||
  str(m.contentID)===""||str(m.missionTemplateID)===""||
  str(m.contentID)!==str(ticket.peerMission?.contentID)||
  str(m.missionTemplateID)!==str(ticket.peerMission?.missionTemplateID))
  return null;
 // Crucially exclude fleet ID and peer ID: reforming a fleet or changing the
 // wingman cannot reset this character's same native mission payout fence.
 return JSON.stringify([ticket.leader,ticket.agentID,
  m.missionSequence,str(m.contentID),str(m.missionTemplateID)]);
}
function readLeaderFence(file,key){
 if(typeof file!=="string"||!path.isAbsolute(file)||!key)
  return {status:"LEADER_FENCE_PATH_INVALID"};
 let data;
 try{data=fs.readFileSync(file,"utf8");}
 catch(e){return e?.code==="ENOENT"?
  {status:"READY",previous:null}:
  {status:"LEADER_FENCE_UNAVAILABLE"};}
 if(typeof data!=="string"||Buffer.byteLength(data,"utf8")>8*1024*1024||
  (data.length>0&&!data.endsWith("\n")))
  return {status:"LEADER_FENCE_CORRUPT"};
 let previous=null;
 const latest=new Map();
 for(const line of data.split("\n")){
  if(!line)continue;
  let event;
  try{event=JSON.parse(line);}catch{return {status:"LEADER_FENCE_CORRUPT"};}
  if(event?.v!==1||typeof event.key!=="string"||
   !Array.isArray(event.identity)||event.identity.length!==5||
   event.key!==JSON.stringify(event.identity)||
   event.identity.some((x,i)=>i<3?!id(x):str(x)==="")||
   !id(event.peerID)||!id(event.peerMissionSequence)||
   !LEADER_STATES.includes(event.state)||!Number.isFinite(event.at))
   return {status:"LEADER_FENCE_CORRUPT"};
  const last=latest.get(event.key);
  if(!last){
   if(event.state!=="PREPARED")
    return {status:"LEADER_FENCE_INVALID_TRANSITION"};
  }else{
   if(last.peerID!==event.peerID||
    last.peerMissionSequence!==event.peerMissionSequence||
    (last.state==="PREPARED"&&event.state!=="LEADER_NATIVE_CLEARED")||
    (last.state==="LEADER_NATIVE_CLEARED"&&event.state!=="BOTH_NATIVE_CLEARED")||
    last.state==="BOTH_NATIVE_CLEARED")
    return {status:"LEADER_FENCE_INVALID_TRANSITION"};
  }
  latest.set(event.key,event);
 }
 previous=latest.get(key)||null;
 return {status:"READY",previous};
}
function writeLeaderFence(file,ticket,key,state){
 let fd;
 try{
  if(!path.isAbsolute(file)||!LEADER_STATES.includes(state))return false;
  const identity=JSON.parse(key);
  fs.mkdirSync(path.dirname(file),{recursive:true});
  fd=fs.openSync(file,"a",0o600);
  const payload=Buffer.from(JSON.stringify({v:1,key,identity,
   peerID:ticket.peerID,peerMissionSequence:ticket.peerMission.missionSequence,
   state,at:Date.now()})+"\n");
  if(fs.writeSync(fd,payload,0,payload.length,null)!==payload.length)return false;
  fs.fsyncSync(fd);return true;
 }catch{return false}
 finally{if(fd!==undefined)try{fs.closeSync(fd)}catch{}}
}
function beginLeaderFence(ticket,file){
 const key=leaderFenceKey(ticket);
 if(!key)return {status:"LEADER_FENCE_INVALID_NATIVE_KEY"};
 const record=readLeaderFence(file,key);
 if(record.status!=="READY")return record;
 if(record.previous)
  return {status:"LEADER_SETTLEMENT_REQUIRES_MANUAL_RECONCILIATION"};
 if(!writeLeaderFence(file,ticket,key,"PREPARED"))
  return {status:"LEADER_FENCE_WRITE_FAILED"};
 return {status:"READY",key,file};
}
function advanceLeaderFence(ticket,nextState){
 const fence=ticket?._leaderFence;
 if(!fence)return {status:"LEADER_FENCE_NOT_PREPARED"};
 const record=readLeaderFence(fence.file,fence.key);
 if(record.status!=="READY")return record;
 const expected=nextState==="LEADER_NATIVE_CLEARED"?"PREPARED":"LEADER_NATIVE_CLEARED";
 if(record.previous?.state!==expected||
  record.previous.peerID!==ticket.peerID||
  record.previous.peerMissionSequence!==ticket.peerMission?.missionSequence)
  return {status:"LEADER_SETTLEMENT_REQUIRES_MANUAL_RECONCILIATION"};
 if(!writeLeaderFence(fence.file,ticket,fence.key,nextState))
  return {status:"LEADER_FENCE_WRITE_FAILED"};
 return {status:"READY",key:fence.key};
}

const equivalent=(a,b)=>Boolean(a&&b&&
 id(a.agentID)===id(b.agentID)&&
 str(a.contentID)!==""&&str(a.contentID)===str(b.contentID)&&
 str(a.missionTemplateID)===str(b.missionTemplateID)&&
 a.objectiveMode==="dungeon"&&b.objectiveMode==="dungeon"&&
 a.runtimeStatus==="accepted"&&b.runtimeStatus==="accepted"&&
 a.objectiveCompleted===true&&b.objectiveCompleted===true&&
 a.gmCompleted!==true&&b.gmCompleted!==true);
function prepare({session,agentID,actionID,fleetRuntime,missionRuntime,
 sessions=[],getDockedLocationID,leaderFencePath}={}){
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
 if(process.env.EVEJS_COOP_MISSION_INSTANCE_LINK==="1"){
  const provenance=require("./coopMissionInstanceProvenance");
  const link=provenance.verify({ownerID:leader,peerID,agentID:agent,
   leaderMission,peerMission});
  if(!link.ok)return {ok:false,reason:link.status};
  if(!provenance.nativeSharedObjectiveMatches({ownerID:leader,
   agentID:agent,leaderMission,peerMission}))
   return {ok:false,reason:"PEER_NATIVE_SHARED_OBJECTIVE_NOT_PROVED"};
 }
 const ticket={ok:true,reason:"NATIVE_SHARED_TURNIN_READY",
  fleetID:member.fleetID,leader,peerID,agentID:agent,
  actionID:action,station,leaderMission:{...leaderMission},
  peerMission:{...peerMission},session,peer};
 // The optional PVE-005A gate executes BEFORE any native leader reward
 // intent or stock doAgentAction. Never simulate mission completion.
 if(process.env.EVEJS_COOP_PVE_DUO_REWARD_GUARD==="1"){
  const proof=require("./coopPveDuoNativeRewardGuard").preflight(ticket);
  if(!proof.ok)
   throw Error("COOP_PVE_DUO_REWARD_BLOCKED: "+proof.status);
  ticket._pveRewardPreflight=proof;
 }
 if(process.env.EVEJS_COOP_FLEET_LEADER_FENCE==="1"){
  if(process.env.EVEJS_COOP_FLEET_MISSION_TURNIN!=="1")
   throw Error("LEADER_FENCE_REQUIRES_PEER_SETTLEMENT_GUARD");
  const file=leaderFencePath||process.env.EVEJS_COOP_MISSION_LEADER_FENCE_FILE||
   DEFAULT_LEADER_FENCE;
  const result=beginLeaderFence(ticket,file);
  // Fail CLOSED before the native leader's wallet/LP/standing award starts.
  if(result.status!=="READY")
   throw Error("COOP_DUO_LEADER_SETTLEMENT_BLOCKED: "+result.status);
  ticket._leaderFence={key:result.key,file:result.file};
 }
 return ticket;
}
function finish({ticket,missionRuntime,leaderActionResult,fleetRuntime,getDockedLocationID,journalPath}={}){
 if(!ticket?.ok||!missionRuntime||!fleetRuntime)
  return {status:"NO_AUTHORIZED_SHARED_TURNIN"};
 if(ticket._leaderFence && leaderActionResult?.success!==true)
  return {status:"LEADER_NATIVE_RESULT_NOT_ACKNOWLEDGED"};
 // This is called ONLY after the real captain's original DoAction,
 // and only if native EveJS deleted that accepted mission. A failed
 // attempt or a conversation does not close a peer's mission.
 if(missionRuntime.getMissionRecord(ticket.leader,ticket.agentID))
  return {status:"LEADER_NATIVE_MISSION_NOT_COMPLETED"};
 if(ticket._leaderFence){
  // Native original agent completed. Mark AFTER actual mission record deletion
  // but BEFORE attempting the second recipient's independent reward.
  const leaderRecord=advanceLeaderFence(ticket,"LEADER_NATIVE_CLEARED");
  if(leaderRecord.status!=="READY")
   return {status:"LEADER_SETTLEMENT_REQUIRES_MANUAL_RECONCILIATION",
    reason:leaderRecord.status};
 }
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
 if(process.env.EVEJS_COOP_MISSION_INSTANCE_LINK==="1"){
  const provenance=require("./coopMissionInstanceProvenance");
  const link=provenance.verify({ownerID:ticket.leader,
   peerID:ticket.peerID,agentID:ticket.agentID,
   leaderMission:ticket.leaderMission,peerMission:second});
  if(!link.ok)return {status:link.status};
  if(!provenance.nativeSharedObjectiveMatches({
   ownerID:ticket.leader,agentID:ticket.agentID,
   leaderMission:ticket.leaderMission,peerMission:second}))
   return {status:"PEER_NATIVE_SHARED_OBJECTIVE_NOT_PROVED"};
 }
 // The leader's original native DoAction purges the dungeon on completion,
 // so recheck immutable mission/source identity and peer's original shared
 // objective receipt WITHOUT requiring that already-purged live instance.
 if(ticket._pveRewardPreflight||
    process.env.EVEJS_COOP_PVE_DUO_REWARD_GUARD==="1"){
  const peerGuard=require("./coopPveDuoNativeRewardGuard").beforePeer(ticket,second);
  if(!peerGuard.ok)return {status:"PVE_DUO_PEER_NATIVE_REWARD_BLOCKED",
   reason:peerGuard.status};
 }
 // The old native DoAction remains the ONLY reward/standing authority.
 // This durable intent is required only for explicitly opted-in automated
 // two-recipient turn-in; by default this gameplay feature stays OFF.
 const safeMode=process.env.EVEJS_COOP_FLEET_MISSION_TURNIN==="1";
 const file=journalPath||process.env.EVEJS_COOP_MISSION_TURNIN_JOURNAL_FILE||
  DEFAULT_JOURNAL;
 const intent=safeMode?beginPeerSettlement(ticket,file):null;
 if(safeMode&&intent.status!=="READY")return intent;
 let result;
 try{
  result=missionRuntime.doAgentAction(ticket.peerID,ticket.agentID,
   ticket.actionID);
 }catch(error){
  if(safeMode)durableWrite(file,intent.key,"UNKNOWN");
  return {status:"PEER_SETTLEMENT_REQUIRES_MANUAL_RECONCILIATION"};
 }
 let remaining;
 try{remaining=missionRuntime.getMissionRecord(ticket.peerID,ticket.agentID);}
 catch(_){remaining={unknown:true};}
 if(result?.success!==true||remaining){
  if(safeMode)durableWrite(file,intent.key,"UNKNOWN");
  return {status:safeMode?"PEER_SETTLEMENT_REQUIRES_MANUAL_RECONCILIATION":
   "PEER_NATIVE_TURNIN_NOT_COMPLETED"};
 }
 if(safeMode&&!durableWrite(file,intent.key,"AWARDED"))
  return {status:"PEER_SETTLEMENT_REQUIRES_MANUAL_RECONCILIATION"};
 if(ticket._leaderFence){
  const both=advanceLeaderFence(ticket,"BOTH_NATIVE_CLEARED");
  if(both.status!=="READY")
   return {status:"LEADER_SETTLEMENT_REQUIRES_MANUAL_RECONCILIATION",
    reason:both.status};
 }
 // Both *native mission records* were independently cleared by EveJS.
 // This is no ISK/LP balance attestation or additional reward mutation.
 if(ticket._pveRewardPreflight){
  try{require("./coopRuntimeProbe").observe(
   "living-pve-duo-native-mission-turnin",null,
   {spaceState:{systemID:ticket._pveRewardPreflight.missionSystemID}},
   {status:"TWO_NATIVE_PERSONAL_MISSION_RECORDS_CLEARED",
    fleetID:ticket.fleetID,agentID:ticket.agentID,
    sourceInstanceID:ticket._pveRewardPreflight.sourceInstanceID,
    characterIDs:[ticket.leader,ticket.peerID],
    missionSequences:[ticket.leaderMission.missionSequence,
     ticket.peerMission.missionSequence],
    evidence:"NATIVE_PERSONAL_MISSION_DELETION_NOT_WALLET_OR_LP_DELTA"}
  )}catch{}
 }
 return {status:"TWO_NATIVE_MISSIONS_COMPLETED",fleetID:ticket.fleetID,
  characterIDs:[ticket.leader,ticket.peerID],agentID:ticket.agentID};
}
module.exports={prepare,finish,equivalent,journalKey,readSettlement,beginPeerSettlement,leaderFenceKey,readLeaderFence,beginLeaderFence,advanceLeaderFence};
