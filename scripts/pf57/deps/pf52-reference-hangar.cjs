'use strict';
/**
 * PF-52: stock ItemStore hangar snapshot + canonical corporationRuntime
 * reservation in ONE original GameStore SQLite transaction.
 *
 * Does not fabricate NPCs, hire prices, ship IDs, item titles or a wallet.
 * Import a hire only after an independent native paid-contract proof. The
 * adapter must be integrated with ALL ItemStore ownership writers and other
 * fleet writers before its opt-in can ever be enabled.
 */
const crypto = require('node:crypto');
const TABLE = 'corporationRuntime';
const ITEM_TABLE = 'items';
const REGISTRY_KEY = 'coop-personal-fleet\u001fhangar-reservations-v1';
const ROSTER_PREFIX = 'coop-personal-fleet\u001fhangar-roster-v1:';
const WAR_KEY = 'coop-faction-war\u001ffleet-registry-v1';
const PF_ACTOR_KEY = 'coop-personal-fleet\u001factor-claims-v1';
const TOKEN=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const PILOT=/^coop-pilot-[0-9]{3,}$/;
const HASH=/^[a-f0-9]{64}$/;
const positive = x => Number.isSafeInteger(x) && x>0;
const obj = x => x!==null && typeof x==='object' && !Array.isArray(x);
const own = (o,k) => Object.prototype.hasOwnProperty.call(o,k);
const deny = (reason, status='BLOCKED') => ({status,reason});
const clone = x => structuredClone(x);
const rosterKey = owner => ROSTER_PREFIX+owner;
const signature = x => crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const newIndex=()=>({version:1,pilots:{},ships:{},contracts:{},generations:{},processed:{}});
const newRoster=owner=>({version:1,ownerCharacterID:owner,revision:0,pilots:{}});

function validateIndex(index){
 if(!obj(index)||index.version!==1||!obj(index.pilots)||!obj(index.ships)||
    !obj(index.contracts)||!obj(index.generations)||!obj(index.processed)||
    Object.keys(index.pilots).length>256||Object.keys(index.ships).length>256||
    Object.keys(index.contracts).length>256||Object.keys(index.generations).length>1024||Object.keys(index.processed).length>2048)
  throw Error('PF52_INDEX_INVALID');
 for(const [pilot,row] of Object.entries(index.pilots)){
  if(!PILOT.test(pilot)||!obj(row)||!positive(row.ownerCharacterID)||
     !TOKEN.test(row.contractID)||row.pilotID!==pilot||
     !HASH.test(row.hireReceiptHash))throw Error('PF52_INDEX_PILOT_INVALID');
 }
 for(const [id,row] of Object.entries(index.ships)){
  if(!positive(Number(id))||String(Number(id))!==id||!obj(row)||
     !positive(row.ownerCharacterID)||!PILOT.test(row.pilotID)||
     row.shipItemID!==Number(id)||!positive(row.stationID)||
     !positive(row.generation)||!TOKEN.test(row.assignmentID)||
     !own(index.pilots,row.pilotID)||
     index.pilots[row.pilotID].ownerCharacterID!==row.ownerCharacterID||
     index.generations[id]!==row.generation)
   throw Error('PF52_INDEX_SHIP_INVALID');
 }
 for(const [id,pilot] of Object.entries(index.contracts)){
  if(!TOKEN.test(id)||!PILOT.test(pilot)||index.pilots[pilot]?.contractID!==id)
   throw Error('PF52_INDEX_CONTRACT_INVALID');
 }
 for(const [id,generation] of Object.entries(index.generations)){
  if(!positive(Number(id))||String(Number(id))!==id||!positive(generation))
   throw Error('PF52_INDEX_GENERATION_INVALID');
 }
 for(const [pilot,row] of Object.entries(index.pilots)){
  if(index.contracts[row.contractID]!==pilot)throw Error('PF52_INDEX_REVERSE_CONTRACT_INVALID');
 }
 const boundPilots=new Set();
 for(const row of Object.values(index.ships)){
  if(boundPilots.has(row.pilotID))throw Error('PF52_INDEX_DOUBLE_SHIP_PER_PILOT');
  boundPilots.add(row.pilotID);
 }
 for(const [op,row] of Object.entries(index.processed)){
  if(!TOKEN.test(op)||!obj(row)||!HASH.test(row.signature)||
     !obj(row.receipt)||!['HIRED','HANGAR_RESERVED','HANGAR_RELEASED'].includes(row.receipt.type))
   throw Error('PF52_REPLAY_INDEX_INVALID');
 }
 return index;
}
function validateRoster(roster,owner){
 if(!obj(roster)||roster.version!==1||roster.ownerCharacterID!==owner||
    !Number.isSafeInteger(roster.revision)||roster.revision<0||
    !obj(roster.pilots)||Object.keys(roster.pilots).length>24)
  throw Error('PF52_ROSTER_INVALID');
 for(const [pilot,p] of Object.entries(roster.pilots)){
  if(!PILOT.test(pilot)||!obj(p)||p.pilotID!==pilot||
     !TOKEN.test(p.contractID)||!HASH.test(p.hireReceiptHash)||
     !['CONTRACTED','HANGAR_RESERVED'].includes(p.status)||
     !Number.isSafeInteger(p.revision)||p.revision<0||
     (p.status==='HANGAR_RESERVED'?!positive(p.shipItemID)||!positive(p.generation)||
       !TOKEN.test(p.assignmentID):p.shipItemID!==null))
   throw Error('PF52_ROSTER_PILOT_INVALID');
 }
 return roster;
}

