"use strict";
// Move real mined EveJS NPC ore stacks onto an actual native hauler entity.
// Wreck service then drops the hauler's native cargo if players destroy it.
const positive=v=>Number.isSafeInteger(Number(v))&&Number(v)>0?Number(v):null;
function transferCargo(scene,fleet,miner,dependencies={}){
 try{
  if(!scene||!miner?.itemID)return 0;
  const store=dependencies.store||require("./npc/nativeNpcStore");
  const hauler=(fleet?.haulerEntityIDs||[]).map(id=>scene.getEntityByID(Number(id)))
   .find(e=>e?.kind==="ship"&&e.itemID!==miner.itemID);
  if(!hauler)return 0; // Without a real hauler cargo stays on the miner.
  const source=(store.listNativeCargoForEntity(miner.itemID)||[])
   .filter(x=>positive(x.cargoID)&&positive(x.typeID)&&Number(x.quantity)>0&&Number(x.moduleID||0)===0);
  let volume=0,moved=0;
  for(const item of source){
   // Reparent the SAME native cargo item: no new items or made-up resource.
   const result=store.upsertNativeCargo({...item,
     entityID:Number(hauler.itemID),
     ownerID:Number(hauler.ownerID||item.ownerID||0)
   },{transient:hauler.transient===true});
   if(result?.success!==true){console.warn("[CoopHaul] cargo transfer failed",item.cargoID,result?.errorMsg);continue;}
   const cached=(miner.nativeCargoItems||[]).find(x=>Number(x.itemID)===Number(item.cargoID));
   volume+=Math.max(0,Number(item.quantity)||0)*Math.max(0,Number(cached?.volume)||0);
   miner.nativeCargoItems=(miner.nativeCargoItems||[]).filter(x=>Number(x.itemID)!==Number(item.cargoID));
   moved++;
  }
  if(moved){
   hauler.nativeCargoItems=store.buildNativeCargoItems(hauler.itemID);
   (dependencies.probe||require("./coopRuntimeProbe")).observe("living-hauler-loaded",null,
    {itemID:hauler.itemID,spaceState:{systemID:fleet.systemID}},
    {fleetID:fleet.fleetID,minerID:miner.itemID,stacks:moved,cargoQuantity:source.reduce((n,x)=>n+Number(x.quantity||0),0)});
  }
  return volume;
 }catch(error){console.warn("[CoopHaul] transfer",error.message);return 0;}
}
function unloadCargo(scene,fleet,dependencies={}){
 try{
  if(!scene||!fleet)return;
  const store=require("./npc/nativeNpcStore");
  let stacks=0,quantity=0,volumeM3=0;
  for(const rawID of fleet.haulerEntityIDs||[]){
   const hauler=scene.getEntityByID(Number(rawID));
   if(!hauler)continue;
   for(const item of store.listNativeCargoForEntity(hauler.itemID)||[]){
    if(!positive(item.cargoID)||Number(item.moduleID||0)>0)continue;
    const cached=(hauler.nativeCargoItems||[]).find(x=>Number(x.itemID)===Number(item.cargoID));
    const result=store.removeNativeCargo(item.cargoID);
    if(result?.success!==true)continue;
    stacks++;
    quantity+=Number(item.quantity)||0;
    volumeM3+=Math.max(0,Number(item.quantity)||0)*Math.max(0,Number(cached?.volume)||0);
   }
   hauler.nativeCargoItems=store.buildNativeCargoItems(hauler.itemID);
  }
  if(stacks)(dependencies.probe||require("./coopRuntimeProbe")).observe("living-hauler-delivered",null,
   {spaceState:{systemID:fleet.systemID}},{
    fleetID:fleet.fleetID,stacks,quantity,volumeM3,
    // Delivery is currently a virtual depot, NOT a real market order.
    destination:"virtual-depot"
   });
 }catch(error){console.warn("[CoopHaul] unload",error.message);}
}
module.exports={transferCargo,unloadCargo};
