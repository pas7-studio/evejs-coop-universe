'use strict';
/** PF58 read-only original GameStore permit for native materialization.
 * The initial PF54 ISSUING is accepted only for explicit one-shot adoption;
 * ordinary startup/reload requires PF54 ACTIVE + a matching PF actor claim.
 */
const T='corporationRuntime',SEP='\u001f';
const prefix='coop-personal-fleet'+SEP;
const pos=x=>Number.isSafeInteger(x)&&x>0;
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
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
   const claimRoot=tx.get(T,prefix+'actor-claims-v1');
   if(claimRoot===undefined)return false;
   const claim=claimRoot?.claims?.[String(e.entityID)];
   if(row.phase==='ISSUING'){
     return allowIssuing===true&&row.dispatchCount===1&&claim==null;
   }
   return !!claim&&claim.ownerType==='PERSONAL_FLEET'&&
    claim.entityID===e.entityID&&claim.ownerCharacterID===e.ownerID&&
    claim.pilotID===e.personalFleetPilotID&&
    claim.assignmentID===e.personalFleetAssignmentID&&
    claim.systemID===e.systemID&&claim.generation===row.actorGeneration;
  })===true;}catch{return false;}
 }
 return Object.freeze({verify});
}
module.exports={createPermitVerifier};
