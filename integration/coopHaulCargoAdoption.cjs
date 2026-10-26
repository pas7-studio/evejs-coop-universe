"use strict";
// Restart resilience (path B): a durable haul-cargo row keeps its original
// native cargoID, but after a process restart the hauler that loaded it no
// longer exists. The ore then waits on disk as an orphan while the re-seeded
// fleet starts its cycle from zero. This module re-attaches such orphans to
// the live hauler of the SAME solar system and the SAME fleet slot exactly
// once, then hands the fleet back to the normal loaded -> station -> sell
// pipeline. It never creates cargo, never grants station stock and never
// invents a destination.
const pos=v=>{const n=Number(v);return Number.isSafeInteger(n)&&n>0?n:0;};
const DEFAULT_TTL_MS=45*60*1000;
const MAX_ATTEMPTS=120;
const THROTTLE_MS=2000;
const attempts=new Map();
const noted=new Set();
function enableFlag(){return process.env.EVEJS_COOP_HAUL_CARGO_ADOPTION==="1";}
function dependenciesOf(options={}){
 return {store:options.store||require("./npc/nativeNpcStore"),
  probe:options.probe||require("./coopRuntimeProbe"),
  database:options.database||null,
  cargoTable:options.cargoTable||null,
  clock:options.clock||(()=>Date.now())};
}
// The pinned store exports listNativeCargoForEntity but NOT a global
// listNativeCargo, so the durable table is read through gameStore when the
// store cannot enumerate.
function cargoRows({store,cargoTable,database}={}){
 if(typeof store?.listNativeCargo==="function"){
  const all=store.listNativeCargo();
  if(Array.isArray(all))return all;
 }
 let read=cargoTable;
 if(typeof read!=="function"){
  const db=database||require("../gameStore");
  read=()=>db.read?.("npcCargo","/cargo");
 }
 const table=read();
 return table&&typeof table==="object"&&!Array.isArray(table)?
  Object.values(table):null;
}
function liveShip(scene,id){
 const entity=scene?.getEntityByID?.(Number(id));
 return entity?.kind==="ship"&&pos(entity.itemID)===Number(id)?entity:null;
}
// Missing or failing native entity registry is NOT proof a former hauler
// has disappeared. Reusing its original cargo would duplicate custody.
const REGISTRY_UNVERIFIED=Symbol("NATIVE_ENTITY_REGISTRY_UNVERIFIED");
function stillRegistered(store,entityID){
 if(typeof store?.getNativeEntity!=="function")return REGISTRY_UNVERIFIED;
 try{return store.getNativeEntity(Number(entityID))||null}
 catch(_error){return REGISTRY_UNVERIFIED}
}
// Which orphans may this exact fleet slot adopt? Every condition is an
// independent refusal, so a missing or odd field never guesses ownership.
function plan({store,scene,systemID,fleetID,now,ttlMs=DEFAULT_TTL_MS,cargoTable,database}={}){
 const pid=pos(systemID),fid=pos(fleetID);
 if(!pid||!fid||!scene)return {status:"INVALID_AUTHORITIES",rows:[]};
 let all;try{all=cargoRows({store,cargoTable,database})}
 catch(_error){return {status:"CARGO_UNAVAILABLE",rows:[]}}
 if(!Array.isArray(all))return {status:"CARGO_UNAVAILABLE",rows:[]};
 const rows=[];
 for(const row of all){
  if(!row||row.transient!==false||Number(row.moduleID||0)!==0)continue;
  if(!pos(row.cargoID)||!pos(row.typeID)||!pos(row.quantity)||
     !pos(row.coopHaulFromMinerID)||!pos(row.entityID))continue;
  if(Number(row.coopHaulFleetID)!==fid||Number(row.coopHaulSystemID)!==pid)continue;
  if(pos(row.coopHaulAdoptedAt))continue;
  const loadedAt=Number(row.coopHaulLoadedAt);
  if(!Number.isFinite(loadedAt)||loadedAt<=0||loadedAt>now)continue;
  if(now-loadedAt>ttlMs)continue;
  if(liveShip(scene,row.entityID))continue;
  const registered=stillRegistered(store,row.entityID);
  if(registered===REGISTRY_UNVERIFIED)
   return {status:"NATIVE_ENTITY_REGISTRY_UNVERIFIED",rows:[]};
  if(registered)continue;
  rows.push(row);
 }
 return {status:rows.length?"ADOPTABLE":"NO_ORPHAN_CARGO",rows};
}
function observe(probe,event,entity,payload,systemID){
 try{probe?.observe?.(event,entity,{spaceState:{systemID}},payload)}catch(_error){/* telemetry never blocks */}
}
// adopt() is idempotent per process and per fleet slot. A row may only be
// re-pointed while its original hauler is provably gone, and its cargoID is
// preserved so every existing receipt/audit identity still matches.
function adopt(scene,fleet,options={}){
 if(!enableFlag())return {status:"DISABLED"};
 const {store,probe,database,clock}=dependenciesOf(options);
 const systemID=pos(scene?.systemID),fleetID=pos(fleet?.fleetID);
 const now=Number(clock());
 if(!systemID||!fleetID||systemID!==pos(fleet?.systemID))
  return {status:"INVALID_FLEET"};
 const key=systemID+":"+fleetID;
 const state=attempts.get(key)||{tries:0,at:0,done:false};
 if(state.done)return {status:"ALREADY_ATTEMPTED"};
 if(now-state.at<THROTTLE_MS)return {status:"THROTTLED"};
 if(state.tries>=MAX_ATTEMPTS){state.done=true;attempts.set(key,state);return {status:"ALREADY_ATTEMPTED"}}
 state.tries+=1;state.at=now;attempts.set(key,state);
 const ttlMs=Number(process.env.EVEJS_COOP_HAUL_CARGO_ADOPTION_TTL_MS)>0?
  Number(process.env.EVEJS_COOP_HAUL_CARGO_ADOPTION_TTL_MS):DEFAULT_TTL_MS;
 const planned=plan({store,scene,systemID,fleetID,now,ttlMs,
  cargoTable:options.cargoTable,database});
 if(planned.status!=="ADOPTABLE"){
  // One status line per slot, not one per native tick.
  const noteKey=key+":"+planned.status;
  if(planned.status!=="NO_ORPHAN_CARGO"&&!noted.has(noteKey)){
   noted.add(noteKey);
   observe(probe,"living-haul-cargo-adoption-skipped",null,
    {fleetID,status:planned.status},systemID);
  }
  return {status:planned.status,adopted:0};
 }
 // A fresh slot may keep mining; an active trip or a fleet already holding
 // durable cargo must never receive a second batch.
 if(String(fleet?.state||"")!=="mining"||fleet?.coopStationArrival||
    fleet?.coopHaulNeedsOperatorRepair)
  return {status:"FLEET_NOT_IDLE",adopted:0};
 const haulerIDs=(fleet.haulerEntityIDs||[]).map(pos).filter(Boolean);
 if(haulerIDs.length!==1||(fleet.haulerEntityIDs||[]).length!==1)
  return {status:"HAULER_NOT_UNIQUE",adopted:0};
 const hauler=liveShip(scene,haulerIDs[0]);
 if(!hauler)return {status:"HAULER_NOT_UNIQUE",adopted:0};
 const haulerID=pos(hauler.itemID),ownerID=pos(hauler.ownerID);
 if(!haulerID||!ownerID)return {status:"HAULER_NOT_ATTESTED",adopted:0};
 // A fleet slot is NOT corporate title: fleet IDs can be reused across
 // original NPC owners. Never transfer a cargo item to a different owner
 // merely by adopting its previous hauler's stale entityID.
 // Validate the entire batch before any original cargo row is rewritten.
 if(planned.rows.some(row=>pos(row.ownerID)!==ownerID))
  return {status:"ORIGINAL_CARGO_OWNER_MISMATCH",adopted:0};
 const existing=(store.listNativeCargoForEntity(haulerID)||[]);
 if(existing.some(x=>pos(x?.coopHaulFleetID)))return {status:"HAULER_ALREADY_LOADED",adopted:0};
 // Upserts are not a GameStore transaction. A failed second write
 // cannot turn a partially transferred batch into an authorised haul.
 // Include the failing row: an adapter may mutate then return failure.
 const flushCargo=()=>{
  try{
   const db=database||require("../gameStore");
   return db?.flushTableSync?.("npcCargo")?.success===true;
  }catch(_error){return false}
 };
 const restore=(touched,status,detail)=>{
  // A failed batch must not consume the once-only slot: the rows were put back,
  // so a later tick may legitimately try again.
  attempts.delete(systemID+":"+fleetID);
  let restored=true;
  for(const row of [...touched].reverse()){
   try{
    const result=store.upsertNativeCargo({...row},{transient:false});
    if(result?.success!==true)restored=false;
   }catch(_error){restored=false}
  }
  // The original custody must be re-flushed after compensation, not just
  // restored to an in-memory table. Unknown rollback means operator hold.
  const durable=flushCargo();
  if(!restored||!durable){
   fleet.coopHaulNeedsOperatorRepair=true;
   observe(probe,"living-haul-cargo-adoption-skipped",null,
    {fleetID,status:"ADOPTION_RECOVERY_UNVERIFIED",reason:status},systemID);
   return {status:"ADOPTION_RECOVERY_UNVERIFIED",detail,adopted:0};
  }
  observe(probe,"living-haul-cargo-adoption-skipped",null,
   {fleetID,status,rows:touched.length},systemID);
  return {status,detail,adopted:0};
 };
 let adopted=0,quantity=0,volume=0,failed=null;
 const attempted=[];
 for(const row of planned.rows){
  const next={...row,entityID:haulerID,ownerID,
   coopHaulFleetID:fleetID,coopHaulSystemID:systemID,
   coopHaulAdoptedAt:now,coopHaulAdoptedFrom:pos(row.entityID)};
  attempted.push(row);
  let result;try{result=store.upsertNativeCargo(next,{transient:false})}
  catch(error){failed=String(error?.message||error).slice(0,80);break}
  if(!result||result.success!==true){failed=String(result?.errorMsg||"UPSERT_REJECTED");break}
  adopted+=1;quantity+=pos(next.quantity);
  volume+=pos(next.quantity)*Math.max(0,Number(row.volume)||0);
 }
 if(failed!==null)return restore(attempted,"ADOPTION_REJECTED",failed);
 // The entire original cargo batch must be durable before sailing.
 if(!flushCargo())return restore(attempted,"CARGO_FLUSH_FAILED",null);
 hauler.nativeCargoItems=store.buildNativeCargoItems(haulerID);
 fleet.lastHauledVolumeM3=volume;
 fleet.lastHauledAtMs=now;
 fleet.state="loaded";
 fleet.loadedUntilMs=now+5000;
 fleet.nextThinkAtMs=fleet.loadedUntilMs;
 fleet.coopHaulAdoptedAt=now;
 fleet.coopHaulAdoptedVolumeM3=volume;
 observe(probe,"living-haul-cargo-adopted",null,
  {fleetID,rows:adopted,quantity,volumeM3:volume,haulerID,
   fromEntityIDs:planned.rows.map(row=>pos(row.entityID)).slice(0,16),
   carriage:"native",invented:false},systemID);
 const result={status:"ADOPTED",adopted,quantity,volumeM3:volume,haulerID};
 attempts.set(key,{tries:state.tries,at:now,done:true});
 return result;
}
function resetForTests(){attempts.clear();noted.clear();}
module.exports={adopt,plan,resetForTests};
