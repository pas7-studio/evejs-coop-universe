'use strict';
// PF-01B source-ready reciprocal writer guard. NON-DEPLOYED reference.
// Import this at the ORIGINAL WAR / mining / expedition assignment writer,
// inside the SAME coopAtomicNativeRows.transact(["corporationRuntime"], tx => ...)
// before committing a competing actor's exclusive reservation.
// IMPORTANT: this guard alone is necessary but NOT sufficient: the PF writer
// must also prove all legacy writer paths have been modified and exercised.
const TABLE='corporationRuntime';
const KEY='coop-personal-fleet\u001factor-claims-v1';
const PILOT=/^coop-pilot-[0-9]{3,}$/;
const pos=x=>Number.isSafeInteger(x)&&x>0;
const block=reason=>Object.freeze({ok:false,reason});
function assertPersonalFleetActorFree(tx,{entityID,pilotID}={}){
 if(typeof tx?.get!=='function'||!pos(entityID)||!PILOT.test(pilotID))
  return block('PF_WRITER_GUARD_INVALID_CONTEXT');
 let state;
 try{state=tx.get(TABLE,KEY);}
 catch{return block('PF_WRITER_GUARD_STORE_UNAVAILABLE');}
 if(state===null){
  // Legacy WAR/mining may operate without PF records. PF integration rollout
  // must also guarantee this module/guard is installed in all writer paths.
  return Object.freeze({ok:true,reason:'PF_CLAIM_ROW_ABSENT'});
 }
 if(!state||state.version!==1||!state.claims||!state.generations||
   !state.processed||[state.claims,state.generations,state.processed]
     .some(x=>!x||typeof x!=='object'||Array.isArray(x))||
   Object.keys(state.claims).length>128||
   Object.keys(state.generations).length>1024||
   Object.keys(state.processed).length>1024)
  return block('PF_WRITER_GUARD_CORRUPT');
 const pilots=new Set();
 let reserved=false;
 for(const [key,c] of Object.entries(state.claims)){
  if(!pos(Number(key))||String(Number(key))!==key||!c||
    c.entityID!==Number(key)||!PILOT.test(c.pilotID)||
    !pos(c.ownerCharacterID)||!pos(c.systemID)||
    c.ownerType!=='PERSONAL_FLEET'||!pos(c.generation)||
    !pos(state.generations[key])||state.generations[key]<c.generation||
    pilots.has(c.pilotID))return block('PF_WRITER_GUARD_CORRUPT');
  pilots.add(c.pilotID);
  if(c.entityID===entityID||c.pilotID===pilotID)reserved=true;
 }
 for(const [key,g] of Object.entries(state.generations))
  if(!pos(Number(key))||String(Number(key))!==key||!pos(g))
   return block('PF_WRITER_GUARD_CORRUPT');
 for(const [key,r] of Object.entries(state.processed))
  if(typeof key!=='string'||!key.length||key.length>128||!r||
    typeof r.signature!=='string'||!r.receipt)
   return block('PF_WRITER_GUARD_CORRUPT');
 if(reserved)return block('PF_ACTOR_ALREADY_RESERVED');
 // A legacy writer may safely proceed after this guard ONLY while the same
 // serialized transaction protects its own record and PF claim row.
 return Object.freeze({ok:true,reason:'PF_ACTOR_FREE'});
}
module.exports={KEY,TABLE,assertPersonalFleetActorFree};
