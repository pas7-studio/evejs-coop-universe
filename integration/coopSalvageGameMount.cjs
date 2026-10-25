"use strict";
// Actual pinned EVE services mounted only by authenticated chat action.
// Never creates offers, pays ISK, or writes to a live world when feature OFF.
let singleton;
const deny=status=>({status});
function commandInGame(session,eventID,cargoID,action){
 if(process.env.EVEJS_COOP_SALVAGE_GAME!=="1")return deny("DISABLED");
 try{
  if(!singleton){
   const root=process.env.EVEJS_COOP_NPC_WAREHOUSE_DIR||
    "/var/lib/evejs/coop-native-warehouse";
   const store=require("./npc/nativeNpcStore");
   const items=require("../services/inventory/itemStore");
   const manifest=require("./coopNativeHaulManifest").createManifest({
    root,store,items,getNativeEntity:store.getNativeEntity});
   const ledger=require("./coopSalvageProvenance").createSalvageLedger({
    root,readManifest:manifest.read,
    getWreck:store.getNativeWreck,
    getWreckItems:store.listNativeWreckItemsForWreck,
    readOriginalCargo:id=>store.listNativeEntities().some(e=>
     store.listNativeCargoForEntity(e.entityID).some(x=>x.cargoID===id)),
    readWarehouseItem:id=>Object.values(items.getAllItems()).some(x=>
     x.customInfo==="coop-warehouse:v1:cargo:"+id||
     typeof x.customInfo==="string"&&
      x.customInfo.startsWith("coop-salvage:v1:")&&
      x.customInfo.split(":").at(-2)===String(id))
   });
   const atomic=require("../gameStore").coopAtomicNativeRows;
   singleton=require("./coopSalvageGameAuthority").createSalvageGameAuthority({
    readEvent:id=>require("./coopWorldOpportunityBoard").readNativeEvent(id),
    readFlight:id=>require("./coopEscortNativeBinding").routeGate().readFlight(id),
    readManifest:manifest.read,
    readVolunteers:id=>require("./coopEscortVolunteers").readVerifiedNativePair(id),
    readOutcomes:()=>require("./coopConvoyOutcomeProof").createOutcomes().snapshot(),
    ledger,
    readScene:s=>require("./runtime").getSceneForSession(s),
    readPlayerShip:s=>{
     const target=s?._space?.shipID||
      items.getActiveShipItem(s.characterID)?.itemID;
     return items.findItemById(target);
    },
    readDockedStation:s=>require("../services/structure/structureLocation")
     .getSessionStationID(s),
    getSessions:()=>require("../services/chat/sessionRegistry").getSessions(),
    createTransfer:({verifyPickupPresence,verifyDocking})=>
     require("./coopSalvageNativeTransfer").createNativeSalvageTransfer({
      atomic,readWitness:ledger.read,readManifest:manifest.read,
      readOriginalWreckItem:store.getNativeWreckItem,
      listNativeItems:()=>Object.values(items.getAllItems()),
      buildInventoryItem:items.buildInventoryItem,
      verifyPickupPresence,verifyDocking
     })
   });
  }
  return singleton.command({session,eventID,cargoID:Number(cargoID),action});
 }catch{return deny("SALVAGE_PINNED_NATIVE_MOUNT_UNAVAILABLE")}
}
module.exports={commandInGame};
