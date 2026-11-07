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
/**
 * PF91: scan ORIGINAL per-character SQLite keys inside the caller's one
 * BEGIN IMMEDIATE transaction. The stock characterState repository writes
 * paths /<characterID>, NOT a synthetic 'characters' aggregate row.
 *
 * Fail closed on mixed/legacy fixtures, duplicate keys, unreadable scans,
 * invalid records, or an active hull held by any character in the universe.
 * This can only attest the database; live in-memory sessions additionally
 * need original native owner hooks (NOT installed by this archive).
 */
function inspectOriginalCharacterShipRows(tx,{ownerCharacterID,shipItemID,
 allowOwnerAlreadyActive=false}={}){
 const reject=reason=>Object.freeze({status:'BLOCKED',reason,verified:false});
 if(!pos(ownerCharacterID)||!pos(shipItemID)||
    typeof tx?.get!=='function'||typeof tx?.scan!=='function')
  return reject('PF91_ORIGINAL_CHARACTER_SCAN_AUTHORITY_REQUIRED');
 try{
  const records=tx.scan('characters');
  if(!Array.isArray(records)||records.length===0||records.length>250000)
   return reject('PF91_ORIGINAL_CHARACTER_ROWSET_UNAVAILABLE');
  const seen=new Set();
  let ownerRecord=null;
  for(const entry of records){
   const key=entry?.key,record=entry?.value;
   if(typeof key!=='string'||!/^[1-9][0-9]*$/.test(key)||
      !pos(Number(key))||String(Number(key))!==key||seen.has(key)||
      !obj(record)||(record.characterID!==undefined&&
        record.characterID!==Number(key)))
    return reject('PF91_ORIGINAL_CHARACTER_ROW_INVALID');
   seen.add(key);
   if(key===String(ownerCharacterID))ownerRecord=record;
   const aliases=[record.shipID,record.shipid,record.activeShipID];
   const activeIDs=new Set();
   for(const active of aliases){
    if(active===undefined||active===null||active===0)continue;
    const id=typeof active==='string'&&/^[1-9][0-9]*$/.test(active)?
      Number(active):active;
    if(!pos(id))
     return reject('PF92_ORIGINAL_ACTIVE_SHIP_ALIAS_INVALID');
    activeIDs.add(id);
   }
   if(activeIDs.size>1)
    return reject('PF92_ORIGINAL_ACTIVE_SHIP_ALIASES_CONFLICT');
   if(activeIDs.has(shipItemID)&&
      !(allowOwnerAlreadyActive===true&&key===String(ownerCharacterID)))
    return reject('PF91_ORIGINAL_SHIP_ACTIVE_FOR_CHARACTER');
  }
  if(!ownerRecord)
   return reject('PF91_ORIGINAL_CHARACTER_OWNER_MISSING');
  const owner=tx.get('characters',String(ownerCharacterID));
  if(!obj(owner)||!isDeepStrictEqual(owner,ownerRecord))
   return reject('PF91_ORIGINAL_CHARACTER_OWNER_DRIFT');
  return Object.freeze({status:'CLEAR_IN_SAME_TRANSACTION',
   verified:true,ownerCharacterID,checkedRows:records.length});
 }catch{return reject('PF91_ORIGINAL_CHARACTER_SCAN_FAILED');}
}

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

/**
 * PF91 original characterState target ship activation, staged for the REAL
 * stock character owner. Existing stock characterState.activateShipForSession
 * DOES NOT call this yet; until it does, source-bound gameplay remains OFF.
 * Commit the exact original character row and read PF title/claims in ONE
 * original BEGIN IMMEDIATE. No secondary owner or synthetic characters map.
 */
/**
 * PF93: the original GameStore's explicit mutation scope is
 * corporationRuntime + items + characters. Never trust an external session
 * witness merely because the facade offered read-only methods: its closure
 * may still capture another writer capability.
 *
 * The ONLY evidence available with the existing original SQLite adapter is
 * to compare the complete declared table contents before and after each
 * witness call, then throw (not BLOCKED) if they differ. Any thrown error
 * causes the original SQLite owner to ROLLBACK. Future original native
 * integration should replace O(database) scans with an owner-controlled
 * transaction write-generation counter; no such counter exists today.
 *
 * This is for uncommon protected title transitions, NOT every wallet write.
 * The cost cap rejects huge tables rather than silently skipping rows.
 */
