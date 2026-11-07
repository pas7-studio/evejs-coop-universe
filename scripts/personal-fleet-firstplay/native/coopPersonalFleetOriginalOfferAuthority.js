'use strict';
/**
 * WORK candidate: an original named NPC character (SDE), an existing authored
 * NPC profile/loadout, an original NPC corporation + its real wallet, and a
 * fixed server-owned hiring tariff form the only authorized hireable offer.
 *
 * No NPC profile/entity/item/ISK is created. A quote is a durable promise,
 * NOT a paid hire. PF53 alone charges the original character wallet and adds
 * a contracted pilot. The installed server must supply an explicitly authored,
 * immutable operator catalogue; unconfigured means NO OFFERS.
 *
 * Native target: Code/server/src/space/coopPersonalFleetOriginalOfferAuthority.js
 */
const {createHash}=require('node:crypto');
const {isDeepStrictEqual}=require('node:util');
const SEP='\u001f',T='corporationRuntime',CHAR='characters';
const PREFIX='coop-personal-fleet'+SEP+'native-offer-v1:';
const TOKEN=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const PROFILE=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const POS=x=>Number.isSafeInteger(x)&&x>0;
const OBJ=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const deny=reason=>Object.freeze({status:'BLOCKED',reason});
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const clone=x=>structuredClone(x);
const key=offerID=>PREFIX+offerID;
function validCatalogEntry(r){
 return OBJ(r)&&POS(r.npcCharacterID)&&POS(r.employerCorpID)&&POS(r.shipTypeID)&&
   PROFILE.test(r.profileID)&&POS(r.amountCents)&&r.amountCents<=1000000000000&&
   Object.keys(r).every(x=>['npcCharacterID','employerCorpID','profileID','shipTypeID','amountCents'].includes(x));
}
function createOriginalOfferAuthority({gameStore,pf52,pf53,access,
 originalNpcCharacters,originalNpcData,originalCorporations,
 authoredCatalog=[],enabled=()=>false,allWalletWritersFenced=()=>false,
 clock=()=>Date.now(),ttlMs=15*60*1000}={}){
 const atom=gameStore?.coopAtomicNativeRows;
 if(atom?.mode!=='SERVER_INTERNAL_FLAGGED'||typeof atom.transact!=='function'||
    typeof atom.isPoisoned!=='function'||
    typeof pf52?.REGISTRY_KEY!=='string'||typeof pf52?.validateIndex!=='function'||
    typeof pf52?.newIndex!=='function'||typeof pf53?.paidKey!=='function'||
    typeof pf53?.verifyPaidReceipt!=='function'||
    typeof access?.isOwner!=='function'||
    typeof originalNpcCharacters?.getNpcCharacterOwnerRecord!=='function'||
    typeof originalNpcData?.buildNpcDefinition!=='function'||
    typeof originalCorporations?.getCorporationRecord!=='function'||
    typeof originalCorporations?.isNpcCorporationID!=='function'||
    !Array.isArray(authoredCatalog)||authoredCatalog.length>12||
    authoredCatalog.some(x=>!validCatalogEntry(x))||
    new Set(authoredCatalog.map(x=>x.npcCharacterID)).size!==authoredCatalog.length||
    !Number.isSafeInteger(ttlMs)||ttlMs<60000||ttlMs>3600000||
    [enabled,allWalletWritersFenced,clock].some(x=>typeof x!=='function'))
  throw Error('PF_FIRSTPLAY_ORIGINAL_NPC_OFFER_AUTHORITIES_REQUIRED');
 // Never retain the author's mutable array; no user request can add a pilot.
 const catalog=Object.freeze(authoredCatalog.map(e=>Object.freeze(clone(e))));
 const available=()=>enabled()===true&&allWalletWritersFenced()===true&&atom.isPoisoned()===false;
 const pilotID=c=>'coop-pilot-'+c;
 const offerID=(owner,npc)=>'pf-offer-'+owner+'-'+npc;
 const contractID=(owner,npc,rev)=>'pf-contract-'+owner+'-'+npc+'-'+rev;
 function sourceProof(entry,tx){
  const character=originalNpcCharacters.getNpcCharacterOwnerRecord(entry.npcCharacterID);
  const definition=originalNpcData.buildNpcDefinition(entry.profileID);
  const corporation=originalCorporations.getCorporationRecord(entry.employerCorpID);
  const employer=tx.get(T,'corporations'+SEP+entry.employerCorpID);
  const division=employer?.wallet?.divisions?.['1000'];
  if(!OBJ(character)||character.ownerID!==entry.npcCharacterID||
     character.typeID!==1373||typeof character.ownerName!=='string'||
     character.ownerName.length<2||character.ownerName.startsWith('Entity ')||
     !OBJ(definition)||definition.profile?.profileID!==entry.profileID||
     definition.profile?.shipTypeID!==entry.shipTypeID||
     !OBJ(definition.loadout)||!OBJ(definition.behaviorProfile)||
     !OBJ(corporation)||corporation.corporationID!==entry.employerCorpID||
     corporation.isNPC!==true||
     originalCorporations.isNpcCorporationID(entry.employerCorpID)!==true||
     !OBJ(employer)||employer.corporationID!==entry.employerCorpID||
     !OBJ(division)||!Number.isFinite(division.balance)||division.balance<0||
     !Array.isArray(division.journal)||!Array.isArray(division.transactions))return null;
  return sha(['ORIGINAL_EVEJS_NPC_CATALOG_V1',entry.npcCharacterID,character.ownerName,
    entry.profileID,entry.shipTypeID,definition.profile.loadoutID,definition.profile.behaviorProfileID,
    entry.employerCorpID,entry.amountCents]);
 }
 function guard(session,owner,tx){
  if(!available()||!POS(owner)||!OBJ(session)||session.characterID!==owner||
     !POS(session.userid)||session.socket?.destroyed!==false||
     access.isOwner(session,owner,tx)!==true)return false;
  const record=tx.get(CHAR,String(owner));
  return OBJ(record)&&record.characterID===owner&&record.accountId===session.userid&&
    record.isDeleted!==true;
 }
 function expected(entry,owner,revision,expiresAtMs,proof){
  return {version:1,source:'ORIGINAL_EVEJS_STATIC_NPC_OFFER_V1',
    offerID:offerID(owner,entry.npcCharacterID),revision,
    contractID:contractID(owner,entry.npcCharacterID,revision),
    pilotID:pilotID(entry.npcCharacterID),npcCharacterID:entry.npcCharacterID,
    agentID:entry.npcCharacterID,employerCorpID:entry.employerCorpID,
    ownerCharacterID:owner,profileID:entry.profileID,
    shipTypeID:entry.shipTypeID,amountCents:entry.amountCents,
    sourceProof:proof,expiresAtMs};
 }
 function integrity(row,entry,owner,proof){
  return OBJ(row)&&POS(row.revision)&&POS(row.expiresAtMs)&&
    isDeepStrictEqual(row,expected(entry,owner,row.revision,row.expiresAtMs,proof));
 }
 function listNativeOffers({session,ownerCharacterID}={}){
  if(!available())return [];
  try{return atom.transact([T,CHAR],tx=>{
   if(!guard(session,ownerCharacterID,tx))return [];
   const raw=tx.get(T,pf52.REGISTRY_KEY);
   if(raw===undefined)return [];
   const idx=pf52.validateIndex(raw===null?pf52.newIndex():raw);
   const now=clock();if(!POS(now)||now>Number.MAX_SAFE_INTEGER-ttlMs)return [];
   const offers=[];
   for(const entry of catalog){
    const pid=pilotID(entry.npcCharacterID);
    if(idx.pilots[pid])continue; // One original NPC can have one active employer.
    const proof=sourceProof(entry,tx);
    if(!proof)continue;
    const id=offerID(ownerCharacterID,entry.npcCharacterID);
    if(!TOKEN.test(id))continue;
    const earlier=tx.get(T,key(id));
    if(earlier===undefined)return [];
    if(earlier!==null&&!integrity(earlier,entry,ownerCharacterID,proof))
     throw Error('PF_NATIVE_OFFER_PERSISTED_QUOTE_UNTRUSTED');
    let quote=earlier;
    if(quote!==null){
     // PF53 generates a random server operationID, so lookup by a guessed
     // operationID is unsafe. Use the original PF52 processed-hire index and
     // verify its matching native PF53 payment receipt in the SAME transaction.
     const hired=Object.entries(idx.processed).filter(([,v])=>
       v?.receipt?.type==='HIRED'&&v.receipt.pilotID===quote.pilotID&&
       v.receipt.contractID===quote.contractID);
     if(hired.length){
      if(hired.length!==1)throw Error('PF_NATIVE_OFFER_HIRE_HISTORY_AMBIGUOUS');
      const receipt=tx.get(T,pf53.paidKey(hired[0][0]));
      if(!receipt||pf53.verifyPaidReceipt(tx,receipt)!==true)
       throw Error('PF_NATIVE_OFFER_PAID_HISTORY_NOT_VERIFIED');
      continue; // No silent rehire; operator must explicitly allow a new contract.
     }
     if(quote.expiresAtMs>now){offers.push(clone(quote));continue;}
    }
    const revision=(quote?.revision||0)+1;
    if(!POS(revision)||revision>100000)return [];
    quote=expected(entry,ownerCharacterID,revision,now+ttlMs,proof);
    tx.put(T,key(id),quote);
    offers.push(clone(quote));
   }
   if(!guard(session,ownerCharacterID,tx))throw Error('PF_NATIVE_OFFER_AUTHORITY_REVOKED');
   return offers;
  });}catch{return [];} // No caller can distinguish commit-uncertain from no offers.
 }
 function lookupNativeOffer({session,ownerCharacterID,offerID:id}={}){
  if(!available()||!TOKEN.test(id))return null;
  try{return atom.transact([T,CHAR],tx=>{
   if(!guard(session,ownerCharacterID,tx))return null;
   const entry=catalog.find(e=>offerID(ownerCharacterID,e.npcCharacterID)===id);
   if(!entry)return null;
   const proof=sourceProof(entry,tx),offer=tx.get(T,key(id)),now=clock();
   if(!proof||!OBJ(offer)||!integrity(offer,entry,ownerCharacterID,proof)||
      !POS(now)||offer.expiresAtMs<=now)return null;
   return clone(offer);
  });}catch{return null;}
 }
 function resolveNativeOffer(command,tx){
  if(!available()||!OBJ(command)||!TOKEN.test(command.offerID)||
     !POS(command.ownerCharacterID)||!POS(command.agentID)||
     !POS(command.offerRevision))return null;
  const entry=catalog.find(e=>offerID(command.ownerCharacterID,e.npcCharacterID)===command.offerID);
  if(!entry||!guard(command.session,command.ownerCharacterID,tx))return null;
  const proof=sourceProof(entry,tx),row=tx.get(T,key(command.offerID)),now=clock();
  if(!POS(now)||!proof||!OBJ(row)||!integrity(row,entry,command.ownerCharacterID,proof)||
     row.revision!==command.offerRevision||row.agentID!==command.agentID||
     row.pilotID!==command.pilotID||row.contractID!==command.contractID||
     row.expiresAtMs<=now)return null;
  return clone(row);
 }
 function activeHire(entry,owner,tx){
  const offer=tx.get(T,key(offerID(owner,entry.npcCharacterID)));
  if(!OBJ(offer)||!integrity(offer,entry,owner,sourceProof(entry,tx)))return null;
  const raw=tx.get(T,pf52.REGISTRY_KEY);
  if(!OBJ(raw))return null;
  const idx=pf52.validateIndex(raw),p=idx.pilots[pilotID(entry.npcCharacterID)];
  if(!p||p.ownerCharacterID!==owner||p.contractID!==offer.contractID||
     p.pilotID!==offer.pilotID)return null;
  const matches=Object.entries(idx.processed).filter(([,v])=>
     v?.receipt?.type==='HIRED'&&v.receipt.pilotID===offer.pilotID&&
     v.receipt.contractID===offer.contractID);
  if(matches.length!==1)return null;
  const paid=tx.get(T,pf53.paidKey(matches[0][0]));
  if(!OBJ(paid)||paid.status!=='PAID'||paid.operationID!==matches[0][0]||
     paid.offerID!==offer.offerID||paid.offerRevision!==offer.revision||
     paid.contractID!==offer.contractID||paid.pilotID!==offer.pilotID||
     paid.ownerCharacterID!==owner||paid.employerCorpID!==offer.employerCorpID||
     paid.amountCents!==offer.amountCents||
     paid.hireReceiptHash!==p.hireReceiptHash||
     pf53.verifyPaidReceipt(tx,paid)!==true)return null;
  return offer;
 }
 function verifyHiredPilotHull({session,ownerCharacterID,pilotID:pid,shipTypeID}={},nativeTx=null){
  if(!available()||!POS(ownerCharacterID)||!POS(shipTypeID)||
     typeof pid!=='string')return false;
  const entry=catalog.find(e=>pilotID(e.npcCharacterID)===pid&&e.shipTypeID===shipTypeID);
  if(!entry)return false;
  try{
   const check=tx=>guard(session,ownerCharacterID,tx)&&
     activeHire(entry,ownerCharacterID,tx)!==null;
   return nativeTx?check(nativeTx)===true:
     atom.transact([T,CHAR],check)===true;
  }catch{return false;}
 }
 function resolvePaidNativeProfile(row){
  if(!available()||!OBJ(row)||!POS(row.ownerCharacterID)||!POS(row.shipItemID)||
     !POS(row.typeID)||!TOKEN.test(row.contractID)||typeof row.pilotID!=='string')return null;
  const entry=catalog.find(e=>pilotID(e.npcCharacterID)===row.pilotID&&
     e.shipTypeID===row.typeID);
  if(!entry)return null;
  try{return atom.transact([T,CHAR],tx=>{
   const owner=tx.get(CHAR,String(row.ownerCharacterID));
   if(!OBJ(owner)||owner.characterID!==row.ownerCharacterID||owner.isDeleted===true)
     return null;
   const hire=activeHire(entry,row.ownerCharacterID,tx);
   if(!hire||hire.contractID!==row.contractID)return null;
   const definition=originalNpcData.buildNpcDefinition(entry.profileID);
   if(!OBJ(definition)||definition.profile?.shipTypeID!==row.typeID||
      definition.profile?.profileID!==entry.profileID)return null;
   return clone(definition);
  });}catch{return null;}
 }
 function verifyOriginalNpcPilot(command,offer,tx){
  const verified=resolveNativeOffer(command,tx);
  return verified!==null&&verified.pilotID===offer?.pilotID&&
    verified.sourceProof===offer.sourceProof&&verified.agentID===offer.agentID;
 }
 function verifyNativeEmployer(command,offer,record,tx){
  const verified=resolveNativeOffer(command,tx);
  return verified!==null&&verified.employerCorpID===record?.corporationID&&
    record.wallet?.divisions?.['1000']?.balance>=0;
 }
 return Object.freeze({listNativeOffers,lookupNativeOffer,resolveNativeOffer,
  verifyOriginalNpcPilot,verifyNativeEmployer,verifyHiredPilotHull,
  resolvePaidNativeProfile});
}
// Bind real original EveJS ownership services; never inject client-provided
// NPC identities, corporations, profile rows or wallet values at install time.
function createSourceBoundOriginalOfferAuthority(options={}){
 const corporations=require('../services/corporation/corporationState');
 const npcData=require('./npc/npcData');
 return createOriginalOfferAuthority({...options,
  originalNpcCharacters:corporations,originalNpcData:npcData,
  originalCorporations:corporations});
}
module.exports=Object.freeze({createOriginalOfferAuthority,
 createSourceBoundOriginalOfferAuthority,validCatalogEntry,key});
