'use strict';
const F=require('./pf54-fixture.cjs');
const api=require('../native/coopPersonalFleetOriginalShipHandoff.cjs');
function setup(file, opts={}){
 const f=F.open(file),c=F.command();
 const state={attempts:0,adoptions:0,auth:true,writers:true,sessionFree:true,physicalFree:true,
   exclusive:true,stationValid:true,equipmentValid:true,allowMove:true,allowAdopt:true,
   directProof:true,beforeMove:null,afterMove:null,beforeAdopt:null,afterAdopt:null,
   station:{systemID:F.SYSTEM,stationID:F.STATION,position:{x:10,y:20,z:30},
     direction:{x:1,y:0,z:0},sessionless:true}};
 const native={
  verifyStationAndUndock(){return state.stationValid?structuredClone(state.station):null;},
  noActivePlayerSession(){return state.sessionFree;},
  noExistingPhysicalActor(){return state.physicalFree&&!f.shared.scene;},
  moveOriginalShipToSpace(row,spawn){
   state.attempts++;
   state.beforeMove?.(row,spawn);
   if(!state.allowMove)return {success:false,errorMsg:'SOURCE_REFUSED'};
   const moved=f.gameStore.coopAtomicNativeRows.transact(['items'],tx=>{
    const items=tx.get('items','items'),source=items?.[String(row.shipItemID)];
    if(!source||source.locationID!==row.stationID||source.flagID!==4)
      throw Error('SOURCE_CHANGED');
    tx.put('items','items',{...items,[String(row.shipItemID)]:{...source,
      locationID:row.systemID,flagID:0,spaceState:{systemID:row.systemID,
       position:spawn.position,velocity:{x:0,y:0,z:0},direction:spawn.direction,mode:'STOP'}}});
    return true;
   });
   state.afterMove?.(row,spawn);
   return {success:moved};
  },
  readOriginalShip(shipID){return f.get('items','items')?.[String(shipID)]||null;},
  adoptOriginalShipAsNpc(row,stock){
   state.adoptions++;
   state.beforeAdopt?.(row,stock);
   if(!state.allowAdopt)return {success:false,errorMsg:'NATIVE_REFUSED'};
   if(stock.itemID!==row.shipItemID)throw Error('WRONG_ID');
   f.shared.scene={nativeNpc:true,shipItemID:row.shipItemID,entityID:row.shipItemID,
    controllerEntityID:row.shipItemID,ownerCharacterID:row.ownerCharacterID,
    pilotID:row.pilotID,systemID:row.systemID,assignmentID:row.assignmentID,
    generation:row.generation,alive:true,noDuplicatePhysicalEntity:true,
    fittingHash:row.fittingHash,cargoHash:row.cargoHash};
   state.afterAdopt?.(row,stock);
   return {success:true};
  },
  inspectOriginalActor(row){
   if(!state.directProof)return null;
   const s=f.shared.scene;
   return s?{originalShipItemID:s.shipItemID,entityID:s.entityID,
    controllerEntityID:s.controllerEntityID,ownerCharacterID:s.ownerCharacterID,
    pilotID:s.pilotID,systemID:s.systemID,assignmentID:s.assignmentID,
    generation:s.generation,uniquePhysicalEntity:s.noDuplicatePhysicalEntity,
    noNewItemIDs:true,originalFittingsUnchanged:true,originalCargoUnchanged:true,
    fittingHash:s.fittingHash,cargoHash:s.cargoHash}:null;
  }
 };
 const handoff=api.createOriginalShipHandoff({gameStore:f.gameStore,pf52:F.pf52,native,
  enabled:()=>f.shared.enabled&&state.auth,allWritersFenced:()=>f.shared.writers&&state.writers,
  verifyExclusive:()=>f.shared.exclusive&&state.exclusive,
  verifyOriginalEquipment:()=>state.equipmentValid?{fittingHash:f.shared.fittingHash,
    cargoHash:f.shared.cargoHash}:null,clock:()=>f.shared.clock});
 f.shared.onHandoff=row=>handoff.execute(row);
 return {...f,c,handoff,native,state,F,api,
  prepare(){f.seed();f.onboard();const p=f.bridge.prepare(c);
   if(p.status!=='PREPARED')throw Error('PF54_PREPARE_FAILED '+JSON.stringify(p));},
  pending(){const res=f.bridge.dispatch(c);return res;}
 };
}
module.exports={setup,F,api};
