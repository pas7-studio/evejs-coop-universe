'use strict';
/**
 * PF93 original Personal Fleet payroll: source-bound, server-only actorless
 * settlement. Runs on the EXISTING original PF56 native server tick. No
 * forged account/session, no synthetic ISK or user-input rate/period.
 *
 * Real PF53 persisted wage consent + PF57 period CAS are the only permits.
 * Each tick pays a bounded number of already due periods, one per pilot;
 * an uncertain COMMIT is sticky-fenced for the rest of this process.
 */
const gameStore=require('../gameStore');
const pf52=require('./coopPersonalFleetHangarBridge');
const pf53=require('./coopPersonalFleetPaidHiring');
const pf57=require('./coopPersonalFleetContractLifecycle');
const consent=require('./coopPersonalFleetOriginalPayrollConsent');
const T='corporationRuntime',CHAR='characters';
const pos=x=>Number.isSafeInteger(x)&&x>0;
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const pilot=x=>typeof x==='string'&&/^coop-pilot-[0-9]{3,}$/.test(x);
const token=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(x);
const blocked=reason=>Object.freeze({status:'BLOCKED',reason});
function createOriginalPayrollScheduler({lifecycle,salaryTerms,
 serverPayrollCapability,enabled=()=>false,allWritersFenced=()=>false,
 clock=()=>Date.now(),maxPerTick=2}={}){
 const atomic=gameStore?.coopAtomicNativeRows;
 if(atomic?.mode!=='SERVER_INTERNAL_FLAGGED'||
    typeof atomic.transact!=='function'||typeof atomic.isPoisoned!=='function'||
    typeof pf52.validateIndex!=='function'||typeof pf52.validateRoster!=='function'||
    typeof pf52.REGISTRY_KEY!=='string'||typeof pf52.ROSTER_PREFIX!=='string'||
    typeof pf53.verifyPaidReceipt!=='function'||typeof pf53.paidKey!=='function'||
    typeof pf57.validate!=='function'||typeof pf57.empty!=='function'||
    typeof pf57.LEDGER!=='string'||
    typeof consent.salaryOperationID!=='function'||
    typeof consent.verifyPaidWageConsent!=='function'||
    typeof lifecycle?.salaryServer!=='function'||
    typeof salaryTerms?.verifyOriginalNpcService!=='function'||
    typeof serverPayrollCapability!=='symbol'||
    [enabled,allWritersFenced,clock].some(x=>typeof x!=='function')||
    !Number.isSafeInteger(maxPerTick)||maxPerTick<1||maxPerTick>5)
  throw Error('PF93_ORIGINAL_SERVER_PAYROLL_AUTHORITIES_REQUIRED');
 const live=()=>enabled()===true&&allWritersFenced()===true&&atomic.isPoisoned()===false;
 let busy=false,cursor=0;
 const unknown=new Set();
 function openDue(){
  return atomic.transact([T,CHAR],tx=>{
   const root=tx.get(T,pf52.REGISTRY_KEY);
   if(root===null)return [];
   if(!obj(root))return null;
   const index=pf52.validateIndex(root),
    ledger=pf57.validate(tx.get(T,pf57.LEDGER)??pf57.empty());
   const pilots=Object.values(index.pilots);
   if(pilots.length>256)return null;
   const now=clock();
   if(!pos(now))return null;
   const jobs=[],seen=new Set();
   for(const entry of pilots){
    if(!obj(entry)||!pilot(entry.pilotID)||!pos(entry.ownerCharacterID)||
       !token(entry.contractID)||seen.has(entry.pilotID))
     return null;
    seen.add(entry.pilotID);
    if(index.contracts[entry.contractID]!==entry.pilotID||
       ledger.closedContracts[entry.contractID])return null;
    const rosterRaw=tx.get(T,pf52.ROSTER_PREFIX+entry.ownerCharacterID);
    if(!obj(rosterRaw))return null;
    const roster=pf52.validateRoster(rosterRaw,entry.ownerCharacterID),
     assigned=roster.pilots?.[entry.pilotID];
    if(!obj(assigned)||assigned.contractID!==entry.contractID||
       assigned.hireReceiptHash!==entry.hireReceiptHash||
       !['CONTRACTED','HANGAR_RESERVED'].includes(assigned.status))
     return null;
    const matches=Object.entries(index.processed).filter(([,v])=>
     v?.receipt?.type==='HIRED'&&v.receipt.pilotID===entry.pilotID&&
     v.receipt.contractID===entry.contractID);
    if(matches.length!==1||!token(matches[0][0]))return null;
    const paid=tx.get(T,pf53.paidKey(matches[0][0]));
    if(!obj(paid)||paid.status!=='PAID'||paid.ownerCharacterID!==entry.ownerCharacterID||
       paid.contractID!==entry.contractID||paid.pilotID!==entry.pilotID||
       paid.hireReceiptHash!==entry.hireReceiptHash||
       pf53.verifyPaidReceipt(tx,paid)!==true||
       consent.verifyPaidWageConsent(tx,paid)!==true)return null;
    const agreement=paid.payrollConsent;
    const char=tx.get(CHAR,String(entry.ownerCharacterID));
    if(!obj(char)||char.characterID!==entry.ownerCharacterID||
       char.accountId!==agreement.accountID||char.isDeleted===true)return null;
    const ledgerEntry=ledger.contracts[entry.pilotID];
    if(ledgerEntry&&(ledgerEntry.status!=='ACTIVE'||
       ledgerEntry.contractID!==entry.contractID||
       ledgerEntry.ownerCharacterID!==entry.ownerCharacterID||
       ledgerEntry.hireReceiptHash!==entry.hireReceiptHash))return null;
    const period=(ledgerEntry?.lastPeriod||0)+1;
    if(!Number.isSafeInteger(period)||period<1||period>1000000)return null;
    const due=agreement.startsAtMs+period*agreement.periodMs;
    if(!Number.isSafeInteger(due)||due<=0)return null;
    if(due>now)continue;
    const command=Object.freeze({
     source:'PF93_ORIGINAL_SERVER_PAYROLL_V1',
     ownerCharacterID:entry.ownerCharacterID,
     accountID:agreement.accountID,pilotID:entry.pilotID,
     contractID:entry.contractID,periodIndex:period,
     operationID:consent.salaryOperationID({
      ownerCharacterID:entry.ownerCharacterID,pilotID:entry.pilotID,
      contractID:entry.contractID,periodIndex:period})
    });
    if(!token(command.operationID)||
       salaryTerms.verifyOriginalNpcService(command,paid,tx)!==true)return null;
    jobs.push(command);
   }
   if(jobs.length>256)return null;
   jobs.sort((a,b)=>a.ownerCharacterID-b.ownerCharacterID||
      a.pilotID.localeCompare(b.pilotID));
   if(!jobs.length)return [];
   // Round-robin over ALL due pilots. An underfunded pilot or an
   // unresolved COMMIT must never permanently starve later contracts.
   const start=cursor%jobs.length;
   cursor=(start+maxPerTick)%jobs.length;
   return [...jobs.slice(start),...jobs.slice(0,start)].slice(0,maxPerTick);
  });
 }
 function tick(){
  if(!live())return blocked('PF93_PAYROLL_NATIVE_GATE_OFF');
  if(busy)return blocked('PF93_PAYROLL_TICK_REENTRANT');
  busy=true;
  try{
   const jobs=openDue();
   if(!Array.isArray(jobs))return blocked('PF93_ORIGINAL_DUE_PAYROLL_SNAPSHOT_UNVERIFIED');
   let applied=0,duplicates=0,blockedCount=0;
   const issues=[];
   for(const c of jobs){
    if(!live())return blocked('PF93_PAYROLL_GATE_REVOKED_DURING_TICK');
    if(unknown.has(c.operationID)){
     blockedCount++;issues.push({pilotID:c.pilotID,reason:'UNKNOWN_OUTCOME_FENCED'});
     continue;
    }
    let result;
    try{result=lifecycle.salaryServer(c,serverPayrollCapability);}
    catch{
     unknown.add(c.operationID);result=blocked('PF93_ORIGINAL_SALARY_CALL_THREW_OUTCOME_UNCERTAIN');
    }
    if(result?.status==='APPLIED')applied++;
    else if(result?.status==='DUPLICATE')duplicates++;
    else{
     blockedCount++;
     const reason=typeof result?.reason==='string'?result.reason:'PF93_ORIGINAL_OUTCOME_UNKNOWN';
     if(reason.includes('COMMIT_OUTCOME_UNKNOWN')||
        reason.includes('OUTCOME_UNCERTAIN')||!obj(result)||result.status!=='BLOCKED')
      unknown.add(c.operationID);
     issues.push({pilotID:c.pilotID,reason});
    }
   }
   return {status:blockedCount?'PAYROLL_NEEDS_REVIEW':'PAYROLL_RECONCILED',
    due:jobs.length,applied,duplicates,blocked:blockedCount,issues};
  }catch{return blocked('PF93_PAYROLL_ORIGINAL_SQLITE_UNAVAILABLE');}
  finally{busy=false;}
 }
 return Object.freeze({tick});
}
module.exports=Object.freeze({createOriginalPayrollScheduler});
