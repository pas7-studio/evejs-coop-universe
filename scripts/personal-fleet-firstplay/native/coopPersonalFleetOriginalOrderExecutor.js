'use strict';
/**
 * Original EveJS physical FOLLOW/HOLD executor. Uses the ORIGINAL common
 * coopNpcOrderBridge with the SAME arbiter object as other NPC directors,
 * original native npcRuntime and PF52/PF54/ItemStore witnesses. No fake NPC,
 * independent parallel arbiter or client-provided target/ship authority.
 * PF55 retains the durable one-shot ISSUE and original order ACK writer.
 */
const gameStore=require('../gameStore');
const runtime=require('./runtime');
const npcRuntime=require('./npc/npcRuntime');
const registry=require('./npc/npcRegistry');
const pf52=require('./coopPersonalFleetHangarBridge');
const {createOrderBridge}=require('./coopNpcOrderBridge');
const {createNpcRuntimeExecutor}=require('./coopPersonalFleetNpcRuntimeExecutor');
const F='coop-personal-fleet\u001f',T='corporationRuntime';
const positive=x=>Number.isSafeInteger(x)&&x>0;
function createOriginalOrderExecutor({sharedOriginalArbiter,readOriginalWarShipClaim,
 orderWitness,orderReceipt,enabled=()=>false,allWritersFenced=()=>false}={}){
 const a=gameStore.coopAtomicNativeRows;
 if(a?.mode!=='SERVER_INTERNAL_FLAGGED'||typeof a.transact!=='function'||
    typeof a.isPoisoned!=='function'||typeof runtime.scenes?.get!=='function'||
    typeof registry.getControllerByEntityID!=='function'||
    !['follow','stop','issueOrder','issueAttackOrder','warpToEntity'].every(k=>typeof npcRuntime[k]==='function')||
    typeof pf52.validateIndex!=='function'||typeof pf52.validateRoster!=='function'||
    !sharedOriginalArbiter||!['issue','blocked','snapshot','retainWithNativeProof','blocksForSystem'].every(k=>
     typeof sharedOriginalArbiter[k]==='function')||
    !orderWitness||!['verifyNativeActor','verifyTarget','verifyPersonalClaim','verifyOriginalControl'].every(k=>
     typeof orderWitness[k]==='function')||
  typeof orderReceipt?.recordAfterNativeEffect!=='function'||
    [readOriginalWarShipClaim,enabled,allWritersFenced].some(f=>typeof f!=='function'))
  throw Error('PF_FIRSTPLAY_ORIGINAL_SHARED_ORDER_RUNTIME_REQUIRED');
 const live=()=>enabled()===true&&allWritersFenced()===true&&a.isPoisoned()===false;
 const sceneForSystem=systemID=>positive(systemID)?runtime.scenes.get(systemID)||null:null;
 const getController=id=>positive(id)?registry.getControllerByEntityID(id):null;
 function assignments(){
  if(!live())return [];
  try{return a.transact([T,'items'],tx=>{
   const raw=tx.get(T,pf52.REGISTRY_KEY);
   if(!raw||typeof raw!=='object')return [];
   const idx=pf52.validateIndex(raw);
   const result=[];
   if(Object.keys(idx.ships).length>256)return [];
   for(const [key,ship] of Object.entries(idx.ships)){
    const id=Number(key);
    if(!positive(id)||ship.shipItemID!==id||!positive(ship.ownerCharacterID)||
       !positive(ship.generation)||typeof ship.assignmentID!=='string')return [];
    const dep=tx.get(T,F+'deploy-v1:'+ship.assignmentID);
    if(!dep||dep.phase!=='ACTIVE'||!positive(dep.actorGeneration))continue;
    const row={ownerCharacterID:ship.ownerCharacterID,pilotID:ship.pilotID,
     shipItemID:id,systemID:dep.systemID,assignmentID:ship.assignmentID,
     actorGeneration:dep.actorGeneration};
    if(orderWitness.verifyNativeActor(row,tx)!==true)return [];
    result.push({pilotID:ship.pilotID,entityID:id,systemID:dep.systemID});
   }
   // Repeated pilots or ship IDs are ambiguity, not multiple actors.
   if(new Set(result.map(x=>x.entityID)).size!==result.length||
      new Set(result.map(x=>x.pilotID)).size!==result.length)return [];
   return result;
  });}catch{return [];} // Never turn unreadable SQLite into a stock order claim.
 }
 const orderBridge=createOrderBridge({arbiter:sharedOriginalArbiter,
  assignments,sceneForSystem,getController,
  warShipClaim:link=>{
   if(!live())return 'UNKNOWN';
   try{
    const x=readOriginalWarShipClaim(link);
    return ['UNASSIGNED','ASSIGNED'].includes(x)?x:'UNKNOWN';
   }catch{return 'UNKNOWN';}
  }});
 if(!orderBridge||typeof orderBridge.issue!=='function')
  throw Error('PF_FIRSTPLAY_ORIGINAL_SHARED_ORDER_BRIDGE_UNAVAILABLE');
 const base=createNpcRuntimeExecutor({npcRuntime,orderBridge,
  sceneForSystem,getController,
  verifyPersonalClaim:row=>live()&&orderWitness.verifyPersonalClaim(row)===true,
  authorizeTarget:row=>{
   if(!live()||row?.action!=='FOLLOW')return false;
   try{return a.transact([T,'items','characters'],tx=>
    orderWitness.verifyTarget(row,tx)===true)===true;
   }catch{return false;}
  },enabled:live});
 if(!base||typeof base.execute!=='function'||typeof base.supports!=='function')
  throw Error('PF_FIRSTPLAY_ORIGINAL_ORDER_EXECUTOR_UNAVAILABLE');
 function supports(action){return ['FOLLOW','HOLD'].includes(action)&&live()&&base.supports(action)===true;}
 function execute(row){
  if(!row||!supports(row.action))
   return {success:false,errorMsg:'PF_FIRSTPLAY_PHYSICAL_ORDER_NOT_AUTHORIZED'};
  const physical=base.execute(row);
  // Original bridge/runtime returned physical success. Post-effect native
  // movement + PF55 receipt MUST commit together in original SQLite. If this
  // fails, PF55 keeps ISSUING and NEVER redispatches the movement.
  if(physical?.success!==true||physical?.then)return physical;
  const persisted=orderReceipt.recordAfterNativeEffect(row);
  if(persisted?.success!==true)return {
   success:false,errorMsg:'PF55_NATIVE_EFFECT_OUTCOME_UNKNOWN_NO_RETRY'};
  return {success:true,data:{operationID:row.operationID,
   durability:'ORIGINAL_NPC_ENTITIES_AND_PF55_RECEIPT_COMMITTED'}};
 }
 return Object.freeze({supports,execute,
  // Read-only; useful to diagnose a missing native assignment on WORK.
  inspectAssignments:()=>assignments().map(x=>Object.freeze({...x}))});
}
module.exports=Object.freeze({createOriginalOrderExecutor});
