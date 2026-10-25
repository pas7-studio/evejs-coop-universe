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
  actionID:action,station,leaderMission:{...leaderMission},
  peerMission:{...peerMission},session,peer};
}
function finish({ticket,missionRuntime,fleetRuntime,getDockedLocationID,journalPath}={}){
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
 return {status:"TWO_NATIVE_MISSIONS_COMPLETED",fleetID:ticket.fleetID,
  characterIDs:[ticket.leader,ticket.peerID],agentID:ticket.agentID};
}
module.exports={prepare,finish,equivalent,journalKey,readSettlement,beginPeerSettlement};
