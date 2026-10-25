"use strict";
// Native EveJS cargo custody: transfer the SAME ore item IDs to a real
// hauling ship. Unload only items this fleet actually picked up.
// Avoid writing fake inventory, fake wrecks or mining yields.
const positive=v=>Number.isSafeInteger(Number(v))&&Number(v)>0?Number(v):null;
const mineable=x=>positive(x?.cargoID)&&positive(x?.typeID)&&Number(x.quantity)>0&&Number(x.moduleID||0)===0;
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
  if(!hauler)return 0; // Never erase an ore stack if the ship cannot receive it.
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
   quantity+=amount;
   volume+=amount*Math.max(0,Number(cached?.volume)||0);
   moved++;
  }
  if(moved){
   hauler.nativeCargoItems=store.buildNativeCargoItems(hauler.itemID);
   probe.observe("living-hauler-loaded",null,
    {itemID:hauler.itemID,spaceState:{systemID:fleet.systemID}},
    {fleetID:fleet.fleetID,minerID:miner.itemID,haulerID:hauler.itemID,
     stacks:moved,cargoQuantity:quantity,volumeM3:volume});
  }
  return volume;
 }catch(error){console.warn("[CoopHaul] transfer",error.message);return 0;}
}
function unloadCargo(scene,fleet,options={}){
 try{
  if(!scene||!positive(fleet?.fleetID))return {status:"INVALID",stacks:0};
  const {store,probe,depot}=dependenciesOf(options);
  let stacks=0,quantity=0,volumeM3=0;
  const deliveries=[];
  for(const rawID of fleet.haulerEntityIDs||[]){
   const hauler=scene.getEntityByID(Number(rawID));
   if(hauler?.kind!=="ship")continue;
   const manifest=(store.listNativeCargoForEntity(hauler.itemID)||[])
    .filter(x=>mineable(x)&&Number(x[haulFlag])===Number(fleet.fleetID));
   for(const item of manifest){
    const cached=(hauler.nativeCargoItems||[]).find(x=>Number(x.itemID)===Number(item.cargoID));
    const removed=store.removeNativeCargo(item.cargoID);
    if(!removed?.success)continue;
    const amount=Number(item.quantity);
    stacks++;quantity+=amount;
    volumeM3+=amount*Math.max(0,Number(cached?.volume)||0);
    deliveries.push({cargoID:Number(item.cargoID),typeID:Number(item.typeID),
     quantity:amount,fromMinerID:positive(item.coopHaulFromMinerID),haulerID:Number(hauler.itemID)});
   }
   hauler.nativeCargoItems=store.buildNativeCargoItems(hauler.itemID);
  }
  if(stacks){
   // A virtual depot RECEIPT is not an EveJS station inventory deposit.
   if(depot)try{depot.record({systemID:fleet.systemID,fleetID:fleet.fleetID,deliveries});}
    catch(error){console.warn("[CoopHaul] depot receipt",error.message);}
   probe.observe("living-hauler-delivered",null,{spaceState:{systemID:fleet.systemID}},
    {fleetID:fleet.fleetID,stacks,quantity,volumeM3,destination:"virtual-depot"});
  }
  return {status:stacks?"DELIVERED":"NO_CARGO",stacks,quantity,volumeM3};
 }catch(error){console.warn("[CoopHaul] unload",error.message);return {status:"ERROR",stacks:0};}
}
module.exports={transferCargo,unloadCargo,haulFlag};
