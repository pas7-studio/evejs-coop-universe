'use strict';
/**
 * PF91: original PF57 paid-contract salary terms, not a client price engine.
 * The server must author explicit NPC wage amount and period for each
 * genuine catalog pilot. No default amount, synthetic wallet or free payment.
 * All reads are against the SAME original GameStore SQLite transaction.
 */
const pf53=require('./coopPersonalFleetPaidHiring');
const pf52=require('./coopPersonalFleetHangarBridge');
const npcData=require('./npc/npcData');
const corporations=require('../services/corporation/corporationState');
const nativeStore=require('./npc/nativeNpcStore');
const registry=require('./npc/npcRegistry');
const SEP='\u001f',T='corporationRuntime',LEDGER='coop-personal-fleet'+SEP+'contract-lifecycle-v1';
const pos=n=>Number.isSafeInteger(n)&&n>0;
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const TOKEN=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const PILOT=/^coop-pilot-[0-9]{3,}$/;
function validatePolicy(x){
 return obj(x)&&pos(x.npcCharacterID)&&pos(x.employerCorpID)&&
 typeof x.profileID==='string'&&TOKEN.test(x.profileID)&&
 pos(x.shipTypeID)&&pos(x.salaryCents)&&x.salaryCents<=1000000000000&&
 Number.isSafeInteger(x.periodMs)&&x.periodMs>=3600000&&x.periodMs<=604800000&&
 Object.keys(x).every(k=>['npcCharacterID','employerCorpID','profileID',
  'shipTypeID','salaryCents','periodMs'].includes(k));
}
function createOriginalSalaryTerms({authoredPolicies=[],clock=()=>Date.now(),
 enabled=()=>false,allWritersFenced=()=>false}={}){
 if(!Array.isArray(authoredPolicies)||authoredPolicies.length<1||
    authoredPolicies.length>12||authoredPolicies.some(x=>!validatePolicy(x))||
    new Set(authoredPolicies.map(x=>x.npcCharacterID)).size!==authoredPolicies.length||
    typeof pf53.verifyPaidReceipt!=='function'||typeof pf53.paidKey!=='function'||
    typeof pf52.validateIndex!=='function'||typeof pf52.REGISTRY_KEY!=='string'||
    typeof npcData.buildNpcDefinition!=='function'||
    typeof corporations.getNpcCharacterOwnerRecord!=='function'||
    typeof corporations.getCorporationRecord!=='function'||
    typeof corporations.isNpcCorporationID!=='function'||
    typeof nativeStore.listNativeEntities!=='function'||
    typeof nativeStore.listNativeControllers!=='function'||
    typeof registry.listControllers!=='function'||
    [clock,enabled,allWritersFenced].some(f=>typeof f!=='function'))
  throw Error('PF91_SOURCE_AUTHORED_SALARY_TERMS_REQUIRED');
 const policies=Object.freeze(authoredPolicies.map(x=>Object.freeze({...x})));
 const live=()=>enabled()===true&&allWritersFenced()===true;
 const forPilot=(pilot,corp)=>PILOT.test(pilot||'')&&pos(corp)?
   policies.find(x=>'coop-pilot-'+x.npcCharacterID===pilot&&x.employerCorpID===corp)||null:null;
 function readOriginalHire(command,tx){
  if(!live()||!obj(command)||!obj(tx)||!pos(command.ownerCharacterID)||
     !TOKEN.test(command.contractID)||!PILOT.test(command.pilotID))return null;
  const root=tx.get(T,pf52.REGISTRY_KEY);
  if(!obj(root))return null;
  let index;
  try{index=pf52.validateIndex(root);}catch{return null;}
  const pilot=index.pilots[command.pilotID];
  if(!obj(pilot)||pilot.ownerCharacterID!==command.ownerCharacterID||
     pilot.contractID!==command.contractID||index.contracts[command.contractID]!==command.pilotID)
   return null;
  const matches=Object.entries(index.processed).filter(([,r])=>
    r?.receipt?.type==='HIRED'&&r.receipt.pilotID===command.pilotID&&
    r.receipt.contractID===command.contractID);
  if(matches.length!==1)return null;
  const operationID=matches[0][0];
  if(!TOKEN.test(operationID))return null;
  const paid=tx.get(T,pf53.paidKey(operationID));
  if(!obj(paid)||paid.status!=='PAID'||paid.operationID!==operationID||
     paid.ownerCharacterID!==command.ownerCharacterID||
     paid.pilotID!==command.pilotID||paid.contractID!==command.contractID||
     pilot.hireReceiptHash!==paid.hireReceiptHash||
     pf53.verifyPaidReceipt(tx,paid)!==true)return null;
  return Object.freeze({operationID});
 }
 function originalPaid(command,tx){
  const hire=readOriginalHire(command,tx);
  return hire?tx.get(T,pf53.paidKey(hire.operationID)):null;
 }
 function sourcePilot(command,paid,policy){
  const id=Number(command.pilotID.slice('coop-pilot-'.length));
  if(!pos(id)||!policy||policy.npcCharacterID!==id||
     policy.employerCorpID!==paid.employerCorpID||
     paid.ownerCharacterID!==command.ownerCharacterID||
     paid.contractID!==command.contractID||paid.pilotID!==command.pilotID)return false;
  const character=corporations.getNpcCharacterOwnerRecord(id);
  const profile=npcData.buildNpcDefinition(policy.profileID);
  const corporation=corporations.getCorporationRecord(policy.employerCorpID);
  return character?.ownerID===id&&character?.typeID===1373&&
    typeof character.ownerName==='string'&&character.ownerName.length>1&&
    !character.ownerName.startsWith('Entity ')&&
    profile?.profile?.profileID===policy.profileID&&
    profile.profile.shipTypeID===policy.shipTypeID&&
    obj(profile.loadout)&&obj(profile.behaviorProfile)&&
    corporation?.corporationID===policy.employerCorpID&&corporation.isNPC===true&&
    corporations.isNpcCorporationID(policy.employerCorpID)===true;
 }
 function verifiedPaid(command,paid,tx){
  const source=originalPaid(command,tx);
  return obj(source)&&obj(paid)&&source.operationID===paid.operationID&&
   source.hireReceiptHash===paid.hireReceiptHash&&
   source.employerCorpID===paid.employerCorpID&&
   source.createdAtMs===paid.createdAtMs;
 }
 function resolveNativeSalary(command,paid,tx){
  if(!live()||!obj(command)||!obj(tx)||!obj(paid)||
     !Number.isSafeInteger(command.periodIndex)||command.periodIndex<1||
     !verifiedPaid(command,paid,tx))return null;
  const policy=forPilot(command.pilotID,paid.employerCorpID);
  if(!sourcePilot(command,paid,policy)||!pos(paid.createdAtMs)||
     !Number.isSafeInteger(policy.periodMs*command.periodIndex))return null;
  const dueAtMs=paid.createdAtMs+policy.periodMs*command.periodIndex;
  const now=clock();
  if(!pos(dueAtMs)||!pos(now)||dueAtMs>now)return null;
  // Missed periods remain payable in order after a long offline downtime.
  // No invisible forgiveness or newly priced arrears after restart.
  return Object.freeze({
   source:'ORIGINAL_EVEJS_PERSONAL_NPC_SALARY_V1',
   ownerCharacterID:command.ownerCharacterID,pilotID:command.pilotID,
   contractID:command.contractID,employerCorpID:paid.employerCorpID,
   periodIndex:command.periodIndex,revision:1,
   amountCents:policy.salaryCents,dueAtMs,
   expiresAtMs:Number.MAX_SAFE_INTEGER});
 }
 function verifyOriginalNpcService(command,paid,tx){
  if(!live()||!verifiedPaid(command,paid,tx))return false;
  const policy=forPilot(command.pilotID,paid.employerCorpID);
  return sourcePilot(command,paid,policy)===true;
 }
 function verifyNativeEmployer(command,paid,corp,tx){
  if(!live()||!verifiedPaid(command,paid,tx)||!obj(corp)||
     corp.corporationID!==paid.employerCorpID||
     !obj(corp.wallet?.divisions?.['1000']))return false;
  return corporations.getCorporationRecord(paid.employerCorpID)?.isNPC===true&&
     corporations.isNpcCorporationID(paid.employerCorpID)===true;
 }
 function verifyNativePilotReleased(command,tx){
  if(!live()||!obj(command)||!obj(tx)||!PILOT.test(command.pilotID))return false;
  try{
   const active=[
    ...nativeStore.listNativeEntities(),
    ...nativeStore.listNativeControllers(),
    ...registry.listControllers()
   ];
   return active.length<=100000&&active.every(row=>
    row?.personalFleetPilotID!==command.pilotID);
  }catch{return false;}
 }
 function verifyDismissalSettlement(command,tx){
  if(!live()||!obj(command)||!obj(tx))return false;
  const paid=originalPaid(command,tx);
  const policy=forPilot(command.pilotID,paid?.employerCorpID);
  if(!obj(paid)||!policy||!sourcePilot(command,paid,policy))return false;
  const ledger=tx.get(T,LEDGER),last=ledger?.contracts?.[command.pilotID]?.lastPeriod||0;
  if(!Number.isSafeInteger(last)||last<0)return false;
  const now=clock();
  if(!pos(now)||!pos(paid.createdAtMs)||now<paid.createdAtMs)return false;
  // Before releasing the paid NPC, all periods already due must have
  // their own independently committed PF57 salary journal receipts.
  const due=Math.floor((now-paid.createdAtMs)/policy.periodMs);
  return last>=due;
 }
 return Object.freeze({readOriginalHire,resolveNativeSalary,
  verifyOriginalNpcService,verifyNativeEmployer,verifyNativePilotReleased,
  verifyDismissalSettlement});
}
module.exports=Object.freeze({createOriginalSalaryTerms,validatePolicy});
