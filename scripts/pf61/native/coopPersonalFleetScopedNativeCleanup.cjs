'use strict';
/** PF64 hardens PF61: the native removal attempt is committed to the ORIGINAL
 * corporationRuntime before any external controller/entity write. This record
 * is never cleared automatically. A fresh process cannot redispatch after a
 * SIGKILL, even when the PF60 terminal remains ISSUING and the native rows are
 * only partially removed. Repair/reconciliation must be operator-controlled.
 */
const crypto=require('node:crypto');
const pf60=require('../../pf60/native/coopPersonalFleetTerminalCustody.cjs');
const T='corporationRuntime',SEP='\u001f',P='coop-personal-fleet'+SEP;
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const clone=x=>structuredClone(x);
const sha=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const err=errorMsg=>({success:false,errorMsg});
const attemptKey=assignmentID=>P+'terminal-native-attempt-v1:'+assignmentID;
const attemptSignature=(c,row)=>sha(['PF64_NATIVE_ONESHOT_V1',row.signature,
 c.assignmentID,c.shipItemID,c.generation,c.actorGeneration,c.operationID,
 row.witnessHash,row.sourcePF54Hash]);
function createScopedNativeCleanup({nativeStore,gameStore,enabled=()=>false,
 allWritersFenced=()=>false,verifyOriginalSceneVacant,
 verifyExclusiveOwnership,verifyOriginalTerminalWitness,
 clock=()=>Date.now()}={}) {
 const a=gameStore?.coopAtomicNativeRows;
 if(a?.mode!=='SERVER_INTERNAL_FLAGGED'||typeof a.transact!=='function'||
  typeof a.isPoisoned!=='function'||!nativeStore||
  nativeStore.PF61_SCOPED_ORIGINAL_NATIVE_CLEANUP_V1!==true||
  typeof nativeStore.installScopedOriginalTerminalCleanupAuthority!=='function'||
  typeof nativeStore.removeScopedPersonalFleetTerminalNativeRows!=='function'||
  [enabled,allWritersFenced,verifyOriginalSceneVacant,
    verifyExclusiveOwnership,verifyOriginalTerminalWitness,clock].some(x=>typeof x!=='function'))
  throw Error('PF61_ORIGINAL_NATIVE_AUTHORITIES_REQUIRED');
 const attempted=new Set(),capability=Symbol('PF61-in-process-original-store-capability');
 const feature=()=>enabled()===true&&allWritersFenced()===true&&!a.isPoisoned();
 function verify(c,tx,requireConsumed){
   if(!feature()||verifyExclusiveOwnership(c,tx)!==true)return null;
   const row=tx.get(T,pf60.terminalKey(c.assignmentID)),
    ship=tx.get(T,pf60.terminalShipKey(c.shipItemID)),
    lock=tx.get(T,pf60.LOCK+c.shipItemID),
    handoff=tx.get(T,pf60.HANDOFF+c.assignmentID),
    prior=tx.get(T,attemptKey(c.assignmentID));
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
      handoff.sourcePF54Hash!==lock.sourcePF54Hash)return null;
   const proof=verifyOriginalTerminalWitness(c,tx);
   if(!pf60.validWitness(proof,c)||sha(proof)!==row.witnessHash||
      verifyOriginalSceneVacant(c,tx)!==true)return null;
   if(requireConsumed){
     if(!obj(prior)||prior.version!==1||prior.status!=='CONSUMED'||
        prior.assignmentID!==c.assignmentID||prior.shipItemID!==c.shipItemID||
        prior.generation!==c.generation||prior.actorGeneration!==c.actorGeneration||
        prior.operationID!==c.operationID||prior.signature!==attemptSignature(c,row)||
        !Number.isSafeInteger(prior.consumedAtMs)||prior.consumedAtMs<=0)return null;
   }else if(prior!==null){return null;} // unknown/corrupt/foreign = DENY
   return row;
 }
 function authorize(command){
  if(!pf60.validCommand(command))return false;
  try{const c=clone(command);return a.transact([T],tx=>!!verify(c,tx,true))===true;}
  catch{return false;}
 }
 // Constructing the native store authority must not change original rows.
 const installed=nativeStore.installScopedOriginalTerminalCleanupAuthority({capability,authorize});
 if(installed!==true)throw Error('PF61_NATIVE_AUTHORITY_INSTALL_UNCONFIRMED');
 function execute(command){
  if(!pf60.validCommand(command))return err('PF61_COMMAND_INVALID');
  const c=clone(command),key=c.assignmentID+':'+c.shipItemID+':'+c.generation;
  if(attempted.has(key))return err('PF61_EXECUTOR_ALREADY_ATTEMPTED');
  let reserved;
  try{reserved=a.transact([T],tx=>{
   const prior=tx.get(T,attemptKey(c.assignmentID));
   if(prior===undefined)return 'PF64_ATTEMPT_READ_UNKNOWN';
   if(prior!==null)return 'PF64_DURABLE_NATIVE_ATTEMPT_ALREADY_CONSUMED';
   const row=verify(c,tx,false);
   if(!row)return 'PF61_DURABLE_INTENT_OR_NATIVE_WITNESS_UNVERIFIED';
   const at=clock();
   if(!Number.isSafeInteger(at)||at<=0)return 'PF64_CLOCK_INVALID';
   tx.put(T,attemptKey(c.assignmentID),{version:1,status:'CONSUMED',
    assignmentID:c.assignmentID,shipItemID:c.shipItemID,operationID:c.operationID,
    generation:c.generation,actorGeneration:c.actorGeneration,
    signature:attemptSignature(c,row),consumedAtMs:at});
   return 'COMMITTED';
  });}catch{return err('PF64_ATTEMPT_COMMIT_UNKNOWN_NO_RETRY');}
  if(reserved!=='COMMITTED')return err(reserved||'PF64_ATTEMPT_COMMIT_UNKNOWN_NO_RETRY');
  attempted.add(key); // secondary process-local guard; durable token is primary.
  try{
   const out=nativeStore.removeScopedPersonalFleetTerminalNativeRows({command:c,capability});
   if(out&&typeof out.then==='function')return err('PF61_ASYNC_NATIVE_CLEANUP_UNSAFE');
   return out?.success===true?{success:true,data:{shipItemID:c.shipItemID,
    requiresPF60Reconcile:true}}:err('PF61_NATIVE_WRITE_OUTCOME_UNKNOWN');
  }catch{return err('PF61_NATIVE_WRITE_OUTCOME_UNKNOWN');}
 }
 return Object.freeze({execute});
}
module.exports={createScopedNativeCleanup,attemptKey,attemptSignature};
