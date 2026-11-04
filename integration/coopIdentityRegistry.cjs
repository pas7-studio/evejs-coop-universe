"use strict";
// Durable virtual-to-physical NPC identity registry.
// The game engine is authoritative: records NEVER restore ships directly.
//
// Stage 4 of the JSON->gameStore migration. The registry used to be a JSON file
// that several owners (the world, the market trader, the co-op loop) read and
// REWROTE, so it needed an mtime refresh and an on-disk merge to stop one owner
// dropping another owner's link (measured 2026-10-30: a hull linked by the loop
// was gone after a write from the market side, and every crossing then failed
// SOURCE_IDENTITY_MISMATCH). With a shared table each owner reads and writes the
// same row, so there is nothing to merge and nothing to go stale; the file only
// remains as a migration source and as the fallback for callers that pass none.
const fs=require("node:fs"),path=require("node:path");
const TABLE="coopNpcLinks";
function validID(x){return typeof x==="string"&&/^coop-pilot-[0-9]{3,}$/.test(x);}
function positive(x){const v=Number(x);return Number.isSafeInteger(v)&&v>0?v:null;}
function createRegistry({file,exists,clock=()=>Date.now(),gameStore=null}){
 if(!file||typeof exists!=="function")throw Error("file and exists required");
 // When the experimental native military transfer is enabled an orphan
 // identity-write temp file is a crash signal, not permission to respawn. Only
 // a pre-migration install can still have one: the store path never writes one.
 if(process.env.EVEJS_COOP_FACTION_WAR_NATIVE_TRANSFER==="1"){
  const dir=path.dirname(file),base=path.basename(file)+".tmp-";
  try{
   if(fs.readdirSync(dir).some(name=>name.startsWith(base)))
    throw Error("WAR_IDENTITY_UNRESOLVED_TEMP_WRITE");
  }catch(e){if(e.code!=="ENOENT")throw e;}
 }
 if(gameStore)return createStoreRegistry({gameStore,exists,clock,file});
 return createFileRegistry({file,exists,clock});
}
// One row per pilot in coopNpcLinks. Every mutation is flushed synchronously:
// native transfers depend on the identity surviving a process crash, and this is
// the same durability the file path got from fsync+rename (plus the directory
// entry, which rename alone does not make durable).
function createStoreRegistry({gameStore,exists,clock,file}){
 if(typeof gameStore.read!=="function"||typeof gameStore.write!=="function"||
  typeof gameStore.remove!=="function")throw Error("IDENTITY_GAME_STORE_REQUIRED");
 let nonce=0;
 function rows(){
  const result=gameStore.read(TABLE,"/");
  if(!result||result.success!==true)return {};
  const data=result.data;
  return data&&typeof data==="object"&&!Array.isArray(data)?data:{};
 }
 function flush(){
  if(typeof gameStore.flushTableSync!=="function")return;
  const flushed=gameStore.flushTableSync(TABLE);
  if(!flushed||flushed.success===false)throw Error("IDENTITY_LINK_FLUSH_FAILED");
 }
 function writeRow(pilotID,record){
  const written=gameStore.write(TABLE,"/"+pilotID,record,{force:true});
  if(!written||written.success===false)throw Error("IDENTITY_LINK_WRITE_FAILED");
  flush();
  project();
 }
 function removeRow(pilotID){
  const removed=gameStore.remove(TABLE,"/"+pilotID);
  if(!removed||removed.success===false)throw Error("IDENTITY_LINK_WRITE_FAILED");
  flush();
  project();
 }
 // Legacy readers (admin bridge, NPC memory, destruction attribution, the co-op
 // loop) still parse coop-npc-links.json. The store is the authority; this keeps
 // that file as a PROJECTION of it so those readers see every link. It is
 // best-effort on purpose: a projection may never fail a real identity write.
 function project(){
  const dir=path.dirname(file);
  const tmp=file+".proj-"+process.pid+"-"+(++nonce);
  let fd=null;
  try{
   fs.mkdirSync(dir,{recursive:true});
   fd=fs.openSync(tmp,"wx",0o600);
   fs.writeFileSync(fd,JSON.stringify({version:1,links:rows()}));
   fs.closeSync(fd);fd=null;
   fs.renameSync(tmp,file);
  }catch(_error){
   try{if(fd!==null)fs.closeSync(fd);}catch(_){}
   try{fs.unlinkSync(tmp);}catch(_){}
  }
 }
 // Read-through of an install that still keeps coop-npc-links.json.
 (function importLegacy(){
  if(Object.keys(rows()).length>0)return;
  let legacy=null;
  try{legacy=JSON.parse(fs.readFileSync(file,"utf8"));}
  catch(e){if(e.code!=="ENOENT")throw e;}
  if(!legacy||legacy.version!==1||!legacy.links||typeof legacy.links!=="object")return;
  for(const [pilotID,record] of Object.entries(legacy.links))
   if(validID(pilotID)&&record&&positive(record.entityID)&&positive(record.systemID))
    writeRow(pilotID,record);
 })();
 function get(id){
  const result=gameStore.read(TABLE,"/"+String(id));
  if(!result||result.success!==true||!result.data)return null;
  const e=result.data;
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
    const next={...existing,role:String(pilot.role).slice(0,24)};
    writeRow(pilot.id,next);
    return {...next};
   }
   return existing;
  }
  const e={pilotID:pilot.id,name:String(pilot.name||pilot.id).slice(0,96),faction:String(pilot.faction||"independent").slice(0,48),role:String(pilot.role||"").slice(0,24),durable:pilot.durable===true,systemID:Number(systemID),entityID:Number(entityID),linkedAt:clock()};
  writeRow(pilot.id,e);
  return {...e};
 }
 // A finished shift frees the pilot. The physical ship stays alive as a spare;
 // only the identity link is dropped, and only when it still points at the exact
 // entity the caller means. Without this a long-lived world spends one resident
 // per station trip and every later sale dies with no free identity.
 function release(pilotID,options={}){
  if(!validID(pilotID))return {status:"INVALID_PILOT"};
  const record=gameStore.read(TABLE,"/"+pilotID);
  if(!record||record.success!==true||!record.data)return {status:"NOT_LINKED"};
  const current=record.data;
  const expected=positive(options?.expectedEntityID);
  if(expected&&Number(current.entityID)!==expected)return {status:"ENTITY_MISMATCH"};
  removeRow(pilotID);
  return {status:"RELEASED",pilotID,entityID:Number(current.entityID),
   systemID:Number(current.systemID)};
 }
 // Only update durable identity AFTER the same native ship physically
 // exists in the destination and is absent from its former EveJS scene.
 function relocate(pilotID,fromSystemID,entityID,toSystemID){
  const source=positive(fromSystemID),id=positive(entityID),dest=positive(toSystemID);
  if(!validID(pilotID)||!source||!id||!dest||source===dest)
   return {status:"INVALID"};
  const read=gameStore.read(TABLE,"/"+pilotID);
  const record=read&&read.success===true?read.data:null;
  if(!record||Number(record.systemID)!==source||Number(record.entityID)!==id)
   return {status:"STALE_SOURCE"};
  if(exists(source,id))return {status:"SOURCE_STILL_PHYSICAL"};
  if(!exists(dest,id))return {status:"DESTINATION_NOT_PHYSICAL"};
  const next={...record,systemID:dest,relocatedAt:clock()};
  writeRow(pilotID,next);
  return {status:"RELOCATED",...next};
 }
 function prune(){
  let removed=0;
  for(const [id,e] of Object.entries(rows())){
   if(!positive(e?.systemID)||!positive(e?.entityID)||!exists(e.systemID,e.entityID)){
    removeRow(id);removed++;
   }
  }
  return removed;
 }
 // Compatibility only: a shared table has no per-process copy to refresh.
 function refresh(){return false;}
 return {get,link,release,relocate,prune,refresh,
  snapshot:()=>({version:1,links:structuredClone(rows())})};
}
function createFileRegistry({file,exists,clock}){
 let state={version:1,links:{}};
 try{const raw=JSON.parse(fs.readFileSync(file,"utf8"));if(raw?.version!==1||!raw.links||typeof raw.links!=="object")throw Error("invalid registry");state=raw;}
 catch(err){if(err.code!=="ENOENT")throw err;}
 // Links deleted SINCE the last persist: a merge must not bring them back.
 let nonce=0;
 const removedLinks=new Set();
 let loadedStamp = null; // the file as this owner last saw it; refresh() compares
 const persist=()=>{
  // Several owners write this file (the world, the market trader, the co-op loop) and each
  // used to REPLACE it with its own copy. Measured 2026-10-30: a hull linked by the loop was
  // dropped by the next write from the market side and every crossing then failed
  // SOURCE_IDENTITY_MISMATCH. Merge with what is really on disk instead of overwriting it:
  // this owner always refreshes before it mutates, so its own view is the newest for its keys.
  let onDisk={};
  try{onDisk=JSON.parse(fs.readFileSync(file,"utf8")).links||{};}catch(_error){onDisk={};}
  const merged={...onDisk,...state.links};
  for(const id of removedLinks)delete merged[id];
  removedLinks.clear();
  state={version:1,links:merged};
  const dir=path.dirname(file);
  fs.mkdirSync(dir,{recursive:true});
  const tmp=file+".tmp-"+process.pid+"-"+(++nonce);
  let fd=null;
  try{
   fd=fs.openSync(tmp,"wx",0o600);
   fs.writeFileSync(fd,JSON.stringify(state));fs.fsyncSync(fd);
   fs.closeSync(fd);fd=null;
   fs.renameSync(tmp,file);
   if(typeof stamp==="function")loadedStamp=stamp();
   try{
    const dirfd=fs.openSync(dir,"r");
    try{fs.fsyncSync(dirfd);}finally{fs.closeSync(dirfd);}
   }catch(error){
    // Windows installations may reject directory fd fsync. Keep legacy
    // non-war NPC registry working, but require strict durability for war.
    if(process.env.EVEJS_COOP_FACTION_WAR_NATIVE_TRANSFER==="1"||
     !["EINVAL","ENOTSUP","EISDIR","EPERM"].includes(error?.code))
     throw error;
   }
  }finally{if(fd!==null)fs.closeSync(fd);}
 };
 // More than one owner reads this file (the world, the market trader, the co-op loop), and
 // each kept its own copy of the state. Measured 2026-10-30: the co-op linked a hull, the
 // market trader still had the file as it was at boot and refused every sale NO_IDENTITY_LINK -
 // and the next write from either side silently dropped the other's link.
 // refresh() re-reads the file when it really changed, so a reader never acts on a stale copy.
 function stamp(){
  try{const s=fs.statSync(file);return s.size + ":" + s.mtimeMs;}catch(_error){return null}
 }
 loadedStamp=stamp();
 function refresh(){
  const nowStamp=stamp();
  if(nowStamp===loadedStamp)return false;
  try{
   const raw=JSON.parse(fs.readFileSync(file,"utf8"));
   if(raw?.version!==1||!raw.links||typeof raw.links!=="object")return false;
   state=raw;loadedStamp=nowStamp;
   return true;
  }catch(_error){return false}
 }
 function get(id){
  refresh();
  const e=state.links[id];
  if(!e)return null;
  if(!positive(e.entityID)||!positive(e.systemID)||!exists(e.systemID,e.entityID))return null;
  return {...e};
 }
 function link(pilot,systemID,entityID){
  refresh();
  if(!validID(pilot?.id)||!positive(systemID)||!positive(entityID))throw Error("invalid materialization link");
  const existing=get(pilot.id);
  if(existing){
   // Older worlds were created before occupation tracking existed.
   // Migrate metadata without replacing a still-living physical ship.
   if(!existing.role&&pilot.role){
    const previous=state.links[pilot.id].role;
    state.links[pilot.id].role=String(pilot.role).slice(0,24);
    try{persist()}catch(error){
     state.links[pilot.id].role=previous;throw error;
    }
    return {...state.links[pilot.id]};
   }
   return existing;
  }
  const e={pilotID:pilot.id,name:String(pilot.name||pilot.id).slice(0,96),faction:String(pilot.faction||"independent").slice(0,48),role:String(pilot.role||"").slice(0,24),durable:pilot.durable===true,systemID:Number(systemID),entityID:Number(entityID),linkedAt:clock()};
  state.links[pilot.id]=e;
  try{persist()}catch(error){delete state.links[pilot.id];throw error;}
  return {...e};
 }
 // A finished shift frees the pilot. The physical ship stays alive as a spare;
 // only the identity link is dropped, and only when it still points at the exact
 // entity the caller means. Without this a long-lived world spends one resident
 // per station trip and every later sale dies with no free identity.
 function release(pilotID,options={}){
  refresh();
  if(!validID(pilotID))return {status:"INVALID_PILOT"};
  const record=state.links[pilotID];
  if(!record)return {status:"NOT_LINKED"};
  const expected=positive(options?.expectedEntityID);
  if(expected&&Number(record.entityID)!==expected)return {status:"ENTITY_MISMATCH"};
  delete state.links[pilotID];
  removedLinks.add(pilotID);
  try{persist();}
  catch(error){state.links[pilotID]=record;throw error;}
  return {status:"RELEASED",pilotID,entityID:Number(record.entityID),
   systemID:Number(record.systemID)};
 }
 // Only update durable identity AFTER the same native ship physically
 // exists in the destination and is absent from its former EveJS scene.
 function relocate(pilotID,fromSystemID,entityID,toSystemID){
  refresh();
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
  const before={...state.links};
  let removed=0;
  for(const [id,e] of Object.entries(state.links)){
   if(!positive(e.systemID)||!positive(e.entityID)||!exists(e.systemID,e.entityID)){
    delete state.links[id];removed++;
   }
  }
  if(removed)try{persist()}catch(error){state.links=before;throw error;}
  return removed;
 }
 return {get,link,release,relocate,prune,refresh,snapshot:()=>{refresh();return structuredClone(state);}};
}
module.exports={TABLE,createRegistry};
