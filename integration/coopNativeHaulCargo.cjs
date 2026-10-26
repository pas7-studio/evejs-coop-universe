"use strict";
// Real EveJS native cargo identity is preserved from miner to hauler.
// A durable PREPARED receipt is mandatory BEFORE native hauler unloading.
// Never credit virtual supply or station inventory unless cargo removal was
// confirmed. An interrupted intent remains visible for operator repair.
const positive=v=>Number.isSafeInteger(Number(v))&&Number(v)>0?Number(v):null;
const mineable=x=>positive(x?.cargoID)&&positive(x?.typeID)&&Number.isSafeInteger(Number(x.quantity))&&Number(x.quantity)>0&&Number(x.moduleID||0)===0;
const haulFlag="coopHaulFleetID";
const {promote:durableCargo}=require("./coopDurableCargoWrite");
function dependenciesOf(options={}){
 return {store:options.store||require("./npc/nativeNpcStore"),
 probe:options.probe||require("./coopRuntimeProbe"),
 depot:options.depot||(
  process.env.EVEJS_COOP_NATIVE_HAUL_CARGO==="1"
  ?require("./coopNativeDepot").getNativeDepot():null)};
}
// Chat 16: opt-in, conservative physical custody transfer for persistent NPCs.
// Uses the SAME original nativeNpcStore cargoID and an original GameStore flush.
// It never allocates cargo or credits virtual/station stock. Unknown outcomes
// quarantine both actors instead of replaying a possibly committed transfer.
const strictInFlight=new Set();
const integer=x=>typeof x==="number"&&Number.isSafeInteger(x)&&x>0;
const vector=x=>x&&["x","y","z"].every(k=>Number.isFinite(x[k]));
const isWarping=x=>Boolean(x?.isWarping||x?.pendingWarp||x?.warpState||
 String(x?.mode||"").toUpperCase()==="WARP");
