'use strict';
/**
 * PF102: fail-closed original EveJS NPC catalogue + recurring salary preflight.
 * Source-owned, startup-only, read-only. This does NOT author hireable IDs.
 * A genuine operator-authored static catalog must exist in WORK source.
 */
const gameStore=require('../gameStore');
const corporations=require('../services/corporation/corporationState');
const npcData=require('./npc/npcData');
const TABLE='corporationRuntime',SEPARATOR='\u001f';
const positive=x=>Number.isSafeInteger(x)&&x>0;
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const profileID=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(x);
const exactKeys=(o,keys)=>Object.keys(o).length===keys.length&&
 keys.every(k=>Object.prototype.hasOwnProperty.call(o,k));
const CATALOG_KEYS=['npcCharacterID','employerCorpID','profileID','shipTypeID','amountCents'];
const SALARY_KEYS=['npcCharacterID','employerCorpID','profileID','shipTypeID','salaryCents','periodMs'];
const reject=reason=>Object.freeze({verified:false,reason});
function verifyOriginalCatalogAndWages(authoredCatalog,authoredSalaryPolicies){
 const atomic=gameStore?.coopAtomicNativeRows;
 if(atomic?.mode!=='SERVER_INTERNAL_FLAGGED'||
    typeof atomic.transact!=='function'||typeof atomic.isPoisoned!=='function'||
    typeof corporations.getNpcCharacterOwnerRecord!=='function'||
    typeof corporations.getCorporationRecord!=='function'||
    typeof corporations.isNpcCorporationID!=='function'||
    typeof npcData.buildNpcDefinition!=='function')
  return reject('PF102_ORIGINAL_SOURCE_SERVICES_MISSING');
 if(!Array.isArray(authoredCatalog)||!Array.isArray(authoredSalaryPolicies)||
    authoredCatalog.length<1||authoredCatalog.length>12||
    authoredSalaryPolicies.length!==authoredCatalog.length)
  return reject('PF102_AUTHORED_CATALOG_AND_WAGE_PAIR_REQUIRED');
 if(atomic.isPoisoned())return reject('PF102_ORIGINAL_GAMESTORE_POISONED');
 const seen=new Set(),pairs=[];
 for(const c of authoredCatalog){
  if(!object(c)||!exactKeys(c,CATALOG_KEYS)||
     ![c.npcCharacterID,c.employerCorpID,c.shipTypeID,c.amountCents].every(positive)||
     c.amountCents>1000000000000||!profileID(c.profileID)||
     seen.has(c.npcCharacterID))
   return reject('PF102_INVALID_OR_DUPLICATE_AUTHORED_NPC');
  seen.add(c.npcCharacterID);
  const matches=authoredSalaryPolicies.filter(s=>
    object(s)&&s.npcCharacterID===c.npcCharacterID);
  if(matches.length!==1)return reject('PF102_SALARY_POLICY_NOT_ONE_TO_ONE');
  const s=matches[0];
  if(!exactKeys(s,SALARY_KEYS)||
     s.employerCorpID!==c.employerCorpID||
     s.profileID!==c.profileID||s.shipTypeID!==c.shipTypeID||
     !positive(s.salaryCents)||s.salaryCents>1000000000000||
     !Number.isSafeInteger(s.periodMs)||
     s.periodMs<3600000||s.periodMs>604800000)
   return reject('PF102_IMMUTABLE_WAGE_TERMS_INVALID');
  pairs.push([c,s]);
 }
 if(new Set(authoredSalaryPolicies.map(s=>s?.npcCharacterID)).size!==seen.size)
  return reject('PF102_UNEXPECTED_WAGE_POLICY');
 try{
  return atomic.transact([TABLE],tx=>{
   if(atomic.isPoisoned()||typeof tx?.get!=='function')
    return reject('PF102_ORIGINAL_READ_AUTHORITY_REVOKED');
   for(const [c] of pairs){
    const character=corporations.getNpcCharacterOwnerRecord(c.npcCharacterID);
    const def=npcData.buildNpcDefinition(c.profileID);
    const corp=corporations.getCorporationRecord(c.employerCorpID);
    const source=tx.get(TABLE,'corporations'+SEPARATOR+c.employerCorpID);
    const division=source?.wallet?.divisions?.['1000'];
    if(!object(character)||character.ownerID!==c.npcCharacterID||
       character.typeID!==1373||
       typeof character.ownerName!=='string'||
       character.ownerName.trim().length<2||
       character.ownerName.startsWith('Entity '))
     return reject('PF102_ORIGINAL_SDE_NPC_CHARACTER_NOT_FOUND');
    if(!object(def)||def.profile?.profileID!==c.profileID||
       def.profile?.shipTypeID!==c.shipTypeID||
       !profileID(def.profile.loadoutID)||
       !profileID(def.profile.behaviorProfileID)||
       !object(def.loadout)||!object(def.behaviorProfile)||
       def.loadout.loadoutID!==def.profile.loadoutID||
       def.behaviorProfile.behaviorProfileID!==def.profile.behaviorProfileID)
     return reject('PF102_ORIGINAL_PROFILE_OR_FITTINGS_NOT_FOUND');
    if(!object(corp)||corp.corporationID!==c.employerCorpID||
       corp.isNPC!==true||
       corporations.isNpcCorporationID(c.employerCorpID)!==true||
       !object(source)||source.corporationID!==c.employerCorpID||
       !object(division)||!Number.isFinite(division.balance)||
       division.balance<0||
       !Array.isArray(division.journal)||
       !Array.isArray(division.transactions))
     return reject('PF102_ORIGINAL_NPC_EMPLOYER_WALLET_NOT_FOUND');
   }
   if(atomic.isPoisoned())return reject('PF102_ORIGINAL_READ_AUTHORITY_REVOKED');
   return Object.freeze({verified:true,source:'ORIGINAL_EVEJS_PF102_CATALOG_PREFLIGHT_V1',
    npcCount:pairs.length});
  });
 }catch{
  return reject('PF102_ORIGINAL_SDE_OR_SQLITE_READ_UNCERTAIN');
 }
}
module.exports=Object.freeze({verifyOriginalCatalogAndWages});
