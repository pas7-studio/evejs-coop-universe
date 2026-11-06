'use strict';
/** PF58/PF65 read-only original GameStore permit for native materialization.
 * Initial adoption: PF54 ISSUING and no competing pilot/ship claims globally.
 * Restart: PF54 ACTIVE and the one matching original claim. Malformed global
 * claims NEVER count as empty (including an unrelated corrupt row).
 */
const crypto=require('node:crypto');
const {isDeepStrictEqual}=require('node:util');
const T='corporationRuntime',SEP='\u001f';
const prefix='coop-personal-fleet'+SEP;
const pos=x=>Number.isSafeInteger(x)&&x>0;
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const PILOT=/^coop-pilot-[0-9]{3,}$/;
const TOKEN=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const canonicalId=k=>typeof k==='string'&&pos(Number(k))&&String(Number(k))===k;
/** Same canonical fields/limits as scripts/lib/personal-fleet-claims.cjs.
 * Keep this module self-contained for staging into EveJS's native space/ dir.
 */
function validateOriginalClaimsIndex(raw){
 if(raw===null)return {version:1,claims:{},generations:{},processed:{}};
 if(!obj(raw)||raw.version!==1||!obj(raw.claims)||!obj(raw.generations)||
    !obj(raw.processed)||Object.keys(raw.claims).length>128||
    Object.keys(raw.generations).length>1024||Object.keys(raw.processed).length>1024)
    return null;
 const seenPilots=new Set();
 for(const [k,c] of Object.entries(raw.claims)){
  if(!canonicalId(k)||!obj(c)||c.entityID!==Number(k)||!PILOT.test(c.pilotID)||
     !pos(c.ownerCharacterID)||!pos(c.systemID)||!TOKEN.test(c.assignmentID)||
     !pos(c.generation)||c.ownerType!=='PERSONAL_FLEET'||seenPilots.has(c.pilotID)||
     !pos(raw.generations[k])||raw.generations[k]<c.generation)return null;
  seenPilots.add(c.pilotID);
 }
 for(const [k,v] of Object.entries(raw.generations))if(!canonicalId(k)||!pos(v))return null;
 for(const [k,v] of Object.entries(raw.processed))
  if(!TOKEN.test(k)||!obj(v)||typeof v.signature!=='string'||!v.receipt)return null;
 return raw;
}
/** PF73 original custody barrier. A PF54 ACTIVE deployment is NOT permission
 * to resurrect an NPC after PF56 committed DOCK_ISSUING, even if the original
 * ItemStore ship has not yet left space. Observe the PF56 and PF60/PF66 rows
 * together with PF54, PF58 and ItemStore inside ONE original SQLite read tx.
 * This is an admission fence, not a retry/recovery executor.
 */
