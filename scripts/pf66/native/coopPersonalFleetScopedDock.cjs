'use strict';
/** PF66: source-bound, single-use stock docking candidate. NOT AUTO-INSTALLED.
 * Intended only as PF56 executeNativeDock(row) inside the ORIGINAL game server.
 * The scene is removed by an independently source-patched NPC service, NEVER
 * by PF59-blocked generic destroy/dematerialize. No automatic crash retry.
 */
const crypto=require('node:crypto');
const T='corporationRuntime',ITEMS='items',SEP='\u001f',P='coop-personal-fleet'+SEP;
const RETURN=P+'return-dock-v1:',DEPLOY=P+'deploy-v1:',HANDOFF=P+'handoff-v1:',LOCK=P+'handoff-ship-v1:';
const CLAIMS=P+'actor-claims-v1',TERMINAL=P+'terminal-v1:';
const KEY=P+'dock-native-attempt-v1:',SCENE_KEY=P+'dock-scene-attempt-v1:';
const positive=n=>Number.isSafeInteger(n)&&n>0;
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const clone=x=>structuredClone(x);
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const token=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const sha=/^[0-9a-f]{64}$/;
const fail=errorMsg=>({success:false,errorMsg});
const attemptKey=assignmentID=>KEY+assignmentID;
const sceneAttemptKey=assignmentID=>SCENE_KEY+assignmentID;
const fields=c=>['PF66_DOCK_V1',c.operationID,c.signature,c.assignmentID,c.shipItemID,
  c.pilotID,c.ownerCharacterID,c.stationID,c.systemID,c.reservationGeneration,
  c.actorGeneration,c.typeID,c.arrivalProofHash,hash(c.manifest)];
const signature=c=>hash(fields(c));
function valid(c){return obj(c)&&c.version===1&&c.phase==='DOCK_ISSUING'&&
  c.dockDispatchCount===1&&[c.operationID,c.assignmentID].every(x=>typeof x==='string'&&token.test(x))&&
  typeof c.pilotID==='string'&&/^coop-pilot-\d{3,}$/.test(c.pilotID)&&
  [c.shipItemID,c.ownerCharacterID,c.stationID,c.systemID,c.reservationGeneration,
    c.actorGeneration,c.typeID].every(positive)&&sha.test(c.signature)&&
  sha.test(c.arrivalProofHash)&&obj(c.manifest)&&
  c.manifest.source==='ORIGINAL_EVEJS_ITEM_AND_CARGO_MANIFEST_V1'&&
  c.manifest.shipItemID===c.shipItemID&&
  c.manifest.ownerCharacterID===c.ownerCharacterID&&
  c.manifest.assignmentID===c.assignmentID&&c.manifest.actorGeneration===c.actorGeneration&&
  sha.test(c.manifest.fittingHash)&&sha.test(c.manifest.cargoHash)&&
  c.manifest.originalItemTitlesVerified===true&&c.manifest.noUnrecordedCargo===true&&
  Array.isArray(c.manifest.cargoItemIDs)&&c.manifest.cargoItemIDs.length<=4096&&
  c.manifest.cargoItemIDs.every(positive)&&new Set(c.manifest.cargoItemIDs).size===c.manifest.cargoItemIDs.length;
}
function stockShip(item,c,docked){return obj(item)&&item.itemID===c.shipItemID&&
 item.ownerID===c.ownerCharacterID&&item.typeID===c.typeID&&item.categoryID===6&&
 item.singleton===1&&item.stacksize===1&&item.quantity===-1&&
 item.locationID===(docked?c.stationID:c.systemID)&&item.flagID===(docked?4:0)&&
 (docked?item.spaceState==null:item.spaceState?.systemID===c.systemID);}
