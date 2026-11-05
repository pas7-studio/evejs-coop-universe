'use strict';
/**
 * PF-54 native deployment admission / single-flight handoff candidate.
 * Inert without original GameStore, ItemStore, original NPC controller and
 * reciprocal writer fences. The original ship itemID must remain the
 * physical entityID; this module NEVER allocates a new entity or ship.
 *
 * PREPARED -> ISSUING is committed BEFORE the original one-shot external
 * handoff. A crash from ISSUING is NOT retried. Independent reconciliation
 * reads the original item and native controller and attaches the PF actor claim
 * atomically with a durable ACTIVE receipt only when all evidence agrees.
 */
const crypto=require('node:crypto');
const T='corporationRuntime',ITEMS='items',SEP='\u001f';
const PF54_PREFIX='coop-personal-fleet'+SEP+'deploy-v1:';
const EXPECTED_ACTOR_KEY='coop-personal-fleet'+SEP+'actor-claims-v1';
const TOKEN=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const PILOT=/^coop-pilot-[0-9]{3,}$/;
const HASH=/^[a-f0-9]{64}$/;
const id=x=>Number.isSafeInteger(x)&&x>0;
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const clone=x=>structuredClone(x);
const sha=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const deny=reason=>({status:'BLOCKED',reason});
const key=assignmentID=>PF54_PREFIX+assignmentID;
const rosterKey=(pf52,owner)=>pf52.ROSTER_PREFIX+owner;
const signature=c=>sha(['PF54_DEPLOY',c.operationID,c.assignmentID,c.ownerCharacterID,
 c.pilotID,c.shipItemID,c.stationID,c.systemID,c.expectedGeneration,
 c.expectedRosterRevision,c.expectedPilotRevision]);
