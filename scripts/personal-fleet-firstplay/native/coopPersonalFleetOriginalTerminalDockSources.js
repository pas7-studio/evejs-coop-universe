'use strict';
/** Original server-only PF60/PF61 DOCK sources; no client supplied evidence. */
const crypto=require('node:crypto');
const stock=require('../services/inventory/itemStore');
const store=require('./npc/nativeNpcStore');
const registry=require('./npc/npcRegistry');
const runtime=require('./runtime');
const pf56=require('./coopPersonalFleetReturnDock');
const pf66=require('./coopPersonalFleetScopedDock');
const P='coop-personal-fleet\u001f',T='corporationRuntime';
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const positive=x=>Number.isSafeInteger(x)&&x>0;
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const same=(r,c)=>obj(r)&&r.assignmentID===c.assignmentID&&r.operationID===c.operationID&&
 r.shipItemID===c.shipItemID&&r.ownerCharacterID===c.ownerCharacterID&&
 r.pilotID===c.pilotID&&r.systemID===c.systemID&&r.stationID===c.stationID&&
 r.actorGeneration===c.actorGeneration&&r.reservationGeneration===c.generation&&
 r.typeID===c.typeID;
function createOriginalTerminalDockSources({enabled=()=>false,
 allWritersFenced=()=>false,verifyExclusiveOwnership,
 verifyFinalOriginalManifest}={}){
 if([enabled,allWritersFenced,verifyExclusiveOwnership,
  verifyFinalOriginalManifest].some(x=>typeof x!=='function')||
  ![stock.findItemById,store.getNativeEntity,store.getNativeController,
    store.listNativeModulesForEntity,store.listNativeCargoForEntity,
    registry.getControllerByEntityID,pf56.manifestValid,pf66.valid,pf66.signature]
    .every(x=>typeof x==='function')||typeof runtime.scenes?.values!=='function')
  throw Error('PF_TERMINAL_ORIGINAL_SOURCES_REQUIRED');
 const active=()=>enabled()===true&&allWritersFenced()===true;
 const vacant=c=>{
  if(!positive(c?.shipItemID)||!positive(c?.systemID))return false;
  try{return registry.getControllerByEntityID(c.shipItemID)===null&&
   [...runtime.scenes.values()].every(s=>s&&typeof s.getEntityByID==='function'&&
    s.getEntityByID(c.shipItemID)==null);}catch{return false;}
 };
 function authority(c,tx){
  if(!active()||c?.mode!=='DOCK'||!positive(c.shipItemID)||
    !obj(tx)||typeof tx.get!=='function'||
    verifyExclusiveOwnership(c,tx)!==true)return null;
  const ret=tx.get(T,P+'return-dock-v1:'+c.assignmentID),
    dock=tx.get(T,P+'dock-native-attempt-v1:'+c.assignmentID),
    scene=tx.get(T,P+'dock-scene-attempt-v1:'+c.assignmentID),
    items=tx.get('items','items');
  if([ret,dock,scene,items].some(x=>x===undefined||x===null)||
     !same(ret,c)||!['DOCK_ISSUING','DOCKED'].includes(ret.phase)||
     !pf66.valid({...ret,phase:'DOCK_ISSUING'})||
     !obj(dock)||dock.version!==1||dock.status!=='CONSUMED'||
     dock.signature!==pf66.signature({...ret,phase:'DOCK_ISSUING'})||
     dock.operationID!==c.operationID||dock.shipItemID!==c.shipItemID||
     dock.actorGeneration!==c.actorGeneration||dock.reservationGeneration!==c.generation||
     !positive(dock.committedAtMs)||!obj(scene)||scene.version!==1||
     scene.status!=='CONSUMED'||scene.assignmentID!==c.assignmentID||
     scene.shipItemID!==c.shipItemID||scene.actorGeneration!==c.actorGeneration||
     scene.reservationGeneration!==c.generation||
     scene.dockAttemptSignature!==dock.signature||!positive(scene.committedAtMs)||
     !pf66.stockShip(items[String(c.shipItemID)],ret,true)||
     !pf66.stockShip(stock.findItemById(c.shipItemID),ret,true)||!vacant(c))return null;
  const manifest=verifyFinalOriginalManifest(ret,tx);
  if(!pf56.manifestValid(manifest,ret)||
      JSON.stringify(manifest)!==JSON.stringify(ret.manifest))return null;
  // Exactly one original stock title, no hidden second ship with the same ID.
  if(Object.values(items).filter(x=>x?.itemID===c.shipItemID).length!==1)
   return null;
  return {ret,dock,scene,manifest};
 }
 function authenticateCommand(c,tx){
  try{return authority(c,tx)!==null;}catch{return false;}
 }
 function verifyOriginalSceneVacant(c){return active()&&vacant(c);}
 function readNativeIdentity(c){
  if(!active()||!vacant(c))return null;
  try{
   const entity=store.getNativeEntity(c.shipItemID),
     controller=store.getNativeController(c.shipItemID),
     modules=store.listNativeModulesForEntity(c.shipItemID),
     cargo=store.listNativeCargoForEntity(c.shipItemID);
   if(!Array.isArray(modules)||!Array.isArray(cargo))return null;
   return {source:'ORIGINAL_EVEJS_NATIVE_ENTITY_CONTROLLER_V1',
    shipItemID:c.shipItemID,systemID:c.systemID,sceneAbsent:true,
    entity,controller,modules,cargo};
  }catch{return null;}
 }
 function verifyOriginalTerminalWitness(c,tx){
  try{
   const x=authority(c,tx);
   if(!x)return null;
   return Object.freeze({source:'ORIGINAL_EVEJS_PF60_DOCK_V1',
    assignmentID:c.assignmentID,ownerCharacterID:c.ownerCharacterID,
    pilotID:c.pilotID,shipItemID:c.shipItemID,systemID:c.systemID,
    actorGeneration:c.actorGeneration,stationID:c.stationID,
    noLiveSceneActor:true,noCompetingWriter:true,
    originalAssetsAccountedFor:true,noDuplicateOriginalItemIDs:true,
    receiptHash:hash(['PF60_DOCK',c.assignmentID,c.shipItemID,
      x.dock.signature,x.scene.dockAttemptSignature,x.ret.signature,
      x.manifest.fittingHash,x.manifest.cargoHash,x.manifest.cargoItemIDs]),
    originalShipInHangar:true,originalDockReceiptPersisted:true});
  }catch{return null;}
 }
 return Object.freeze({authenticateCommand,verifyOriginalSceneVacant,
  readNativeIdentity,verifyOriginalTerminalWitness});
}
module.exports=Object.freeze({createOriginalTerminalDockSources});