// Authoritative ORIGINAL itemStore stores /items as a { itemID: item } root.
// Never accept a synthetic or nativeNpcStore-only hull as a player-owned ship.
function checkCompetingClaims(tx,cmd){
 const war=tx.get(TABLE,WAR_KEY);
 const actors=tx.get(TABLE,PF_ACTOR_KEY);
 if(war===undefined||actors===undefined)return 'PF52_OTHER_CLAIMS_READ_UNCERTAIN';
 if(war!==null){
  if(!obj(war)||war.version!==1||!obj(war.ships)||
     (war.transfers!==undefined&&!obj(war.transfers)))
    return 'PF52_WAR_REGISTRY_INVALID';
  for(const [id,ship] of Object.entries(war.ships)){
   if(!positive(Number(id))||String(Number(id))!==id||
      !obj(ship)||ship.entityID!==Number(id)||!PILOT.test(ship.pilotID))
     return 'PF52_WAR_REGISTRY_INVALID';
   if(ship.entityID===cmd.shipItemID||ship.pilotID===cmd.pilotID)
     return 'PF52_WAR_SHIP_OR_PILOT_RESERVED';
  }
  for(const [id,flight] of Object.entries(war.transfers||{})){
   if(!positive(Number(id))||String(Number(id))!==id||
      !obj(flight)||flight.entityID!==Number(id)||!PILOT.test(flight.pilotID))
    return 'PF52_WAR_TRANSFER_INVALID';
   if(flight.entityID===cmd.shipItemID||flight.pilotID===cmd.pilotID)
    return 'PF52_WAR_SHIP_OR_PILOT_RESERVED';
  }
 }
 if(actors!==null){
  if(!obj(actors)||actors.version!==1||!obj(actors.claims)||
     !obj(actors.generations)||!obj(actors.processed))
   return 'PF52_ACTOR_REGISTRY_INVALID';
  for(const [id,c] of Object.entries(actors.claims)){
   if(!positive(Number(id))||String(Number(id))!==id||!obj(c)||
      c.entityID!==Number(id)||!PILOT.test(c.pilotID)||
      !positive(c.ownerCharacterID)||c.ownerType!=='PERSONAL_FLEET')
     return 'PF52_ACTOR_REGISTRY_INVALID';
   if(c.entityID===cmd.shipItemID||c.pilotID===cmd.pilotID)
     return 'PF52_ACTIVE_PERSONAL_ACTOR_RESERVED';
  }
 }
 return null;
}
function readStockHangar(tx,shipID,owner,stationID){
 const items=tx.get(ITEM_TABLE,'items');
 if(!obj(items)||!own(items,String(shipID)))return null;
 const item=items[String(shipID)];
 if(!obj(item)||item.itemID!==shipID||item.ownerID!==owner||
    item.locationID!==stationID||item.flagID!==4||item.categoryID!==6||
    item.singleton!==1||item.stacksize!==1||item.quantity!==-1||
    !positive(item.typeID)||
    (item.shipID!==undefined&&item.shipID!==shipID)||
    (item.shipTypeID!==undefined&&item.shipTypeID!==item.typeID)||
    (item.spaceState!==undefined&&item.spaceState!==null))return null;
 return clone(item);
}
function createPersonalFleetHangarBridge({gameStore, access, verifyPaidHire,
 verifyShipAvailable, verifyRelease, enabled=()=>false,
 allWritersFenced=()=>false, clock=()=>Date.now()}={}){
 const atomic=gameStore?.coopAtomicNativeRows;
 if(typeof atomic?.transact!=='function'||typeof atomic?.isPoisoned!=='function'||
    typeof access?.isOwner!=='function'||
    [verifyPaidHire,verifyShipAvailable,verifyRelease,enabled,allWritersFenced,clock]
      .some(fn=>typeof fn!=='function'))throw Error('PF52_NATIVE_AUTHORITIES_REQUIRED');
 function transact(tables,fn){return atomic.transact(tables,fn);}
 function execute(command){
  if(enabled()!==true)return {status:'DISABLED'};
  // This must assert reciprocal integration of *original* ItemStore writers,
  // WAR, Mining, Exploration and station/ship deployment, not mere flags.
  if(allWritersFenced()!==true)return deny('PF52_ORIGINAL_WRITERS_NOT_FENCED');
  if(atomic.isPoisoned())return deny('PF52_GAMESTORE_POISONED');
  if(!obj(command)||!['IMPORT_PAID_HIRE','RESERVE_HANGAR_SHIP','RELEASE_HANGAR_SHIP'].includes(command.type)||
     !TOKEN.test(command.operationID)||!PILOT.test(command.pilotID)||
     !positive(command.ownerCharacterID)||
     // Expected revision 0 is valid for the first hire.
     !Number.isSafeInteger(command.expectedRosterRevision)||command.expectedRosterRevision<0||
     !obj(command.session)||command.session.characterID!==command.ownerCharacterID||
     !positive(command.session.userid)||command.session.socket?.destroyed===true)
   return deny('PF52_COMMAND_INVALID');
  if(access.isOwner(command.session,command.ownerCharacterID)!==true)
   return deny('PF52_AUTHENTICATION_REJECTED');
  const type=command.type;
  if(type==='IMPORT_PAID_HIRE'&&(!TOKEN.test(command.contractID)||
       !HASH.test(command.hireReceiptHash)))return deny('PF52_HIRE_RECEIPT_INVALID');
  if(type!=='IMPORT_PAID_HIRE'&&(!positive(command.shipItemID)||
     !positive(command.stationID)||!TOKEN.test(command.assignmentID)||
     !Number.isSafeInteger(command.expectedPilotRevision)||command.expectedPilotRevision<0))
   return deny('PF52_ASSIGNMENT_INPUT_INVALID');
  if(type==='RELEASE_HANGAR_SHIP'&&(!positive(command.expectedGeneration)))
   return deny('PF52_GENERATION_INVALID');
  const sig=signature([
   type,command.operationID,command.pilotID,command.ownerCharacterID,
   command.expectedRosterRevision,command.contractID??null,
   command.hireReceiptHash??null,command.shipItemID??null,
   command.stationID??null,command.assignmentID??null,
   command.expectedPilotRevision??null,command.expectedGeneration??null
  ]);
  try{
   const result=transact([TABLE,ITEM_TABLE],tx=>{
    // Repeat admission inside the original serialized transaction. A revoked
    // session or an integration gate turning OFF after preflight never writes.
    if(enabled()!==true)return deny('PF52_DISABLED_DURING_TX');
    if(allWritersFenced()!==true)return deny('PF52_WRITER_FENCE_REVOKED');
    if(access.isOwner(command.session,command.ownerCharacterID,tx)!==true)
      return deny('PF52_ACCESS_REVOKED_DURING_TX');
    // Exact-null check: undefined is not a trustworthy absence witness.
    const ir=tx.get(TABLE,REGISTRY_KEY),rr=tx.get(TABLE,rosterKey(command.ownerCharacterID));
    if(ir===undefined||rr===undefined)return deny('PF52_READ_UNCERTAIN');
    const index=validateIndex(ir===null?newIndex():ir);
    const roster=validateRoster(rr===null?newRoster(command.ownerCharacterID):rr,
      command.ownerCharacterID);
    const previous=index.processed[command.operationID];
    if(previous)return previous.signature===sig?
       {status:'DUPLICATE',receipt:clone(previous.receipt)}:deny('PF52_REPLAY_CONFLICT');
    if(index.processed[command.operationID]!==undefined||
       Object.keys(index.processed).length>=2048)return deny('PF52_REPLAY_CAP');
    if(roster.revision!==command.expectedRosterRevision)return deny('PF52_ROSTER_CAS_STALE');
    if(roster.revision>=Number.MAX_SAFE_INTEGER-1)return deny('PF52_ROSTER_REVISION_EXHAUSTED');
    const pilot=roster.pilots[command.pilotID];
    const globalPilot=index.pilots[command.pilotID];
    if(Boolean(pilot)!==Boolean(globalPilot)||
       (pilot&&(pilot.contractID!==globalPilot.contractID||
         pilot.hireReceiptHash!==globalPilot.hireReceiptHash||
         globalPilot.ownerCharacterID!==command.ownerCharacterID)))
      return deny('PF52_ROSTER_GLOBAL_DRIFT');
    let receipt;
    if(type==='IMPORT_PAID_HIRE'){
     if(pilot||index.pilots[command.pilotID]||
        index.contracts[command.contractID]||
        Object.keys(roster.pilots).length>=24||
        Object.keys(index.pilots).length>=256)return deny('PF52_HIRE_RESERVED');
     // Verify receipt against original native wallet+employment contract.
     // The function may READ tx tables, never synthesize an employer receipt.
     if(verifyPaidHire(command,tx)!==true)return deny('PF52_PAID_NATIVE_CONTRACT_NOT_VERIFIED');
     const row={pilotID:command.pilotID,contractID:command.contractID,
       hireReceiptHash:command.hireReceiptHash,status:'CONTRACTED',
       shipItemID:null,revision:0};
     roster.pilots[command.pilotID]=row;
     index.pilots[command.pilotID]={pilotID:command.pilotID,
       ownerCharacterID:command.ownerCharacterID,contractID:command.contractID,
       hireReceiptHash:command.hireReceiptHash};
     index.contracts[command.contractID]=command.pilotID;
     receipt={type:'HIRED',pilotID:command.pilotID,contractID:command.contractID};
    }else if(type==='RESERVE_HANGAR_SHIP'){
     if(!pilot||pilot.status!=='CONTRACTED'||pilot.shipItemID!==null||
        pilot.revision!==command.expectedPilotRevision||
        !own(index.pilots,command.pilotID)||
        index.pilots[command.pilotID].ownerCharacterID!==command.ownerCharacterID||
        index.ships[String(command.shipItemID)]||
        Object.keys(index.ships).length>=256)return deny('PF52_PILOT_OR_SHIP_RESERVED');
     const conflicting=checkCompetingClaims(tx,command);
     if(conflicting)return deny(conflicting);
     if(Object.values(index.ships).some(row=>row.assignmentID===command.assignmentID))
      return deny('PF52_ASSIGNMENT_ID_RESERVED');
     const item=readStockHangar(tx,command.shipItemID,command.ownerCharacterID,command.stationID);
     if(!item)return deny('PF52_ORIGINAL_HANGAR_TITLE_UNVERIFIED');
     // This MUST check the original station/docking and competing ownership
     // authorities. A claim-only ref cannot authorize a physical item.
     if(verifyShipAvailable({...command,stockItem:item},tx)!==true)
      return deny('PF52_ORIGINAL_SHIP_BUSY_OR_UNVERIFIED');
     const previous=index.generations[String(command.shipItemID)]||0;
     if(previous>=Number.MAX_SAFE_INTEGER-1)return deny('PF52_GENERATION_EXHAUSTED');
     const generation=previous+1;
     index.generations[String(command.shipItemID)]=generation;
     pilot.status='HANGAR_RESERVED';pilot.shipItemID=command.shipItemID;
     pilot.stationID=command.stationID;pilot.assignmentID=command.assignmentID;
     pilot.generation=generation;pilot.revision++;
     index.ships[String(command.shipItemID)]={shipItemID:command.shipItemID,
       ownerCharacterID:command.ownerCharacterID,pilotID:command.pilotID,
       stationID:command.stationID,assignmentID:command.assignmentID,generation};
     receipt={type:'HANGAR_RESERVED',pilotID:command.pilotID,
       shipItemID:command.shipItemID,generation,assignmentID:command.assignmentID};
    }else{
     const reserved=index.ships[String(command.shipItemID)];
     if(!pilot||pilot.status!=='HANGAR_RESERVED'||
        pilot.shipItemID!==command.shipItemID||
        pilot.revision!==command.expectedPilotRevision||
        pilot.generation!==command.expectedGeneration||
        pilot.assignmentID!==command.assignmentID||
        pilot.stationID!==command.stationID||
        !reserved||reserved.ownerCharacterID!==command.ownerCharacterID||
        reserved.pilotID!==command.pilotID||
        reserved.assignmentID!==command.assignmentID||
        reserved.generation!==command.expectedGeneration)
       return deny('PF52_RELEASE_CAS_FAILED');
     if(verifyRelease(command,tx)!==true)return deny('PF52_NATIVE_RELEASE_NOT_PROVEN');
     // Releases must prove original hull in the same station or a certified
     // loss/reconciliation; reject if ship silently changed its stock owner.
     if(!readStockHangar(tx,command.shipItemID,command.ownerCharacterID,command.stationID))
       return deny('PF52_ORIGINAL_HANGAR_RELEASE_UNVERIFIED');
     pilot.status='CONTRACTED';pilot.shipItemID=null;pilot.revision++;
     delete pilot.stationID;delete pilot.assignmentID;delete pilot.generation;
     delete index.ships[String(command.shipItemID)];
     receipt={type:'HANGAR_RELEASED',pilotID:command.pilotID,
       shipItemID:command.shipItemID,generation:command.expectedGeneration};
    }
    roster.revision++;
    index.processed[command.operationID]={signature:sig,receipt};
    validateRoster(roster,command.ownerCharacterID);
    validateIndex(index);
    tx.put(TABLE,rosterKey(command.ownerCharacterID),roster);
    tx.put(TABLE,REGISTRY_KEY,index);
    return {status:'APPLIED',receipt};
   });
   return result?.result&&result.status===undefined?result.result:result;
  }catch(error){
   return deny(error?.coopCommitOutcomeUnknown===true?
     'PF52_COMMIT_OUTCOME_UNKNOWN':'PF52_ATOMIC_STORE_REJECTED');
  }
 }
 function inspect({session,ownerCharacterID}={}){
  if(enabled()!==true)return {status:'DISABLED'};
  if(atomic.isPoisoned())return deny('PF52_GAMESTORE_POISONED');
  if(!positive(ownerCharacterID)||!positive(session?.userid)||
     session?.characterID!==ownerCharacterID||
     access.isOwner(session,ownerCharacterID)!==true)return deny('PF52_ACCESS_DENIED');
  try{
   return transact([TABLE],tx=>{
    const value=tx.get(TABLE,rosterKey(ownerCharacterID));
    if(value===undefined)return deny('PF52_READ_UNCERTAIN');
    return {status:'OK',roster:clone(validateRoster(value===null?newRoster(ownerCharacterID):value,ownerCharacterID))};
   });
  }catch{return deny('PF52_INSPECTION_UNAVAILABLE');}
 }
 return Object.freeze({execute,inspect});
}
module.exports={TABLE,ITEM_TABLE,REGISTRY_KEY,ROSTER_PREFIX,newIndex,newRoster,
 validateIndex,validateRoster,readStockHangar,checkCompetingClaims,createPersonalFleetHangarBridge};
