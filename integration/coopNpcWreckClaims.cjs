"use strict";
// Durable proof of an authoritative native-NPC kill; never an item claim,
// loot right, credit, or money grant. A missing native attacker fails closed.
const fs=require("node:fs"),path=require("node:path");
// Stage 2 of the JSON->gameStore migration. A claim is the only proof that a
// wreck may be looted, so it is written with an explicit synchronous SQLite
// flush instead of a hand-rolled fsync+rename of the whole journal; the legacy
// file is read once per install and then only used if the store refuses a write.
const TABLE="coopWreckClaims";
const id=x=>Number.isSafeInteger(Number(x))&&Number(x)>0?Number(x):null;
const named=x=>typeof x==="string"&&/^coop-pilot-[0-9]{3,}$/.test(x);
const clone=x=>JSON.parse(JSON.stringify(x));
function createWreckClaims({file,clock=()=>Date.now(),maxClaims=500,ttlMs=3600000,gameStore=null}={}){
 if(typeof file!=="string"||!path.isAbsolute(file)||typeof clock!=="function"||
    !Number.isSafeInteger(maxClaims)||maxClaims<1||maxClaims>5000||
    !Number.isSafeInteger(ttlMs)||ttlMs<60000||ttlMs>86400000)
  throw Error("INVALID_NATIVE_WRECK_CLAIMS_OPTIONS");
 let state={version:1,claims:{},closed:{}};
 const validate=(key,v)=>id(key)===id(v?.wreckID)&&id(v?.systemID)&&
  id(v?.sourceEntityID)&&id(v?.attackerEntityID)&&named(v?.attackerPilotID)&&
  Number.isSafeInteger(v?.at)&&v.at>=0&&Number.isSafeInteger(v?.expiresAt)&&
  v.expiresAt>v.at;
 // A closed claim is an explicit, durable statement that this wreck can never
 // be looted again (or that its loot was already moved). It carries the reason
 // and, when the store could still measure them, the lost stacks.
 const validateClosed=(key,v)=>id(key)===id(v?.wreckID)&&id(v?.systemID)&&
  id(v?.sourceEntityID)&&id(v?.attackerEntityID)&&named(v?.attackerPilotID)&&
  Number.isSafeInteger(v?.killedAt)&&Number.isSafeInteger(v?.closedAt)&&
  typeof v?.reason==="string"&&/^[A-Z][A-Z0-9_:.-]{2,90}$/.test(v.reason)&&
  (v.loot===null||(v.loot&&Number.isSafeInteger(v.loot.stacks)&&v.loot.stacks>=0&&
   Number.isSafeInteger(v.loot.quantity)&&v.loot.quantity>=0&&
   Array.isArray(v.loot.typeIDs)&&v.loot.typeIDs.length<=64));
 function normalizeJournal(v){
  if(v?.version!==1||!v.claims||Array.isArray(v.claims)||typeof v.claims!=="object"||
    Object.keys(v.claims).length>maxClaims||
    Object.entries(v.claims).some(([key,x])=>!validate(key,x)))
   throw Error("INVALID_NATIVE_WRECK_CLAIMS_JOURNAL");
  const closed=v.closed===undefined?{}:v.closed;
  if(!closed||Array.isArray(closed)||typeof closed!=="object"||
    Object.keys(closed).length>maxClaims||
    Object.entries(closed).some(([key,x])=>!validateClosed(key,x)))
   throw Error("INVALID_NATIVE_WRECK_CLAIMS_JOURNAL");
  return {...v,closed};
 }
 // A claim is the only proof that a wreck may be looted, so the write must be on
 // disk before the caller continues. A synchronous WAL commit gives that without
 // a whole-file rewrite and without the directory-entry weakness of rename.
 function persistStore(next){
  if(!gameStore||typeof gameStore.flushTableSync!=="function")return false;
  const written=gameStore.write(TABLE,"/",next,{force:true});
  if(!written||written.success===false)return false;
  const flushed=gameStore.flushTableSync(TABLE);
  return !!flushed&&flushed.success!==false;
 }
 function writeFileJournal(next){
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const tmp=file+".tmp-"+process.pid;
  const fd=fs.openSync(tmp,"wx",0o600);
  try{fs.writeFileSync(fd,JSON.stringify(next));fs.fsyncSync(fd);}
  finally{fs.closeSync(fd);}
  try{fs.renameSync(tmp,file);}
  catch(e){try{fs.unlinkSync(tmp);}catch(_){}throw e;}
 }
 function persist(next){
  if(!persistStore(next))writeFileJournal(next);
  state=next;
 }
 function readStoreJournal(){
  if(!gameStore)return null;
  const result=gameStore.read(TABLE,"/");
  if(!result||result.success!==true)return null;
  const data=result.data;
  if(!data||typeof data!=="object"||Array.isArray(data)||
    Object.keys(data).length===0)return null;
  return data;
 }
 const stored=readStoreJournal();
 // A damaged stored journal is fatal - it is never silently replaced by the file.
 if(stored)state=normalizeJournal(stored);
 else{
  let legacy=null;
  try{legacy=JSON.parse(fs.readFileSync(file,"utf8"));}
  catch(e){if(e.code!=="ENOENT")throw e;}
  if(legacy){state=normalizeJournal(legacy);persist(state);}
 }
 function record({proof,wreck}={}){
  const now=clock(),key=String(proof?.wreckID);
  if(proof?.status!=="NATIVE_DESTRUCTION_ATTACKER_PROVIDED"||
    !id(proof?.systemID)||!id(proof?.wreckID)||!id(proof?.victimEntityID)||
    !id(proof?.attackerEntityID)||!named(proof?.attackerPilotID)||
    !wreck||Number(wreck.wreckID)!==Number(proof.wreckID)||
    Number(wreck.systemID)!==Number(proof.systemID)||
    Number(wreck.sourceEntityID)!==Number(proof.victimEntityID)||
    Number(wreck.launcherID)!==Number(proof.victimEntityID)||
    !Number.isSafeInteger(now)||now<0)
   return {status:"NO_NATIVE_KILL_PROOF"};
  const old=state.claims[key];
  if(old)return old.attackerPilotID===proof.attackerPilotID&&
    old.attackerEntityID===proof.attackerEntityID?
    {status:"ALREADY_RECORDED"}:{status:"CLAIM_CONFLICT_REQUIRES_REPAIR"};
  const claims={};
  for(const [k,x] of Object.entries(state.claims))
   if(x.expiresAt>=now)claims[k]=x;
  if(Object.keys(claims).length>=maxClaims)
   return {status:"NATIVE_WRECK_CLAIMS_CAP"};
  claims[key]={wreckID:Number(proof.wreckID),systemID:Number(proof.systemID),
   sourceEntityID:Number(proof.victimEntityID),
   attackerEntityID:Number(proof.attackerEntityID),
   attackerPilotID:proof.attackerPilotID,at:now,expiresAt:now+ttlMs};
  persist({version:1,claims,closed:state.closed});
  return {status:"KILL_PROOF_RECORDED"};
 }
 // Closing is the only honest end for a claim whose physical wreck can never be
 // recovered again: the loot stays where the store left it, and this record
 // says exactly why it will never be picked up. It never grants anything.
 function close({wreckID,reason,loot=null}={}){
  const now=clock(),key=String(id(wreckID)||"");
  if(!id(wreckID)||!Number.isSafeInteger(now)||typeof reason!=="string"||
    !/^[A-Z][A-Z0-9_:.-]{2,90}$/.test(reason))
   return {status:"INVALID_CLAIM_CLOSE"};
  if(state.closed[key])return {status:"ALREADY_CLOSED",record:clone(state.closed[key])};
  const claim=state.claims[key];
  if(!claim)return {status:"NO_CLAIM"};
  let measured=null;
  if(loot&&typeof loot==="object"){
   const stacks=Number(loot.stacks),quantity=Number(loot.quantity);
   const typeIDs=[...new Set((Array.isArray(loot.typeIDs)?loot.typeIDs:[])
    .map(Number).filter(x=>Number.isSafeInteger(x)&&x>0))].slice(0,64);
   if(!Number.isSafeInteger(stacks)||stacks<0||!Number.isSafeInteger(quantity)||
    quantity<0)return {status:"INVALID_CLAIM_CLOSE"};
   measured={stacks,quantity,typeIDs};
  }
  const closed={wreckID:Number(claim.wreckID),systemID:Number(claim.systemID),
   sourceEntityID:Number(claim.sourceEntityID),
   attackerEntityID:Number(claim.attackerEntityID),
   attackerPilotID:claim.attackerPilotID,killedAt:Number(claim.at),
   closedAt:now,reason,loot:measured};
  const claims={...state.claims};
  delete claims[key];
  const merged={...state.closed,[key]:closed};
  const kept={};
  for(const row of Object.values(merged).sort((a,b)=>a.closedAt-b.closedAt)
   .slice(-maxClaims))kept[String(row.wreckID)]=row;
  persist({version:1,claims,closed:kept});
  return {status:"CLAIM_CLOSED",record:clone(closed)};
 }
 function active(systemID){
  const now=clock(),system=id(systemID);
  if(!system||!Number.isSafeInteger(now))return [];
  return Object.values(state.claims).filter(x=>x.systemID===system&&
   now>=x.at&&now<=x.expiresAt).map(clone).sort((a,b)=>a.wreckID-b.wreckID);
 }
 function closed(systemID){
  const system=id(systemID);
  const rows=Object.values(state.closed).map(clone);
  return (system?rows.filter(x=>x.systemID===system):rows)
   .sort((a,b)=>a.closedAt-b.closedAt);
 }
 return {record,close,active,closed,snapshot:()=>clone(state)};
}
let singleton=null,currentFile=null;
function getWreckClaims(){
 const file=process.env.EVEJS_COOP_NPC_WRECK_CLAIMS_FILE||
  "/var/lib/evejs/coop-npc-wreck-claims.json";
 if(!singleton||currentFile!==file){
  singleton=createWreckClaims({file,gameStore:require("../gameStore")});
  currentFile=file;
 }
 return singleton;
}
module.exports={TABLE,createWreckClaims,getWreckClaims};
