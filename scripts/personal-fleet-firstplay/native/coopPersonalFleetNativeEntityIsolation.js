'use strict';
/**
 * PF87: source-owned original GameStore transient NPC isolation.
 * ONLY the original coopGameStoreAtomic owner may invoke this contract.
 * It never writes transient NPCs to SQLite, and never masks a missing durable
 * entity, a non-quiescent baseline, a partial receipt or an unknown writer.
 */
const {isDeepStrictEqual}=require('node:util');
const SEP='\u001f',NE='npcEntities',T='corporationRuntime';
const PREFIX='coop-personal-fleet'+SEP;
const CONTRACT='personal-fleet-entity-receipt-v1';
const TABLES=Object.freeze([T,'items','characters',NE]);
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const positive=x=>Number.isSafeInteger(x)&&x>0;
const token=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(x);
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const clone=x=>JSON.parse(JSON.stringify(x));
const fail=s=>{throw Error('PF87_'+s);};
const entityKey=id=>'entities'+SEP+id;
const exact=(a,b)=>a.length===b.length&&[...a].sort().every((s,i)=>s===[...b].sort()[i]);
const identity=['entityID','systemID','ownerID','typeID','personalFleetOriginal',
 'personalFleetAssignmentID','personalFleetPilotID','personalFleetGeneration'];
const PF55_FIELDS=['mode','targetEntityID','followRange','position','velocity',
 'direction','targetPoint','speedFraction'];
