'use strict';
/**
 * PF96 — readopt ACKED original PF55 combat after original NPC re-materialization.
 * This never creates a fresh PF55 ISSUING operation or emits a new receipt.
 * The same original shared arbiter may resume a physically absent manualOrder
 * once per process after original controller, target and SQLite proof agree.
 */
const gameStore=require('../gameStore');
const pf55=require('./coopPersonalFleetNativeOrders');
const registry=require('./npc/npcRegistry');
const runtime=require('./runtime');
const T='corporationRuntime',NE='npcEntities',NC='npcRuntimeControllers',
 ITEMS='items',CH='characters';
const F='coop-personal-fleet\u001f',ACK=F+'native-combat-order-receipt-v1:';
const id=x=>Number.isSafeInteger(x)&&x>0;
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const blocked=reason=>Object.freeze({status:'BLOCKED',reason});
const pending=x=>obj(x)&&x.manualOrder!=null&&
 String(x.manualOrder.type||'').toLowerCase()!=='resumebehavior';
function createOriginalCombatRecovery({combatAuthority,combatReceipt,
 orderWitness,resumeAfterOriginalAck,retainOriginalCombatLease,enabled=()=>false,
 allWritersFenced=()=>false,clock=()=>Date.now(),maxPerTick=3}={}){
 const a=gameStore?.coopAtomicNativeRows;
 if(a?.mode!=='SERVER_INTERNAL_FLAGGED'||typeof a.transact!=='function'||
    typeof a.isPoisoned!=='function'||typeof pf55.key!=='function'||
    typeof pf55.signature!=='function'||typeof pf55.OP_INDEX!=='string'||
    typeof registry.getControllerByEntityID!=='function'||
    typeof runtime.scenes?.get!=='function'||
    typeof combatAuthority?.verify!=='function'||
    typeof combatReceipt?.verifyPersisted!=='function'||
    typeof orderWitness?.verifyNativeActor!=='function'||
    [resumeAfterOriginalAck,retainOriginalCombatLease,enabled,allWritersFenced,clock]
     .some(x=>typeof x!=='function')||
    !Number.isSafeInteger(maxPerTick)||maxPerTick<1||maxPerTick>8)
  throw Error('PF96_ORIGINAL_COMBAT_RECOVERY_AUTHORITIES_REQUIRED');
 const live=()=>enabled()===true&&allWritersFenced()===true&&a.isPoisoned()===false;
 // A process can issue one re-adoption for a committed operation. Failed,
 // ambiguous and successful outcomes all retain the fence; no blind retries.
 const attempted=new Set();
 let running=false,cursor=0;
 function inspect(){
  if(!live())return blocked('PF96_ORIGINAL_COMBAT_RECOVERY_OFF');
  try{return a.transact([T,ITEMS,CH,NE,NC],tx=>{
   const idx=tx.get(T,pf55.OP_INDEX);
   if(idx===null)return {status:'READY',rows:[]};
   if(!obj(idx)||idx.version!==1||!obj(idx.operations)||
      Object.keys(idx.operations).length>2048)
    return blocked('PF96_ORIGINAL_ORDER_INDEX_UNVERIFIED');
   const seen=new Set(),rows=[];
   for(const [key,index] of Object.entries(idx.operations)){
    if(index?.phase!=='ACKED'||!['string','number'].includes(typeof key)||
       !id(index.shipItemID))continue;
    const row=tx.get(T,pf55.key(index.shipItemID));
    // Old historical commands are not an instruction to recreate combat.
    if(row?.operationID!==key||!['ATTACK','DEFEND'].includes(row?.action))
     continue;
    if(seen.has(row.shipItemID))return blocked('PF96_DUPLICATE_ACTIVE_COMBAT_HULL');
    seen.add(row.shipItemID);
    if(row.phase!=='ACKED'||row.signature!==index.signature||
       row.signature!==pf55.signature(row)||
       index.shipItemID!==row.shipItemID||
       !id(row.ownerCharacterID)||!id(row.systemID)||
       !id(row.actorGeneration)||!id(row.targetEntityID))
     return blocked('PF96_ORIGINAL_COMBAT_OPERATION_CONFLICT');
    const receipt=tx.get(T,ACK+row.operationID);
    if(receipt?.source!=='EVEJS_ORIGINAL_NATIVE_COMBAT_EFFECT_V1'||
       !id(receipt.committedAtMs)||
       combatReceipt.verifyPersisted(row,tx)?.orderApplied!==true||
       orderWitness.verifyNativeActor(row,tx)!==true)
     return blocked('PF96_COMBAT_RECEIPT_ORIGINAL_PROOF_MISSING');
    const age=clock()-receipt.committedAtMs;
    if(!Number.isSafeInteger(age)||age<0)return blocked('PF96_COMBAT_CLOCK_INVALID');
    if(row.action==='ATTACK'&&age>600000)continue; // never resurrect stale PvE
    if(combatAuthority.verify(row,tx)!==true)continue; // dead or replaced target
    rows.push(structuredClone(row));
    if(rows.length>128)return blocked('PF96_EXCESSIVE_ORIGINAL_COMBAT_ACTORS');
   }
   rows.sort((x,y)=>x.shipItemID-y.shipItemID);
   return {status:'READY',rows};
  });}catch{return blocked('PF96_SQLITE_OR_ORIGINAL_SOURCE_UNCERTAIN');}
 }
 function resumeOne(row){
  if(!live()||!obj(row)||!id(row.shipItemID)||!id(row.systemID)||
     !id(row.actorGeneration))
   return blocked('PF96_ORIGINAL_COMBAT_RECOVERY_OFF');
  const controller=registry.getControllerByEntityID(row.shipItemID),
   scene=runtime.scenes.get(row.systemID),
   ship=scene?.getEntityByID?.(row.shipItemID);
  if(!controller||controller.entityID!==row.shipItemID||
     controller.systemID!==row.systemID||
     controller.personalFleetOriginal!==true||
     controller.personalFleetAssignmentID!==row.assignmentID||
     controller.personalFleetPilotID!==row.pilotID||
     !ship||ship.itemID!==row.shipItemID||ship.kind!=='ship'||
     ship.nativeNpc!==true||ship.ownerID!==row.ownerCharacterID||
     ship.session!=null||ship.transient===true)
   return blocked('PF96_ORIGINAL_COMBAT_ACTOR_NOT_MATERIALIZED');
  if(pending(controller)){
   const manual=controller.manualOrder;
   if(manual.targetID===row.targetEntityID&&
      manual.type===(row.action==='ATTACK'?'attack':'follow')&&
      manual.allowWeapons===(row.action==='ATTACK')&&
      manual.allowPodKill!==true){
    if(retainOriginalCombatLease(row)!==true)
     return blocked('PF96_ORIGINAL_SHARED_LEASE_NOT_RETAINED');
    return {status:'ALREADY_NATIVE',shipItemID:row.shipItemID};
   }
   return blocked('PF96_ACTIVE_FOREIGN_NATIVE_ORDER');
  }
  const key=row.operationID+':'+row.shipItemID+':'+row.actorGeneration;
  if(attempted.has(key))return blocked('PF96_RESTORE_ATTEMPT_STICKY');
  attempted.add(key);
  let result;
  try{result=resumeAfterOriginalAck(row);}catch{
   return blocked('PF96_NATIVE_RESUME_OUTCOME_UNKNOWN');
  }
  if(result?.success!==true||result?.then)
   return blocked('PF96_NATIVE_RESUME_UNVERIFIED_NO_RETRY');
  const after=registry.getControllerByEntityID(row.shipItemID);
  if(after!==controller||!pending(after)||
     after.manualOrder.targetID!==row.targetEntityID||
     after.manualOrder.type!==(row.action==='ATTACK'?'attack':'follow')||
     after.manualOrder.allowWeapons!==(row.action==='ATTACK'))
   return blocked('PF96_NATIVE_RESTORED_ORDER_NOT_OBSERVED');
  return {status:'RESTORED_COMBAT',shipItemID:row.shipItemID,
   action:row.action,operationID:row.operationID};
 }
 function recover(){
  if(!live())return blocked('PF96_RECOVERY_OFF');
  if(running)return blocked('PF96_OVERLAPPING_RECOVERY');
  running=true;
  try{
   const scanned=inspect();
   if(scanned.status!=='READY')return scanned;
   const list=scanned.rows;if(!list.length)return {status:'RECOVERY_SCANNED',
    total:0,restored:0,already:0,blocked:0};
   const start=cursor%list.length;
   cursor=(start+maxPerTick)%list.length;
   const slice=[...list.slice(start),...list.slice(0,start)].slice(0,maxPerTick);
   const result={status:'RECOVERY_SCANNED',total:list.length,
    restored:0,already:0,blocked:0,issues:[]};
   for(const row of slice){
    const one=resumeOne(row);
    if(one.status==='RESTORED_COMBAT')result.restored++;
    else if(one.status==='ALREADY_NATIVE')result.already++;
    else {result.blocked++;result.issues.push({shipItemID:row.shipItemID,reason:one.reason});}
   }
   return result;
  }finally{running=false;}
 }
 return Object.freeze({inspect,recover});
}
module.exports=Object.freeze({createOriginalCombatRecovery});