function strictTransferCargo(scene,fleet,miner,options,store,probe){
 const stop=(reason,uncertain=false,hauler=null,cargoID=0)=>{
  if(uncertain){
   miner.coopHaulNeedsOperatorRepair=reason;
   miner.coopHaulCargoNeedsOperatorRepair=reason;
   miner.coopMiningCargoNeedsOperatorRepair=reason;
   fleet.coopHaulNeedsOperatorRepair=reason;
   fleet.coopHaulCargoNeedsOperatorRepair=reason;
   if(hauler)hauler.coopHaulNeedsOperatorRepair=reason;
  }
  try{probe.observe("living-haul-custody-blocked",null,
   {itemID:miner.itemID,spaceState:{systemID:scene?.systemID}},
   {fleetID:fleet?.fleetID,cargoID,reason,operatorRepairRequired:uncertain,nativeMutation:false});}
  catch(_){} // Telemetry cannot affect custody.
  return 0;
 };
 if(process.env.EVEJS_COOP_NATIVE_HAUL_CARGO!=="1"||
  process.env.EVEJS_COOP_NPC_STATION_DELIVERY!=="1"||
  process.env.EVEJS_COOP_NATIVE_MINING_CYCLE_ATOMIC!=="1")
  return stop("HAUL_NATIVE_PERSISTENCE_FLAGS_REQUIRED");
 const atomicRequired=process.env.EVEJS_COOP_NATIVE_MINING_FLEET_DURABLE==="1"&&
   typeof fleet?.startupKey==="string"&&fleet.startupKey.length>0;
 if(atomicRequired&&process.env.EVEJS_COOP_NATIVE_HAUL_TRANSFER_ATOMIC!=="1")
  return stop("ALIFE10_ATOMIC_HAUL_REQUIRED",true);
 const systemID=Number(scene?.systemID),fleetID=Number(fleet?.fleetID);
 const minerID=Number(miner?.itemID),minerOwner=Number(miner?.ownerID);
 if(![systemID,fleetID,minerID,minerOwner].every(integer)||
  !Array.isArray(fleet?.minerEntityIDs)||!fleet.minerEntityIDs.includes(minerID)||
  !Array.isArray(fleet?.haulerEntityIDs)||fleet.haulerEntityIDs.length<1||
  fleet.haulerEntityIDs.length>32||new Set(fleet.haulerEntityIDs).size!==fleet.haulerEntityIDs.length||
  Number(fleet.systemID)!==systemID||miner?.kind!=="ship"||miner?.nativeNpc!==true||
  miner.transient!==false||miner.coopHaulNeedsOperatorRepair||
  fleet.coopHaulNeedsOperatorRepair||
  scene.getEntityByID?.(minerID)!==miner||isWarping(miner)||
  miner.destroyed===true||miner.isDestroyed===true||!vector(miner.position))
  return stop("HAUL_MINER_NOT_PHYSICALLY_ATTESTED");
 if(typeof store.getNativeEntity!=="function"||
  typeof store.listNativeCargoForEntity!=="function"||
  typeof store.listNativeCargo!=="function"||
  typeof store.upsertNativeCargo!=="function"||
  typeof store.buildNativeCargoItems!=="function")
  return stop("HAUL_NATIVE_STORE_UNAVAILABLE");
 const originalMiner=store.getNativeEntity(minerID);
 if(!originalMiner||Number(originalMiner.entityID)!==minerID||
  Number(originalMiner.ownerID)!==minerOwner||Number(originalMiner.systemID)!==systemID||
  originalMiner.transient!==false)return stop("HAUL_MINER_NATIVE_IDENTITY_CONFLICT");
 const resolveType=options.resolveItemByTypeID||
  require("../services/inventory/itemTypeRegistry").resolveItemByTypeID;
 if(typeof resolveType!=="function")return stop("HAUL_SDE_UNAVAILABLE");
 let source,all;
 try{source=store.listNativeCargoForEntity(minerID);all=store.listNativeCargo();}
 catch(_){return stop("HAUL_CARGO_PREIMAGE_UNAVAILABLE");}
 if(!Array.isArray(source)||!Array.isArray(all)||source.length>1000||
  !Array.isArray(miner.nativeCargoItems))return stop("HAUL_CARGO_PREIMAGE_INVALID");
 const cached=new Map(miner.nativeCargoItems.map(x=>[Number(x?.itemID),x]));
 const seen=new Set(),cargo=[];
 for(const item of source){
  const key=Number(item?.cargoID),local=cached.get(key);
  if(!integer(key)||seen.has(key)||!integer(Number(item?.typeID))||
    !integer(Number(item?.quantity))||Number(item?.quantity)>1000000000||
    Number(item?.entityID)!==minerID||Number(item?.ownerID)!==minerOwner||
    Number(item?.moduleID||0)!==0||item.transient!==false||
    Number(item?.categoryID)!==25||
    Number(item?.coopHaulFleetID||0)!==0||
    !local||Number(local.typeID)!==Number(item.typeID)||
    Number(local.quantity)!==Number(item.quantity)||
    all.filter(x=>Number(x?.cargoID)===key).length!==1)
   return stop("HAUL_SOURCE_CARGO_IDENTITY_CONFLICT");
  seen.add(key);
  const ore=resolveType(Number(item.typeID));
  const volume=Number(ore?.volume);
  if(!ore||Number(ore.typeID)!==Number(item.typeID)||
     Number(ore.categoryID)!==25||!Number.isFinite(volume)||volume<=0)
   return stop("HAUL_ORE_VOLUME_UNVERIFIED");
  cargo.push({item,volume:volume*Number(item.quantity)});
 }
 if(!cargo.length){
  if(miner.nativeCargoItems.some(x=>Number(x?.moduleID||0)===0))
   return stop("HAUL_LOCAL_CARGO_WITHOUT_NATIVE_SOURCE",true);
  return 0;
 }
 const db=atomicRequired?null:(options.database||require("../gameStore"));
 if(!atomicRequired&&(!db||typeof db.setTransientPath!=="function"||
  typeof db.flushTableSync!=="function"))return stop("HAUL_GAMESTORE_UNAVAILABLE");
 let totalMoved=0,quantity=0,count=0;
 // Pick the first physical, in-range hull with VERIFIED remaining capacity;
 // never merge, split, or invent an ore stack to satisfy a capacity deficit.
 for(const {item,volume} of cargo){
  let selected=null;
  for(const haulerID of fleet.haulerEntityIDs){
   if(!integer(haulerID)||haulerID===minerID)continue;
   const ship=scene.getEntityByID(haulerID),native=store.getNativeEntity(haulerID);
   if(!ship||ship.itemID!==haulerID||ship.kind!=="ship"||
    ship.nativeNpc!==true||ship.transient!==false||ship.coopHaulNeedsOperatorRepair||
    ship.destroyed===true||ship.isDestroyed===true||isWarping(ship)||
    !vector(ship.position)||Number(ship.ownerID)!==minerOwner||
    !native||Number(native.entityID)!==haulerID||Number(native.ownerID)!==minerOwner||
    Number(native.systemID)!==systemID||native.transient!==false)continue;
   const range=Math.max(0,Math.hypot(
    miner.position.x-ship.position.x,miner.position.y-ship.position.y,
    miner.position.z-ship.position.z)-Math.max(0,Number(miner.radius)||0)-
    Math.max(0,Number(ship.radius)||0));
   if(!Number.isFinite(range)||range>2500)continue;
   const hull=resolveType(Number(ship.typeID));
   const capacity=Number(options.resolveCargoCapacityM3?
    options.resolveCargoCapacityM3(ship,hull):hull?.capacity);
   if(!Number.isFinite(capacity)||capacity<=0)continue;
   const existing=store.listNativeCargoForEntity(haulerID);
   if(!Array.isArray(existing)||existing.length>1000)continue;
   let used=0,valid=true;
   for(const row of existing){
    const type=resolveType(Number(row?.typeID));
    const unit=Number(type?.volume);
    if(!integer(Number(row?.cargoID))||!integer(Number(row?.quantity))||
      Number(row?.entityID)!==haulerID||Number(row?.ownerID)!==minerOwner||
      row.transient!==false||!Number.isFinite(unit)||unit<=0){valid=false;break;}
    used+=unit*Number(row.quantity);
   }
   if(valid&&Number.isFinite(used)&&used+volume<=capacity+1e-6){selected=ship;break;}
  }
  if(!selected)continue; // Leave the original persistent cargo on the miner.
  const cargoID=Number(item.cargoID),key=systemID+":"+cargoID;
  if(strictInFlight.has(key))return stop("HAUL_TRANSFER_REENTRANT",true,selected,cargoID);
  strictInFlight.add(key);
  try{
   if(atomicRequired){
    // Keep all upstream physical range, capacity, and original ore type guards.
    // Only the final native cargo reparent is made transactional.
    const atomic=options.atomicMover||require("./coopNativeHaulTransferAtomic");
    const result=atomic.transfer({scene,fleet,miner,hauler:selected,cargoID});
    if(result?.status!=="COMMITTED")
     return stop("ALIFE10_"+String(result?.reason||result?.status||"UNKNOWN"),true,selected,cargoID);
    if(Number(result.quantity)!==Number(item.quantity)||
       !Number.isFinite(result.volumeM3)||
       Math.abs(result.volumeM3-volume)>1e-6)
     return stop("ALIFE10_AFTER_COMMIT_VOLUME_CONFLICT",true,selected,cargoID);
   }else{
    const updated={...item,cargoID,entityID:selected.itemID,
     ownerID:minerOwner,transient:false,[haulFlag]:fleetID,
     coopHaulFromMinerID:minerID,coopHaulSystemID:Number(scene.systemID),
     coopHaulLoadedAt:Date.now()};
    const promoted=durableCargo({store,database:options.database,cargoID,row:updated});
    // An unsuccessful ACK does not establish that nothing was written.
    if(promoted.status==="UPSERT_REJECTED"||promoted.status==="UPSERT_UNCERTAIN")
     return stop("HAUL_SOURCE_MOVE_UNCERTAIN",true,selected,cargoID);
    if(promoted.status!== "DURABLE")
     return stop("HAUL_SOURCE_FLUSH_UNCERTAIN",true,selected,cargoID);
    const after=store.listNativeCargo();
    const hits=Array.isArray(after)?after.filter(x=>Number(x?.cargoID)===cargoID):[];
    if(hits.length!==1||Number(hits[0].entityID)!==selected.itemID||
       Number(hits[0].ownerID)!==minerOwner||Number(hits[0].typeID)!==Number(item.typeID)||
       Number(hits[0].quantity)!==Number(item.quantity)||
       Number(hits[0][haulFlag])!==fleetID||
       Number(hits[0].coopHaulFromMinerID)!==minerID||hits[0].transient!==false||
       store.listNativeCargoForEntity(minerID).some(x=>Number(x?.cargoID)===cargoID))
     return stop("HAUL_POSTCOMMIT_IDENTITY_UNKNOWN",true,selected,cargoID);
    miner.nativeCargoItems=miner.nativeCargoItems.filter(x=>Number(x.itemID)!==cargoID);
    selected.nativeCargoItems=store.buildNativeCargoItems(selected.itemID);
   }
   totalMoved+=volume;quantity+=Number(item.quantity);count++;
  }catch(_){return stop("HAUL_TRANSFER_OUTCOME_UNKNOWN",true,selected,cargoID);}
  finally{strictInFlight.delete(key);}
 }
 if(count){
  try{probe.observe("living-hauler-loaded",null,
   {itemID:miner.itemID,spaceState:{systemID}},
   {fleetID,minerID,stacks:count,cargoQuantity:quantity,volumeM3:totalMoved,
    verifiedNativeCargo:true});}catch(_){}
 }
 return totalMoved;
}
function transferCargo(scene,fleet,miner,options={}){
 try{
  if(!scene||!positive(miner?.itemID)||!positive(fleet?.fleetID))return 0;
  const {store,probe}=dependenciesOf(options);
  const durableRequired=process.env.EVEJS_COOP_NATIVE_MINING_FLEET_DURABLE==="1"&&
    miner?.transient===false&&typeof fleet?.startupKey==="string"&&
    fleet.startupKey.length>0;
  if(durableRequired||process.env.EVEJS_COOP_NATIVE_HAUL_TRANSFER_GUARD==="1")
   return strictTransferCargo(scene,fleet,miner,options,store,probe);
  const hauler=(fleet.haulerEntityIDs||[]).map(id=>scene.getEntityByID(Number(id)))
    .find(x=>x?.kind==="ship"&&positive(x.itemID)&&x.itemID!==miner.itemID);
  if(!hauler)return 0;
  const items=(store.listNativeCargoForEntity(miner.itemID)||[]).filter(mineable);
  let moved=0,quantity=0,volume=0;
  for(const item of items){
   const cached=(miner.nativeCargoItems||[]).find(x=>Number(x.itemID)===Number(item.cargoID));
   const amount=Number(item.quantity);
   // Restart resilience: a transient hauler's haul cargo is persisted too when
   // the adoption feature is on, so a restart can re-attach it to the next
   // hauler of the same slot instead of losing the ore. Without the flag the
   // conservative behaviour is unchanged.
   const durable=process.env.EVEJS_COOP_NPC_STATION_DELIVERY==="1"&&
     (hauler.transient!==true||process.env.EVEJS_COOP_HAUL_CARGO_ADOPTION==="1");
   const next={...item,transient:durable?false:item.transient,entityID:Number(hauler.itemID),
    ownerID:positive(hauler.ownerID)||positive(item.ownerID)||0,
    [haulFlag]:Number(fleet.fleetID),coopHaulFromMinerID:Number(miner.itemID),
    coopHaulSystemID:Number(fleet.systemID),coopHaulLoadedAt:Date.now()};
   if(durable){
    // Promotes the SAME cargoID and removes its previous transient marker
    // before synchronous durability, never creating a second ore stack.
    const promoted=durableCargo({store,database:options.database,
     cargoID:item.cargoID,row:next});
    if(promoted.status!=="DURABLE"){
     probe.observe("living-hauler-cargo-persist-failed",null,
      {itemID:hauler.itemID,spaceState:{systemID:fleet.systemID}},
      {fleetID:fleet.fleetID,cargoID:item.cargoID,status:promoted.status});
     continue;
    }
   }else if(!store.upsertNativeCargo(next,{transient:hauler.transient===true})?.success)continue;
   if(!(store.listNativeCargoForEntity(hauler.itemID)||[]).some(x=>Number(x.cargoID)===Number(item.cargoID)))continue;
   miner.nativeCargoItems=(miner.nativeCargoItems||[]).filter(x=>Number(x.itemID)!==Number(item.cargoID));
   quantity+=amount;volume+=amount*Math.max(0,Number(cached?.volume)||0);moved++;
  }
  if(moved){
   hauler.nativeCargoItems=store.buildNativeCargoItems(hauler.itemID);
   probe.observe("living-hauler-loaded",null,{itemID:hauler.itemID,spaceState:{systemID:fleet.systemID}},
    {fleetID:fleet.fleetID,minerID:miner.itemID,haulerID:hauler.itemID,
     stacks:moved,cargoQuantity:quantity,volumeM3:volume});
  }
  return volume;
 }catch(error){
  if(miner?.transient===false&&process.env.EVEJS_COOP_NATIVE_MINING_FLEET_DURABLE==="1"){
   const reason="ALIFE10_UNEXPECTED_HAUL_OUTCOME";
   miner.coopMiningCargoNeedsOperatorRepair=reason;
   miner.coopHaulNeedsOperatorRepair=reason;
   fleet.coopHaulNeedsOperatorRepair=reason;
  }
  console.warn("[CoopHaul] transfer",error.message);return 0;
 }
}
function unloadCargo(scene,fleet,options={}){
 try{
  if(!scene||!positive(fleet?.fleetID)||!positive(fleet?.systemID))return {status:"INVALID",stacks:0};
  const {store,probe,depot}=dependenciesOf(options);
  // No depot -> no removal. Do not silently destroy NPC ore.
  if(!depot||typeof depot.prepare!=="function"||typeof depot.commit!=="function")
   return {status:"BLOCKED_DEPOT_UNAVAILABLE",stacks:0};
  let stacks=0,quantity=0,volumeM3=0,blocked=0;
  for(const rawID of fleet.haulerEntityIDs||[]){
   const hauler=scene.getEntityByID(Number(rawID));
   if(hauler?.kind!=="ship")continue;
   const manifest=(store.listNativeCargoForEntity(hauler.itemID)||[])
    .filter(x=>mineable(x)&&Number(x[haulFlag])===Number(fleet.fleetID));
   for(const item of manifest){
    const delivery={cargoID:Number(item.cargoID),typeID:Number(item.typeID),
      quantity:Number(item.quantity),fromMinerID:positive(item.coopHaulFromMinerID),
      haulerID:Number(hauler.itemID)};
    let prepared;
    try{prepared=depot.prepare({systemID:fleet.systemID,fleetID:fleet.fleetID,item:delivery});}
    catch(error){console.warn("[CoopHaul] cannot durably prepare",error.message);blocked++;continue;}
    if(prepared?.status!=="PREPARED"){blocked++;continue;}
    const cached=(hauler.nativeCargoItems||[]).find(x=>Number(x.itemID)===Number(item.cargoID));
    const removed=store.removeNativeCargo(item.cargoID);
    if(!removed?.success){blocked++;continue;}
    // Prevent a false credit when the source row still exists.
    if((store.listNativeCargoForEntity(hauler.itemID)||[]).some(x=>Number(x.cargoID)===Number(item.cargoID))){blocked++;continue;}
    let committed;
    try{committed=depot.commit({systemID:fleet.systemID,fleetID:fleet.fleetID,item:delivery});}
    catch(error){console.warn("[CoopHaul] NEEDS_REPAIR: removed cargo with pending receipt",error.message);blocked++;continue;}
    if(committed?.status!=="COMMITTED"){blocked++;continue;}
    stacks++;quantity+=delivery.quantity;volumeM3+=delivery.quantity*Math.max(0,Number(cached?.volume)||0);
   }
   hauler.nativeCargoItems=store.buildNativeCargoItems(hauler.itemID);
  }
  if(stacks)probe.observe("living-hauler-delivered",null,{spaceState:{systemID:fleet.systemID}},
    {fleetID:fleet.fleetID,stacks,quantity,volumeM3,destination:"durable-virtual-depot",blocked});
  return {status:blocked?"NEEDS_REPAIR":stacks?"DELIVERED":"NO_CARGO",stacks,quantity,volumeM3,blocked};
 }catch(error){console.warn("[CoopHaul] unload",error.message);return {status:"ERROR",stacks:0};}
}
module.exports={transferCargo,unloadCargo,haulFlag};
