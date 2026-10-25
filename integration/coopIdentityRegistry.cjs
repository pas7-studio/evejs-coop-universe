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
 // Native transfers depend on this JSON identity surviving a process crash.
 // This is still a separate durable owner from SQLite, hence transfer fences.
 let nonce=0;
 const persist=()=>{
  const dir=path.dirname(file);
  fs.mkdirSync(dir,{recursive:true});
  const tmp=file+".tmp-"+process.pid+"-"+(++nonce);
  let fd=null;
  try{
   fd=fs.openSync(tmp,"wx",0o600);
   fs.writeFileSync(fd,JSON.stringify(state));fs.fsyncSync(fd);
   fs.closeSync(fd);fd=null;
   fs.renameSync(tmp,file);
   const dirfd=fs.openSync(dir,"r");
   try{fs.fsyncSync(dirfd);}finally{fs.closeSync(dirfd);}
  }finally{if(fd!==null)fs.closeSync(fd);}
 };
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
  const e={pilotID:pilot.id,name:String(pilot.name||pilot.id).slice(0,96),faction:String(pilot.faction||"independent").slice(0,48),role:String(pilot.role||"").slice(0,24),durable:pilot.durable===true,systemID:Number(systemID),entityID:Number(entityID),linkedAt:clock()};
  state.links[pilot.id]=e;persist();return {...e};
 }
 // Only update durable identity AFTER the same native ship physically
 // exists in the destination and is absent from its former EveJS scene.
 function relocate(pilotID,fromSystemID,entityID,toSystemID){
  const source=positive(fromSystemID),id=positive(entityID),dest=positive(toSystemID);
  if(!validID(pilotID)||!source||!id||!dest||source===dest)
   return {status:"INVALID"};
  const record=state.links[pilotID];
  if(!record||Number(record.systemID)!==source||Number(record.entityID)!==id)
   return {status:"STALE_SOURCE"};
  if(exists(source,id))return {status:"SOURCE_STILL_PHYSICAL"};
  if(!exists(dest,id))return {status:"DESTINATION_NOT_PHYSICAL"};
  const old={...record};
  state.links[pilotID]={...record,systemID:dest,relocatedAt:clock()};
  try{persist();}
  catch(error){state.links[pilotID]=old;throw error;}
  return {status:"RELOCATED",...state.links[pilotID]};
 }
 function prune(){
  let removed=0;
  for(const [id,e] of Object.entries(state.links)){
   if(!positive(e.systemID)||!positive(e.entityID)||!exists(e.systemID,e.entityID)){delete state.links[id];removed++;}
  }
  if(removed)persist();
  return removed;
 }
 return {get,link,relocate,prune,snapshot:()=>structuredClone(state)};
}
module.exports={createRegistry};
