"use strict";
/**
 * CH24+31 Stage D1: EXISTING stock Agent contact as a read-only company
 * dispatcher and one explicit Accept -> native MINE order. Not a new mission.
 * No free fleet, agent, corporation, ore, ISK, or second scheduler.
 * Native missions + paid convoy job hook retain priority.
 */
const pos=x=>Number.isSafeInteger(x)&&x>0;
const say=(text,actions=[])=>({success:true,data:{agentSays:[String(text).slice(0,1400),null],
 actions,lastActionInfo:{missionCompleted:0,missionDeclined:0,missionQuit:0,
 missionCantReplay:0}}});
const safe=x=>String(x??"").replace(/[<>\x00-\x1f]/g," ").slice(0,130);
function createMiningAgent({getAgent,getMission,getSessions,getFleetRecords,
 inspectShift,assignOrder,access,enabled=()=>false}={}){
 if([getAgent,getMission,getSessions,getFleetRecords,inspectShift,assignOrder,
  access?.isMember,access?.canIndustry,enabled].some(x=>typeof x!=="function"))
  throw Error("PLAYER_MINING_AGENT_NATIVE_AUTHORITIES_REQUIRED");
 function selected({session,agentID}={}){
  if(enabled()!==true||!pos(agentID)||!pos(session?.characterID)||
   !pos(session?.userid)||!pos(session?.corporationID)||
   session.socket?.destroyed===true)return null;
  let agent,mission,online;
  try{agent=getAgent(agentID);mission=getMission(session.characterID,agentID);
   online=getSessions();}catch{return null;}
  if(!agent||agent.agentID!==agentID||!pos(agent.corporationID)||
   !pos(agent.solarSystemID)||!pos(agent.stationID)||
   agent.isInSpace===true||mission||!Array.isArray(online)||
   online.filter(x=>x===session).length!==1||
   online.filter(x=>x.characterID===session.characterID).length!==1)
   return null;
  if(access.isMember(session,session.corporationID)!==true)return null;
  let fleets;
  try{fleets=getFleetRecords(agent.solarSystemID)}catch{return null}
  if(!Array.isArray(fleets)||fleets.length>128)return null;
  const jobs=[];
  for(const f of fleets){
   if(!pos(f?.fleetID)||f.systemID!==agent.solarSystemID||
    f.source!=="startup")continue;
   let row;try{row=inspectShift({systemID:f.systemID,fleetID:f.fleetID})}
   catch{return null;}
   if(row&&row.version===1&&row.status==="FUNDED"&&
    row.corporationID===session.corporationID&&
    row.employerCorpID===agent.corporationID&&
    row.systemID===agent.solarSystemID&&row.fleetID===f.fleetID)
    jobs.push(row);
  }
  if(!jobs.length)return null;
  // Stock agent has no native multi-fleet selector. Refuse ambiguous
  // selection rather than silently issuing commands to the wrong ships.
  if(jobs.length!==1)return {blocked:true,message:"Multiple verified mining shifts belong to this agent. No fleet was selected; no command was issued."};
  return {row:jobs[0],agent};
 }
 function display(j,session,detail=""){
  const r=j.row,manager=access.canIndustry(session,r.corporationID)===true;
  const seq=Number.isSafeInteger(r.commandSeq)?r.commandSeq:0;
  const started=r.directive==="MINE"&&r.commandState==="IDLE";
  const canActivate=manager&&(started||r.directive==="HOLD"||
   r.directive==="MINE"&&r.commandState!=="PENDING");
  const state="NPC mining fleet "+r.fleetID+" | original system "+r.systemID+
   " | miners "+(Array.isArray(r.minerIDs)?r.minerIDs.length:0)+
   " | haulers "+(Array.isArray(r.haulerIDs)?r.haulerIDs.length:0)+
   " | order "+safe(r.directive)+" | state "+safe(r.commandState)+
   " | revision "+seq+".";
  const money=manager?" Paid wage: "+(r.wageCents/100).toFixed(2)+
   " ISK (shift funding, NOT ore ownership).":"";
  const controls=manager&&canActivate?
   "\nAccept = request MINE/resume through the original native NPC tick. View = refresh. No automatic ore or ISK payout.":
   "\nView = refresh. Only a corporation industry manager may order the NPC fleet.";
  return say(state+money+controls+(detail?"\n"+safe(detail):""),
    canActivate?[[3,3],[1,1]]:[[1,1]]);
 }
 function doAction({session,agentID,actionID}={}){
  const j=selected({session,agentID});
  if(!j)return null; // stock missions and other existing agent jobs win
  if(j.blocked)return say(j.message);
  if(actionID==null||Number(actionID)===1||Number(actionID)===2)
   return display(j,session);
  if(Number(actionID)!==3&&Number(actionID)!==5)
   return say("This mining agent permits View and Accept only; no native mission was changed.",[[1,1]]);
  const r=j.row;
  if(access.canIndustry(session,r.corporationID)!==true)
   return say("Corporation industry permission denied; no NPC order sent.",[[1,1]]);
  // Repeated Accept cannot cause a second paid shift or cargo write. The
  // original GameStore order CAS is the authority for one command sequence.
  if(r.directive==="MINE"&&r.commandState!=="IDLE"&&r.commandState!=="PENDING")
   return display(j,session,"Mining was already requested; command replay was not sent.");
  if(r.directive!=="HOLD"&&r.directive!=="MINE")
   return display(j,session,"Current command must complete before another request.");
  let result;
  try{result=assignOrder({session,corporationID:r.corporationID,
   systemID:r.systemID,fleetID:r.fleetID,operationID:r.operationID,
   command:"MINE",expectedSeq:r.commandSeq});}
  catch{return say("Native mining order authority unavailable. No NPC order sent.",[[1,1]]);}
  if(result?.status==="ORDER_QUEUED"||
     result?.status==="ALREADY_ORDERED")
   return say("Native mining command "+safe(result.status)+
    ". This proves a durable request only, not mining work, ore delivery or earnings.",
     [[1,1]]);
  return say("Native mining command refused: "+safe(result?.reason||result?.status||"UNAVAILABLE")+
   ". No other fleet was selected.",[[1,1]]);
 }
 function briefing({session,agentID}={}){
  const j=selected({session,agentID});
  if(!j||j.blocked)return null;
  const row=j.row;
  return {"ContentID":null,"Mission Title ID":"NPC Mining Company",
   "Mission Briefing ID":"Funded native corporate mining shift "+row.operationID+
    " in system "+row.systemID+". Current order "+safe(row.directive)+
    ". Native fleet orders are separate from cargo title, station sale and payroll.",
   "Mission Keywords":{},"Mission Image":null,"Decline Time":null,
   "Expiration Time":null,"AcceptTimestamp":null,"Mission ID":null};
 }
 return Object.freeze({doAction,briefing});
}
let singleton;
function native(){
 if(!singleton){
  const access=require("./coopPlayerCorporationAccess"),
   agents=require("../services/agent/agentAuthority"),
   missions=require("../services/agent/agentMissionRuntime"),
   sessions=require("../services/chat/sessionRegistry"),
   mining=require("../services/mining/miningNpcOperations"),
   fleet=require("./coopPlayerMiningFleetTick");
  singleton=createMiningAgent({access,getAgent:agents.getAgentByID,
   getMission:missions.getMissionRecord,getSessions:sessions.getSessions,
   getFleetRecords:id=>mining.getMiningFleetsForSystem(id),
   inspectShift:fleet.inspect,assignOrder:fleet.assign,
   enabled:()=>process.env.EVEJS_COOP_PLAYER_NPC_MINING_AGENT==="1"&&
    process.env.EVEJS_COOP_PLAYER_NPC_MINING_COMPANY==="1"});
 }
 return singleton;
}
function doAction(args){
 if(process.env.EVEJS_COOP_PLAYER_NPC_MINING_AGENT!=="1")return null;
 try{return native().doAction(args)}catch{
  return null; // stock agent mission remains available
 }
}
function briefing(args){
 if(process.env.EVEJS_COOP_PLAYER_NPC_MINING_AGENT!=="1")return null;
 try{return native().briefing(args)}catch{return null;}
}
module.exports={createMiningAgent,doAction,briefing};
