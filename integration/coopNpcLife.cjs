"use strict";
// Persistent capsule/clone recovery for autonomous NPCs after real ship losses.
// Ship destruction comes ONLY from the authoritative native EveJS wreck hook.
//
// Stage 3 of the JSON->gameStore migration: the life ledger lives in its own
// SQLite table (one row per dataset, keyed by pilotID inside the document) so a
// loss is committed atomically instead of rewriting coop-npc-life.json. The file
// is read once per install and then only used if the store refuses a write.
const fs=require("node:fs"),path=require("node:path");
const TABLE="coopNpcLife";
const valid=id=>typeof id==="string"&&/^coop-pilot-[0-9]{3,}$/.test(id);
const positive=n=>Number.isSafeInteger(Number(n))&&Number(n)>0;
function createLife({file,clock=()=>Date.now(),recoveryMs=1800000,gameStore=null}={}){
 if(!file||!Number.isSafeInteger(recoveryMs)||recoveryMs<60000)throw Error("invalid NPC life settings");
 let state={version:1,pilots:{},wrecks:{}};
 function parseState(value){
  if(value?.version!==1||!value.pilots||!value.wrecks)throw Error("invalid NPC life state");
  return value;
 }
 function readStore(){
  if(!gameStore)return null;
  const result=gameStore.read(TABLE,"/");
  if(!result||result.success!==true)return null;
  const data=result.data;
  if(!data||typeof data!=="object"||Array.isArray(data)||Object.keys(data).length===0)return null;
  return parseState(data);
 }
 function readFile(){
  try{return parseState(JSON.parse(fs.readFileSync(file,"utf8")));}
  catch(e){if(e.code==="ENOENT")return null;throw e;}
 }
 function persistFile(){
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const tmp=file+".tmp-"+process.pid;
  fs.writeFileSync(tmp,JSON.stringify(state));fs.renameSync(tmp,file);
 }
 const persist=()=>{
  if(gameStore){
   const written=gameStore.write(TABLE,"/",state,{force:true});
   if(written&&written.success!==false){
    const flushed=typeof gameStore.flushTableSync==="function"?
     gameStore.flushTableSync(TABLE):{success:true};
    if(flushed&&flushed.success!==false)return;
   }
  }
  persistFile();
 };
 const stored=readStore();
 if(stored)state=stored;
 else{
  const legacy=readFile();
  if(legacy){state=legacy;persist();}
 }
 function markLoss({pilotID,systemID,shipID,wreckID}){
  if(!valid(pilotID)||![systemID,shipID,wreckID].every(positive))return {status:"INVALID"};
  const key=String(wreckID);
  if(state.wrecks[key])return {status:"DUPLICATE",...state.wrecks[key]};
  const now=clock();
  const prior=state.pilots[pilotID]||{lossCount:0};
  const entry={pilotID,systemID:Number(systemID),shipID:Number(shipID),wreckID:Number(wreckID),lostAt:now,readyAt:now+recoveryMs};
  state.wrecks[key]=entry;
  state.pilots[pilotID]={status:"RECOVERING",lossCount:(prior.lossCount||0)+1,readyAt:entry.readyAt,lastLoss:entry};
  persist();
  return {status:"RECOVERING",...entry};
 }
 function canFly(pilotID){
  const p=state.pilots[pilotID];
  return valid(pilotID)&&(!p||p.status!=="RECOVERING"||clock()>=Number(p.readyAt));
 }
 function recover(pilotID){
  if(!valid(pilotID))return {status:"INVALID"};
  const p=state.pilots[pilotID];
  if(!p||p.status!=="RECOVERING")return {status:"ACTIVE"};
  if(!canFly(pilotID))return {status:"RECOVERING",readyAt:p.readyAt};
  p.status="ACTIVE";p.recoveredAt=clock();persist();return {status:"ACTIVE",lossCount:p.lossCount};
 }
 return {markLoss,canFly,recover,snapshot:()=>structuredClone(state)};
}
module.exports={TABLE,createLife};