const ORIGINAL_WITNESS_TABLES=Object.freeze([T,'items','characters']);
function fingerprintOriginalWitnessRows(tx){
 if(typeof tx?.scan!=='function'||typeof tx?.get!=='function')
  throw Error('PF93_ORIGINAL_ROWSET_SCAN_REQUIRED');
 const maxRows=250000,maxChars=64*1024*1024;
 const hash=crypto.createHash('sha256');
 let seenChars=0;
 for(const table of ORIGINAL_WITNESS_TABLES){
  const rows=tx.scan(table);
  if(!Array.isArray(rows)||rows.length>maxRows)
   throw Error('PF93_ORIGINAL_ROWSET_SCAN_INVALID');
  const keys=new Set(),sorted=[];
  for(const row of rows){
   if(typeof row?.key!=='string'||row.key.length===0||
      row.key.length>1024||keys.has(row.key))
    throw Error('PF93_ORIGINAL_ROWSET_KEY_INVALID');
   keys.add(row.key);
   const json=JSON.stringify(row.value);
   if(typeof json!=='string')
    throw Error('PF93_ORIGINAL_ROWSET_JSON_INVALID');
   seenChars+=row.key.length+json.length+32;
   if(seenChars>maxChars)
    throw Error('PF93_ORIGINAL_WITNESS_SCAN_LIMIT');
   sorted.push([row.key,json]);
  }
  sorted.sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0);
  // Length-prefixed JSON tuple framing is unambiguous even for original
  // corporationRuntime keys containing ASCII control separators (U+001F).
  // Raw concatenation with those separators is not collision-safe framing.
  hash.update(JSON.stringify([table,sorted]));
 }
 return hash.digest('hex');
}
/**
 * PF98: production-like native Personal Fleet transactions MUST ask the
 * source-owned PF95/PF96 original SQLite GameStore to verify the live
 * character/session witness. A SHA256 before/after table fingerprint cannot
 * prove absence of write-then-restore, identical writes or missing-row deletes.
 *
 * The PF93 fingerprint remains only for archived OFF-mode contract tests:
 * flag ON MUST NEVER fall back to hashing or caller-supplied pseudo owners.
 * Native tx provenance itself is proven only by the source-pinned original
 * GameStore owner installation, not by this module in isolation.
 */
function verifyOriginalWitnessCannotWrite(tx,callback,request){
 if(process.env.EVEJS_COOP_PERSONAL_FLEET_NATIVE_WITNESS==='1'){
  if(typeof tx?.verifyReadOnlySessionWitness!=='function')
   throw Error('PF98_ORIGINAL_SQLITE_OWNER_SESSION_WITNESS_REQUIRED');
  const verdict=tx.verifyReadOnlySessionWitness(callback,request);
  if(verdict&&typeof verdict.then==='function')
   throw Error('PF98_ASYNC_ORIGINAL_OWNER_WITNESS_FORBIDDEN');
  return verdict===true;
 }
 // PF93 legacy compatibility only while native witness flag is OFF.
 const before=fingerprintOriginalWitnessRows(tx);
 const reader=Object.freeze({
  get:(table,key)=>structuredClone(tx.get(table,key)),
  scan:table=>structuredClone(tx.scan(table))
 });
 let answer,issue=null;
 try{
  answer=callback(request,reader);
  if(answer&&typeof answer.then==='function')
   throw Error('PF93_ASYNC_SESSION_WITNESS_FORBIDDEN');
 }catch(e){issue=e;}
 const after=fingerprintOriginalWitnessRows(tx);
 if(before!==after)
  throw Error('PF93_SESSION_WITNESS_MUTATED_ORIGINAL_SQLITE_ROLLBACK');
 if(issue)throw issue;
 return answer===true;
}

