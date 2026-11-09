'use strict';
/** PF57 original-GameStore personal fleet recurring service fees / dismiss / original wreck loss.
 * Strict integration candidate: NO synthetic pilots, replacement ships, wallet, refunds or timers.
 */
const crypto=require('node:crypto');
const T='corporationRuntime',CHAR='characters',ITEMS='items',NPC='npcEntities',WRECK='npcWrecks';
const SEP='\u001f',K='coop-personal-fleet'+SEP;
const LEDGER=K+'contract-lifecycle-v1',CLAIMS=K+'actor-claims-v1',PF54=K+'deploy-v1:',PF56=K+'return-dock-v1:';
const TOKEN=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/,PILOT=/^coop-pilot-[0-9]{3,}$/,HEX=/^[a-f0-9]{64}$/;
const pos=x=>Number.isSafeInteger(x)&&x>0;
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const deny=reason=>({status:'BLOCKED',reason});
const sha=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const clone=x=>structuredClone(x);
const cents=x=>{if(typeof x!=='number'||!Number.isFinite(x)||x<0)return null;const n=Math.round(x*100);return Number.isSafeInteger(n)&&Math.abs(n-x*100)<1e-6?n:null;};
const isk=x=>x/100;
const filetime=ms=>String(BigInt(ms)*10000n+116444736000000000n);
const empty=()=>({version:1,contracts:{},processed:{},closedContracts:{},losses:{}});
function validate(state){
 if(!obj(state)||state.version!==1||!obj(state.contracts)||!obj(state.processed)||
  !obj(state.closedContracts)||!obj(state.losses)||Object.keys(state.contracts).length>256||
  Object.keys(state.processed).length>4096||Object.keys(state.closedContracts).length>4096||
  Object.keys(state.losses).length>1024)throw Error('PF57_LEDGER_CORRUPT');
 for(const [id,v] of Object.entries(state.contracts))if(!PILOT.test(id)||!obj(v)||v.pilotID!==id||
  !pos(v.ownerCharacterID)||!pos(v.employerCorpID)||!TOKEN.test(v.contractID)||
  !HEX.test(v.hireReceiptHash)||!Number.isSafeInteger(v.lastPeriod)||v.lastPeriod<0||
  !['ACTIVE','DISMISSED'].includes(v.status)||!Number.isSafeInteger(v.lossCount)||v.lossCount<0)
  throw Error('PF57_CONTRACT_ROW_CORRUPT');
 for(const [id,v] of Object.entries(state.processed))if(!TOKEN.test(id)||!obj(v)||!HEX.test(v.signature)||
  !['PAID','DISMISSED','LOST'].includes(v.type)||!obj(v.receipt))throw Error('PF57_PROCESSED_CORRUPT');
 for(const [id,v] of Object.entries(state.closedContracts))if(!TOKEN.test(id)||!obj(v)||
  !PILOT.test(v.pilotID)||!TOKEN.test(v.operationID))throw Error('PF57_CLOSED_CORRUPT');
 for(const [id,v] of Object.entries(state.losses))if(!TOKEN.test(id)||!obj(v)||!pos(v.wreckID)||
  !pos(v.shipItemID)||!HEX.test(v.witnessHash))throw Error('PF57_LOSS_CORRUPT');
 return state;
}
function journalEntry(owner,other,txid,operationID,delta,after,at){
 return {transactionID:txid,transactionDate:filetime(at),referenceID:other,
  ownerID1:owner,ownerID2:other,accountKey:1000,entryTypeID:10,
  amount:isk(delta),balance:isk(after),currency:1,sortValue:1,
  description:'Personal NPC salary '+operationID};
}
function journalHas(rows,txid,op,owner,other,amount,after){
 return Array.isArray(rows)&&rows.filter(v=>v?.transactionID===txid).length===1&&
  rows.some(v=>v?.transactionID===txid&&v.ownerID1===owner&&v.ownerID2===other&&
   v.referenceID===other&&v.accountKey===1000&&v.currency===1&&
   v.description==='Personal NPC salary '+op&&cents(Math.abs(v.amount))===Math.abs(amount)&&
   (amount<0?v.amount<0:v.amount>0)&&cents(v.balance)===after);
}
function createPersonalFleetContractLifecycle({gameStore,pf52,pf53,claimsPolicy,access,
 resolveOriginalHire,resolveNativeSalary,verifyOriginalNpcService,verifyNativeEmployer,
 verifyJournalID,originalTransactionID,verifyNativePilotReleased,verifyDismissalSettlement,verifyNativeWreckLoss,
 verifyWreckAssetCustody,verifyNoCompetingOrders,verifyExclusiveOwnership,
 allWritersFenced=()=>false,enabled=()=>false,clock=()=>Date.now(),notifyOriginalWallet=()=>false}={}){
 const atomic=gameStore?.coopAtomicNativeRows;
 if(atomic?.mode!=='SERVER_INTERNAL_FLAGGED'||typeof atomic.transact!=='function'||
  typeof atomic.isPoisoned!=='function'||!pf52||!pf53||
  typeof pf52.validateIndex!=='function'||typeof pf52.validateRoster!=='function'||
  typeof pf52.REGISTRY_KEY!=='string'||typeof pf52.ROSTER_PREFIX!=='string'||
  typeof pf53.verifyPaidReceipt!=='function'||typeof pf53.journalKey!=='function'||
  claimsPolicy?.KEY!==CLAIMS||typeof claimsPolicy.validate!=='function'||
  [access?.isOwner,resolveOriginalHire,resolveNativeSalary,verifyOriginalNpcService,
   verifyNativeEmployer,verifyJournalID,originalTransactionID,verifyNativePilotReleased,
   verifyDismissalSettlement,verifyNativeWreckLoss,verifyWreckAssetCustody,verifyNoCompetingOrders,verifyExclusiveOwnership,
   allWritersFenced,enabled,clock,notifyOriginalWallet].some(v=>typeof v!=='function'))
  throw Error('PF57_NATIVE_AUTHORITIES_REQUIRED');
 const pre=c=>{
  if(enabled()!==true)return {status:'DISABLED'};
  if(!obj(c)||!TOKEN.test(c.operationID)||!PILOT.test(c.pilotID)||!TOKEN.test(c.contractID)||
   !pos(c.ownerCharacterID)||!obj(c.session)||c.session.characterID!==c.ownerCharacterID||
   !pos(c.session.userid)||c.session.socket?.destroyed===true)return deny('PF57_INVALID_COMMAND');
  if(allWritersFenced()!==true||atomic.isPoisoned())return deny('PF57_WALLET_OR_NATIVE_WRITERS_UNFENCED');
  if(access.isOwner(c.session,c.ownerCharacterID)!==true)return deny('PF57_ACCESS_DENIED');
  return null;
 };
 function gate(c,tx){
  if(enabled()!==true||allWritersFenced()!==true||atomic.isPoisoned())return 'PF57_GATE_REVOKED';
  if(access.isOwner(c.session,c.ownerCharacterID,tx)!==true)return 'PF57_ACCESS_REVOKED';
  if(verifyExclusiveOwnership(c,tx)!==true)return 'PF57_WAR_MINING_EXPLORATION_UNFENCED';
  return null;
 }
 function read(c,tx){
  const idx=tx.get(T,pf52.REGISTRY_KEY),rs=tx.get(T,pf52.ROSTER_PREFIX+c.ownerCharacterID),raw=tx.get(T,LEDGER);
  if(idx===undefined||rs===undefined||raw===undefined||idx===null||rs===null)
   return {error:'PF57_ORIGINAL_ROSTER_UNAVAILABLE'};
  let ix,roster,ledger;
  try{ix=pf52.validateIndex(idx);roster=pf52.validateRoster(rs,c.ownerCharacterID);
   ledger=validate(raw===null?empty():raw);}catch{return {error:'PF57_ORIGINAL_ROSTER_OR_LEDGER_CORRUPT'};}
  const p=roster.pilots?.[c.pilotID],i=ix.pilots?.[c.pilotID];
  if(!p||!i||p.contractID!==c.contractID||i.contractID!==c.contractID||
   i.ownerCharacterID!==c.ownerCharacterID||i.hireReceiptHash!==p.hireReceiptHash||
   ix.contracts[c.contractID]!==c.pilotID||ledger.closedContracts[c.contractID])
   return {error:'PF57_CONTRACT_NOT_ACTIVE_OR_CHANGED'};
  return {ix,roster,ledger,p,i};
 }
 function verifyHire(c,s,tx){
  // Resolve PF53 payment ONLY by a privileged original-hire authority.
  // A request cannot supply its own employer or paid receipt.
  const ref=resolveOriginalHire(c,tx);
  if(!obj(ref)||!TOKEN.test(ref.operationID))return null;
  const paid=tx.get(T,pf53.paidKey(ref.operationID));
  if(!obj(paid)||paid.operationID!==ref.operationID||paid.ownerCharacterID!==c.ownerCharacterID||
   paid.contractID!==c.contractID||paid.pilotID!==c.pilotID||
   paid.hireReceiptHash!==s.p.hireReceiptHash||!pos(paid.employerCorpID)||
   pf53.verifyPaidReceipt(tx,paid)!==true)return null;
  return paid;
 }
 function salary(c){
  const bad=pre(c);if(bad)return bad;
  if(!Number.isSafeInteger(c.periodIndex)||c.periodIndex<1)return deny('PF57_INVALID_SALARY_PERIOD');
  const sig=sha(['PF57_SALARY',c.operationID,c.pilotID,c.contractID,c.ownerCharacterID,c.periodIndex]);
  let result;
  try{result=atomic.transact([T,CHAR,NPC],tx=>{
   const reason=gate(c,tx);if(reason)return deny(reason);
   const rawLedger=tx.get(T,LEDGER);
   if(rawLedger===undefined)return deny('PF57_LEDGER_READ_UNKNOWN');
   let preLedger;try{preLedger=validate(rawLedger===null?empty():rawLedger);}
   catch{return deny('PF57_LEDGER_CORRUPT');}
   const old=preLedger.processed[c.operationID];
   if(old){
    if(old.signature!==sig||old.type!=='PAID')return deny('PF57_REPLAY_CONFLICT');
    const rec=old.receipt,chars=tx.get(CHAR,CHAR),ch=chars?.[String(c.ownerCharacterID)],
     emp=tx.get(T,'corporations'+SEP+rec.employerCorpID),div=emp?.wallet?.divisions?.['1000'];
    if(!journalHas(ch?.walletJournal,rec.transactionID,c.operationID,c.ownerCharacterID,
      rec.employerCorpID,-rec.amountCents,rec.characterAfterCents)||
       !journalHas(div?.journal,rec.transactionID,c.operationID,rec.employerCorpID,
       c.ownerCharacterID,rec.amountCents,rec.employerAfterCents)||
       !journalHas(div?.transactions,rec.transactionID,c.operationID,rec.employerCorpID,
       c.ownerCharacterID,rec.amountCents,rec.employerAfterCents))
      return deny('PF57_REPLAY_ORIGINAL_WALLET_RECEIPT_MISSING');
    return {status:'DUPLICATE',receipt:clone(rec)};
   }
   const s=read(c,tx);if(s.error)return deny(s.error);
   if(Object.keys(s.ledger.processed).length>=4096)return deny('PF57_RECEIPT_CAP');
   const prior=s.ledger.contracts[c.pilotID];
   const paid=verifyHire(c,s,tx);if(!paid)return deny('PF57_ORIGINAL_PAID_HIRE_UNVERIFIED');
   if(prior&&(prior.status!=='ACTIVE'||prior.contractID!==c.contractID||
    prior.ownerCharacterID!==c.ownerCharacterID||prior.employerCorpID!==paid.employerCorpID||
    prior.hireReceiptHash!==paid.hireReceiptHash))return deny('PF57_CONTRACT_LEDGER_CONFLICT');
   const lastPeriod=prior?.lastPeriod||0;
   if(c.periodIndex!==lastPeriod+1)return deny('PF57_PERIOD_OUT_OF_SEQUENCE');
   const quote=resolveNativeSalary(c,paid,tx);
   const now=clock();
   if(!pos(now)||!obj(quote)||quote.source!=='ORIGINAL_EVEJS_PERSONAL_NPC_SALARY_V1'||
    quote.pilotID!==c.pilotID||quote.contractID!==c.contractID||
    quote.ownerCharacterID!==c.ownerCharacterID||quote.employerCorpID!==paid.employerCorpID||
    quote.periodIndex!==c.periodIndex||!pos(quote.revision)||!pos(quote.amountCents)||
    quote.amountCents>1000000000000||!pos(quote.dueAtMs)||!pos(quote.expiresAtMs)||
    quote.dueAtMs>now||now>=quote.expiresAtMs)
    return deny('PF57_NATIVE_SALARY_QUOTE_UNVERIFIED_OR_NOT_DUE');
   if(verifyOriginalNpcService(c,paid,tx)!==true)return deny('PF57_NATIVE_PILOT_SERVICE_UNVERIFIED');
   const employer=tx.get(T,'corporations'+SEP+paid.employerCorpID);
   if(!obj(employer)||employer.corporationID!==paid.employerCorpID||
    verifyNativeEmployer(c,paid,employer,tx)!==true)
    return deny('PF57_NATIVE_EMPLOYER_UNVERIFIED');
   const div=employer.wallet?.divisions?.['1000'],beforeCorp=cents(div?.balance);
   const chars=tx.get(CHAR,CHAR),owner=chars?.[String(c.ownerCharacterID)],before=cents(owner?.balance);
   if(!obj(chars)||!obj(owner)||owner.characterID!==c.ownerCharacterID||
    !Array.isArray(owner.walletJournal)||!Array.isArray(div?.journal)||
    !Array.isArray(div?.transactions)||beforeCorp===null||before===null)
    return deny('PF57_ORIGINAL_WALLETS_UNAVAILABLE');
   if(before<quote.amountCents)return deny('PF57_INSUFFICIENT_ISK');
   const afterCorp=beforeCorp+quote.amountCents;
   if(!Number.isSafeInteger(afterCorp))return deny('PF57_WALLET_OVERFLOW');
   const transactionID=originalTransactionID({command:c,quote,tx});
   if(!pos(transactionID)||verifyJournalID({transactionID,command:c,quote},tx)!==true||
    tx.get(T,pf53.journalKey(transactionID))!==null||
    owner.walletJournal.some(v=>v?.transactionID===transactionID)||
    div.journal.some(v=>v?.transactionID===transactionID)||
    div.transactions.some(v=>v?.transactionID===transactionID))
    return deny('PF57_NATIVE_JOURNAL_ID_COLLISION');
   const after=before-quote.amountCents;
   const debit=journalEntry(c.ownerCharacterID,paid.employerCorpID,transactionID,
    c.operationID,-quote.amountCents,after,now);
   const credit=journalEntry(paid.employerCorpID,c.ownerCharacterID,transactionID,
    c.operationID,quote.amountCents,afterCorp,now);
   const receipt={type:'PAID',operationID:c.operationID,pilotID:c.pilotID,
    contractID:c.contractID,ownerCharacterID:c.ownerCharacterID,employerCorpID:paid.employerCorpID,
    periodIndex:c.periodIndex,amountCents:quote.amountCents,transactionID,
    characterAfterCents:after,employerAfterCents:afterCorp,paidAtMs:now};
   const nextPilot={version:1,pilotID:c.pilotID,contractID:c.contractID,
    hireReceiptHash:paid.hireReceiptHash,ownerCharacterID:c.ownerCharacterID,
    employerCorpID:paid.employerCorpID,lastPeriod:c.periodIndex,
    lossCount:prior?.lossCount||0,status:'ACTIVE'};
   s.ledger.contracts[c.pilotID]=nextPilot;
   s.ledger.processed[c.operationID]={signature:sig,type:'PAID',receipt};
   tx.put(CHAR,CHAR,{...chars,[String(c.ownerCharacterID)]:{...owner,balance:isk(after),
    balanceChange:isk(-quote.amountCents),walletJournal:[debit,...owner.walletJournal].slice(0,100)}});
   tx.put(T,'corporations'+SEP+paid.employerCorpID,{...employer,wallet:{...employer.wallet,divisions:{
    ...employer.wallet.divisions,'1000':{...div,balance:isk(afterCorp),
     journal:[...div.journal,credit].slice(-100),
     transactions:[...div.transactions,credit].slice(-2000)}}}});
   tx.put(T,pf53.journalKey(transactionID),{version:1,operationID:c.operationID,
    transactionID,ownerCharacterID:c.ownerCharacterID,employerCorpID:paid.employerCorpID});
   tx.put(T,LEDGER,validate(s.ledger));
   return {status:'APPLIED',receipt};
  });}catch{return deny('PF57_SALARY_COMMIT_OUTCOME_UNKNOWN');}
  if(result?.status==='APPLIED'||result?.status==='DUPLICATE'){
   let notified=false;
   try{notified=notifyOriginalWallet({command:c,receipt:result.receipt},gameStore)===true;}catch{}
   return {...result,notificationStatus:notified?'DELIVERED':'PENDING'};
  }
  return result;
 }
 function dismiss(c){
  const bad=pre(c);if(bad)return bad;
  const sig=sha(['PF57_DISMISS',c.operationID,c.ownerCharacterID,c.pilotID,c.contractID]);
  try{return atomic.transact([T,ITEMS,NPC],tx=>{
   const reason=gate(c,tx);if(reason)return deny(reason);
   const raw=tx.get(T,LEDGER);
   if(raw===undefined)return deny('PF57_LEDGER_READ_UNKNOWN');
   let ledger;try{ledger=validate(raw===null?empty():raw);}catch{return deny('PF57_LEDGER_CORRUPT');}
   const earlier=ledger.processed[c.operationID];
   if(earlier){
    if(earlier.signature!==sig||earlier.type!=='DISMISSED')return deny('PF57_OPERATION_COLLISION');
    const ixRaw=tx.get(T,pf52.REGISTRY_KEY),roRaw=tx.get(T,pf52.ROSTER_PREFIX+c.ownerCharacterID);
    let ix,roster;try{ix=pf52.validateIndex(ixRaw);roster=pf52.validateRoster(roRaw,c.ownerCharacterID);}
    catch{return deny('PF57_REPLAY_ORIGINAL_RELEASE_UNVERIFIED');}
    if(ix.pilots[c.pilotID]||ix.contracts[c.contractID]||roster.pilots[c.pilotID]||
      ledger.closedContracts[c.contractID]?.operationID!==c.operationID)
      return deny('PF57_REPLAY_ORIGINAL_RELEASE_UNVERIFIED');
    return {status:'DUPLICATE',receipt:clone(earlier.receipt)};
   }
   const s=read(c,tx);if(s.error)return deny(s.error);
   if(s.p.status!=='CONTRACTED'||s.p.shipItemID!==null||
    Object.values(s.ix.ships).some(v=>v.pilotID===c.pilotID))
    return deny('PF57_SHIP_STILL_RESERVED_OR_ACTIVE');
   // The native controller/identity owner must show this pilot has no pending
   // startup, combat, warp, return, pending loss or outstanding salary period.
   if(verifyNoCompetingOrders(c,tx)!==true||verifyNativePilotReleased(c,tx)!==true)
    return deny('PF57_NATIVE_PILOT_OR_ORDER_STILL_ACTIVE');
   if(verifyDismissalSettlement(c,tx)!==true)
    return deny('PF57_OUTSTANDING_SALARY_OR_TERMINATION_UNVERIFIED');
   if(Object.keys(s.ledger.processed).length>=4096||Object.keys(s.ledger.closedContracts).length>=4096||
    s.roster.revision>=Number.MAX_SAFE_INTEGER-1)return deny('PF57_LEDGER_CAP');
   const at=clock();if(!pos(at))return deny('PF57_CLOCK_INVALID');
   const receipt={type:'DISMISSED',operationID:c.operationID,pilotID:c.pilotID,
    contractID:c.contractID,ownerCharacterID:c.ownerCharacterID,dismissedAtMs:at,
    noRefund:true,noOriginalPilotDeleted:true};
   s.ledger.closedContracts[c.contractID]={pilotID:c.pilotID,operationID:c.operationID,at};
   if(s.ledger.contracts[c.pilotID])s.ledger.contracts[c.pilotID].status='DISMISSED';
   s.ledger.processed[c.operationID]={signature:sig,type:'DISMISSED',receipt};
   delete s.ix.pilots[c.pilotID];delete s.ix.contracts[c.contractID];
   delete s.roster.pilots[c.pilotID];s.roster.revision++;
   pf52.validateIndex(s.ix);pf52.validateRoster(s.roster,c.ownerCharacterID);
   tx.put(T,pf52.REGISTRY_KEY,s.ix);
   tx.put(T,pf52.ROSTER_PREFIX+c.ownerCharacterID,s.roster);
   tx.put(T,LEDGER,validate(s.ledger));
   return {status:'APPLIED',receipt};
  });}catch{return deny('PF57_DISMISS_COMMIT_OUTCOME_UNKNOWN');}
 }
 function loss(c){
  const bad=pre(c);if(bad)return bad;
  if(!TOKEN.test(c.assignmentID)||!pos(c.shipItemID)||!pos(c.systemID)||
   !pos(c.actorGeneration)||!pos(c.reservationGeneration)||!pos(c.wreckID))
   return deny('PF57_LOSS_COMMAND_INVALID');
  const sig=sha(['PF57_LOSS',c.operationID,c.ownerCharacterID,c.pilotID,c.contractID,
   c.assignmentID,c.shipItemID,c.systemID,c.actorGeneration,c.reservationGeneration,c.wreckID]);
  try{return atomic.transact([T,ITEMS,NPC,WRECK,'npcCargo','npcModules','npcWreckItems'],tx=>{
   const reason=gate(c,tx);if(reason)return deny(reason);
   const raw=tx.get(T,LEDGER);
   if(raw===undefined)return deny('PF57_LEDGER_READ_UNKNOWN');
   let ledger;try{ledger=validate(raw===null?empty():raw);}catch{return deny('PF57_LEDGER_CORRUPT');}
   const prior=ledger.processed[c.operationID];
   if(prior){
    if(prior.signature!==sig||prior.type!=='LOST')return deny('PF57_OPERATION_COLLISION');
    const rawIdx=tx.get(T,pf52.REGISTRY_KEY),rawRo=tx.get(T,pf52.ROSTER_PREFIX+c.ownerCharacterID),
     rawClaims=tx.get(T,CLAIMS),dep=tx.get(T,PF54+c.assignmentID),
      originalShipRow=tx.get(ITEMS,String(c.shipItemID)),
     wreckRoot=tx.get(WRECK,WRECK),record=ledger.losses[c.assignmentID];
    let ix,ro,claims;try{ix=pf52.validateIndex(rawIdx);ro=pf52.validateRoster(rawRo,c.ownerCharacterID);
      claims=claimsPolicy.validate(rawClaims);}catch{return deny('PF57_REPLAY_ORIGINAL_LOSS_UNVERIFIED');}
    if(!obj(record)||record.wreckID!==c.wreckID||record.shipItemID!==c.shipItemID||
      ix.ships[String(c.shipItemID)]||ro.pilots[c.pilotID]?.shipItemID!==null||
      claims.claims[String(c.shipItemID)]||dep?.phase!=='LOST'||
      originalShipRow!==null||
      wreckRoot?.wrecks?.[String(c.wreckID)]?.sourceEntityID!==c.shipItemID)
      return deny('PF57_REPLAY_ORIGINAL_LOSS_UNVERIFIED');
    return {status:'DUPLICATE',receipt:clone(prior.receipt)};
   }
   if(ledger.losses[c.assignmentID])return deny('PF57_ASSIGNMENT_ALREADY_LOST');
   const s=read(c,tx);if(s.error)return deny(s.error);
   const hull=s.ix.ships[String(c.shipItemID)];
   if(s.p.status!=='HANGAR_RESERVED'||!hull||hull.ownerCharacterID!==c.ownerCharacterID||
    hull.pilotID!==c.pilotID||hull.assignmentID!==c.assignmentID||
    hull.generation!==c.reservationGeneration||s.p.shipItemID!==c.shipItemID||
    s.p.assignmentID!==c.assignmentID||s.p.generation!==c.reservationGeneration)
    return deny('PF57_LOSS_RESERVATION_MISMATCH');
   const dep=tx.get(T,PF54+c.assignmentID),rawClaims=tx.get(T,CLAIMS);
   if(!obj(dep)||dep.phase!=='ACTIVE'||dep.ownerCharacterID!==c.ownerCharacterID||
    dep.pilotID!==c.pilotID||dep.shipItemID!==c.shipItemID||
    dep.actorGeneration!==c.actorGeneration||!obj(rawClaims))
    return deny('PF57_ACTIVE_DEPLOYMENT_UNVERIFIED');
   let claims;try{claims=claimsPolicy.validate(rawClaims);}catch{return deny('PF57_ACTOR_CLAIMS_CORRUPT');}
   const claim=claims.claims[String(c.shipItemID)];
   if(!obj(claim)||claim.pilotID!==c.pilotID||claim.assignmentID!==c.assignmentID||
    claim.generation!==c.actorGeneration||claim.ownerCharacterID!==c.ownerCharacterID)
    return deny('PF57_ACTOR_CLAIM_MISMATCH');
   const originalShipRow=tx.get(ITEMS,String(c.shipItemID)),
    wreckRoot=tx.get(WRECK,WRECK),
    entityRoot=tx.get(NPC,NPC),cargoRoot=tx.get('npcCargo','npcCargo'),
    moduleRoot=tx.get('npcModules','npcModules'),wreckItems=tx.get('npcWreckItems','npcWreckItems');
   if(!obj(entityRoot)||!obj(entityRoot.entities)||!obj(cargoRoot)||!obj(cargoRoot.cargo)||
      !obj(moduleRoot)||!obj(moduleRoot.modules)||!obj(wreckItems)||!obj(wreckItems.items))
    return deny('PF57_ORIGINAL_NATIVE_ASSET_TABLES_UNAVAILABLE');
   if(own(entityRoot.entities,String(c.shipItemID))||
      Object.values(cargoRoot.cargo).some(v=>v?.entityID===c.shipItemID)||
      Object.values(moduleRoot.modules).some(v=>v?.entityID===c.shipItemID))
    return deny('PF57_ORIGINAL_NATIVE_ASSETS_STILL_ACTIVE');
   const sourceItemIDs=new Set();
   for(const row of Object.values(wreckItems.items)){
    if(!obj(row))return deny('PF57_ORIGINAL_WRECK_ITEMS_CORRUPT');
    const original=row.originalItemID??row.sourceItemID;
    if(pos(original)){
      if(sourceItemIDs.has(original))return deny('PF57_DUPLICATED_ORIGINAL_WRECK_ITEM_TITLE');
      sourceItemIDs.add(original);
    }
   }
   if(originalShipRow!==null)
    return deny('PF57_ORIGINAL_SHIP_NOT_DESTROYED');
   const wreck=wreckRoot?.wrecks?.[String(c.wreckID)];
   if(!obj(wreckRoot)||!obj(wreckRoot.wrecks))
    return deny('PF57_ORIGINAL_WRECK_TABLE_UNAVAILABLE');
   const matches=Object.values(wreckRoot.wrecks).filter(x=>x?.sourceEntityID===c.shipItemID);
   if(matches.length===0)return deny('PF57_ORIGINAL_WRECK_NOT_FOUND');
   if(matches.length!==1)return deny('PF57_DUPLICATE_OR_AMBIGUOUS_NATIVE_WRECK');
   if(!obj(wreck)||wreck.wreckID!==c.wreckID||wreck.sourceEntityID!==c.shipItemID||
    wreck.systemID!==c.systemID)
    return deny('PF57_ORIGINAL_WRECK_NOT_FOUND');
   const proof=verifyNativeWreckLoss({...c,originalWreck:clone(wreck)},tx);
   if(!obj(proof)||proof.source!=='ORIGINAL_EVEJS_WRECK_AND_DEATH_V1'||
    proof.shipItemID!==c.shipItemID||proof.wreckID!==c.wreckID||
    proof.ownerCharacterID!==c.ownerCharacterID||proof.pilotID!==c.pilotID||
    proof.actorGeneration!==c.actorGeneration||proof.originalKillRecordPersisted!==true||
    proof.nativeEntityAbsent!==true||proof.nativeControllerAbsent!==true||
    proof.noDuplicateLiveEntity!==true||!HEX.test(proof.killHash))
    return deny('PF57_NATIVE_WRECK_LOSS_UNVERIFIED');
   const custody=verifyWreckAssetCustody({...c,originalWreck:clone(wreck)},tx);
   if(!obj(custody)||custody.source!=='ORIGINAL_EVEJS_WRECK_CUSTODY_V1'||
    custody.shipItemID!==c.shipItemID||custody.wreckID!==c.wreckID||
    custody.originalCargoAccountedFor!==true||custody.originalFittingsAccountedFor!==true||
    custody.noDuplicatedItemIDs!==true||custody.titleTransferOrDestructionPersisted!==true||
    !HEX.test(custody.receiptHash))return deny('PF57_WRECK_ASSET_CUSTODY_UNVERIFIED');
   const returned=tx.get(T,PF56+c.assignmentID);
   // A pending sessionless docking writer might still commit an ItemStore move.
   // A wreck cannot resolve that ambiguous native side-effect on its own.
   if(returned!==null&&returned!==undefined&&(!obj(returned)||returned.shipItemID!==c.shipItemID||
    returned.pilotID!==c.pilotID||['DOCK_ISSUING','DOCKED'].includes(returned.phase)))
    return deny('PF57_RETURN_DOCK_CONFLICT');
   if(verifyNoCompetingOrders({...c,terminalLoss:true},tx)!==true)
    return deny('PF57_NATIVE_ORDER_LIFECYCLE_UNVERIFIED');
   if(Object.keys(claims.processed).length>=1024||Object.keys(ledger.processed).length>=4096||
    Object.keys(ledger.losses).length>=1024||s.roster.revision>=Number.MAX_SAFE_INTEGER-1||
    s.p.revision>=Number.MAX_SAFE_INTEGER-1)return deny('PF57_LOSS_LEDGER_CAP');
   const at=clock();if(!pos(at))return deny('PF57_CLOCK_INVALID');
   const receipt={type:'LOST',operationID:c.operationID,assignmentID:c.assignmentID,
    pilotID:c.pilotID,contractID:c.contractID,ownerCharacterID:c.ownerCharacterID,
    shipItemID:c.shipItemID,wreckID:c.wreckID,actorGeneration:c.actorGeneration,
    reservationGeneration:c.reservationGeneration,processedAtMs:at,
    originalItemNotRecreated:true,noAutomaticReplacement:true};
   delete s.ix.ships[String(c.shipItemID)];
   s.p.status='CONTRACTED';s.p.shipItemID=null;s.p.revision++;
   delete s.p.stationID;delete s.p.assignmentID;delete s.p.generation;
   s.roster.revision++;
   const claimReceiptKey='pf57:'+c.operationID;
   if(own(claims.processed,claimReceiptKey))return deny('PF57_ACTOR_RECEIPT_COLLISION');
   delete claims.claims[String(c.shipItemID)];
   claims.processed[claimReceiptKey]={signature:JSON.stringify(['PF57_LOSS',c.shipItemID,c.actorGeneration]),
    receipt:{type:'RELEASE',entityID:c.shipItemID,pilotID:c.pilotID,generation:c.actorGeneration}};
   // PF52 index generations remain monotonic; destroyed item is never reinserted.
   const lossRecord={version:1,assignmentID:c.assignmentID,shipItemID:c.shipItemID,
    wreckID:c.wreckID,ownerCharacterID:c.ownerCharacterID,pilotID:c.pilotID,
    contractID:c.contractID,witnessHash:sha([proof,custody]),at};
   ledger.losses[c.assignmentID]=lossRecord;
   if(ledger.contracts[c.pilotID])ledger.contracts[c.pilotID].lossCount++;
   ledger.processed[c.operationID]={signature:sig,type:'LOST',receipt};
   pf52.validateIndex(s.ix);pf52.validateRoster(s.roster,c.ownerCharacterID);
   claimsPolicy.validate(claims);validate(ledger);
   tx.put(T,pf52.REGISTRY_KEY,s.ix);
   tx.put(T,pf52.ROSTER_PREFIX+c.ownerCharacterID,s.roster);
   tx.put(T,CLAIMS,claims);
   tx.put(T,PF54+c.assignmentID,{...dep,phase:'LOST',lossWreckID:c.wreckID,lossAtMs:at});
   if(obj(returned))tx.put(T,PF56+c.assignmentID,{...returned,phase:'LOST',lossWreckID:c.wreckID});
   tx.put(T,LEDGER,ledger);
   return {status:'APPLIED',receipt};
  });}catch{return deny('PF57_LOSS_COMMIT_OUTCOME_UNKNOWN');}
 }
 function inspect(c){const bad=pre(c);if(bad)return bad;
  try{return atomic.transact([T],tx=>{
   const reason=gate(c,tx);if(reason)return deny(reason);
   const raw=tx.get(T,LEDGER);if(raw===undefined)return deny('PF57_LEDGER_READ_UNKNOWN');
   const l=validate(raw===null?empty():raw);
   const v=l.contracts[c.pilotID];
   if(v&&(v.ownerCharacterID!==c.ownerCharacterID||v.contractID!==c.contractID))
    return deny('PF57_CONTRACT_OWNERSHIP_CONFLICT');
   const losses=Object.values(l.losses).filter(x=>x.ownerCharacterID===c.ownerCharacterID&&
    x.pilotID===c.pilotID&&x.contractID===c.contractID);
   if(!v&&!losses.length)return {status:'NOT_FOUND'};
   return {status:'OK',contract:v?clone(v):null,losses:clone(losses)};
  });}catch{return deny('PF57_READ_UNCERTAIN');}
 }
 return Object.freeze({salary,dismiss,loss,inspect});
}
module.exports={LEDGER,CLAIMS,PF54,PF56,empty,validate,cents,journalEntry,journalHas,
 createPersonalFleetContractLifecycle};
