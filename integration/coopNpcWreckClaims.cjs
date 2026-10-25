"use strict";
// Durable proof of an authoritative native-NPC kill; never an item claim,
// loot right, credit, or money grant. A missing native attacker fails closed.
const fs=require("node:fs"),path=require("node:path");
const id=x=>Number.isSafeInteger(Number(x))&&Number(x)>0?Number(x):null;
const named=x=>typeof x==="string"&&/^coop-pilot-[0-9]{3,}$/.test(x);
const clone=x=>JSON.parse(JSON.stringify(x));
function createWreckClaims({file,clock=()=>Date.now(),maxClaims=500,ttlMs=3600000}={}){
 if(typeof file!=="string"||!path.isAbsolute(file)||typeof clock!=="function"||
    !Number.isSafeInteger(maxClaims)||maxClaims<1||maxClaims>5000||
    !Number.isSafeInteger(ttlMs)||ttlMs<60000||ttlMs>86400000)
  throw Error("INVALID_NATIVE_WRECK_CLAIMS_OPTIONS");
 let state={version:1,claims:{}};
 const validate=(key,v)=>id(key)===id(v?.wreckID)&&id(v?.systemID)&&
  id(v?.sourceEntityID)&&id(v?.attackerEntityID)&&named(v?.attackerPilotID)&&
  Number.isSafeInteger(v?.at)&&v.at>=0&&Number.isSafeInteger(v?.expiresAt)&&
  v.expiresAt>v.at;
 try{
  const v=JSON.parse(fs.readFileSync(file,"utf8"));
  if(v?.version!==1||!v.claims||Array.isArray(v.claims)||typeof v.claims!=="object"||
    Object.keys(v.claims).length>maxClaims||
    Object.entries(v.claims).some(([key,x])=>!validate(key,x)))
   throw Error("INVALID_NATIVE_WRECK_CLAIMS_JOURNAL");
  state=v;
 }catch(e){if(e.code!=="ENOENT")throw e;}
 function persist(next){
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const tmp=file+".tmp-"+process.pid;
  const fd=fs.openSync(tmp,"wx",0o600);
  try{fs.writeFileSync(fd,JSON.stringify(next));fs.fsyncSync(fd);}
  finally{fs.closeSync(fd);}
  try{fs.renameSync(tmp,file);}
  catch(e){try{fs.unlinkSync(tmp);}catch(_){}throw e;}
  state=next;
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
  persist({version:1,claims});
  return {status:"KILL_PROOF_RECORDED"};
 }
 function active(systemID){
  const now=clock(),system=id(systemID);
  if(!system||!Number.isSafeInteger(now))return [];
  return Object.values(state.claims).filter(x=>x.systemID===system&&
   now>=x.at&&now<=x.expiresAt).map(clone).sort((a,b)=>a.wreckID-b.wreckID);
 }
 return {record,active,snapshot:()=>clone(state)};
}
let singleton=null,currentFile=null;
function getWreckClaims(){
 const file=process.env.EVEJS_COOP_NPC_WRECK_CLAIMS_FILE||
  "/var/lib/evejs/coop-npc-wreck-claims.json";
 if(!singleton||currentFile!==file){singleton=createWreckClaims({file});currentFile=file;}
 return singleton;
}
module.exports={createWreckClaims,getWreckClaims};