function createOriginalPlayerShipActivation({
 gameStore,pf52,enabled=()=>false,allWritersFenced=()=>false,
 verifyOriginalDockedPlayerSession=()=>false
}={}){
 const a=gameStore?.coopAtomicNativeRows;
 if(a?.mode!=='SERVER_INTERNAL_FLAGGED'||typeof a.transact!=='function'||
    typeof a.isPoisoned!=='function'||typeof enabled!=='function'||
    typeof allWritersFenced!=='function'||
    typeof verifyOriginalDockedPlayerSession!=='function')
  throw Error('PF91_ORIGINAL_CHARACTER_OWNER_AUTHORITIES_REQUIRED');
 const fence=createReciprocalWriterFence({pf52});
 const block=reason=>Object.freeze({status:'BLOCKED',reason,mayCommit:false});
 const cleanSnapshot=value=>{
  if(!obj(value))return null;
  const copy=structuredClone(value);
  const roundtrip=JSON.parse(JSON.stringify(copy));
  return isDeepStrictEqual(copy,roundtrip)?roundtrip:null;
 };
 function activate({characterID,targetShipItemID,stationID,expectedBefore,
                    session=null}={}){
  if(!pos(characterID)||!pos(targetShipItemID)||!pos(stationID)||
     !obj(expectedBefore)||!obj(session))
   return block('PF91_PLAYER_ACTIVATION_INPUT_INVALID');
  if(enabled()!==true||allWritersFenced()!==true||a.isPoisoned())
   return block('PF91_PLAYER_ACTIVATION_DISABLED');
  let before;
  try{before=cleanSnapshot(expectedBefore);}
  catch{return block('PF91_PLAYER_ACTIVATION_SNAPSHOT_INVALID');}
  if(!before)return block('PF91_PLAYER_ACTIVATION_SNAPSHOT_INVALID');
  try{return a.transact([T,'items','characters'],tx=>{
   if(enabled()!==true||allWritersFenced()!==true)
    return block('PF91_PLAYER_ACTIVATION_DISABLED');
   // Live native session evidence is NOT a durable row. The actual stock
   // character owner must supply a source-bound witness on every call.
   if(!verifyOriginalWitnessCannotWrite(tx,
      verifyOriginalDockedPlayerSession,
      Object.freeze({session,characterID,stationID})))
    return block('PF91_ORIGINAL_PLAYER_SESSION_UNVERIFIED');
   const original=tx.get('characters',String(characterID));
   if(!obj(original)||original.characterID!==undefined&&
      original.characterID!==characterID||
      !isDeepStrictEqual(original,before))
    return block('PF91_CHARACTER_OWNER_SNAPSHOT_STALE');
   const items=tx.get('items','items');
   const target=obj(items)?items[String(targetShipItemID)]:null;
   if(!obj(target)||target.itemID!==targetShipItemID||
      target.ownerID!==characterID||target.categoryID!==6||
      target.flagID!==4||target.locationID!==stationID||
      !pos(target.typeID)||target.singleton!==1)
    return block('PF91_PLAYER_TARGET_NOT_ORIGINAL_HANGAR');
   const present=inspectOriginalCharacterShipRows(tx,{
    ownerCharacterID:characterID,shipItemID:targetShipItemID});
   if(!present.verified)return block(present.reason);
   const targetFence=fence.inTransaction({tx,writer:'PLAYER',
    shipItemID:targetShipItemID});
   if(targetFence.mayCommit!==true)return block(targetFence.reason);
   const old=original.shipID===undefined?null:original.shipID;
   const oldID=(typeof old==='string'&&/^[1-9][0-9]*$/.test(old))?
     Number(old):old;
   if(oldID!==null&&oldID!==0&&oldID!==undefined){
    if(!pos(oldID))return block('PF91_ORIGINAL_ACTIVE_SHIP_ID_INVALID');
    if(oldID===targetShipItemID)
     return block('PF91_ALREADY_ACTIVE_OR_INCONSISTENT');
    const currentFence=fence.inTransaction({tx,writer:'PLAYER',shipItemID:oldID});
    if(currentFence.mayCommit!==true)return block(currentFence.reason);
   }
   if(!verifyOriginalWitnessCannotWrite(tx,
      verifyOriginalDockedPlayerSession,
      Object.freeze({session,characterID,stationID})))
    return block('PF91_ORIGINAL_PLAYER_SESSION_REVOKED');
   const updated=structuredClone(original);
   updated.shipID=target.itemID;
   updated.shipTypeID=target.typeID;
   updated.shipName=target.itemName??null;
   if(Object.prototype.hasOwnProperty.call(updated,'storedShips'))
    delete updated.storedShips;
   tx.put('characters',String(characterID),updated);
   const saved=tx.get('characters',String(characterID));
   if(!isDeepStrictEqual(saved,updated))
    throw Error('PF91_ORIGINAL_CHARACTER_WRITE_READBACK_FAILED');
   return Object.freeze({status:'APPLIED_IN_ORIGINAL_SQLITE_TRANSACTION',
    mayCommit:true,characterID,previousShipID:oldID??null,
    targetShipItemID,stationID});
  });}catch{return block('PF91_ORIGINAL_CHARACTER_TRANSACTION_FAILED');}
 }
 return Object.freeze({activate});
}

