'use strict';
const F=require('./pf55-fixture.cjs');
const pf56=require('../native/coopPersonalFleetReturnDock.cjs');
const manifest={source:'ORIGINAL_EVEJS_ITEM_AND_CARGO_MANIFEST_V1',
 shipItemID:F.SHIP,ownerCharacterID:F.OWNER,assignmentID:F.ASSIGNMENT,
 actorGeneration:1,fittingHash:F.FIT,cargoHash:F.CARGO,cargoItemIDs:[],
 originalItemTitlesVerified:true,noUnrecordedCargo:true};
function command(extra={}){return {operationID:'pf56-return-1',assignmentID:F.ASSIGNMENT,
 ownerCharacterID:F.OWNER,pilotID:F.PILOT,shipItemID:F.SHIP,
 stationID:F.STATION,systemID:F.SYSTEM,reservationGeneration:1,
 actorGeneration:1,session:F.session,...extra};}
function returnProof(row){return {source:'EVEJS_ORIGINAL_PERSISTED_NPC_RETURN_V1',
 operationID:row.operationID,signature:row.signature,assignmentID:row.assignmentID,
 ownerCharacterID:row.ownerCharacterID,pilotID:row.pilotID,
 shipItemID:row.shipItemID,controllerEntityID:row.shipItemID,
 actorGeneration:row.actorGeneration,stationID:row.stationID,systemID:row.systemID,
 nativeOwner:'PERSONAL_FLEET',returnOrderPersisted:true,
 returnTargetVerified:true,noForeignCommand:true};}
function dockProof(row){return {source:'ORIGINAL_EVEJS_DOCK_COMPLETION_V1',
 operationID:row.operationID,signature:row.signature,assignmentID:row.assignmentID,
 ownerCharacterID:row.ownerCharacterID,pilotID:row.pilotID,
 shipItemID:row.shipItemID,stationID:row.stationID,systemID:row.systemID,
 actorGeneration:row.actorGeneration,originalItemStoreCommitted:true,
 nativeEntityAbsent:true,nativeControllerAbsent:true,
 noOtherLivePhysicalEntity:true,cargoAndFittingTitlesPreserved:true,
 sessionlessNativeDockReceiptPersisted:true};}
function arrival(row,options={}){
 return {source:'ORIGINAL_EVEJS_SCENE_STATION_V1',sceneEpoch:options.sceneEpoch||'boot-1',
 systemID:row.systemID,stationID:row.stationID,shipItemID:row.shipItemID,
 entityID:row.shipItemID,controllerEntityID:row.shipItemID,
 ownerCharacterID:row.ownerCharacterID,pilotID:row.pilotID,
 actorGeneration:row.actorGeneration,shipPosition:{x:100000,y:0,z:0},
 stationPosition:{x:101000,y:0,z:0},shipRadius:100,stationRadius:300,
 warpInactive:true,stationDockAccess:true,noDuplicatePhysicalEntity:true,
 nativeControllerPresent:true,shipStopped:true,...options};
}
function open(file){
 const f=F.open(file);
 Object.assign(f.shared,{returnCalls:0,dockCalls:0,returnIssued:true,
  docked:true,canArrive:true,arrivalOverride:null,arrivalSceneEpoch:'boot-1',
  manifestOverride:null,dockProofOverride:null,nativeReturnProof:true,
  nativeDockProof:true,flight:true,checkpoint:null,returnCallback:null,dockCallback:null});
 function nativeReturn(row){
  f.shared.returnCalls++;
  if(f.shared.returnCallback)return f.shared.returnCallback(row,f);
  if(f.shared.returnIssued)f.put('npcEntities','pf56-return:'+row.operationID,returnProof(row));
  return {success:f.shared.returnIssued};
 }
 function nativeDock(row){
  f.shared.dockCalls++;
  if(f.shared.dockCallback)return f.shared.dockCallback(row,f);
  if(f.shared.docked){
   f.gameStore.coopAtomicNativeRows.transact(['items'],tx=>{
    const root=tx.get('items','items'),item=root[String(row.shipItemID)];
    tx.put('items','items',{...root,[String(row.shipItemID)]:{
     ...item,locationID:row.stationID,flagID:4,spaceState:null}});
   });
   f.shared.scene=null;
   f.put('npcEntities','pf56-dock:'+row.operationID,dockProof(row));
  }
  return {success:f.shared.docked};
 }
 const opts={gameStore:f.gameStore,pf52:F.pf52,
  claimsPolicy:f.deps.claimsPolicy,access:f.deps.access,
  enabled:()=>f.shared.enabled,allWritersFenced:()=>f.shared.writers,
  clock:()=>f.shared.clock,verifyExclusiveOwnership:()=>f.shared.exclusive,
  verifyNativeFlight:()=>f.shared.flight&&f.shared.native&&
   f.shared.scene?.entityID===F.SHIP,
  verifyOriginalReturnOrder(row,tx){return f.shared.nativeReturnProof?
   tx.get('npcEntities','pf56-return:'+row.operationID):null;},
  verifyStationArrival(row){return f.shared.canArrive?
   (f.shared.arrivalOverride||arrival(row,{sceneEpoch:f.shared.arrivalSceneEpoch})):null;},
  verifyContinuousDwell(row){return {source:'ORIGINAL_EVEJS_CONTINUOUS_DOCK_DWELL_V1',
   shipItemID:row.shipItemID,stationID:row.stationID,systemID:row.systemID,
   sceneEpoch:f.shared.arrivalSceneEpoch,continuousSinceMs:row.arrivedAtMs,
   checkedAtMs:f.shared.clock,noDepartures:f.shared.canDwell!==false,
   nativeMonitorPersisted:f.shared.dwellPersisted!==false};},
  verifyOriginalManifest(row){return f.shared.manifestOverride||{...manifest}},
  verifyOriginalDockReceipt(row,tx){return f.shared.nativeDockProof?
   (f.shared.dockProofOverride||tx.get('npcEntities','pf56-dock:'+row.operationID)):null;},
  verifyFinalOriginalManifest(row){return f.shared.manifestOverride||{...manifest}},
  executeNativeReturn:nativeReturn,executeNativeDock:nativeDock};
 f.returnDock=pf56.createPersonalFleetReturnDock(opts);
 f.makeReady=()=>{f.makeActive();};
 f.returnCommand=command;
 f.progressToReturning=()=>{
  const c=command();let r=f.returnDock.requestReturn(c);
  if(r.status!=='NEEDS_RECONCILIATION')throw Error('REQUEST_RETURN_FAILED '+JSON.stringify(r));
  r=f.returnDock.confirmReturn(c);
  if(r.status!=='RETURNING')throw Error('CONFIRM_RETURN_FAILED '+JSON.stringify(r));
  return r;
 };
 f.progressToDockIntent=()=>{
  const c=command();f.progressToReturning();
  let r=f.returnDock.observeArrival(c);
  if(r.status!=='ARRIVAL_OBSERVED')throw Error('ARRIVAL_FAILED '+JSON.stringify(r));
  f.shared.clock+=2100;
  r=f.returnDock.requestDock(c);
  if(r.status!=='NEEDS_RECONCILIATION')throw Error('DOCK_REQUEST_FAILED '+JSON.stringify(r));
  return r;
 };
 return {...f,pf56,manifest,returnProof,dockProof,arrival};
}
module.exports={...F,pf56,command,open,returnProof,dockProof,arrival,manifest};
