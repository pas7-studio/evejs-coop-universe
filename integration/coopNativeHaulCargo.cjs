"use strict";
// Real EveJS native cargo identity is preserved from miner to hauler.
// A durable PREPARED receipt is mandatory BEFORE native hauler unloading.
// Never credit virtual supply or station inventory unless cargo removal was
// confirmed. An interrupted intent remains visible for operator repair.
const positive=v=>Number.isSafeInteger(Number(v))&&Number(v)>0?Number(v):null;
const mineable=x=>positive(x?.cargoID)&&positive(x?.typeID)&&Number.isSafeInteger(Number(x.quantity))&&Number(x.quantity)>0&&Number(x.moduleID||0)===0;
const haulFlag="coopHaulFleetID";
function dependenciesOf(options={}){
 return {store:options.store||require("./npc/nativeNpcStore"),
 probe:options.probe||require("./coopRuntimeProbe"),
 depot:options.depot||(
  process.env.EVEJS_COOP_NATIVE_HAUL_CARGO==="1"
  ?require("./coopNativeDepot").getNativeDepot():null)};
}
function transferCargo(scene,fleet,miner,options={}){
 try{
  if(!scene||!positive(miner?.itemID)||!positive(fleet?.fleetID))return 0;
  const {store,probe}=dependenciesOf(options);
  const hauler=(fleet.haulerEntityIDs||[]).map(id=>scene.getEntityByID(Number(id)))
    .find(x=>x?.kind==="ship"&&positive(x.itemID)&&x.itemID!==miner.itemID);
  if(!hauler)return 0;
  const items=(store.listNativeCargoForEntity(miner.itemID)||[]).filter(mineable);
  let moved=0,quantity=0,volume=0;
  for(const item of items){
   const cached=(miner.nativeCargoItems||[]).find(x=>Number(x.itemID)===Number(item.cargoID));
   const amount=Math.max(0,Number(item.quantity)||0);
   const durable=process.env.EVEJS_COOP_NPC_STATION_DELIVERY==="1"&&hauler.transient!==true;
   const result=store.upsertNativeCargo({
    ...item,transient:durable?false:item.transient,entityID:Number(hauler.itemID),
    ownerID:positive(hauler.ownerID)||positive(item.ownerID)||0,
    [haulFlag]:Number(fleet.fleetID),
    coopHaulFromMinerID:Number(miner.itemID),
    coopHaulLoadedAt:Date.now()
   },{transient:durable?true:hauler.transient===true});
   if(!result?.success)continue;
   if(durable){
    // A transient miner's cargoID is transient-marked in native GameStore.
    // Reparent the SAME cargoID, clear its transient path and flush npcCargo.
    const repo=options.database||require("../gameStore");
    repo.setTransientPath("npcCargo",`/cargo/${Number(item.cargoID)}`,false);
    if(repo.flushTableSync("npcCargo")?.success!==true){
     probe.observe("living-hauler-cargo-persist-failed",null,
      {itemID:hauler.itemID,spaceState:{systemID:fleet.systemID}},
      {fleetID:fleet.fleetID,cargoID:item.cargoID});
     continue;
    }
   }
   // Re-read the authoritative cargo before removing the in-memory mirror.
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
 }catch(error){console.warn("[CoopHaul] transfer",error.message);return 0;}
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