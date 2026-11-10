'use strict';
/**
 * PF103: real original WAR fleet assignment readback. Source-owned and
 * read-only. No private WAR registry, client source, or synthetic claim.
 * Every ambiguous original SQLite read is UNKNOWN, never UNASSIGNED.
 */
const gameStore=require('../gameStore');
const originalWar=require('./coopWarFleetRegistry');
const TOKEN=/^coop-pilot-[0-9]{3,}$/;
const pos=x=>Number.isSafeInteger(x)&&x>0;
const TABLE='corporationRuntime';
function createOriginalWarClaim(){
 const a=gameStore?.coopAtomicNativeRows;
 if(a?.mode!=='SERVER_INTERNAL_FLAGGED'||
    typeof a.transact!=='function'||typeof a.isPoisoned!=='function'||
    originalWar?.TABLE!==TABLE||
    originalWar?.KEY!=='coop-faction-war\u001ffleet-registry-v1'||
    typeof originalWar.validate!=='function'||typeof originalWar.empty!=='function')
  throw Error('PF103_ORIGINAL_WAR_SQLITE_REGISTRY_REQUIRED');
 function readOriginalWarShipClaim(link){
  if(!pos(link?.entityID)||!pos(link?.systemID)||
     typeof link?.pilotID!=='string'||!TOKEN.test(link.pilotID)||
     a.isPoisoned()!==false)return 'UNKNOWN';
  try{
   return a.transact([TABLE],tx=>{
    if(a.isPoisoned()||typeof tx?.get!=='function')return 'UNKNOWN';
    const raw=tx.get(TABLE,originalWar.KEY);
    // In the source-owned atomic adapter, null is a proven absent row,
    // whereas undefined can mean an unreadable/undeclared key.
    if(raw===undefined)return 'UNKNOWN';
    const state=originalWar.validate(raw===null?originalWar.empty():raw);
    if(!state||!state.ships||typeof state.ships!=='object'||
       Array.isArray(state.ships))return 'UNKNOWN';
    const record=state.ships[String(link.entityID)];
    if(!record){
     // A pilot linked to another original WAR hull is NOT unassigned.
     if(Object.values(state.ships).some(s=>s?.pilotID===link.pilotID))
      return 'UNKNOWN';
     return a.isPoisoned()===false?'UNASSIGNED':'UNKNOWN';
    }
    if(record.entityID!==link.entityID||record.systemID!==link.systemID||
       record.pilotID!==link.pilotID)return 'UNKNOWN';
    const transfer=state.transfers?.[String(link.entityID)];
    if(transfer&&transfer.phase!=='COMPLETE'&&transfer.phase!=='ABORTED')
     return 'UNKNOWN';
    if(a.isPoisoned())return 'UNKNOWN';
    return 'ASSIGNED';
   });
  }catch{return 'UNKNOWN';}
 }
 return Object.freeze({readOriginalWarShipClaim});
}
module.exports=Object.freeze({createOriginalWarClaim});