/**
 * PF92 — generic ORIGINAL characterState.writeCharacterRecord() owner path.
 *
 * The original character owner can update ship identity from several entry
 * points, not only activateShipForSession(): active-ship repair, migration,
 * normalization, and generic updateCharacterRecord() also reach its writer.
 *
 * Future stock integration MUST replace that owner's async repo.write with
 * this single durable SQLite transaction (and preserve cache/notifications).
 * The candidate below is not injected or installed in the original engine.
 */
function createOriginalCharacterRecordWriteBarrier({pf52,
 verifyOriginalSessionLease=()=>false}={}){
 if(typeof verifyOriginalSessionLease!=='function')
  throw Error('PF92_ORIGINAL_SESSION_LEASE_READER_REQUIRED');
 const fence=createReciprocalWriterFence({pf52});
 const fail=reason=>Object.freeze({status:'BLOCKED',reason,mayCommit:false});
 const cloneJson=value=>{
  const copy=structuredClone(value);
  const json=JSON.parse(JSON.stringify(copy));
  return isDeepStrictEqual(copy,json)?json:null;
 };
 const activeId=record=>{
  const ids=new Set();
  for(const k of ['shipID','shipid','activeShipID']){
   const value=record[k];
   if(value===undefined||value===null||value===0)continue;
   const id=typeof value==='string'&&/^[1-9][0-9]*$/.test(value)?
    Number(value):value;
   if(!pos(id))return {bad:true};
   ids.add(id);
  }
  if(ids.size>1)return {bad:true};
  return {id:ids.size===1?[...ids][0]:null};
 };
 const protectedFields=['shipID','shipid','activeShipID',
  'shipTypeID','shipName','storedShips'];
 function inTransaction({tx,characterID,expectedBefore,nextRecord,
                         session=null}={}){
  if(!pos(characterID)||typeof tx?.get!=='function'||
     typeof tx?.put!=='function'||!obj(expectedBefore)||!obj(nextRecord))
   return fail('PF92_CHARACTER_OWNER_AUTHORITIES_REQUIRED');
  let before,after;
  try{
   before=cloneJson(expectedBefore);
   after=cloneJson(nextRecord);
  }catch{return fail('PF92_CHARACTER_SNAPSHOT_UNSERIALIZABLE');}
  if(!before||!after||
     (before.characterID!==undefined&&before.characterID!==characterID)||
     (after.characterID!==undefined&&after.characterID!==characterID))
   return fail('PF92_CHARACTER_OWNER_IDENTITY_INVALID');
  try{
   const current=tx.get('characters',String(characterID));
   if(!obj(current)||!isDeepStrictEqual(current,before))
    return fail('PF92_CHARACTER_BEFORE_IMAGE_STALE');
   const prior=activeId(before),next=activeId(after);
   if(prior.bad||next.bad)
    return fail('PF92_CHARACTER_ACTIVE_SHIP_ALIAS_INVALID');
   const sensitive=protectedFields.some(k=>
    !isDeepStrictEqual(before[k],after[k]));
   if(!sensitive&&isDeepStrictEqual(before,after))
    return Object.freeze({status:'NOOP_IN_SAME_TRANSACTION',
     mayCommit:true,characterID,protectedChange:false});
   if(sensitive){
    // This is source-bound original character/session evidence, not a
    // caller-supplied boolean. Returning false or throwing denies writes.
    const witness=Object.freeze({characterID,previousShipItemID:prior.id,
     nextShipItemID:next.id,session});
    // The verifier receives a READ-ONLY view: never lend an original
    // SQLite writer's put/del capability to a session/session-lease probe.
    // The witness is invoked ONLY through PF93's read-only facade with
    // a complete original SQLite rowset mutation check.
    const items=tx.get('items','items');
    if(!obj(items))return fail('PF92_ORIGINAL_ITEMS_UNAVAILABLE');
    const firstLease=verifyOriginalWitnessCannotWrite(tx,verifyOriginalSessionLease,witness);
    // Callback closures can capture the outer tx despite receiving a
    // read-only view. A failed witness after any direct put must THROW
    // to roll back the transaction rather than return a BLOCKED result.
    if(!isDeepStrictEqual(tx.get('items','items'),items)||
       !isDeepStrictEqual(tx.get('characters',String(characterID)),before))
     throw Error('PF92_SESSION_WITNESS_MODIFIED_AUTHORITY_ROLLBACK');
    if(firstLease!==true)
     return fail('PF92_CHARACTER_SESSION_LEASE_REQUIRED');
    const touched=[...new Set([prior.id,next.id].filter(pos))]
     .sort((a,b)=>a-b);
    for(const id of touched){
     const item=items[String(id)];
     if(!obj(item)||item.itemID!==id||item.ownerID!==characterID||
        item.categoryID!==6||!pos(item.typeID))
      return fail('PF92_CHARACTER_SHIP_TITLE_UNVERIFIED');
     const custody=fence.inTransaction({tx,writer:'PLAYER',shipItemID:id});
     if(custody.mayCommit!==true)return fail(custody.reason);
    }
    if(next.id!==null){
     const hull=items[String(next.id)];
     if(after.shipTypeID!==undefined&&after.shipTypeID!==null&&
        after.shipTypeID!==hull.typeID)
      return fail('PF92_CHARACTER_SHIP_TYPE_MISMATCH');
     if(after.shipName!==undefined&&after.shipName!==null&&
        hull.itemName!==undefined&&hull.itemName!==null&&
        after.shipName!==hull.itemName)
      return fail('PF92_CHARACTER_SHIP_NAME_MISMATCH');
     const scan=inspectOriginalCharacterShipRows(tx,{
      ownerCharacterID:characterID,shipItemID:next.id,
      allowOwnerAlreadyActive:prior.id===next.id});
     if(scan.verified!==true)return fail(scan.reason);
    }else if(prior.id!==null){
     // Leaving the current hull must not let another original character
     // have silently taken it while the owner detached.
     const scan=inspectOriginalCharacterShipRows(tx,{
      ownerCharacterID:characterID,shipItemID:prior.id,
      allowOwnerAlreadyActive:true});
     if(scan.verified!==true)return fail(scan.reason);
    }
    const finalLease=verifyOriginalWitnessCannotWrite(tx,verifyOriginalSessionLease,witness);
    if(!isDeepStrictEqual(tx.get('items','items'),items)||
       !isDeepStrictEqual(tx.get('characters',String(characterID)),before))
     throw Error('PF92_ORIGINAL_OWNER_CHANGED_BY_SESSION_WITNESS_ROLLBACK');
    for(const id of touched){
     const recustody=fence.inTransaction({tx,writer:'PLAYER',shipItemID:id});
     if(recustody.mayCommit!==true)
      return fail(recustody.reason);
    }
    if(finalLease!==true)
     return fail('PF92_CHARACTER_SESSION_LEASE_REVOKED');
   }
   // Even purely economic/skill writes cannot silently overwrite a newer
   // player ship selection based on an obsolete detached character record.
   if(!isDeepStrictEqual(tx.get('characters',String(characterID)),before))
    throw Error('PF92_CHARACTER_ROW_CHANGED_DURING_GUARD_ROLLBACK');
   tx.put('characters',String(characterID),after);
   if(!isDeepStrictEqual(tx.get('characters',String(characterID)),after))
    throw Error('PF92_CHARACTER_WRITE_READBACK_FAILED_ROLLBACK');
   return Object.freeze({status:'APPLIED_ORIGINAL_CHARACTER_ROW',
    mayCommit:true,characterID,protectedChange:sensitive,
    previousShipItemID:prior.id,nextShipItemID:next.id});
  }catch(e){
   // Never turn an unsafe, possibly already-mutated tx into a returned
   // BLOCKED result: it MUST throw so original GameStore rolls back.
   throw Error('PF92_CHARACTER_TRANSACTION_ABORT:'+String(e?.message||e));
  }
 }
 return Object.freeze({inTransaction});
}

module.exports={createPermitVerifier,validateOriginalClaimsIndex,
 createReciprocalWriterFence,inspectOriginalCharacterShipRows,
 createOriginalPlayerShipActivation,createOriginalCharacterRecordWriteBarrier};
