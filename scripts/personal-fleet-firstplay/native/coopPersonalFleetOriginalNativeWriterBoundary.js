'use strict';
/**
 * PF103: real native source-owner bridge. This is NOT a writer fence.
 * The original game must still author reciprocal writer-owner hooks in
 * ./coopPersonalFleetOriginalReciprocalWriterOwners, whose functions attest
 * their own physical ItemStore, wallet, NPC, Mining and war preconditions.
 *
 * It attaches the READ-ONLY original WAR durable fleet claim here, rather
 * than accepting a caller's stand-in or unconditionally "UNASSIGNED".
 */
const bootstrap=require('./coopPersonalFleetOriginalWorkBootstrap');
const originalWar=require('./coopPersonalFleetOriginalWarClaim');
const SOURCE='ORIGINAL_EVEJS_PERSONAL_FLEET_NATIVE_WRITERS_V1';
const OWNERS_SOURCE='ORIGINAL_EVEJS_PERSONAL_FLEET_RECIPROCAL_WRITER_OWNERS_V1';
const BOOT_SOURCE='ORIGINAL_EVEJS_PERSONAL_FLEET_BOOT_OWNER_V1';
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
function createNativeWriterHooks(){
 let owners;
 try{owners=require('./coopPersonalFleetOriginalReciprocalWriterOwners');}
 catch(e){throw Error('PF103_ORIGINAL_RECIPROCAL_WRITER_OWNERS_NOT_INSTALLED:'+
   String(e?.code||'SOURCE_LOAD_FAILED'));}
 if(!obj(owners)||owners.source!==OWNERS_SOURCE||
    typeof owners.createSourceOwnedWriterHooks!=='function')
  throw Error('PF103_ORIGINAL_WRITER_OWNER_SOURCE_INVALID');
 const native=owners.createSourceOwnedWriterHooks();
 if(!obj(native)||native.source!==BOOT_SOURCE||
    !Array.isArray(bootstrap.HOOKS)||
    bootstrap.HOOKS.some(x=>x!=='readOriginalWarShipClaim'&&
      typeof native[x]!=='function')||
    Object.prototype.hasOwnProperty.call(native,'readOriginalWarShipClaim')||
    !obj(native.claimsPolicy)||
    native.claimsPolicy.KEY!=='coop-personal-fleet\u001factor-claims-v1'||
    typeof native.claimsPolicy.validate!=='function'||
    typeof native.claimsPolicy.empty!=='function'||
    !obj(native.sharedOriginalNpcOrderArbiter)||
    ['issue','blocked','snapshot','retainWithNativeProof','blocksForSystem'].some(
      k=>typeof native.sharedOriginalNpcOrderArbiter[k]!=='function')||
    ['gameStore','stockItemStore','originalRuntime','sessionRegistry',
      'nativeNpcStore','nativeNpcService','nativeNpcRegistry','access'].some(
      k=>Object.prototype.hasOwnProperty.call(native,k)))
  throw Error('PF103_ORIGINAL_RECIPROCAL_WRITERS_INCOMPLETE');
 // Original WAR registry is independent from Personal Fleet authored policy,
 // OriginalWorkStarter and third-party NPC directors. Missing/corrupt
 // durable WAR claim is UNKNOWN and blocks competing Personal Fleet commands.
 const war=originalWar.createOriginalWarClaim();
 if(typeof war?.readOriginalWarShipClaim!=='function')
  throw Error('PF103_ORIGINAL_WAR_CLAIM_SOURCE_MISSING');
 return Object.freeze({...native,
   source:BOOT_SOURCE,
   readOriginalWarShipClaim:war.readOriginalWarShipClaim});
}
module.exports=Object.freeze({source:SOURCE,createNativeWriterHooks});