function policyFor(tables,options,env=process.env){
 if(options?.contract!==CONTRACT)return null;
 if(!exact(tables,TABLES)||env.EVEJS_COOP_PERSONAL_FLEET_ENTITY_ISOLATION!=='1'||
  env.EVEJS_COOP_PERSONAL_FLEET_NATIVE!=='1'||
  env.EVEJS_COOP_NATIVE_ATOMIC_ROWS!=='1')fail('POLICY_NOT_AUTHORIZED');
 const {shipItemID,operationID,assignmentID,mode}=options;
 if(!positive(shipItemID)||!token(operationID)||!token(assignmentID)||
    !['ORDER','RETURN','CONFIRM','RECONCILE'].includes(mode))fail('CONTRACT_INVALID');
 return Object.freeze({shipItemID,operationID,assignmentID,mode});
}
function capture({paths,live,durable,shipItemID}={}){
 if(!(paths instanceof Set)||paths.size<1||paths.size>10000||
    !object(live)||!object(live.entities)||!object(durable)||!object(durable.entities))
  fail('TRANSIENT_SOURCE_INVALID');
 const shadow={},copy=clone(live);
 for(const path of paths){
  const m=typeof path==='string'&&/^\/entities\/([1-9]\d{0,15})$/.exec(path);
  if(!m||!positive(Number(m[1]))||String(Number(m[1]))!==m[1])
    fail('TRANSIENT_PATH_NOT_ENTITY_SCOPED');
  const id=m[1],entity=live.entities[id];
  if(Number(id)===shipItemID||own(shadow,id)||!object(entity)||
   entity.entityID!==Number(id)||entity.transient!==true||
   own(durable.entities,id))fail('TRANSIENT_ENTITY_NOT_ISOLATED');
  shadow[id]=clone(entity);
  delete copy.entities[id];
 }
 if(!isDeepStrictEqual(copy,durable))fail('CACHE_DURABLE_PREIMAGE_MISMATCH');
 return Object.freeze({ids:Object.freeze(Object.keys(shadow)),shadow});
}
function verifyShadow({witness,paths,live}={}){
 if(!witness)return true;
 if(!(paths instanceof Set)||paths.size!==witness.ids.length||
    !object(live)||!object(live.entities))fail('TRANSIENT_SHADOW_LOST');
 for(const id of witness.ids){
  if(!paths.has('/entities/'+id)||
    !isDeepStrictEqual(live.entities[id],witness.shadow[id]))
    fail('TRANSIENT_SHADOW_CHANGED_AFTER_COMMIT');
 }
 return true;
}
function sameExcept(before,after,allow){
 const a=clone(before),b=clone(after);
 for(const key of allow){delete a[key];delete b[key];}
 return isDeepStrictEqual(a,b);
}
function guardMutation(tx,policy){
 if(!tx||!policy)fail('TRANSACTION_AUTHORITY_MISSING');
 const nativeKey=entityKey(policy.shipItemID),
  receiptKey=PREFIX+(policy.mode==='ORDER'?'native-order-receipt-v1:':
   'native-return-receipt-v1:')+policy.operationID,
  confirmKey=PREFIX+'return-dock-v1:'+policy.assignmentID,
  manualKey=PREFIX+'manual-order-v1:'+policy.shipItemID,
  manualIndexKey=PREFIX+'manual-order-operations-v1';
 let entity=null,receipt=null,confirmed=0,manual=null,orderIndex=null;
 const pre=tx.get(NE,nativeKey);
 if(!object(pre)||pre.transient===true||pre.entityID!==policy.shipItemID||
   pre.personalFleetOriginal!==true||
   pre.personalFleetAssignmentID!==policy.assignmentID)
  fail('TARGET_NOT_ORIGINAL_DURABLE_NPC');
 const originalReceipt=tx.get(T,receiptKey);
 if(policy.mode!=='CONFIRM'&&originalReceipt!==null)
  fail('RECEIPT_ALREADY_EXISTS');
 const proxy=Object.freeze({
  get:(t,k)=>tx.get(t,k),
  scan:t=>tx.scan(t),
  put(t,k,value){
   if(policy.mode==='RECONCILE'){
    if(t!==T||!object(value))fail('RECONCILE_FOREIGN_WRITE');
    const old=tx.get(T,k);
    if(k===manualKey){
     if(manual!==null||!object(old)||old.phase!=='ISSUING'||
        old.operationID!==policy.operationID||
        old.shipItemID!==policy.shipItemID||
        old.assignmentID!==policy.assignmentID||
        value.phase!=='ACKED'||value.operationID!==old.operationID||
        !/^[0-9a-f]{64}$/.test(value.proofHash||'')||
        !positive(value.ackedAtMs)||
        !sameExcept(old,value,['phase','proofHash','ackedAtMs']))
      fail('RECONCILE_LEDGER_INVALID');
     manual=clone(value);
    }else if(k===manualIndexKey){
     if(orderIndex!==null||!object(old)||!object(old.operations)||
        !object(value.operations)||!object(old.operations[policy.operationID])||
        old.operations[policy.operationID].phase!=='ISSUING'||
        value.operations[policy.operationID]?.phase!=='ACKED')
      fail('RECONCILE_INDEX_INVALID');
     const prior=clone(old),next=clone(value);
     prior.operations[policy.operationID].phase='ACKED';
     if(!isDeepStrictEqual(prior,next))fail('RECONCILE_INDEX_FOREIGN_CHANGE');
     orderIndex=clone(value);
    }else fail('RECONCILE_UNRELATED_KEY');
   }else if(policy.mode==='CONFIRM'){
    if(t!==T||k!==confirmKey||confirmed!==0||!object(value))
     fail('CONFIRM_FOREIGN_WRITE');
    const old=tx.get(T,k);
    if(!object(old)||old.phase!=='RETURN_ISSUING'||
     old.operationID!==policy.operationID||
     old.shipItemID!==policy.shipItemID||
     old.assignmentID!==policy.assignmentID||
     value.phase!=='RETURNING'||value.operationID!==old.operationID||
     !/^[0-9a-f]{64}$/.test(value.returnProofHash||'')||
     !sameExcept(old,value,['phase','returnProofHash']))
     fail('CONFIRM_STATE_INVALID');
    confirmed++;
   }else if(t===NE){
    if(k!==nativeKey||entity!==null||!object(value)||value.transient===true||
      identity.some(f=>!isDeepStrictEqual(value[f],pre[f]))||
      !sameExcept(pre,value,policy.mode==='ORDER'?PF55_FIELDS:['personalFleetReturnOrder']))
     fail('FOREIGN_NATIVE_ENTITY_WRITE');
    if(policy.mode==='RETURN'){
     const marker=value.personalFleetReturnOrder;
     if(!object(marker)||marker.version!==1||
       marker.operationID!==policy.operationID||
       marker.assignmentID!==policy.assignmentID||
       marker.shipItemID!==policy.shipItemID||
       !/^[0-9a-f]{64}$/.test(marker.signature||''))
      fail('INVALID_RETURN_MARKER');
    }else if(!['FOLLOW','STOP'].includes(value.mode))
     fail('INVALID_ORDER_MOTION');
    entity=clone(value);
   }else if(t===T){
    if(k!==receiptKey||receipt!==null||!object(value)||
       value.operationID!==policy.operationID||
       value.assignmentID!==policy.assignmentID||
       value.shipItemID!==policy.shipItemID||
       !/^[0-9a-f]{64}$/.test(value.signature||'')||
       value.source!==(policy.mode==='ORDER'?
        'EVEJS_ORIGINAL_NATIVE_ORDER_COMMITTED_V1':
        'EVEJS_ORIGINAL_NATIVE_RETURN_COMMITTED_V1'))
      fail('FOREIGN_NATIVE_RECEIPT_WRITE');
    receipt=clone(value);
   }else fail('UNSCOPED_NATIVE_TRANSACTION_WRITE');
   tx.put(t,k,value);
  },
  del(){fail('DELETE_FORBIDDEN');},
  assertWriteSetComplete(){
   if(policy.mode==='RECONCILE'){
    if(entity!==null||receipt!==null||confirmed!==0||
       (manual===null)!==(orderIndex===null))
      fail('INCOMPLETE_RECONCILE_WRITE_SET');
    return;
   }
   if(policy.mode==='CONFIRM'){
    if(entity!==null||receipt!==null)fail('CONFIRM_WRITE_SET_INVALID');
    return;
   }
   if((entity===null)!==(receipt===null))fail('HALF_NATIVE_RECEIPT_WRITE_SET');
   if(entity!==null){
    if(entity.ownerID!==receipt.ownerCharacterID||
       entity.personalFleetPilotID!==receipt.pilotID||
       entity.systemID!==receipt.systemID)
      fail('RECEIPT_SOURCE_IDENTITY_MISMATCH');
    if(policy.mode==='RETURN'){
     const marker=entity.personalFleetReturnOrder;
     if(marker.signature!==receipt.signature||
       marker.ownerCharacterID!==receipt.ownerCharacterID||
       marker.committedAtMs!==receipt.committedAtMs||
       marker.stationID!==receipt.stationID)
      fail('RETURN_RECEIPT_MARKER_MISMATCH');
    }
   }
  }
 });
 return proxy;
}
module.exports=Object.freeze({CONTRACT,TABLES,policyFor,capture,
 verifyShadow,guardMutation,entityKey});
