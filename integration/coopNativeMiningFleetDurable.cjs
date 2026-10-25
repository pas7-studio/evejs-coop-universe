"use strict";
/**
 * ALIFE-08. Native persistent startup mining fleets.
 *
 * npcEntities.coopMiningFleetSlots is ONLY a durable slot witness; the original
 * nativeNpcStore entity/controller/module/cargo rows remain sole authorities.
 * A PREPARING slot is quarantined after a crash: NEVER guess that it is safe
 * to re-spawn ships, even if no hull currently appears in scene memory.
 */
const MAX_SLOTS=16, MAX_WING=32;
const busy=new Set();
const pos=x=>Number.isSafeInteger(Number(x))&&Number(x)>0?Number(x):0;
const clone=x=>JSON.parse(JSON.stringify(x));
function slotKey(systemID,slot){return systemID+"-"+slot;}
// Stable across restarts, disjoint by system and slot; no virtual ship ID.
function fleetIDForSlot(systemID,slot){
 const id=Number(systemID)*32+Number(slot);
 return pos(systemID)&&Number.isSafeInteger(Number(slot))&&slot>=1&&slot<=MAX_SLOTS&&
   Number.isSafeInteger(id)&&id>0?id:0;
}
function roleMarker(systemID,slot,role){
 return "coop-mining-"+systemID+"-"+slot+"-"+role;
}
function result(status,slot,extra={}){return {status,slot,...extra};}
function readSlot(db,key){
 const r=db.read("npcEntities","/coopMiningFleetSlots/"+key);
 if(r?.success===true)return r.data;
 if(r?.errorMsg==="ENTRY_NOT_FOUND")return null;
 throw Error("ALIFE08_SLOT_READ_UNAVAILABLE:"+String(r?.errorMsg));
}
function saveSlot(db,key,record){
 const data=clone(record);
 if(db.write("npcEntities","/coopMiningFleetSlots/"+key,data)?.success!==true)
   throw Error("ALIFE08_SLOT_WRITE_FAILED");
 const flushed=db.flushTableSync("npcEntities",{log:false});
 if(flushed?.success!==true)throw Error("ALIFE08_SLOT_FLUSH_FAILED");
 const observed=readSlot(db,key);
 if(!observed||JSON.stringify(observed)!==JSON.stringify(data))
   throw Error("ALIFE08_SLOT_READBACK_FAILED");
 return data;
}
function ids(values){
 if(!Array.isArray(values)||values.length>MAX_WING)return null;
 const out=values.map(pos);
 return out.every(Boolean)&&new Set(out).size===out.length?out:null;
}
function markers(store,systemID,slot){
 const all=store.listNativeEntitiesForSystem(systemID);
 if(!Array.isArray(all))throw Error("ALIFE08_NATIVE_ENTITY_LIST_UNAVAILABLE");
 const miners=[],haulers=[],invalid=[];
 for(const e of all){
  const id=pos(e?.entityID),mark=String(e?.operatorKind||"");
  if(!mark.startsWith("coop-mining-"+systemID+"-"+slot+"-"))continue;
  if(mark===roleMarker(systemID,slot,"miner"))miners.push(id);
  else if(mark===roleMarker(systemID,slot,"hauler"))haulers.push(id);
  else invalid.push(id);
 }
 return {miners,haulers,invalid};
}
// A witness can survive a whole scene generation whose ships were never durable:
// the record says ACTIVE, the hulls are gone and nothing will ever match it again.
// That is abandonment, not a crash, and it is provable read-only: no durable row,
// no physical ship, no cargo row and no module row may refer to those IDs.
// Anything a provably absent hull left behind (fitted items, and ore it mined)
// is unreachable by any live ship. It is archived verbatim under the slot's key
// instead of being deleted or silently ignored, so the audit trail survives.
function archiveOrphanRows({db,store,key,entityID}){
 const out={modules:0,cargo:0};
 const modules=store.listNativeModulesForEntity(entityID);
 if(!Array.isArray(modules)||!Array.isArray(store.listNativeCargoForEntity(entityID)))
  throw Error("ALIFE08_ORPHAN_ROW_LIST_UNAVAILABLE:"+entityID);
 const cargo=store.listNativeCargoForEntity(entityID);
 for(const [kind,rows] of [["modules",modules],["cargo",cargo]]){
  if(!rows.length)continue;
  const target="/coopMiningFleetSlotsArchive/"+key+"-"+kind+"-"+entityID+"-"+Date.now();
  if(db.write("npcEntities",target,rows)?.success!==true)
   throw Error("ALIFE08_ORPHAN_ARCHIVE_WRITE_FAILED:"+kind+":"+entityID);
  if(db.flushTableSync("npcEntities",{log:false})?.success!==true)
   throw Error("ALIFE08_ORPHAN_ARCHIVE_FLUSH_FAILED:"+kind+":"+entityID);
  // The archive is durable, so custody can now move: the orphan rows are
  // removed from the live store instead of lingering as unreachable ghosts.
  for(const row of rows){
   const removed=kind==="modules"
    ? store.removeNativeModule(row.moduleID)
    : store.removeNativeCargo(row.cargoID);
   if(removed?.success!==true&&removed!==true)
    throw Error("ALIFE08_ORPHAN_REMOVE_FAILED:"+kind+":"+entityID);
  }
  out[kind]=rows.length;
 }
 return out;
}
function slotIsAbandoned({scene,store,systemID,slot,entityIDs}){
 if(process.env.EVEJS_COOP_NATIVE_MINING_SLOT_RECONCILE!=="1")return false;
 if(!Array.isArray(entityIDs)||!entityIDs.length)return false;
 const found=markers(store,systemID,slot);
 if(found.miners.length||found.haulers.length||found.invalid.length)return false;
 for(const id of entityIDs){
  if(store.getNativeEntity(id)||store.getNativeController(id))return false;
  if(scene?.getEntityByID?.(id))return false;
  if(!Array.isArray(store.listNativeCargoForEntity(id))||
     !Array.isArray(store.listNativeModulesForEntity(id)))
   throw Error("ALIFE08_ORPHAN_ROW_LIST_UNAVAILABLE:"+id);
 }
 return true;
}
// The old witness is archived, never deleted, so an operator can still see what
// the slot claimed before it was re-seeded.
function archiveSlot(db,key,record){
 const data=clone(record);
 if(db.write("npcEntities","/coopMiningFleetSlotsArchive/"+key+"-"+Date.now(),data)?.success!==true)
  throw Error("ALIFE08_SLOT_ARCHIVE_WRITE_FAILED");
 if(db.flushTableSync("npcEntities",{log:false})?.success!==true)
  throw Error("ALIFE08_SLOT_ARCHIVE_FLUSH_FAILED");
 return true;
}
// A runtime fleet record can outlive some or all of its physical ships. Any
// listed ship that is NOT the survivor set and no longer exists (no durable row,
// no physical entity) is simply stale: re-point the record at the ships that
// really exist. A record that still owns a live foreign ship is never touched.
function adoptStaleRuntimeFleet({scene,store,fleet,key,minerIDs,haulerIDs}){
 const listed=[...(fleet.minerEntityIDs||[]),...(fleet.haulerEntityIDs||[])]
  .map(pos).filter(Boolean);
 const target=new Set([...minerIDs,...haulerIDs]);
 const foreign=listed.filter(id=>!target.has(id));
 if(!foreign.length)return false;
 // Only a foreign ship that is PHYSICALLY here can be a real occupant. A durable
 // row whose hull is not in the scene is a leftover, never a reason to keep the
 // slot blocked forever; it is left untouched, just unmanaged.
 if(foreign.some(id=>scene.getEntityByID(id)))return false;
 fleet.startupKey=key;
 fleet.minerEntityIDs=[...minerIDs];
 fleet.haulerEntityIDs=[...haulerIDs];
 return true;
}
// A slot can lose SOME ships while the rest survive (a hull that was never
// durable, or a failed restore). The survivors keep their cargo and custody, so
// the slot must not be re-seeded wholesale and must not stay blocked forever:
// only the provably missing roles are allocated again, and the witness is merged.
// A missing ID that still owns cargo or modules is never replaced.
function repairPartialSlot({scene,store,systemID,slot,key,db,spawn,ensureState,minerIDs,haulerIDs}){
 if(process.env.EVEJS_COOP_NATIVE_MINING_SLOT_RECONCILE!=="1")return null;
 const aliveMin=minerIDs.filter(id=>store.getNativeEntity(id)||scene.getEntityByID(id));
 const aliveHau=haulerIDs.filter(id=>store.getNativeEntity(id)||scene.getEntityByID(id));
 const missingMin=minerIDs.length-aliveMin.length;
 const missingHau=haulerIDs.length-aliveHau.length;
 if(!missingMin&&!missingHau)return null;
 let archivedModules=0,archivedCargo=0;
 for(const id of [...minerIDs,...haulerIDs]){
  if(aliveMin.includes(id)||aliveHau.includes(id))continue;
  const archived=archiveOrphanRows({db,store,key,entityID:id});
  archivedModules+=archived.modules;
  archivedCargo+=archived.cargo;
 }
 // The scene mining state must exist BEFORE allocating, exactly like a first
 // seed: without it the fresh hulls are created as scene-only actors and their
 // durable rows never reach the store.
 ensureState();
 const born=spawn(slot,{miners:missingMin,haulers:missingHau});
 if(!born?.success||!born.data||born.data.minerSpawnResult?.data?.partialFailure||
     born.data.haulerSpawnResult?.data?.partialFailure)
  throw Error("ALIFE08_PARTIAL_NATIVE_SPAWN");
 const newMin=ids(born.data.minerEntityIDs||[]),newHau=ids(born.data.haulerEntityIDs||[]);
 if(!newMin||!newHau||newMin.length!==missingMin||newHau.length!==missingHau)
  throw Error("ALIFE08_REPAIR_SPAWN_COUNT_MISMATCH");
 const merged={minerEntityIDs:[...aliveMin,...newMin],haulerEntityIDs:[...aliveHau,...newHau]};
 if(merged.minerEntityIDs.length+merged.haulerEntityIDs.length>MAX_WING)
  throw Error("ALIFE08_REPAIR_WING_TOO_LARGE");
 const found=markers(store,systemID,slot);
 const sameSet=(a,b)=>a.length===b.length&&a.every(x=>b.includes(x));
 if(found.invalid.length||!sameSet(found.miners,merged.minerEntityIDs)||
     !sameSet(found.haulers,merged.haulerEntityIDs))
  throw Error("ALIFE08_REPAIR_MARKER_MISMATCH");
 const synced=db.flushTablesSync(["npcEntities","npcRuntimeControllers","npcModules","npcCargo"]);
 if(synced?.success!==true)throw Error("ALIFE08_NATIVE_ACTOR_FLUSH_FAILED");
 const notStored=[...merged.minerEntityIDs,...merged.haulerEntityIDs]
  .filter(id=>!store.getNativeEntity(id));
 if(notStored.length)throw Error("ALIFE08_REPAIR_NOT_IN_STORE:"+notStored.join(","));
 const previous=readSlot(db,key)||{};
 saveSlot(db,key,{...previous,version:1,status:"ACTIVE",systemID,slot,
  fleetID:previous.fleetID||fleetIDForSlot(systemID,slot),
  minerEntityIDs:merged.minerEntityIDs,haulerEntityIDs:merged.haulerEntityIDs,
  repairedAtMs:Date.now(),archivedModules,archivedCargo,
  replacedEntityIDs:[...minerIDs,...haulerIDs].filter(id=>
   !merged.minerEntityIDs.includes(id)&&!merged.haulerEntityIDs.includes(id))});
 return merged;
}
function verifyActors({scene,store,systemID,slot,minerIDs,haulerIDs}){
 const expected=[...minerIDs,...haulerIDs];
 if(new Set(expected).size!==expected.length)throw Error("ALIFE08_DUPLICATE_SHIP_ID");
 const found=markers(store,systemID,slot);
 if(found.invalid.length ||
    found.miners.length!==minerIDs.length ||
    found.haulers.length!==haulerIDs.length ||
    found.miners.some(x=>!minerIDs.includes(x)) ||
    found.haulers.some(x=>!haulerIDs.includes(x)))
  throw Error("ALIFE08_UNEXPECTED_OR_MISSING_MARKED_SHIPS");
 const check=(id,role)=>{
  const entity=store.getNativeEntity(id),controller=store.getNativeController(id);
  const marker=roleMarker(systemID,slot,role);
  if(!entity||!controller||entity.transient===true||controller.transient===true ||
     entity.nativeNpc!==true||pos(entity.entityID)!==id||
     pos(controller.entityID)!==id||
     pos(entity.systemID)!==systemID||pos(controller.systemID)!==systemID||
     entity.operatorKind!==marker||controller.operatorKind!==marker||
     String(controller.startupRuleID||"")!=="" ||
     pos(entity.ownerID)===0 ||
     !String(controller.profileID||"").trim())
    throw Error("ALIFE08_PERSISTENT_ACTOR_IDENTITY_CONFLICT:"+id);
  const physical=scene.getEntityByID(id);
  if(physical && (physical.kind!=="ship"||physical.nativeNpc!==true||
      pos(physical.itemID)!==id||pos(physical.ownerID)!==pos(entity.ownerID)))
    throw Error("ALIFE08_SCENE_SHIP_ID_OCCUPIED:"+id);
  const cargo=store.listNativeCargoForEntity(id);
  if(!Array.isArray(cargo)||cargo.some(c=>!pos(c.cargoID)||
      pos(c.entityID)!==id||pos(c.ownerID)!==pos(entity.ownerID)||
      c.transient===true))
    throw Error("ALIFE08_CARGO_CUSTODY_CONFLICT:"+id);
  const modules=store.listNativeModulesForEntity(id);
  if(!Array.isArray(modules)||modules.some(m=>!pos(m.moduleID)||
      pos(m.entityID)!==id||m.transient===true))
    throw Error("ALIFE08_MODULE_CUSTODY_CONFLICT:"+id);
 };
 minerIDs.forEach(id=>check(id,"miner"));
 haulerIDs.forEach(id=>check(id,"hauler"));
}
function registerOnce({scene,store,getFleets,register,slot,minerIDs,haulerIDs,originAnchor}){
 const existing=getFleets();
 const key=scene.systemID+":"+slot;
 const stableFleetID=fleetIDForSlot(scene.systemID,slot);
 if(!stableFleetID)throw Error("ALIFE09_INVALID_STABLE_FLEET_ID");
 const conflicts=existing.filter(x=>x.startupKey===key||
   Number(x.fleetID)===stableFleetID);
 if(conflicts.length>1)throw Error("ALIFE08_DUPLICATED_RUNTIME_SLOT");
 if(conflicts.length){
  const fleet=conflicts[0];
  if(fleet.startupKey!==key||Number(fleet.fleetID)!==stableFleetID)
    throw Error("ALIFE09_RUNTIME_FLEET_ID_CONFLICT");
  const a=ids(fleet.minerEntityIDs),b=ids(fleet.haulerEntityIDs);
  if(!a||!b||JSON.stringify(a)!==JSON.stringify(minerIDs)||
     JSON.stringify(b)!==JSON.stringify(haulerIDs)){
   if(adoptStaleRuntimeFleet({scene,store:store,fleet,key,minerIDs,haulerIDs}))
    return false;
   throw Error("ALIFE08_RUNTIME_FLEET_SLOT_CONFLICT");
  }
  return false;
 }
 const answer=register(slot,{minerEntityIDs:minerIDs,haulerEntityIDs:haulerIDs,originAnchor});
 if(!answer||String(answer.startupKey)!==key||Number(answer.fleetID)!==stableFleetID)
   throw Error("ALIFE08_NATIVE_FLEET_REGISTRATION_UNKNOWN");
 return true;
}
function createService({db,store,nativeService,ensureState,spawn,register,
  getFleets,log=()=>{}}={}){
 if(!db||typeof db.read!=="function"||typeof db.write!=="function"||
    typeof db.flushTableSync!=="function"||typeof db.flushTablesSync!=="function"||
    !store||!nativeService||typeof nativeService.materializeStoredNativeController!=="function"||
    typeof ensureState!=="function"||typeof spawn!=="function"||
    typeof register!=="function"||typeof getFleets!=="function")
  throw Error("ALIFE08_AUTHORITIES_REQUIRED");
 // Original persistent haulers with cargo MUST resume the station trip after
 // cold restart instead of restarting the mining state with unresolved ore.
 function resumePendingStationCargo(scene,slot,haulerIDs){
  if(process.env.EVEJS_COOP_NATIVE_STATION_TRIP_RECOVERY!=="1"||
     process.env.EVEJS_COOP_NATIVE_HAUL_MANIFEST!=="1")return false;
  const id=fleetIDForSlot(scene.systemID,slot);
  const live=getFleets().filter(x=>x.startupKey===scene.systemID+":"+slot&&
    Number(x.fleetID)===id);
  if(live.length!==1)throw Error("ALIFE12_RUNTIME_FLEET_TO_RESUME_NOT_UNIQUE");
  const rows=haulerIDs.flatMap(entityID=>{
   const cargo=store.listNativeCargoForEntity(entityID);
   if(!Array.isArray(cargo))throw Error("ALIFE12_NATIVE_HAUL_CARGO_UNAVAILABLE");
   return cargo;
  });
  if(!rows.length)return false;
  if(rows.some(x=>!pos(x.cargoID)||!pos(x.quantity)||
    !haulerIDs.includes(Number(x.entityID))||
    Number(x.coopHaulFleetID)!==id||x.transient===true))
   throw Error("ALIFE12_NATIVE_HAUL_CUSTODY_AMBIGUOUS");
  const fleet=live[0];
  if(fleet.state!=="loaded"&&fleet.state!=="haulereturn"){
   fleet.state="loaded";
   fleet.nextThinkAtMs=0;
  }
  return true;
 }
 function start({scene,fleetCount}={}){
  const systemID=pos(scene?.systemID);
  if(!systemID||!fleetIDForSlot(systemID,1)||
     typeof scene.getEntityByID!=="function"||
     !Number.isSafeInteger(fleetCount)||fleetCount<0||fleetCount>MAX_SLOTS)
   return {status:"BLOCKED",reason:"ALIFE08_INVALID_STARTUP",slots:[]};
  if(process.env.EVEJS_COOP_NATIVE_MINING_FLEET_DURABLE!=="1")
   return {status:"BLOCKED",reason:"ALIFE08_NOT_ENABLED",slots:[]};
  if(busy.has(systemID))return {status:"BLOCKED",reason:"ALIFE08_REENTRANT",slots:[]};
  busy.add(systemID);
  const reports=[];
  try{
   for(let slot=1;slot<=fleetCount;slot++){
    const key=slotKey(systemID,slot);
    // Allocate and verify one slot's native actors. Used for a brand new slot
    // and for a slot whose previous witness proved abandoned.
    const seedSlot=()=>{
     saveSlot(db,key,{version:1,status:"PREPARING",systemID,slot,createdAtMs:Date.now()});
     // The PREPARING witness is flushed BEFORE any native actor allocation.
     ensureState();
     const born=spawn(slot);
     if(!born?.success||!born.data||born.data.minerSpawnResult?.data?.partialFailure||
         born.data.haulerSpawnResult?.data?.partialFailure)
      throw Error("ALIFE08_PARTIAL_NATIVE_SPAWN");
     const minerIDs=ids(born.data.minerEntityIDs),haulerIDs=ids(born.data.haulerEntityIDs);
     if(!minerIDs||minerIDs.length===0||!haulerIDs||
        minerIDs.length+haulerIDs.length>MAX_WING)
      throw Error("ALIFE08_NATIVE_SPAWN_LIST_INVALID");
     verifyActors({scene,store,systemID,slot,minerIDs,haulerIDs});
     // Flush original native entities, controllers, fitting and cargo first.
     const synced=db.flushTablesSync(["npcEntities","npcRuntimeControllers","npcModules","npcCargo"]);
     if(synced?.success!==true)throw Error("ALIFE08_NATIVE_ACTOR_FLUSH_FAILED");
     verifyActors({scene,store,systemID,slot,minerIDs,haulerIDs});
     const active=saveSlot(db,key,{version:1,status:"ACTIVE",systemID,slot,
      fleetID:fleetIDForSlot(systemID,slot),
      minerEntityIDs:minerIDs,haulerEntityIDs:haulerIDs,originAnchor:born.data.originAnchor||null});
     registerOnce({scene,store,getFleets,register,slot,minerIDs,haulerIDs,
      originAnchor:active.originAnchor});
     return result("SPAWNED",slot,{minerIDs,haulerIDs});
    };
    try{
     const record=readSlot(db,key);
     const discovered=markers(store,systemID,slot);
     if(!record){
      if(discovered.invalid.length||discovered.miners.length||discovered.haulers.length){
       reports.push(result("NEEDS_OPERATOR_REPAIR",slot,{reason:"ORPHAN_NATIVE_SLOT_WITHOUT_MANIFEST"}));
       continue;
      }
      reports.push(seedSlot());
      continue;
     }
     if(record.version!==1||record.status!=="ACTIVE"||
        pos(record.systemID)!==systemID||pos(record.slot)!==slot||
        Number(record.fleetID)!==fleetIDForSlot(systemID,slot)){
      reports.push(result("NEEDS_OPERATOR_REPAIR",slot,{reason:"NONACTIVE_OR_INVALID_SLOT_WITNESS"}));
      continue;
     }
     let minerIDs=ids(record.minerEntityIDs),haulerIDs=ids(record.haulerEntityIDs);
     if(!minerIDs||!minerIDs.length||!haulerIDs||
        minerIDs.length+haulerIDs.length>MAX_WING)
      throw Error("ALIFE08_ACTIVE_MANIFEST_INVALID");
     // A slot whose ships were never durable is not a lost fleet: nothing that
     // could hold cargo exists any more. Archive that witness and seed again.
     if(slotIsAbandoned({scene,store,systemID,slot,entityIDs:[...minerIDs,...haulerIDs]})){
      const orphans=[...minerIDs,...haulerIDs].reduce((acc,id)=>{
       const a=archiveOrphanRows({db,store,key,entityID:id});
       return {modules:acc.modules+a.modules,cargo:acc.cargo+a.cargo};
      },{modules:0,cargo:0});
      archiveSlot(db,key,record);
      log("ALIFE08 slot "+key+" witness archived as abandoned; seeding again");
      reports.push({...seedSlot(),reseededFrom:"ABANDONED_WITNESS",...orphans});
      continue;
     }
     // A slot that lost only some ships keeps the survivors and their cargo.
     const healed=repairPartialSlot({scene,store,systemID,slot,key,db,spawn,ensureState,
      minerIDs,haulerIDs});
     if(healed){
      minerIDs=healed.minerEntityIDs;
      haulerIDs=healed.haulerEntityIDs;
     }
     verifyActors({scene,store,systemID,slot,minerIDs,haulerIDs});
     // Validate ALL native rows before materializing ANY physical ship.
     let restored=0;
     for(const id of [...minerIDs,...haulerIDs]){
      if(scene.getEntityByID(id))continue;
      const out=nativeService.materializeStoredNativeController(scene,id,{broadcast:false});
      if(out?.success!==true||pos(scene.getEntityByID(id)?.itemID)!==id)
       throw Error("ALIFE08_NATIVE_RESTORE_FAILED:"+id);
      restored++;
     }
     verifyActors({scene,store,systemID,slot,minerIDs,haulerIDs});
     const registered=registerOnce({scene,store,getFleets,register,slot,minerIDs,haulerIDs,
      originAnchor:record.originAnchor||null});
     const pendingStationCargo=resumePendingStationCargo(scene,slot,haulerIDs);
     reports.push(result(restored?"RESTORED":registered?"RELINKED":"ALREADY_ACTIVE",slot,{
      minerIDs,haulerIDs,restored,pendingStationCargo,repaired:!!healed}));
    }catch(error){
     const reason=String(error?.message||error).slice(0,160);
     reports.push(result("NEEDS_OPERATOR_REPAIR",slot,{reason}));
     log("ALIFE08 slot "+key+" blocked: "+reason);
    }
   }
   for(const report of reports){
    const detail=["miners="+(report.minerIDs||[]).length,"haulers="+(report.haulerIDs||[]).length,
     report.reseededFrom||"",report.repaired?"repaired":"",report.reason||""]
     .filter(Boolean).join(" ");
    log("ALIFE08 slot "+systemID+"-"+report.slot+" -> "+report.status+" "+detail);
   }
   return {status:reports.some(x=>x.status==="NEEDS_OPERATOR_REPAIR")?
    "NEEDS_OPERATOR_REPAIR":"OK",systemID,slots:reports};
  }finally{busy.delete(systemID);}
 }
 return Object.freeze({start});
}
function start(args){
 const {scene,spawn,register,getFleets,ensureState,fleetCount}=args||{};
 return createService({db:require("../gameStore"),
   store:require("./npc/nativeNpcStore"),
   nativeService:require("./npc/nativeNpcService"),
   spawn,register,getFleets,ensureState,log:message=>console.warn("[ALIFE08]",message)
 }).start({scene,fleetCount});
}
module.exports={createService,start,roleMarker,slotKey,fleetIDForSlot};
