"use strict";
// FW-002: actor-bound stock Agent dialogue; no fabricated mission, ISK,
// corporation transfer or client-controlled faction assignment.
const pos=x=>Number.isSafeInteger(x)&&x>0;
const safe=x=>String(x||"").replace(/[<>\x00-\x1f]/g," ").slice(0,90);
const reply=(s,actions=[])=>({success:true,data:{agentSays:[s,null],actions,
 lastActionInfo:{missionCompleted:0,missionDeclined:0,missionQuit:0,missionCantReplay:0}}});
// One line per agent+reason per minute: the militia desk used to answer with a bare
// null and nothing said which precondition failed, so the dialog showed only "Decline".
const contextFailAt = new Map();
function contextFail(agentID, reason) {
  try {
    const key = String(agentID) + "|" + String(reason);
    const now = Date.now();
    if (now - (contextFailAt.get(key) || 0) > 60000) {
      contextFailAt.set(key, now);
      require("../utils/logger").info(
        "[FactionMilitiaAgent] unavailable agent=" + agentID + " reason=" + reason,
      );
    }
  } catch (_error) { /* diagnostics must never change the answer */ }
  return null;
}

function allowedFactionIDs(env){
 const raw=String(env.EVEJS_COOP_MILITIA_FACTION_IDS||"").trim();
 if(!raw)return new Set();
 const ids=raw.split(",").map(x=>x.trim());
 if(ids.length>12||ids.some(x=>!/^\d{1,12}$/.test(x)||!pos(Number(x))))return new Set();
 return new Set(ids.map(Number));
}
function createFactionWarAgent({getAgent,getMission,getSessions,getFactionForCorporation,
 getFaction,getCharacter,getDockedLocationID,getDockedLocationKind,
 getEffectiveStanding,makeStore,getFrontlineStatus=()=>null,
 clock=()=>Date.now(),env=process.env}={}){
 if([getAgent,getMission,getSessions,getFactionForCorporation,getFaction,getCharacter,
  getDockedLocationID,getDockedLocationKind,getEffectiveStanding,
  makeStore,getFrontlineStatus,clock]
  .some(x=>typeof x!=="function"))throw Error("FW_AGENT_NATIVE_AUTHORITIES_REQUIRED");
 const enabled=()=>env.EVEJS_COOP_FACTION_WAR==="1"&&
  env.EVEJS_COOP_FACTION_MILITIA_AGENT==="1"&&
  env.EVEJS_COOP_NATIVE_ATOMIC_ROWS==="1";
 function context(session,agentID){
  if(!enabled()||!pos(session?.characterID)||!pos(agentID)||
    session?.socket?.destroyed===true)return null;
  try{
   const sessions=getSessions(),charID=session.characterID;
   if(!Array.isArray(sessions)||sessions.filter(s=>s===session).length!==1||
    sessions.filter(s=>s?.characterID===charID).length!==1||
    !getCharacter(charID))return contextFail(agentID,"session_or_character");
   const a=getAgent(agentID);
   if(a?.agentID!==agentID||a.isInSpace===true||!pos(a.stationID)||
    !pos(a.solarSystemID)||!pos(a.corporationID))
    return contextFail(agentID,"agent_not_desk");
   if(getDockedLocationKind(session)!=="station"||
    getDockedLocationID(session)!==a.stationID)return contextFail(agentID,"not_docked_at_agent_station");
   if(getMission(charID,agentID))return contextFail(agentID,"existing_mission_with_agent");
   const f=getFactionForCorporation(a.corporationID);
   if(!pos(f?.factionID)||!allowedFactionIDs(env).has(f.factionID)||
    !pos(f.militiaCorporationID))return contextFail(agentID,"corporation_faction_not_militia");
   const original=getFaction(f.factionID);
   if(!original||original.factionID!==f.factionID||
    original.militiaCorporationID!==f.militiaCorporationID)
    return contextFail(agentID,"faction_record_mismatch");
   const standing=getEffectiveStanding(charID,f.factionID);
   if(!standing||!Number.isFinite(standing.standing))return contextFail(agentID,"no_standing");
   return {session,agentID,characterID:charID,factionID:f.factionID,
    factionName:safe(f.name),standing:standing.standing};
  }catch(error){return contextFail(agentID,"exception:"+String(error&&error.message||error).slice(0,60))}
 }
 function storeFor(ctx){
  // Re-evaluate the authenticated native session at the exact atomic write.
  const valid=()=>{const current=context(ctx.session,ctx.agentID);
   return !!current&&current.characterID===ctx.characterID&&
    current.factionID===ctx.factionID};
  return makeStore(Object.freeze({
   enlistment:({characterID,factionID,agentID})=>
    valid()&&characterID===ctx.characterID&&factionID===ctx.factionID&&
    agentID===ctx.agentID&&context(ctx.session,ctx.agentID)?.standing>=0,
   leave:({enlistment,proofID})=>valid()&&
    enlistment?.characterID===ctx.characterID&&
    enlistment?.factionID===ctx.factionID&&
    proofID==="agent-confirm:"+ctx.agentID
  }));
 }
 function doAction({session,agentID,actionID}={}){
  const ctx=context(session,agentID);
  if(!ctx)return null;
  let store,s;
  try{store=storeFor(ctx);s=store.snapshot()}catch{
   return reply("[Militia] Native war state unavailable. No military status changed.");}
  const existing=s.enlistments[String(ctx.characterID)];
  const active=existing?.status==="ACTIVE";
  const same=active&&existing.factionID===ctx.factionID;
  const now=clock();
  if(!Number.isSafeInteger(now)||now<=0)return reply("[Militia] Clock unavailable.");
  const name=ctx.factionName||"the faction";
  if(actionID===null||actionID===undefined||Number(actionID)===1||Number(actionID)===2){
   if(same)return reply("[Militia] You serve "+name+". This is military service, NOT a native corporation transfer. Declining this briefing changes nothing: militia service ends only from the militia card in the Factional Warfare window. "+
    frontline(ctx),[[1,1]]);
   if(active)return reply("[Militia] You already serve another faction. Leave your current militia with its own authorized agent first.",[[1,1]]);
   if(existing?.cooldownUntil>now)return reply("[Militia] Re-enlistment cooldown is active. No change made.",[[1,1]]);
   if(ctx.standing<0)return reply("[Militia] Faction standing must be at least 0 to enlist. Current: "+ctx.standing+".",[[1,1]]);
   return reply("[Militia] Enlist with "+name+"? You must be docked at this authentic faction agent. This is a server-managed militia affiliation, not a native corporation transfer. Press Accept to join.",[[3,3],[1,1]]);
  }
  if(Number(actionID)===3||Number(actionID)===5){
   if(active||ctx.standing<0||existing?.cooldownUntil>now)return reply("[Militia] Enlistment unavailable. Reopen this agent to review your status.",[[1,1]]);
   const eventID="fw-enlist:"+ctx.characterID+":"+ctx.factionID+":"+
    ctx.agentID+":"+(existing?.leftAt||0);
   try{const result=store.execute({type:"ENLIST",eventID,characterID:ctx.characterID,
      factionID:ctx.factionID,agentID:ctx.agentID});
    if(result?.status==="APPLIED"||result?.status==="DUPLICATE")
     return reply("[Militia] Enlistment recorded for "+name+". No items or ISK granted.",[[1,1]]);
    return reply("[Militia] Enlistment blocked: "+safe(result?.reason||result?.status),[[1,1]]);
   }catch{return reply("[Militia] Transaction unavailable. No verified enlistment receipt.",[[1,1]])}
  }
  // Action 9 is what the mission-brief dialog sends for "Decline", and the client sends
  // it for the only button that dialog had. Treating it as "leave the militia" once
  // unenlisted a pilot who merely closed a bugged briefing. The desk never ends service
  // now: leaving the militia stays on the militia card in the Factional Warfare window,
  // where the button says exactly that.
  if(Number(actionID)===9&&same)
   return reply("[Militia] No military status changed. To end militia service use the militia card in the Factional Warfare window.",[[1,1]]);
  return reply("[Militia] Unsupported agent action. No military status changed.",[[1,1]]);
 }
 function frontline(ctx){
  if(env.EVEJS_COOP_FACTION_WAR_PLAYER_CAPTURE!=="1")
   return "";
  try{
   // Revalidate native actor-bound enlistment before rendering ANY
   // military intel, including the stock mission briefing route.
   const original=storeFor(ctx).snapshot()?.enlistments?.[String(ctx.characterID)];
   if(original?.status!=="ACTIVE"||
    original.characterID!==ctx.characterID||
    original.factionID!==ctx.factionID||
    !pos(original.enlistedAt))return "";
   const result=getFrontlineStatus({
    characterID:ctx.characterID,factionID:ctx.factionID});
   return result?.status==="OBSERVED"&&
    typeof result.text==="string"?
    result.text.replace(/[<>]/g," ").replace(/[\x00-\x1f]/g," ").slice(0,600):"";
  }catch{return ""}
 }
 function briefing({session,agentID}={}){
  try{
    require("../utils/logger").info("[FactionMilitiaAgent] briefing agent="+String(agentID)+
      " char="+String(session&&session.characterID)+
      " bound="+String(session&&session.currentBoundObjectID)+
      " flags="+[process.env.EVEJS_COOP_FACTION_WAR,process.env.EVEJS_COOP_FACTION_MILITIA_AGENT,
        process.env.EVEJS_COOP_NATIVE_ATOMIC_ROWS].join("/"));
  }catch(_error){}
  const ctx=context(session,agentID);if(!ctx)return null;
  return {ContentID:null,"Mission Title ID":"Faction Militia",
   "Mission Briefing ID":"Native faction service desk for "+ctx.factionName+
    ". Enlistment affects only server-managed militia service; no native corporation membership or ISK reward. "+
    frontline(ctx),
   "Mission Keywords":{},"Mission Image":null,"Decline Time":null,
   "Expiration Time":null,"AcceptTimestamp":null,"Mission ID":null};
 }
 return Object.freeze({doAction,briefing});
}
let singleton;
function native(){
 if(!singleton){
  const nativeStore=require("../gameStore");
  const factions=require("../services/faction/factionState");
  const agents=require("../services/agent/agentAuthority");
  const missions=require("../services/agent/agentMissionRuntime");
  const registry=require("../services/chat/sessionRegistry");
  const characters=require("../services/character/characterState");
  const locations=require("../services/structure/structureLocation");
  const standing=require("../services/character/standingRuntime");
  const path=require("node:path"),fs=require("node:fs");
  const storePath="./coopFactionWarStore"+
   (fs.existsSync(path.join(__dirname,"coopFactionWarStore.js"))?".js":".cjs");
  const createStore=require(storePath).createFactionWarStore;
  singleton=createFactionWarAgent({getAgent:agents.getAgentByID,
   getMission:missions.getMissionRecord,getSessions:registry.getSessions,
   getFactionForCorporation:factions.getFactionRecordByCorporationID,
   getFaction:factions.getFactionRecord,getCharacter:characters.getCharacterRecord,
   getDockedLocationID:locations.getDockedLocationID,
   getDockedLocationKind:locations.getDockedLocationKind,
   getEffectiveStanding:standing.getCharacterEffectiveStanding,
   getFrontlineStatus:details=>
    require("./coopWarMilitiaIntel").createWarMilitiaIntel({
     gameStore:nativeStore}).read(details),
   makeStore:proofs=>createStore({gameStore:nativeStore,proofs})});
 }
 return singleton;
}
function doAction(x){
 if(process.env.EVEJS_COOP_FACTION_MILITIA_AGENT!=="1")return null;
 try{return native().doAction(x)}catch{return null}
}
function briefing(x){
 if(process.env.EVEJS_COOP_FACTION_MILITIA_AGENT!=="1")return null;
 try{return native().briefing(x)}catch{return null}
}
module.exports={createFactionWarAgent,allowedFactionIDs,doAction,briefing};