function createScopedDock({gameStore,originalItemStore,nativeNpcService,claimsPolicy,
 verifyOriginalDockReady,verifyExclusiveOwnership,allWritersFenced=()=>false,
 enabled=()=>false,clock=()=>Date.now()}={}){
 const a=gameStore?.coopAtomicNativeRows;
 if(a?.mode!=='SERVER_INTERNAL_FLAGGED'||typeof a.transact!=='function'||
    typeof a.isPoisoned!=='function'||
    claimsPolicy?.KEY!==CLAIMS||typeof claimsPolicy.validate!=='function'||
    typeof originalItemStore?.findItemById!=='function'||
    typeof originalItemStore?.dockShipToLocation!=='function'||
    nativeNpcService?.PF66_SCOPED_DOCK_SCENE_DETACH_V1!==true||
    typeof nativeNpcService.installScopedPersonalFleetDockAuthority!=='function'||
    typeof nativeNpcService.detachScopedPersonalFleetDockSceneActor!=='function'||
    [verifyOriginalDockReady,verifyExclusiveOwnership,allWritersFenced,
     enabled,clock].some(x=>typeof x!=='function'))
    throw Error('PF66_ORIGINAL_DOCK_AUTHORITIES_REQUIRED');
 const active=()=>enabled()===true&&allWritersFenced()===true&&!a.isPoisoned();
 const capability=Symbol('PF66 original dock capability');
 const attempted=new Set();
 function gate(c,tx,docked){
  if(!active()||verifyExclusiveOwnership(c,tx)!==true)return null;
  const row=tx.get(T,RETURN+c.assignmentID),deploy=tx.get(T,DEPLOY+c.assignmentID),
   handoff=tx.get(T,HANDOFF+c.assignmentID),lock=tx.get(T,LOCK+c.shipItemID),
   claims=tx.get(T,CLAIMS),terminal=tx.get(T,TERMINAL+c.assignmentID),
   items=tx.get(ITEMS,ITEMS);
  let validatedClaims;try{validatedClaims=claimsPolicy.validate(claims);}catch{return null;}
  if(!obj(row)||!valid(row)||signature(row)!==signature(c)||
     row.operationID!==c.operationID||row.signature!==c.signature||
     !obj(deploy)||deploy.phase!=='ACTIVE'||deploy.assignmentID!==c.assignmentID||
     deploy.shipItemID!==c.shipItemID||deploy.ownerCharacterID!==c.ownerCharacterID||
     deploy.pilotID!==c.pilotID||deploy.systemID!==c.systemID||
     deploy.actorGeneration!==c.actorGeneration||deploy.generation!==c.reservationGeneration||
     !obj(handoff)||handoff.status!=='CONSUMED'||handoff.shipItemID!==c.shipItemID||
     handoff.assignmentID!==c.assignmentID||handoff.ownerCharacterID!==c.ownerCharacterID||
     handoff.generation!==c.reservationGeneration||!obj(lock)||
     lock.assignmentID!==c.assignmentID||lock.sourcePF54Hash!==handoff.sourcePF54Hash||
     Object.values(validatedClaims.claims).filter(x=>x?.pilotID===c.pilotID).length!==1||
     !obj(validatedClaims.claims[String(c.shipItemID)])||
     validatedClaims.claims[String(c.shipItemID)].ownerType!=='PERSONAL_FLEET'||
     validatedClaims.claims[String(c.shipItemID)].ownerCharacterID!==c.ownerCharacterID||
     validatedClaims.claims[String(c.shipItemID)].pilotID!==c.pilotID||
     validatedClaims.claims[String(c.shipItemID)].assignmentID!==c.assignmentID||
     validatedClaims.claims[String(c.shipItemID)].generation!==c.actorGeneration||
     validatedClaims.claims[String(c.shipItemID)].systemID!==c.systemID||
     validatedClaims.generations[String(c.shipItemID)]!==c.actorGeneration||
     terminal!==null||!obj(items)||!stockShip(items[String(c.shipItemID)],c,docked))return null;
  return row;
 }
 const validDockAttempt=(x,c)=>obj(x)&&x.version===1&&x.status==='CONSUMED'&&
  x.signature===signature(c)&&x.assignmentID===c.assignmentID&&
  x.operationID===c.operationID&&x.shipItemID===c.shipItemID&&
  x.actorGeneration===c.actorGeneration&&x.reservationGeneration===c.reservationGeneration&&
  Number.isSafeInteger(x.committedAtMs)&&x.committedAtMs>0;
 function authorize(c){
  if(!valid(c))return false;
  try{return a.transact([T,ITEMS],tx=>{
   if(!gate(c,tx,true))return false;
   const x=tx.get(T,attemptKey(c.assignmentID)),scene=tx.get(T,sceneAttemptKey(c.assignmentID));
   return scene===null&&validDockAttempt(x,c);
  })===true;}catch{return false;}
 }
 // Native service consumes this original SQLite sub-attempt immediately before
 // the first physical scene write, after verifying the actual actor identity.
 // A durable unknown/partial result is NEVER retried on restart or by calling
 // the original scene method again with a retained private Symbol.
 function consumeSceneDetach(c){
  if(!valid(c))return false;
  try{return a.transact([T,ITEMS],tx=>{
   const prior=tx.get(T,sceneAttemptKey(c.assignmentID));
   if(prior!==null||!gate(c,tx,true))return false;
   const first=tx.get(T,attemptKey(c.assignmentID));
   if(!validDockAttempt(first,c))return false;
   const at=clock();if(!positive(at))return false;
   tx.put(T,sceneAttemptKey(c.assignmentID),{version:1,status:'CONSUMED',
    assignmentID:c.assignmentID,shipItemID:c.shipItemID,
    reservationGeneration:c.reservationGeneration,actorGeneration:c.actorGeneration,
    dockAttemptSignature:first.signature,committedAtMs:at});
   return true;
  })===true;}catch{return false;}
 }
 if(nativeNpcService.installScopedPersonalFleetDockAuthority({capability,authorize,consumeSceneDetach})!==true)

  throw Error('PF66_NATIVE_AUTHORITY_INSTALL_UNCONFIRMED');
 function execute(row){
  if(!valid(row))return fail('PF66_DOCK_COMMAND_INVALID');
  const c=clone(row),key=c.assignmentID+':'+c.reservationGeneration;
  if(attempted.has(key))return fail('PF66_LOCAL_ALREADY_ATTEMPTED');
  let result;
  try{result=a.transact([T,ITEMS],tx=>{
   const prior=tx.get(T,attemptKey(c.assignmentID));
   if(prior===undefined)return 'PF66_ATTEMPT_READ_UNKNOWN';
   if(prior!==null)return 'PF66_DURABLE_ATTEMPT_ALREADY_CONSUMED';
   if(!gate(c,tx,false))return 'PF66_DOCK_CUSTODY_NOT_PROVEN';
   if(verifyOriginalDockReady(c,tx)!==true)return 'PF66_ORIGINAL_ARRIVAL_NOT_PROVEN';
   const at=clock();if(!positive(at))return 'PF66_CLOCK_INVALID';
   tx.put(T,attemptKey(c.assignmentID),{version:1,status:'CONSUMED',
     assignmentID:c.assignmentID,operationID:c.operationID,shipItemID:c.shipItemID,
     actorGeneration:c.actorGeneration,reservationGeneration:c.reservationGeneration,
     signature:signature(c),committedAtMs:at});
   return 'COMMITTED';
  });}catch{return fail('PF66_ATTEMPT_COMMIT_UNKNOWN_NO_RETRY');}
  if(result!=='COMMITTED')return fail(result||'PF66_ATTEMPT_COMMIT_UNKNOWN_NO_RETRY');
  attempted.add(key);
  // The permit is consumed even if the original stock writer gate is revoked.
  // Re-prove the source after commit and immediately BEFORE the first effect.
  let stillAuthorized=false;
  try{stillAuthorized=a.transact([T,ITEMS],tx=>{
   const x=tx.get(T,attemptKey(c.assignmentID));
   return obj(x)&&x.status==='CONSUMED'&&x.signature===signature(c)&&
    !!gate(c,tx,false)&&verifyOriginalDockReady(c,tx)===true;
  })===true;}catch{return fail('PF66_POST_COMMIT_GATE_UNKNOWN_NO_RETRY');}
  if(!stillAuthorized)return fail('PF66_POST_COMMIT_GATE_REVOKED_NO_RETRY');
  try{
   const moved=originalItemStore.dockShipToLocation(c.shipItemID,c.stationID);
   if(moved?.success!==true||moved.then)return fail('PF66_ORIGINAL_ITEMSTORE_DOCK_UNKNOWN');
   if(!stockShip(originalItemStore.findItemById(c.shipItemID),c,true))
    return fail('PF66_ORIGINAL_HANGAR_READBACK_UNKNOWN');
   const detached=nativeNpcService.detachScopedPersonalFleetDockSceneActor({row:c,capability});
   if(detached?.success!==true||detached.then)return fail('PF66_NATIVE_SCENE_DETACH_UNKNOWN');
   return {success:true,data:{shipItemID:c.shipItemID,requiresPF60Prepare:true,
    requiresPF56DockReconcile:true}};
  }catch{return fail('PF66_NATIVE_DOCK_OUTCOME_UNKNOWN_NO_RETRY');}
 }
 return Object.freeze({execute});
}
module.exports={createScopedDock,valid,signature,attemptKey,sceneAttemptKey,stockShip};
