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
const MAX_ATTEMPTS=300;
const attempts=new Map();
function enableFlag(){return process.env.EVEJS_COOP_HAUL_CARGO_ADOPTION==="1";}
function dependenciesOf(options={}){
 return {store:options.store||require("./npc/nativeNpcStore"),
  probe:options.probe||require("./coopRuntimeProbe"),
  database:options.database||null,
  clock:options.clock||(()=>Date.now())};
}
function liveShip(scene,id){
 const entity=scene?.getEntityByID?.(Number(id));
 return entity?.kind==="ship"&&pos(entity.itemID)===Number(id)?entity:null;
}
function stillRegistered(store,entityID){
 if(typeof store?.getNativeEntity!=="function")return null;
 try{return store.getNativeEntity(Number(entityID))||null}catch(_error){return null}
}
// Which orphans may this exact fleet slot adopt? Every condition is an
// independent refusal, so a missing or odd field never guesses ownership.
function plan({store,scene,systemID,fleetID,now,ttlMs=DEFAULT_TTL_MS}={}){
 const pid=pos(systemID),fid=pos(fleetID);
 if(!pid||!fid||!scene||typeof store?.listNativeCargo!=="function")
  return {status:"INVALID_AUTHORITIES",rows:[]};
 let all;try{all=store.listNativeCargo()}catch(_error){return {status:"CARGO_UNAVAILABLE",rows:[]}}
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
  if(stillRegistered(store,row.entityID))continue;
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
 const tries=(attempts.get(key)||0)+1;
 if(tries>MAX_ATTEMPTS||attempts.get(key)===-1)return {status:"ALREADY_ATTEMPTED"};
 attempts.set(key,tries);
 const ttlMs=Number(process.env.EVEJS_COOP_HAUL_CARGO_ADOPTION_TTL_MS)>0?
  Number(process.env.EVEJS_COOP_HAUL_CARGO_ADOPTION_TTL_MS):DEFAULT_TTL_MS;
 const planned=plan({store,scene,systemID,fleetID,now,ttlMs});
 if(planned.status!=="ADOPTABLE"){
  if(planned.status!=="NO_ORPHAN_CARGO")
   observe(probe,"living-haul-cargo-adoption-skipped",null,
    {fleetID,status:planned.status},systemID);
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
 const existing=(store.listNativeCargoForEntity(haulerID)||[]);
 if(existing.some(x=>pos(x?.coopHaulFleetID)))return {status:"HAULER_ALREADY_LOADED",adopted:0};
 let adopted=0,quantity=0,volume=0,failed=null;
 for(const row of planned.rows){
  const next={...row,entityID:haulerID,ownerID,
   coopHaulFleetID:fleetID,coopHaulSystemID:systemID,
   coopHaulAdoptedAt:now,coopHaulAdoptedFrom:pos(row.entityID)};
  let result;try{result=store.upsertNativeCargo(next,{transient:false})}
  catch(error){failed=String(error?.message||error).slice(0,80);break}
  if(!result||result.success!==true){failed=String(result?.errorMsg||"UPSERT_REJECTED");break}
  adopted+=1;quantity+=pos(next.quantity);
  volume+=pos(next.quantity)*Math.max(0,Number(row.volume)||0);
 }
 if(!adopted)return {status:"ADOPTION_REJECTED",detail:failed,adopted:0};
 // The write must be durable BEFORE the trip starts, exactly as a real load.
 let flushed=false;
 try{
  const db=database||require("../gameStore");
  if(typeof db?.flushTableSync==="function")flushed=db.flushTableSync("npcCargo")?.success===true;
 }catch(_error){flushed=false}
 if(!flushed){
  // Roll the re-point back inside this process only; the rows stay orphans.
  for(const row of planned.rows){
   if(!pos(row.cargoID))continue;
   try{store.upsertNativeCargo({...row},{transient:false})}catch(_error){/* best effort */}
  }
  observe(probe,"living-haul-cargo-adoption-skipped",null,
   {fleetID,status:"CARGO_FLUSH_FAILED",rows:adopted},systemID);
  return {status:"CARGO_FLUSH_FAILED",adopted:0};
 }
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
 attempts.set(key,-1);
 return result;
}
function resetForTests(){attempts.clear();}
module.exports={adopt,plan,resetForTests};
