'use strict';
const F=require('./pf54-fixture.cjs');
const api=require('../native/coopPersonalFleetContractLifecycle.cjs');
const WRECK=980300000010;
function payrollCmd(extra={}){return {operationID:'pf57-salary-1',ownerCharacterID:F.OWNER,
 pilotID:F.PILOT,contractID:F.OFFER.contractID,periodIndex:1,session:F.session,...extra};}
function dismissCmd(extra={}){return {operationID:'pf57-dismiss-1',ownerCharacterID:F.OWNER,
 pilotID:F.PILOT,contractID:F.OFFER.contractID,session:F.session,...extra};}
function lossCmd(extra={}){return {operationID:'pf57-loss-1',ownerCharacterID:F.OWNER,
 pilotID:F.PILOT,contractID:F.OFFER.contractID,assignmentID:F.ASSIGNMENT,
 shipItemID:F.SHIP,systemID:F.SYSTEM,actorGeneration:1,reservationGeneration:1,
 wreckID:WRECK,session:F.session,...extra};}
function lossWreck(f){
 // Native original stock ItemStore is flat: delete ONLY the destroyed hull.
 f.db.prepare('DELETE FROM "items" WHERE key=?').run(String(F.SHIP));
 // PF54 fixture's legacy pilot-profile aggregate is NOT an original entity
 // collection. Replace it with actual original grouped NPC SQLite skeletons.
 f.db.prepare('DELETE FROM "npcEntities" WHERE key=?').run('npcEntities');
 f.put('npcEntities','entities',{});
 f.put('npcEntities','nextEntityID',980000000000);
 f.put('npcWrecks','npcWrecks',{wrecks:{[WRECK]:{wreckID:WRECK,sourceEntityID:F.SHIP,
  systemID:F.SYSTEM,sourceTypeID:606,ownerID:F.OWNER}}});
 f.put('corporationRuntime','native-death:'+WRECK,
  {wreckID:WRECK,entityID:F.SHIP,originalKill:true});
 f.put('npcWreckItems','npcWreckItems',{items:{},receipts:{[WRECK]:{wreckID:WRECK,sourceEntityID:F.SHIP,
  originalCargoAccountedFor:true,originalFittingsAccountedFor:true,titleTransferOrDestructionPersisted:true}}});
 f.put('npcCargo','npcCargo',{cargo:{}});
 f.put('npcModules','modules',{});
 f.put('npcModules','nextModuleID',980100000000);
 f.shared.scene=null;
}
function open(file){
 const f=F.open(file);
 Object.assign(f.shared,{salaryTxID:f.shared.txid+1,salaryCents:4500,
  periodRevision:1,payCalls:0,nativePilotReleased:true,dismissalSettled:true,authHire:true,
  serviceReady:true,wreckProof:true,assetProof:true,otherOrdersClear:true,
  notificationSuccess:true,wreckProofBad:null,custodyProofBad:null});
 const opts={gameStore:f.gameStore,pf52:F.pf52,pf53:F.pf53,
  claimsPolicy:F.claimsPolicy,access:f.deps.access,
  enabled:()=>f.shared.enabled,allWritersFenced:()=>f.shared.writers,
  clock:()=>f.shared.clock,
  verifyExclusiveOwnership:()=>f.shared.exclusive,
  resolveOriginalHire:(c,tx)=>f.shared.authHire&&tx.get('corporationRuntime',F.pf53.paidKey('pf54-hire-1'))?
   {operationID:'pf54-hire-1'}:null,
  resolveNativeSalary:(c,paid)=>({source:'ORIGINAL_EVEJS_PERSONAL_NPC_SALARY_V1',
   ownerCharacterID:c.ownerCharacterID,contractID:c.contractID,pilotID:c.pilotID,
   employerCorpID:paid.employerCorpID,periodIndex:c.periodIndex,revision:f.shared.periodRevision,
   amountCents:f.shared.salaryCents,dueAtMs:f.shared.clock-500,expiresAtMs:f.shared.clock+1000}),
  verifyOriginalNpcService:(c,paid,tx)=>f.shared.serviceReady&&
   tx.get('npcEntities','npcEntities')?.pilots?.[c.pilotID]?.available===true,
  verifyNativeEmployer:(c,p,corp)=>corp?.isNPC===true&&corp.corporationID===p.employerCorpID,
  verifyJournalID:({transactionID})=>transactionID===f.shared.salaryTxID,
  originalTransactionID:()=>f.shared.salaryTxID,
  verifyNativePilotReleased:()=>f.shared.nativePilotReleased,
  verifyDismissalSettlement:()=>f.shared.dismissalSettled,
  verifyNativeWreckLoss(c,tx){
   if(!f.shared.wreckProof||!tx.get('corporationRuntime','native-death:'+c.wreckID)?.originalKill||
    f.shared.scene!==null)return null;
   return {source:'ORIGINAL_EVEJS_WRECK_AND_DEATH_V1',shipItemID:c.shipItemID,
    wreckID:c.wreckID,ownerCharacterID:c.ownerCharacterID,pilotID:c.pilotID,
    actorGeneration:c.actorGeneration,originalKillRecordPersisted:true,
    nativeEntityAbsent:true,nativeControllerAbsent:true,noDuplicateLiveEntity:true,
    killHash:F.FIT,...f.shared.wreckProofBad};
  },
  verifyWreckAssetCustody(c,tx){
   const r=tx.get('npcWreckItems','npcWreckItems')?.receipts?.[c.wreckID];
   if(!f.shared.assetProof||r?.sourceEntityID!==c.shipItemID)return null;
   return {source:'ORIGINAL_EVEJS_WRECK_CUSTODY_V1',shipItemID:c.shipItemID,
    wreckID:c.wreckID,originalCargoAccountedFor:r.originalCargoAccountedFor,
    originalFittingsAccountedFor:r.originalFittingsAccountedFor,
    noDuplicatedItemIDs:true,titleTransferOrDestructionPersisted:r.titleTransferOrDestructionPersisted,
    receiptHash:F.CARGO,...f.shared.custodyProofBad};
  },
  verifyNoCompetingOrders:()=>f.shared.otherOrdersClear,
  notifyOriginalWallet:()=>f.shared.notificationSuccess};
 f.life=api.createPersonalFleetContractLifecycle(opts);
 f.salaryCommand=payrollCmd;f.dismissCommand=dismissCmd;f.lossCommand=lossCmd;
 f.prepareActive=()=>{
  f.seed();f.onboard();const c=F.command();
  for(const [name,res] of [['prepare',f.bridge.prepare(c)],['dispatch',f.bridge.dispatch(c)],['reconcile',f.bridge.reconcile(c)]])
   if(!['PREPARED','AWAITING_NATIVE_RECONCILIATION','ACTIVE'].includes(res.status))
    throw Error(name+' failed: '+JSON.stringify(res));
 };
 f.prepareContracted=()=>{f.seed();f.onboard();
  const x=f.hangar.execute({type:'RELEASE_HANGAR_SHIP',operationID:'pf57-release-1',
   pilotID:F.PILOT,ownerCharacterID:F.OWNER,session:F.session,shipItemID:F.SHIP,
   stationID:F.STATION,assignmentID:F.ASSIGNMENT,expectedRosterRevision:2,
   expectedPilotRevision:1,expectedGeneration:1});
  if(x.status!=='APPLIED')throw Error('RELEASE_FAILED '+JSON.stringify(x));};
 return {...f,api,lossWreck:()=>lossWreck(f)};
}
module.exports={...F,api,open,payrollCmd,dismissCmd,lossCmd,WRECK,lossWreck};