function originalNativeResumeAllowed(tx, deploy, e) {
 const assignment=e.personalFleetAssignmentID;
 const ret=tx.get(T,prefix+'return-dock-v1:'+assignment);
 const dockAttempt=tx.get(T,prefix+'dock-native-attempt-v1:'+assignment);
 const sceneAttempt=tx.get(T,prefix+'dock-scene-attempt-v1:'+assignment);
 const terminal=tx.get(T,prefix+'terminal-v1:'+assignment);
 // Under original GameStore, a proven absent row is null. An undefined read
 // is unproven; malformed, unknown, or durable one-shot effects fail closed.
 if([ret,dockAttempt,sceneAttempt,terminal].some(x=>x===undefined))return false;
 if(dockAttempt!==null||sceneAttempt!==null||terminal!==null)return false;
 if(ret===null)return true;
 // Pre-dock return flight can be restored (the arrival dwell is re-proven
 // in PF56); DOCK_ISSUING and DOCKED must never be restarted as an NPC.
 if(!obj(ret)||deploy.phase!=='ACTIVE'||ret.version!==1||
    !['RETURN_ISSUING','RETURNING','ARRIVAL_OBSERVED'].includes(ret.phase)||
    ret.dockDispatchCount!==0||
    ret.assignmentID!==assignment||ret.shipItemID!==e.entityID||
    ret.ownerCharacterID!==e.ownerID||ret.pilotID!==e.personalFleetPilotID||
    ret.systemID!==e.systemID||ret.typeID!==e.typeID||
    ret.reservationGeneration!==e.personalFleetGeneration||
    ret.actorGeneration!==deploy.actorGeneration||!pos(ret.stationID)||
    typeof ret.operationID!=='string'||!TOKEN.test(ret.operationID)||
    typeof ret.signature!=='string'||
    !/^[0-9a-f]{64}$/.test(ret.signature))return false;
 // PF56's canonical SHA256 digest detects a partially edited return row.
 // This is NOT a MAC; authorization still relies on fenced original writers.
 const expected=crypto.createHash('sha256').update(JSON.stringify([
   'PF56_RETURN',ret.operationID,assignment,e.ownerID,e.personalFleetPilotID,
   e.entityID,ret.stationID,e.systemID,e.personalFleetGeneration,
   deploy.actorGeneration])).digest('hex');
 return ret.signature===expected;
}
// PF73 original native dock resume admission END

function createPermitVerifier({gameStore,enabled=()=>false,allWritersFenced=()=>false}={}){
 const a=gameStore?.coopAtomicNativeRows;
 if(a?.mode!=='SERVER_INTERNAL_FLAGGED'||typeof a.transact!=='function'||
    typeof a.isPoisoned!=='function'||typeof enabled!=='function'||
    typeof allWritersFenced!=='function')throw Error('PF58_ORIGINAL_PERMIT_AUTHORITIES_REQUIRED');
 function verify({entityRecord,allowIssuing=false}={}){
  if(enabled()!==true||allWritersFenced()!==true||a.isPoisoned())return false;
  const e=entityRecord;
  if(!obj(e)||e.personalFleetOriginal!==true||!pos(e.entityID)||
     !pos(e.systemID)||!pos(e.ownerID)||!pos(e.typeID)||
     !pos(e.personalFleetGeneration)||
     typeof e.personalFleetAssignmentID!=='string'||
     typeof e.personalFleetPilotID!=='string')return false;
  try{return a.transact([T,'items'],tx=>{
   if(enabled()!==true||allWritersFenced()!==true)return false;
   const row=tx.get(T,prefix+'deploy-v1:'+e.personalFleetAssignmentID);
   if(!obj(row)||!['ISSUING','ACTIVE'].includes(row.phase)||
     row.assignmentID!==e.personalFleetAssignmentID||row.shipItemID!==e.entityID||
     row.ownerCharacterID!==e.ownerID||row.systemID!==e.systemID||
     row.typeID!==e.typeID||row.pilotID!==e.personalFleetPilotID||
     row.generation!==e.personalFleetGeneration)return false;
   const p=tx.get(T,prefix+'handoff-v1:'+row.assignmentID),
     shipLock=tx.get(T,prefix+'handoff-ship-v1:'+e.entityID);
   if(!obj(p)||p.version!==1||p.status!=='CONSUMED'||
      p.assignmentID!==row.assignmentID||p.shipItemID!==e.entityID||
      p.ownerCharacterID!==e.ownerID||p.pilotID!==e.personalFleetPilotID||
      p.generation!==e.personalFleetGeneration||
      shipLock?.assignmentID!==row.assignmentID||
      shipLock?.sourcePF54Hash!==p.sourcePF54Hash)return false;
   const hull=tx.get('items','items')?.[String(e.entityID)];
   if(!obj(hull)||hull.itemID!==e.entityID||hull.ownerID!==e.ownerID||
      hull.typeID!==e.typeID||hull.categoryID!==6||hull.flagID!==0||
      hull.locationID!==e.systemID||hull.spaceState?.systemID!==e.systemID)return false;
   // PF73: docking intent is terminal for native materialization admission,
   // even while original ItemStore still reports the ship physically in space.
   if(!originalNativeResumeAllowed(tx,row,e))return false;
   const rawClaims=tx.get(T,prefix+'actor-claims-v1');
   // undefined: unreadable/unknown. null: proven empty before first claim.
   if(rawClaims===undefined)return false;
   const root=validateOriginalClaimsIndex(rawClaims);
   if(!root)return false;
   const claim=root.claims[String(e.entityID)];
   const pilotClaims=Object.values(root.claims).filter(c=>c.pilotID===e.personalFleetPilotID);
   if(row.phase==='ISSUING'){
     // The original PF54 handoff checked pilot exclusivity earlier; verify it
     // again atomically at actual materialization, not just for this ship ID.
     return allowIssuing===true&&row.dispatchCount===1&&claim==null&&pilotClaims.length===0;
   }
   return pilotClaims.length===1&&pilotClaims[0]===claim&&
    !!claim&&claim.ownerType==='PERSONAL_FLEET'&&
    claim.entityID===e.entityID&&claim.ownerCharacterID===e.ownerID&&
    claim.pilotID===e.personalFleetPilotID&&
    claim.assignmentID===e.personalFleetAssignmentID&&
    claim.systemID===e.systemID&&claim.generation===row.actorGeneration;
  })===true;}catch{return false;}
 }
 return Object.freeze({verify});
}
/**
 * PF88: reciprocal ORIGINAL ship writer check.
 *
 * This MUST be called from a competing player's / Mining / WAR / Exploration
 * mutating GameStore transaction, using that SAME transaction object. A
 * read-before-write in a separate transaction is *not* authority to commit.
 *
 * Never use a client-supplied "owner" or "release" marker to bypass custody.
 * A historical one-shot ship lock is blocked until a separate, independently
 * reviewed original custody-release protocol proves original title restored.
 */
