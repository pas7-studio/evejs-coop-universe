"use strict";
// Persistent, bounded encounter director for the pinned EveJS server.
// Authoritative NPC entities are created only via native npcRuntime;
// saved records are plans, NOT fictitious ships/players in a hidden scene.
const fs=require("node:fs");
const path=require("node:path");
function int(value){const n=Number(value);return Number.isSafeInteger(n)&&n>0?n:null;}
function normalize(raw){
 const systems=raw&&typeof raw==="object"&&raw.systems&&typeof raw.systems==="object"?raw.systems:{};
 return {version:1,systems:Object.fromEntries(Object.entries(systems)
   .filter(([id,v])=>int(id)&&v&&typeof v==="object")
   .map(([id,v])=>[id,{nextAt:Math.max(0,Number(v.nextAt)||0),visits:Math.max(0,Math.floor(Number(v.visits)||0)),spawns:Math.max(0,Math.floor(Number(v.spawns)||0))}]))};
}
function load(filename){
 try{return normalize(JSON.parse(fs.readFileSync(filename,"utf8")));}
 catch(error){if(error.code==="ENOENT")return normalize({});throw error;}
}
function save(filename,state){
 fs.mkdirSync(path.dirname(filename),{recursive:true});
 const tmp=filename+".tmp-"+process.pid;
 fs.writeFileSync(tmp,JSON.stringify(state,null,2));
 fs.renameSync(tmp,filename);
}
function createDirector({filename,spawn,clock=()=>Date.now(),cooldownMs=3600000,allowedSystems=[30000142],maxSpawns=24}){
 if(typeof spawn!=="function")throw Error("native spawn callback required");
 if(!filename||typeof filename!=="string")throw Error("state path required");
 if(!Number.isInteger(cooldownMs)||cooldownMs<60000)throw Error("minimum cooldown 60 seconds");
 if(!Number.isInteger(maxSpawns)||maxSpawns<1||maxSpawns>1000)throw Error("invalid spawn cap");
 const allow=new Set(allowedSystems.map(int).filter(Boolean));
 let state=load(filename);
 function onPilotArrived(systemID){
  const id=int(systemID),now=clock();
  if(!id||!allow.has(id))return {status:"SKIP_SYSTEM"};
  const record=state.systems[id]||{nextAt:0,visits:0,spawns:0};
  if(now<record.nextAt)return {status:"COOLDOWN",nextAt:record.nextAt};
  if(record.spawns>=maxSpawns)return {status:"SPAWN_CAP"};
  // Reserve the next window *before* spawn to suppress loops on failure.
  record.visits++;record.nextAt=now+cooldownMs;
  state.systems[id]=record;save(filename,state);
  try {
   const result=spawn(id);
   if(result?.success!==true)return {status:"SPAWN_FAILED",error:String(result?.errorMsg||"unknown")};
   record.spawns++;save(filename,state);
   return {status:"SPAWNED",systemID:id,spawns:record.spawns,result};
  }catch(error){return {status:"SPAWN_FAILED",error:error.message};}
 }
 return {onPilotArrived,snapshot:()=>structuredClone(state)};
}
module.exports={createDirector,normalize,load,save};