function validCommand(c){
 return obj(c)&&TOKEN.test(c.operationID)&&TOKEN.test(c.assignmentID)&&
  PILOT.test(c.pilotID)&&id(c.ownerCharacterID)&&id(c.shipItemID)&&
  id(c.stationID)&&id(c.systemID)&&id(c.expectedGeneration)&&
  Number.isSafeInteger(c.expectedRosterRevision)&&c.expectedRosterRevision>=0&&
  Number.isSafeInteger(c.expectedPilotRevision)&&c.expectedPilotRevision>=0&&
  obj(c.session)&&c.session.characterID===c.ownerCharacterID&&
  id(c.session.userid)&&c.session.socket?.destroyed!==true;
}
function validEvidence(v,r){
 return obj(v)&&v.source==='ORIGINAL_EVEJS_NATIVE_PROOF_V1'&&
  v.originalShipItemID===r.shipItemID&&v.nativeEntityID===r.shipItemID&&
  v.nativeControllerEntityID===r.shipItemID&&v.ownerCharacterID===r.ownerCharacterID&&
  v.pilotID===r.pilotID&&v.systemID===r.systemID&&
  v.assignmentID===r.assignmentID&&v.generation===r.generation&&
  v.alive===true&&v.noDuplicatePhysicalEntity===true&&
  HASH.test(v.fittingHash)&&v.fittingHash===r.fittingHash&&
  HASH.test(v.cargoHash)&&v.cargoHash===r.cargoHash;
}
function validSpaceItem(item,r){
 return obj(item)&&item.itemID===r.shipItemID&&
  (item.shipID===undefined||item.shipID===r.shipItemID)&&
  item.ownerID===r.ownerCharacterID&&item.typeID===r.typeID&&
  item.categoryID===6&&item.singleton===1&&item.stacksize===1&&
  item.quantity===-1&&item.flagID===0&&item.locationID===r.systemID&&
  obj(item.spaceState)&&item.spaceState.systemID===r.systemID&&
  obj(item.spaceState.position)&&['x','y','z'].every(k=>
   typeof item.spaceState.position[k]==='number'&&Number.isFinite(item.spaceState.position[k]));
}
function validReservation(index,roster,r){
 const ship=index.ships[String(r.shipItemID)],pilot=roster.pilots[r.pilotID];
 return !!ship&&!!pilot&&ship.ownerCharacterID===r.ownerCharacterID&&
  ship.pilotID===r.pilotID&&ship.stationID===r.stationID&&
  ship.assignmentID===r.assignmentID&&ship.generation===r.generation&&
  pilot.status==='HANGAR_RESERVED'&&pilot.contractID===r.contractID&&
  pilot.shipItemID===r.shipItemID&&pilot.assignmentID===r.assignmentID&&
  pilot.stationID===r.stationID&&pilot.generation===r.generation;
}
function createOriginalDeploymentBridge({gameStore,pf52,claimsPolicy,access,
 verifyOriginalEquipment,verifyOriginalDeploymentAuthority,verifyExclusiveOwnership,
 executeOriginalHandoff,verifyOriginalActor,
 allWritersFenced=()=>false,enabled=()=>false,clock=()=>Date.now()}={}){
 const atomic=gameStore?.coopAtomicNativeRows;
 if(atomic?.mode!=='SERVER_INTERNAL_FLAGGED'||typeof atomic.transact!=='function'||
  typeof atomic.isPoisoned!=='function'||typeof access?.isOwner!=='function'||
  !pf52||typeof pf52.validateIndex!=='function'||typeof pf52.validateRoster!=='function'||
  typeof pf52.readStockHangar!=='function'||typeof pf52.checkCompetingClaims!=='function'||
  typeof pf52.REGISTRY_KEY!=='string'||typeof pf52.ROSTER_PREFIX!=='string'||
  claimsPolicy?.KEY!==EXPECTED_ACTOR_KEY||typeof claimsPolicy.validate!=='function'||
  typeof claimsPolicy.empty!=='function'||
  [verifyOriginalEquipment,verifyOriginalDeploymentAuthority,verifyExclusiveOwnership,
   executeOriginalHandoff,verifyOriginalActor,allWritersFenced,enabled,clock].some(x=>typeof x!=='function'))
  throw Error('PF54_AUTHORITATIVE_DEPENDENCIES_REQUIRED');
 function admit(c){
  if(enabled()!==true)return {status:'DISABLED'};
  if(allWritersFenced()!==true)return deny('PF54_GLOBAL_WRITERS_NOT_FENCED');
  if(atomic.isPoisoned())return deny('PF54_GAMESTORE_POISONED');
  if(!validCommand(c))return deny('PF54_COMMAND_INVALID');
  if(access.isOwner(c.session,c.ownerCharacterID)!==true)return deny('PF54_ACCESS_DENIED');
  return null;
 }
 function guard(c,tx){
  if(enabled()!==true||allWritersFenced()!==true)return 'PF54_GATE_REVOKED';
  if(access.isOwner(c.session,c.ownerCharacterID,tx)!==true)return 'PF54_ACCESS_REVOKED';
  return null;
 }
 function readAssigned(tx,c){
  const ix=tx.get(T,pf52.REGISTRY_KEY),rs=tx.get(T,rosterKey(pf52,c.ownerCharacterID));
  if(ix===undefined||rs===undefined||ix===null||rs===null)throw Error('PF54_ROSTER_UNAVAILABLE');
  const index=pf52.validateIndex(ix),roster=pf52.validateRoster(rs,c.ownerCharacterID);
  const sh=index.ships[String(c.shipItemID)],pilot=roster.pilots[c.pilotID];
  if(!sh||!pilot||sh.ownerCharacterID!==c.ownerCharacterID||sh.pilotID!==c.pilotID||
    sh.assignmentID!==c.assignmentID||sh.stationID!==c.stationID||
    sh.generation!==c.expectedGeneration||pilot.contractID!==index.pilots[c.pilotID]?.contractID||
    !validReservation(index,roster,{...c,generation:c.expectedGeneration,contractID:pilot.contractID}))
    throw Error('PF54_ORIGINAL_RESERVATION_CHANGED');
  return {index,roster,ship:sh,pilot};
 }
 function prepare(c){
  const error=admit(c);if(error)return error;
  try{return atomic.transact([T,ITEMS],tx=>{
   const blocked=guard(c,tx);if(blocked)return deny(blocked);
   const prior=tx.get(T,key(c.assignmentID));
   if(prior===undefined)return deny('PF54_DEPLOY_READ_UNCERTAIN');
   const sig=signature(c);
   if(prior!==null)return prior.operationID===c.operationID&&prior.signature===sig?
    {status:'DUPLICATE',phase:prior.phase,shipItemID:prior.shipItemID}:
    deny('PF54_ASSIGNMENT_ALREADY_PREPARED');
   const {roster,pilot}=readAssigned(tx,c);
   if(roster.revision!==c.expectedRosterRevision||pilot.revision!==c.expectedPilotRevision)
    return deny('PF54_ROSTER_REVISION_STALE');
   if(pilot.status!=='HANGAR_RESERVED')return deny('PF54_PILOT_NOT_IN_HANGAR_RESERVATION');
   const conflict=pf52.checkCompetingClaims(tx,c);
   if(conflict)return deny(conflict);
   if(verifyExclusiveOwnership(c,tx)!==true)
    return deny('PF54_MINING_WAR_EXPLORATION_OWNERSHIP_UNVERIFIED');
   const original=pf52.readStockHangar(tx,c.shipItemID,c.ownerCharacterID,c.stationID);
   if(!original)return deny('PF54_ORIGINAL_HANGAR_SHIP_MISSING');
   if(verifyOriginalDeploymentAuthority({...c,stockItem:clone(original)},tx)!==true)
    return deny('PF54_NATIVE_DEPLOYMENT_AUTHORITY_UNVERIFIED');
   const equipment=verifyOriginalEquipment({...c,stockItem:clone(original)},tx);
   if(!obj(equipment)||!HASH.test(equipment.fittingHash)||!HASH.test(equipment.cargoHash))
    return deny('PF54_ORIGINAL_EQUIPMENT_UNVERIFIED');
   const at=clock();if(!id(at))return deny('PF54_CLOCK_INVALID');
   const row={version:1,phase:'PREPARED',operationID:c.operationID,signature:sig,
    assignmentID:c.assignmentID,ownerCharacterID:c.ownerCharacterID,
    pilotID:c.pilotID,contractID:pilot.contractID,
    shipItemID:c.shipItemID,stationID:c.stationID,systemID:c.systemID,
    typeID:original.typeID,generation:c.expectedGeneration,
    fittingHash:equipment.fittingHash,cargoHash:equipment.cargoHash,
    requestedAtMs:at,dispatchCount:0};
   tx.put(T,key(c.assignmentID),row);
   return {status:'PREPARED',phase:row.phase,shipItemID:row.shipItemID};
  });}catch{return deny('PF54_PREPARE_ORIGINAL_ATOMIC_UNCERTAIN');}
 }
 // Single flight: ISSUING is durable BEFORE the original handoff callback.
 // An unknown/failed callback NEVER authorizes another dispatch.
 function dispatch(c){
  const error=admit(c);if(error)return error;
  let pending;
  try{pending=atomic.transact([T,ITEMS],tx=>{
   const blocked=guard(c,tx);if(blocked)return deny(blocked);
   const row=tx.get(T,key(c.assignmentID));
   if(!row||row.signature!==signature(c)||row.operationID!==c.operationID)
    return deny('PF54_DISPATCH_INTENT_MISSING_OR_FOREIGN');
   if(row.phase!=='PREPARED')return deny('PF54_DISPATCH_REQUIRES_RECONCILIATION');
   readAssigned(tx,c);
   if(pf52.checkCompetingClaims(tx,c))return deny('PF54_ACTOR_CLAIM_CONFLICT');
   if(verifyExclusiveOwnership(c,tx)!==true)
    return deny('PF54_MINING_WAR_EXPLORATION_OWNERSHIP_UNVERIFIED');
   const original=pf52.readStockHangar(tx,c.shipItemID,c.ownerCharacterID,c.stationID);
   if(!original||original.typeID!==row.typeID)return deny('PF54_HANGAR_CHANGED_BEFORE_DISPATCH');
   if(verifyOriginalDeploymentAuthority({...c,stockItem:clone(original)},tx)!==true)
    return deny('PF54_DEPLOYMENT_AUTHORITY_REVOKED');
   const eq=verifyOriginalEquipment({...c,stockItem:clone(original)},tx);
   if(!eq||eq.fittingHash!==row.fittingHash||eq.cargoHash!==row.cargoHash)
    return deny('PF54_FITTING_OR_CARGO_CHANGED');
   const at=clock();if(!id(at))return deny('PF54_CLOCK_INVALID');
   const next={...row,phase:'ISSUING',dispatchCount:1,dispatchedAtMs:at};
   tx.put(T,key(c.assignmentID),next);
   return {status:'ISSUING',row:clone(next)};
  });}catch{return deny('PF54_DISPATCH_COMMIT_UNKNOWN');}
  if(pending?.status!=='ISSUING')return pending;
  try{
   const result=executeOriginalHandoff(Object.freeze({...pending.row}));
   if(result&&typeof result.then==='function')return {status:'NATIVE_OUTCOME_UNKNOWN',
    reason:'PF54_ASYNC_HANDOFF_FORBIDDEN',shipItemID:c.shipItemID};
   return {status:'AWAITING_NATIVE_RECONCILIATION',shipItemID:c.shipItemID,
    executorStatus:result?.status==='COMPLETED'?'REPORTED_COMPLETED':'UNVERIFIED'};
  }catch{return {status:'NATIVE_OUTCOME_UNKNOWN',shipItemID:c.shipItemID};}
 }
 function reconcile(c){
  const error=admit(c);if(error)return error;
  try{return atomic.transact([T,ITEMS],tx=>{
   const blocked=guard(c,tx);if(blocked)return deny(blocked);
   const row=tx.get(T,key(c.assignmentID));
   if(!row||row.signature!==signature(c))return deny('PF54_NO_MATCHING_DEPLOYMENT');
   if(row.phase==='ACTIVE')return {status:'ALREADY_ACTIVE',shipItemID:row.shipItemID,
    actorGeneration:row.actorGeneration};
   if(row.phase!=='ISSUING'||row.dispatchCount!==1)
    return deny('PF54_NOT_ELIGIBLE_FOR_RECONCILIATION');
   readAssigned(tx,c);
   const root=tx.get(ITEMS,ITEMS);
   const original=root?.[String(row.shipItemID)];
   if(!validSpaceItem(original,row))return deny('PF54_ORIGINAL_ITEM_NOT_IN_SPACE');
   // The verified native actor MUST refer to the SAME original ship ID,
   // controller, and immutable original module/cargo witnesses.
   const proof=verifyOriginalActor(clone(row),tx);
   if(!validEvidence(proof,row))return deny('PF54_ORIGINAL_PHYSICAL_ACTOR_NOT_PROVEN');
   const raw=tx.get(T,EXPECTED_ACTOR_KEY);
   if(raw===undefined)return deny('PF54_CLAIMS_READ_UNCERTAIN');
   const actors=claimsPolicy.validate(raw===null?claimsPolicy.empty():raw);
   if(actors.claims[String(row.shipItemID)]||
     Object.values(actors.claims).some(x=>x.pilotID===row.pilotID))
    return deny('PF54_ACTOR_ALREADY_CLAIMED');
   const conflict=pf52.checkCompetingClaims(tx,c);
   if(conflict)return deny(conflict);
   if(verifyExclusiveOwnership(c,tx)!==true)
    return deny('PF54_MINING_WAR_EXPLORATION_OWNERSHIP_UNVERIFIED');
   const generation=(actors.generations[String(row.shipItemID)]||0)+1;
   if(!id(generation)||generation>=Number.MAX_SAFE_INTEGER)
    return deny('PF54_ACTOR_GENERATION_EXHAUSTED');
   actors.generations[String(row.shipItemID)]=generation;
   actors.claims[String(row.shipItemID)]={entityID:row.shipItemID,
    pilotID:row.pilotID,ownerCharacterID:row.ownerCharacterID,
    systemID:row.systemID,assignmentID:row.assignmentID,
    generation,ownerType:'PERSONAL_FLEET'};
   claimsPolicy.validate(actors);
   const at=clock();if(!id(at))return deny('PF54_CLOCK_INVALID');
   const final={...row,phase:'ACTIVE',actorGeneration:generation,
    originalProofHash:sha(proof),reconciledAtMs:at};
   tx.put(T,EXPECTED_ACTOR_KEY,actors);
   tx.put(T,key(c.assignmentID),final);
   return {status:'ACTIVE',shipItemID:row.shipItemID,pilotID:row.pilotID,
    actorGeneration:generation,originalProofHash:final.originalProofHash};
  });}catch{return deny('PF54_RECONCILE_ORIGINAL_ATOMIC_UNCERTAIN');}
 }
 function inspect(c){
  const error=admit(c);if(error)return error;
  try{return atomic.transact([T],tx=>{
   const blocked=guard(c,tx);if(blocked)return deny(blocked);
   const row=tx.get(T,key(c.assignmentID));
   if(row===undefined)return deny('PF54_READ_UNCERTAIN');
   if(!row)return {status:'NOT_FOUND'};
   if(row.signature!==signature(c))return deny('PF54_FOREIGN_DEPLOYMENT');
   return {status:'OK',phase:row.phase,shipItemID:row.shipItemID,
    dispatchCount:row.dispatchCount};
  });}catch{return deny('PF54_INSPECTION_UNAVAILABLE');}
 }
 return Object.freeze({prepare,dispatch,reconcile,inspect});
}
module.exports={createOriginalDeploymentBridge,key,signature,validCommand,validSpaceItem,validEvidence};