function createReciprocalWriterFence({pf52}={}){
 if(typeof pf52?.REGISTRY_KEY!=='string'||
    pf52.REGISTRY_KEY!==prefix+'hangar-reservations-v1'||
    typeof pf52.validateIndex!=='function')
  throw Error('PF88_ORIGINAL_PF52_INDEX_AUTHORITY_REQUIRED');
 const writerKinds=new Set(['PLAYER','MINING','WAR','EXPLORATION','MARKET','INDUSTRY']);
 const fail=reason=>Object.freeze({status:'BLOCKED',reason,mayCommit:false});
 const rootItem=items=>obj(items)&&!Array.isArray(items)?items:null;
 // A stock child item can be fitted or held inside the ship. Protect title,
 // fittings and cargo, and the destination ship on a new insertion.
 function containingShip(items,rawID,{externalDestination=false}={}){
  if(!pos(rawID))return {unresolved:true};
  let id=rawID,seen=new Set();
  for(let depth=0;depth<32;depth++){
   if(seen.has(id))return {unresolved:true};
   seen.add(id);
   const x=items[String(id)];
   // Missing parent is often a station, structure or system, not an item.
   if(x===undefined||x===null)
    return depth===0&&!externalDestination?{unresolved:true}:{ship:null};
   if(!obj(x)||x.itemID!==id||!pos(x.ownerID)||
      !pos(x.locationID)||!pos(x.categoryID))return {unresolved:true};
   if(x.categoryID===6)return {ship:id};
   if(x.locationID===id)return {unresolved:true};
   id=x.locationID;
  }
  return {unresolved:true};
 }
 function inTransaction({tx,writer,shipItemID=null,affectedItemID=null,
                          destinationLocationID=null}={}){
  if(!writerKinds.has(writer)||typeof tx?.get!=='function'||
     typeof tx?.put!=='function')return fail('PF88_WRITER_TRANSACTION_REQUIRED');
  if(shipItemID!==null&&!pos(shipItemID)||affectedItemID!==null&&!pos(affectedItemID)||
     destinationLocationID!==null&&!pos(destinationLocationID)||
     (shipItemID===null&&affectedItemID===null&&destinationLocationID===null))
    return fail('PF88_ORIGINAL_WRITER_IDENTIFIERS_INVALID');
  try{
   const original=tx.get('items','items');
   if(!rootItem(original))return fail('PF88_ORIGINAL_ITEMSTORE_UNAVAILABLE');
   const touched=new Set();
   if(shipItemID!==null){
    const found=containingShip(original,shipItemID);
    if(found.unresolved||found.ship!==shipItemID)
     return fail('PF88_SHIP_ID_NOT_ORIGINAL_STOCK');
    touched.add(shipItemID);
   }
   for(const [id,externalDestination] of [
    [affectedItemID,false],[destinationLocationID,true]]){
    if(id===null)continue;
    const found=containingShip(original,id,{externalDestination});
    if(found.unresolved)return fail('PF88_PARENT_CHAIN_UNVERIFIED');
    if(found.ship!==null)touched.add(found.ship);
   }
   const registry=tx.get(T,pf52.REGISTRY_KEY),
         rawActors=tx.get(T,prefix+'actor-claims-v1');
   if(registry===undefined||rawActors===undefined)
    return fail('PF88_ORIGINAL_CUSTODY_READ_UNCERTAIN');
   const actors=validateOriginalClaimsIndex(rawActors);
   if(!actors)return fail('PF88_ACTOR_CLAIMS_CORRUPT');
   let index;
   try{index=registry===null?null:pf52.validateIndex(registry);}
   catch{return fail('PF88_HANGAR_CUSTODY_CORRUPT');}
   // Malformed unrelated rows also block every candidate writer.
   for(const ship of touched){
    const id=String(ship);
    if(index?.ships?.[id])return fail('PF88_PF52_SHIP_RESERVED');
    if(actors.claims[id])return fail('PF88_NATIVE_ACTOR_CLAIMED');
    const handoff=tx.get(T,prefix+'handoff-ship-v1:'+id),
          terminal=tx.get(T,prefix+'terminal-ship-v1:'+id);
    if(handoff===undefined||terminal===undefined)
     return fail('PF88_CUSTODY_LOCK_READ_UNCERTAIN');
    // Terminal custody is not automatically safe: only a future, separately
    // audited release protocol may return title to the stock player writer.
    if(handoff!==null||terminal!==null)
     return fail('PF88_ONE_SHOT_OR_TERMINAL_CUSTODY');
   }
   return Object.freeze({status:'CLEAR_IN_SAME_TRANSACTION',
    mayCommit:true,originalShipIDs:Object.freeze([...touched].sort((a,b)=>a-b))});
  }catch{return fail('PF88_ORIGINAL_CUSTODY_READ_FAILED');}
 }
 /**
  * PF89: transaction-scoped original ItemStore *root* mutation gateway.
  *
  * A foreign writer is not allowed to claim it will touch item A while
  * actually changing reserved ship B, an in-ship module, or its cargo.
  * Inspect the COMPLETE actual before/after stock item diff, against both
  * the old parent chains and the proposed new parent chains, before the
  * single physical inventory tx.put.
  *
  * The builder receives only an isolated clone and MUST return literal true.
  * The API is not callable after the parent tx commits and cannot certify
  * writers that bypass this function. Real original ItemStore integration
  * is a separate P0, not a property of this module alone.
  */
 function mutateOriginalItemsInTransaction({tx,writer,buildNext,
                                            declaredItemIDs=null}={}){
  if(!writerKinds.has(writer)||typeof tx?.get!=='function'||
     typeof tx?.put!=='function'||typeof buildNext!=='function')
    return fail('PF89_STOCK_WRITER_TRANSACTION_AND_BUILDER_REQUIRED');
  if(declaredItemIDs!==null&&(!Array.isArray(declaredItemIDs)||
      declaredItemIDs.length>1024||
      declaredItemIDs.some(id=>!pos(id))||
      new Set(declaredItemIDs).size!==declaredItemIDs.length))
    return fail('PF89_DECLARED_ITEMS_INVALID');
  let before;
  try{before=tx.get('items','items');}
  catch{return fail('PF89_ORIGINAL_ITEMS_READ_FAILED');}
  if(!rootItem(before))return fail('PF89_ORIGINAL_ITEMS_UNAVAILABLE');
  // The original ItemStore also serializes the full 'items' root; cap
  // accidental oversized batch writers rather than silently skipping diffs.
  const beforeKeys=Object.keys(before);
  if(beforeKeys.length>250000)return fail('PF89_ORIGINAL_ITEMS_AUDIT_CAP');
  let next;
  try{next=structuredClone(before);}
  catch{return fail('PF89_ORIGINAL_ITEMS_CLONE_FAILED');}
  // Intentionally DO NOT swallow a throwing builder: the enclosing original
  // SQLite transaction must abort, even if the closure mutated the tx.
  const ack=buildNext(next);
  // A builder capturing tx must NEVER sneak a stock write into the same
  // transaction and then return BLOCKED/NOOP. Throw to rollback any such
  // write, including when the builder failed to acknowledge synchronously.
  if(!isDeepStrictEqual(before,tx.get('items','items')))
   throw Error('PF89_STOCK_ITEMS_CHANGED_DURING_BUILDER_ROLLBACK');
  if(ack!==true)return fail('PF89_BUILDER_NOT_SYNCHRONOUSLY_ACKED');
  if(!rootItem(next))return fail('PF89_INVALID_NEXT_ITEMS_ROOT');
  try{
   const roundtrip=JSON.parse(JSON.stringify(next));
   if(!isDeepStrictEqual(next,roundtrip))
    return fail('PF89_NON_JSON_INVENTORY_MUTATION');
  }catch{return fail('PF89_NON_JSON_INVENTORY_MUTATION');}
  const nextKeys=Object.keys(next);
  if(nextKeys.length>250000)return fail('PF89_NEXT_ITEMS_AUDIT_CAP');
  const keys=new Set([...beforeKeys,...nextKeys]),changed=[];
  for(const key of keys){
   // Original item IDs are strictly canonical positive safe integer keys.
   if(!/^[1-9][0-9]*$/.test(key)||!pos(Number(key))||
      String(Number(key))!==key)
    return fail('PF89_NONCANONICAL_ORIGINAL_ITEM_KEY');
   const a=Object.prototype.hasOwnProperty.call(before,key)?before[key]:null;
   const z=Object.prototype.hasOwnProperty.call(next,key)?next[key]:null;
   if(!isDeepStrictEqual(a,z))changed.push(Number(key));
   if(changed.length>1024)return fail('PF89_MUTATION_SIZE_EXCEEDS_CAP');
  }
  changed.sort((a,b)=>a-b);
  if(declaredItemIDs!==null&&
     !isDeepStrictEqual([...declaredItemIDs].sort((a,b)=>a-b),changed))
    return fail('PF89_UNDECLARED_STOCK_ITEM_MUTATION');
  if(changed.length===0)
   return Object.freeze({status:'NOOP_IN_SAME_TRANSACTION',
    mayCommit:true,changedItemIDs:Object.freeze([])});
  const guardedShips=new Set();
  for(const id of changed){
   const current=before[String(id)],candidate=next[String(id)];
   if(current!==undefined&&current!==null){
    const oldParent=containingShip(before,id);
    if(oldParent.unresolved)return fail('PF89_EXISTING_ITEM_PARENT_UNVERIFIED');
    if(oldParent.ship!==null)guardedShips.add(oldParent.ship);
   }
   if(candidate!==undefined&&candidate!==null){
    if(current===undefined&&candidate.categoryID===6)
     return fail('PF89_SHIP_CREATION_REQUIRES_ORIGINAL_ITEMSTORE');
    const newParent=containingShip(next,id);
    if(newParent.unresolved)return fail('PF89_NEW_ITEM_PARENT_UNVERIFIED');
    if(newParent.ship!==null)guardedShips.add(newParent.ship);
   }
  }
  // Validate every ship actually reached, not just any caller-declared
  // ship or itemID. Reservation and actor claims are read INSIDE this tx.
  for(const ship of [...guardedShips].sort((a,b)=>a-b)){
   const status=inTransaction({tx,writer,shipItemID:ship});
   if(status.mayCommit!==true)return status;
  }
  // A builder that independently changed GameStore while we inspected its
  // clone requires a THROW, not a "blocked" return: roll back its side effects.
  const live=tx.get('items','items');
  if(!isDeepStrictEqual(before,live))
   throw Error('PF89_STOCK_ITEMS_CHANGED_DURING_BUILDER_ROLLBACK');
  tx.put('items','items',next);
  return Object.freeze({status:'APPLIED_WITH_RECIPROCAL_CUSTODY',
   mayCommit:true,changedItemIDs:Object.freeze(changed),
   originalShipIDs:Object.freeze([...guardedShips].sort((a,b)=>a-b))});
 }
 /**
  * PF90: pure snapshot form of the original ItemStore owner write.
  *
  * The caller captures expectedBefore BEFORE preparing any mutation.
  * It must never pass a previously-mutated shared GameStore cache as
  * expectedBefore. The SAME SQLite tx compares that snapshot with durable
  * original items and writes only the independently prepared nextItems.
  *
  * No untrusted builder callback is accepted from the original owner; that
  * avoids PF89's callback closure capturing the transaction and writing
  * other rows. The actual original owner still needs to invoke this API
  * rather than a later asynchronous repo.write() — NOT INSTALLED YET.
  */
 function commitOriginalOwnerSnapshot({tx,writer,expectedBefore,nextItems,
                                       declaredItemIDs=null}={}){
  if(!writerKinds.has(writer)||typeof tx?.get!=='function'||
     typeof tx?.put!=='function'||!rootItem(expectedBefore)||
     !rootItem(nextItems))
   return fail('PF90_ORIGINAL_OWNER_SNAPSHOT_AUTHORITIES_REQUIRED');
  let inputCurrent,proposal,beforeCopy;
  try{
   // Forbid JSON-incompatible source state and reject functions, symbols,
   // undefined, NaN and object prototypes BEFORE durable transaction writes.
   const copyJson=(raw)=>{
    const cloned=structuredClone(raw);
    const text=JSON.stringify(cloned);
    const parsed=JSON.parse(text);
    if(!isDeepStrictEqual(cloned,parsed))
     throw Error('PF90_NON_JSON_OWNER_SNAPSHOT');
    return parsed;
   };
   beforeCopy=copyJson(expectedBefore);
   proposal=copyJson(nextItems);
   inputCurrent=tx.get('items','items');
  }catch{return fail('PF90_ORIGINAL_OWNER_SNAPSHOT_UNREADABLE');}
  if(!rootItem(inputCurrent)||!isDeepStrictEqual(inputCurrent,beforeCopy))
   return fail('PF90_ORIGINAL_OWNER_STALE_SNAPSHOT');
  // PF89 is the single delta/custody authority. We only replace the
  // isolated, mutable clone it gives the builder — no external tx mutation.
  return mutateOriginalItemsInTransaction({tx,writer,declaredItemIDs,
   buildNext:(working)=>{
    for(const id of Object.keys(working))delete working[id];
    for(const [id,value] of Object.entries(proposal))
     working[id]=structuredClone(value);
    return true;
   }});
 }
 return Object.freeze({inTransaction,mutateOriginalItemsInTransaction,
  commitOriginalOwnerSnapshot});
}

module.exports={createPermitVerifier,validateOriginalClaimsIndex,
 createReciprocalWriterFence};
