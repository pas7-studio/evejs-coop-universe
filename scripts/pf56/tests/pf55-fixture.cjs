'use strict';
// Integration fixture: real PF53 + PF52 + PF54 candidates on Node's SQLite.
// Native actor and original NPC orders remain explicitly SYNTHETIC.
const F=require('./pf54-fixture.cjs');
const pf55=require('../deps/pf55-reference-orders.cjs');
const TARGET=3009;
function command(extra={}){
 const action=extra.action||'FOLLOW';
 return {operationID:'pf55-command-1',assignmentID:F.ASSIGNMENT,
  ownerCharacterID:F.OWNER,pilotID:F.PILOT,shipItemID:F.SHIP,
  systemID:F.SYSTEM,actorGeneration:1,session:F.session,
  action,targetEntityID:action==='HOLD'?null:TARGET,
  ...(['FOLLOW','DEFEND'].includes(action)?{followRangeMeters:1500}:{}),...extra};
}
function proof(row){return {source:'EVEJS_ORIGINAL_PERSISTED_NPC_ORDER_V1',
 operationID:row.operationID,entityID:row.shipItemID,
 controllerEntityID:row.shipItemID,shipItemID:row.shipItemID,
 ownerCharacterID:row.ownerCharacterID,pilotID:row.pilotID,
 assignmentID:row.assignmentID,actorGeneration:row.actorGeneration,
 systemID:row.systemID,action:row.action,signature:row.signature,
 orderApplied:true,nativeOwner:'PERSONAL_FLEET',controllerPersisted:true,
 noForeignCommand:true};}
function open(file){
 const f=F.open(file);
 Object.assign(f.shared,{ordersIssued:0,orderAllowed:true,targetAllowed:true,defendReady:false,actionReady:true,
  controlAllowed:true,proven:true,onCommand:null,onOrderVerify:null});
 const nativeExecutor=row=>{
  f.shared.ordersIssued++;
  if(f.shared.onCommand)return f.shared.onCommand(row,f);
  if(f.shared.orderAllowed){
   f.put('npcEntities','pf55-persisted-native-order:'+row.operationID,proof(row));
   return {success:true};
  }
  return {success:false,errorMsg:'REJECTED'};
 };
 nativeExecutor.supports=action=>f.shared.actionReady&&
  (action!=='DEFEND'||f.shared.defendReady);
 const opts={gameStore:f.gameStore,pf52:F.pf52,
  access:{isOwner:f.deps.access.isOwner},
  allWritersFenced:()=>f.shared.writers,
  enabled:()=>f.shared.enabled,
  clock:()=>f.shared.clock,
  verifyExclusiveOwnership:()=>f.shared.exclusive,
  verifyNativeActor:()=>f.shared.native&&f.shared.scene?.entityID===F.SHIP&&
   f.shared.scene?.controllerEntityID===F.SHIP,
  verifyOriginalControl:()=>f.shared.controlAllowed,
  verifyTarget:()=>f.shared.targetAllowed,
  nativeExecutor,
  verifyPersistedNativeOrder(row){
   if(f.shared.onOrderVerify)return f.shared.onOrderVerify(row,f);
   return f.shared.proven ? f.get('npcEntities','pf55-persisted-native-order:'+row.operationID):null;
  }};
 f.orders=pf55.createPersonalFleetNativeOrders(opts);
 f.makeActive=()=>{
  f.seed();f.onboard();
  const c=F.command();
  if(f.bridge.prepare(c).status!=='PREPARED')throw Error('PF54_PREPARE_FAILED');
  if(f.bridge.dispatch(c).status!=='AWAITING_NATIVE_RECONCILIATION')throw Error('PF54_DISPATCH_FAILED');
  if(f.bridge.reconcile(c).status!=='ACTIVE')throw Error('PF54_RECONCILE_FAILED');
 };
 return f;
}
module.exports={...F,pf55,TARGET,command,open,proof};