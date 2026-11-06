'use strict';
/** PF58/PF65 read-only original GameStore permit for native materialization.
 * Initial adoption: PF54 ISSUING and no competing pilot/ship claims globally.
 * Restart: PF54 ACTIVE and the one matching original claim. Malformed global
 * claims NEVER count as empty (including an unrelated corrupt row).
 */
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
module.exports={createPermitVerifier,validateOriginalClaimsIndex};
