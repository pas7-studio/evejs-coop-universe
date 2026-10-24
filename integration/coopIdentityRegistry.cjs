"use strict";
// Durable virtual-to-physical NPC identity registry.
// The game engine is authoritative: records NEVER restore ships directly.
const fs=require("node:fs"),path=require("node:path");
function validID(x){return typeof x==="string"&&/^coop-pilot-[0-9]{3,}$/.test(x);}
function positive(x){const v=Number(x);return Number.isSafeInteger(v)&&v>0?v:null;}
function createRegistry({file,exists,clock=()=>Date.now()}){
 if(!file||typeof exists!=="function")throw Error("file and exists required");
 let state={version:1,links:{}};
 try{const raw=JSON.parse(fs.readFileSync(file,"utf8"));if(raw?.version!==1||!raw.links||typeof raw.links!=="object")throw Error("invalid registry");state=raw;}
 catch(err){if(err.code!=="ENOENT")throw err;}
 const persist=()=>{fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=file+".tmp-"+process.pid;fs.writeFileSync(tmp,JSON.stringify(state));fs.renameSync(tmp,file);};
 function get(id){
  const e=state.links[id];
  if(!e)return null;
  if(!positive(e.entityID)||!positive(e.systemID)||!exists(e.systemID,e.entityID))return null;
  return {...e};
 }
 function link(pilot,systemID,entityID){
  if(!validID(pilot?.id)||!positive(systemID)||!positive(entityID))throw Error("invalid materialization link");
  const existing=get(pilot.id);
  if(existing){
   // Older worlds were created before occupation tracking existed.
   // Migrate metadata without replacing a still-living physical ship.
   if(!existing.role&&pilot.role){
    state.links[pilot.id].role=String(pilot.role).slice(0,24);
    persist();return {...state.links[pilot.id]};
   }
   return existing;
  }
  const e={pilotID:pilot.id,name:String(pilot.name||pilot.id).slice(0,96),faction:String(pilot.faction||"independent").slice(0,48),role:String(pilot.role||"").slice(0,24),systemID:Number(systemID),entityID:Number(entityID),linkedAt:clock()};
  state.links[pilot.id]=e;persist();return {...e};
 }
 function prune(){
  let removed=0;
  for(const [id,e] of Object.entries(state.links)){
   if(!positive(e.systemID)||!positive(e.entityID)||!exists(e.systemID,e.entityID)){delete state.links[id];removed++;}
  }
  if(removed)persist();
  return removed;
 }
 return {get,link,prune,snapshot:()=>structuredClone(state)};
}
module.exports={createRegistry};
