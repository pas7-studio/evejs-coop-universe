'use strict';
/** PF61 installed in the native *server*, never in a public request handler.
 * One process owner gives a private Symbol to the source-patched native store.
 * The PF60 durable ISSUING row has already committed BEFORE this executes.
 * Without exact PF60 state and original scene/witness authorities it denies.
 */
const crypto=require('node:crypto');
const pf60=require('../../pf60/native/coopPersonalFleetTerminalCustody.cjs');
const T='corporationRuntime',SEP='\u001f',P='coop-personal-fleet'+SEP;
const pos=n=>Number.isSafeInteger(n)&&n>0;
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const clone=x=>structuredClone(x);
const sha=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const err=errorMsg=>({success:false,errorMsg});
function createScopedNativeCleanup({nativeStore,gameStore,enabled=()=>false,
 allWritersFenced=()=>false,verifyOriginalSceneVacant,
 verifyExclusiveOwnership,verifyOriginalTerminalWitness}={}) {
 const a=gameStore?.coopAtomicNativeRows;
 if(a?.mode!=='SERVER_INTERNAL_FLAGGED'||typeof a.transact!=='function'||
  typeof a.isPoisoned!=='function'||!nativeStore||
  nativeStore.PF61_SCOPED_ORIGINAL_NATIVE_CLEANUP_V1!==true||
  typeof nativeStore.installScopedOriginalTerminalCleanupAuthority!=='function'||
  typeof nativeStore.removeScopedPersonalFleetTerminalNativeRows!=='function'||
  [enabled,allWritersFenced,verifyOriginalSceneVacant,
    verifyExclusiveOwnership,verifyOriginalTerminalWitness].some(x=>typeof x!=='function'))
  throw Error('PF61_ORIGINAL_NATIVE_AUTHORITIES_REQUIRED');
 const attempted=new Set(),capability=Symbol('PF61-in-process-original-store-capability');
 const feature=()=>enabled()===true&&allWritersFenced()===true&&!a.isPoisoned();
 function authorize(command){
  if(!feature()||!pf60.validCommand(command))return false;
  const c=clone(command);
  try{return a.transact([T],tx=>{
   if(!feature()||verifyExclusiveOwnership(c,tx)!==true)return false;
   const row=tx.get(T,pf60.terminalKey(c.assignmentID)),
    ship=tx.get(T,pf60.terminalShipKey(c.shipItemID)),
    lock=tx.get(T,pf60.LOCK+c.shipItemID),
    handoff=tx.get(T,pf60.HANDOFF+c.assignmentID);
   if(!obj(row)||row.version!==1||row.phase!=='ISSUING'||row.dispatchCount!==1||
      row.signature!==pf60.terminalSignature(c)||row.operationID!==c.operationID||
      row.mode!==c.mode||row.shipItemID!==c.shipItemID||
      row.ownerCharacterID!==c.ownerCharacterID||row.actorGeneration!==c.actorGeneration||
      row.generation!==c.generation||row.systemID!==c.systemID||
      row.pilotID!==c.pilotID||row.typeID!==c.typeID||
      !obj(ship)||ship.phase!=='PENDING'||ship.assignmentID!==c.assignmentID||
      ship.signature!==row.signature||!obj(lock)||lock.assignmentID!==c.assignmentID||
      lock.sourcePF54Hash!==row.sourcePF54Hash||!obj(handoff)||
      handoff.status!=='CONSUMED'||handoff.assignmentID!==c.assignmentID||
      handoff.shipItemID!==c.shipItemID||handoff.generation!==c.generation||
      handoff.sourcePF54Hash!==lock.sourcePF54Hash)return false;
   const proof=verifyOriginalTerminalWitness(c,tx);
   if(!pf60.validWitness(proof,c)||sha(proof)!==row.witnessHash)return false;
   return verifyOriginalSceneVacant(c,tx)===true;
  })===true;}catch{return false;}
 }
 nativeStore.installScopedOriginalTerminalCleanupAuthority({capability,authorize});
 function execute(command){
  if(!pf60.validCommand(command))return err('PF61_COMMAND_INVALID');
  const c=clone(command),key=c.assignmentID+':'+c.shipItemID+':'+c.generation;
  if(attempted.has(key))return err('PF61_EXECUTOR_ALREADY_ATTEMPTED');
  if(!authorize(c))return err('PF61_DURABLE_INTENT_OR_NATIVE_WITNESS_UNVERIFIED');
  attempted.add(key); // consumed BEFORE external write, no reissue on failure.
  try{
   const out=nativeStore.removeScopedPersonalFleetTerminalNativeRows({command:c,capability});
   if(out&&typeof out.then==='function')return err('PF61_ASYNC_NATIVE_CLEANUP_UNSAFE');
   return out?.success===true?{success:true,data:{shipItemID:c.shipItemID,
    requiresPF60Reconcile:true}}:err('PF61_NATIVE_WRITE_OUTCOME_UNKNOWN');
  }catch{return err('PF61_NATIVE_WRITE_OUTCOME_UNKNOWN');}
 }
 return Object.freeze({execute});
}
module.exports={createScopedNativeCleanup};
