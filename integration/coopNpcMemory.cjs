"use strict";
// Durable individual NPC memories. Native EveJS standings remain authoritative;
// a remembered incident is never itself a standing transaction or combat hit.
const fs=require("node:fs"),path=require("node:path");
const DELTAS=Object.freeze({assault:-25,defense:18,pirateKill:-30});
const validPilot=x=>typeof x==="string"&&/^coop-pilot-[0-9]{3,}$/.test(x);
const validID=x=>Number.isSafeInteger(Number(x))&&Number(x)>0;
const eventPattern=/^[A-Za-z0-9._:-]{1,160}$/;
const bounded=x=>Math.max(-100,Math.min(100,x));
function createMemory({file,clock=()=>Date.now(),maxEvents=50000}={}){
 if(typeof file!=="string"||!file||typeof clock!=="function"||
  !Number.isSafeInteger(maxEvents)||maxEvents<1)throw Error("invalid NPC memory options");
 let state={version:1,events:{},relations:{}};
 try{
  const saved=JSON.parse(fs.readFileSync(file,"utf8"));
  if(saved?.version!==1||!saved.events||!saved.relations||
     Array.isArray(saved.events)||Array.isArray(saved.relations))throw Error("invalid saved NPC memory");
  state=saved;
 }catch(error){if(error.code!=="ENOENT")throw error;}
 const persist=()=>{
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const tmp=file+".tmp-"+process.pid;
  fs.writeFileSync(tmp,JSON.stringify(state));fs.renameSync(tmp,file);
 };
 function remember({eventID,pilotID,characterID,kind,systemID,occurredAt=clock()}={}){
  if(!eventPattern.test(String(eventID||""))||!validPilot(pilotID)||!validID(characterID)||
    !Object.hasOwn(DELTAS,kind)||!validID(systemID)||
    !Number.isSafeInteger(occurredAt)||occurredAt<0)return {status:"INVALID"};
  const id=pilotID+"|"+eventID;
  if(Object.hasOwn(state.events,id))return {status:"DUPLICATE"};
  if(Object.keys(state.events).length>=maxEvents)return {status:"CAP_REACHED"};
  const relationKey=pilotID+":"+Number(characterID);
  const prior=state.relations[relationKey]||{pilotID,characterID:Number(characterID),score:0,encounters:0,incidents:[]};
  const row={eventID,pilotID,characterID:Number(characterID),kind,systemID:Number(systemID),
   occurredAt,delta:DELTAS[kind]};
  const next={...prior,score:bounded(prior.score+row.delta),encounters:prior.encounters+1,
   lastKind:kind,lastEventAt:occurredAt,incidents:[...prior.incidents,row].slice(-6)};
  state.events[id]=true;
  state.relations[relationKey]=next;
  try{persist();}catch(error){
   delete state.events[id];
   if(prior.encounters)state.relations[relationKey]=prior;
   else delete state.relations[relationKey];
   throw error;
  }
  return {status:"RECORDED",relation:structuredClone(next)};
 }
 function recall({pilotID,characterID}={}){
  if(!validPilot(pilotID)||!validID(characterID))return {status:"INVALID"};
  const relation=state.relations[pilotID+":"+Number(characterID)];
  if(!relation)return {status:"UNKNOWN"};
  const attitude=relation.score<=-30?"HOSTILE":relation.score<=-10?"WARY":
    relation.score>=20?"ALLY":relation.score>=10?"FRIENDLY":"NEUTRAL";
  return {status:"KNOWN",attitude,...structuredClone(relation)};
 }
 return {remember,recall,snapshot:()=>structuredClone(state)};
}
let singleton=null;
function getNativeMemory(){
 if(!singleton)singleton=createMemory({file:process.env.EVEJS_COOP_NPC_MEMORY_FILE||
  "/var/lib/evejs/coop-npc-memory.json"});
 return singleton;
}
// Only trusted native combat evidence calls this. Entity IDs must resolve to
// real saved named-NPC links; a fabricated player/NPC cannot accrue history.
function noteVerified({eventID,characterID,systemID,kind,pilotIDs=[],entityIDs=[]}={}){
 if(process.env.EVEJS_COOP_NPC_MEMORY!=="1")return {status:"DISABLED"};
 try{
  const regPath=process.env.EVEJS_COOP_IDENTITY_FILE||"/var/lib/evejs/coop-npc-links.json";
  let saved;
  try{saved=JSON.parse(fs.readFileSync(regPath,"utf8"));}
  catch(error){if(error.code==="ENOENT")return {status:"NO_NAMED_NPC"};throw error;}
  const allowed=new Set(Object.values(saved?.links||{}).filter(link=>
    Number(link?.systemID)===Number(systemID)&&validPilot(link?.pilotID)));
  const match=new Set();
  for(const link of allowed){
   if(pilotIDs.includes(link.pilotID)||entityIDs.some(id=>Number(id)===Number(link.entityID)))
    match.add(link.pilotID);
  }
  if(!match.size)return {status:"NO_NAMED_NPC"};
  const results=[...match].sort().map(pilotID=>({pilotID,...getNativeMemory().remember({
   eventID,characterID,pilotID,systemID,kind
  })}));
  return {status:"PROCESSED",results};
 }catch(error){console.warn("[CoopNpcMemory] verified event",error.message);return {status:"ERROR"};}
}
module.exports={createMemory,getNativeMemory,noteVerified};
