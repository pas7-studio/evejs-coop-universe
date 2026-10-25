"use strict";
// COOP-049: optional, genuine stock agent dialogue -> existing live NPC job quote.
// Does NOT create mission records, bypass native convoy consent, or grant ISK.
// One request-bound verified corporate agent exposes one native preparing convoy.
const pos=x=>Number.isSafeInteger(x)&&x>0;
const validEvent=x=>typeof x==="string"&&/^convoy-\d+-\d+-\d+$/.test(x);
const quoteOK=(q,e,a,n)=>q?.eventID===e.id&&
 q.systemID===e.systemID&&q.systemID===a.solarSystemID&&
 q.corporationID===a.corporationID&&q.haulerID===e.entityID&&
 q.stationID===e.stationID&&pos(q.amountISK)&&q.amountISK<=1000000000&&
 q.amountISK%2===0&&q.expiresAt>n&&
 typeof q.contractID==="string"&&/^escort-[a-zA-Z0-9-]{1,48}$/.test(q.contractID);
const reply=(s,actions=[])=>({success:true,data:{
 agentSays:[s,null],actions,lastActionInfo:{}}});
const safeText=x=>String(x||"").replace(/[<>\x00-\x1f]/g," ").slice(0,180);
function createNativeJobAgent({listEvents,readEvent,readQuote,readAccepted,
 getAgent,getMission,getSessions,dispatch,clock=()=>Date.now()}={}){
 if([listEvents,readEvent,readQuote,readAccepted,getAgent,getMission,
   getSessions,dispatch,clock].some(f=>typeof f!=="function"))
  throw Error("NATIVE_JOB_AGENT_AUTHORITIES_REQUIRED");
 // A single native agent conversation must not silently switch its chosen job
 // when a new convoy is published in between VIEW and ACCEPT requests.
 const selected=new Map(); // only read-only request state; validated each call
 const cacheKey=(char,agent)=>String(char)+":"+String(agent);
 function validated(session,agentID){
  if(!pos(session?.characterID)||session?.socket?.destroyed===true||!pos(agentID))return null;
  let online,a,mission;
  try{online=getSessions();a=getAgent(agentID);
   mission=getMission(session.characterID,agentID)}
  catch{return null}
  if(!Array.isArray(online)||online.filter(s=>s===session).length!==1||
   online.filter(s=>s?.characterID===session.characterID).length!==1||
   !a||a.agentID!==agentID||!pos(a.solarSystemID)||
   !pos(a.stationID)||!pos(a.corporationID)||a.isInSpace===true||
   mission)return null; // native missions retain priority
  return a;
 }
 function offers(agent){
  const now=clock();if(!Number.isSafeInteger(now)||now<=0)return [];
  let listing;
  try{listing=listEvents({all:true,limit:20})}catch{return []}
  if(listing?.status!=="READY"||!Array.isArray(listing.events)||
   listing.events.length>20)return [];
  const jobs=[];
  for(const event of listing.events){
   if(!validEvent(event?.id)||event?.source!=="NATIVE_VERIFIED"||
    event.type!=="CONVOY"||event.stage!=="PREPARING"||
    event.phase!=="ACTIVE"||event.systemID!==agent.solarSystemID||
    !pos(event.stationID)||!pos(event.entityID)||
    !pos(event.createdAt)||event.createdAt>now||
    !pos(event.expiresAt)||event.expiresAt<=now)continue;
   let verified,priced;try{verified=readEvent(event.id);priced=readQuote(event.id)}
   catch{continue}
   if(verified?.status!=="READY"||verified.event?.id!==event.id||
    verified.event.phase!=="ACTIVE"||
    priced?.status!=="READY"||!quoteOK(priced.quote,event,agent,now))
    continue;
   jobs.push({event,quote:priced.quote});
  }
  jobs.sort((x,y)=>x.event.expiresAt-y.event.expiresAt||
   x.event.id.localeCompare(y.event.id));
  return jobs;
 }
 function jobFor(session,agentID){
  const a=validated(session,agentID);if(!a)return null;
  const jobs=offers(a);if(!jobs.length)return null;
  const key=cacheKey(session.characterID,agentID);
  const previous=selected.get(key);
  // If pinned event is no longer present, do NOT silently accept a different
  // source ID. Explicit fresh dialogue request (null action) may select again.
  if(previous){
   const found=jobs.find(x=>x.event.id===previous);
   return found?{...found,agent:a}:null;
  }
  return {...jobs[0],agent:a};
 }
 function render(j,notes=""){
  const total=j.quote.amountISK.toLocaleString("en-US");
  return "[Corporate Logistics] "+safeText(j.agent.ownerName||"NPC agent")+
   " has a real NPC hauler escort job in system "+j.event.systemID+
   " to station "+j.event.stationID+".\n"+
   safeText(j.event.summary)+"\n"+
   "Offer: "+total+" ISK TOTAL, "+(j.quote.amountISK/2).toLocaleString("en-US")+
   " ISK each for TWO real fleet pilots. This is a QUOTE, NOT RESERVED funds."+
   (notes?"\n"+safeText(notes):"");
 }
 function intro(session,agentID){
  const a=validated(session,agentID);
  if(!a)return null;
  const key=cacheKey(session.characterID,agentID);
  selected.delete(key);
  const jobs=offers(a);if(!jobs.length)return null;
  const j={...jobs[0],agent:a};selected.set(key,j.event.id);
  return j;
 }
 function readSelected(session,agentID){
  return jobFor(session,agentID);
 }
 function doAction({session,agentID,actionID}={}){
  if(process.env.EVEJS_COOP_NATIVE_JOB_AGENT!=="1")return null;
  const j=actionID==null?intro(session,agentID):readSelected(session,agentID);
  if(!j)return null; // stock agent mission unaffected
  const id=j.event.id;
  if(actionID===null||actionID===undefined||Number(actionID)===1||Number(actionID)===2){
   let receipt;try{receipt=readAccepted(id)}catch{}
   const signed=receipt?.status==="DURABLE_TWO_PILOT_PAID_ACCEPTANCE"&&
    receipt.contractID===j.quote.contractID&&receipt.amountISK===j.quote.amountISK&&
    Array.isArray(receipt.characters)&&receipt.characters.includes(session.characterID);
   return reply(render(j,signed?
    "Both pilots signed this offer. NPC funds are NOT reserved until native pre-warp escrow.":"Use the native Accept button to opt in. Both pilots must separately consent in the same real fleet."),
    signed?[[1,1]]:[[3,3],[1,1]]);
  }
  if(Number(actionID)!==3&&Number(actionID)!==5){
   return reply(render(j,"Only View and Accept are supported for this corporate job."),[[1,1]]);
  }
  // Native client Accept = this character's explicit intention only.
  // Existing /events internals are the sole authority for consent/finance.
  let interested,volunteer,accept;
  try{
   interested=dispatch({session,command:"events",argumentText:"interest "+id});
   if(!["INTEREST_RECORDED","ALREADY_INTERESTED_OR_WRITE_UNCERTAIN"].includes(interested?.status)){
    return reply(render(j,"Cannot register your interest: "+(interested?.status||"unavailable")),[[3,3],[1,1]]);
   }
   volunteer=dispatch({session,command:"events",argumentText:"volunteer "+id});
   if(volunteer?.status==="WAITING_FOR_OTHER_VOLUNTEER")
    return reply(render(j,"You opted in. Ask your fleetmate to press Accept in their agent window, then confirm again here."),[[3,3],[1,1]]);
   if(!["VERIFIED_NATIVE_DUO_VOLUNTEER","DUO_ALREADY_CONFIRMED"].includes(volunteer?.status))
    return reply(render(j,"Native fleet/ship consent not yet verified: "+(volunteer?.status||"unavailable")+
      ". Both ships must be together in space."),[[3,3],[1,1]]);
   accept=dispatch({session,command:"events",argumentText:"accept "+id});
  }catch{
   return reply(render(j,"Native job authority unavailable. No ISK moved."),[[1,1]]);
  }
  const status=String(accept?.status||"UNAVAILABLE");
  if(status==="WAITING_FOR_OTHER_PAID_ACCEPTOR")
   return reply(render(j,"Your priced signature was saved. Waiting for the OTHER pilot to press Accept."),[[3,3],[1,1]]);
  if(status==="DURABLE_TWO_PILOT_PAID_ACCEPTANCE")
   return reply(render(j,"Both pilots signed. Payment is still contingent on server-verified native escrow, the real convoy and complete cargo delivery."),[[1,1]]);
  return reply(render(j,"Not accepted: "+status+". No payment was created."),[[3,3],[1,1]]);
 }
 function briefing({session,agentID}={}){
  if(process.env.EVEJS_COOP_NATIVE_JOB_AGENT!=="1")return null;
  const j=readSelected(session,agentID);if(!j)return null;
  return {"ContentID":null,"Mission Title ID":"NPC Convoy Escort",
   "Mission Briefing ID":render(j),
   "Mission Keywords":{},"Mission Image":null,"Decline Time":null,
   "Expiration Time":null,"AcceptTimestamp":null,"Mission ID":null};
 }
 return Object.freeze({doAction,briefing,offers});
}
// Native pinned GameStore and agentMgr service install only through L1 hook;
// no top-level side effects, no synthetic mission/wallet/route.
let singleton;
function native(){
 if(!singleton){
  const board=require("./coopWorldOpportunityBoard");
  const priced=require("./coopEscortPricedOffers");
  const agentAuthority=require("../services/agent/agentAuthority");
  const missions=require("../services/agent/agentMissionRuntime");
  const registry=require("../services/chat/sessionRegistry");
  singleton=createNativeJobAgent({listEvents:board.listNativeEvents,
   readEvent:board.readNativeEvent,readQuote:priced.readVisibleQuote,
   readAccepted:priced.readNativeAccepted,getAgent:agentAuthority.getAgentByID,
   getMission:missions.getMissionRecord,getSessions:registry.getSessions,
   dispatch:board.handleChat});
 }
 return singleton;
}
function doAction(x){
 if(process.env.EVEJS_COOP_NATIVE_JOB_AGENT!=="1")return null;
 try{return native().doAction(x)}catch{return reply("Native corporate job currently unavailable; no funds moved.")}
}
function briefing(x){
 if(process.env.EVEJS_COOP_NATIVE_JOB_AGENT!=="1")return null;
 try{return native().briefing(x)}catch{return null}
}
module.exports={createNativeJobAgent,doAction,briefing};
