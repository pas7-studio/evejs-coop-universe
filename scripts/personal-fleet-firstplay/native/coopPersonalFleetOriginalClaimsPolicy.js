'use strict';
/**
 * PF105: canonical ORIGINAL Personal Fleet actor-claims policy.
 *
 * Exactly the SAME validator used by PF58 original physical NPC permit,
 * NOT a new parser or injectable "empty claims" replacement. This module
 * never commits, deletes or repairs actor claims; individual PF54/PF56/PF57
 * writers remain the only mutation owners, under original GameStore.
 */
const permit=require('./coopPersonalFleetOriginalNativePermit');
const KEY='coop-personal-fleet\u001factor-claims-v1';
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
function empty(){
 return {version:1,claims:{},generations:{},processed:{}};
}
function validate(raw){
 if(typeof permit?.validateOriginalClaimsIndex!=='function')
  throw Error('PF105_ORIGINAL_PF58_CLAIM_VALIDATOR_NOT_INSTALLED');
 // Never reinterpret a missing/read-failed key as "empty". The original
 // GameStore contracts distinguish proven absent (null) from unknown
 // (undefined); this distinction must survive every PF stage.
 if(raw===undefined)
  throw Error('PF105_ORIGINAL_ACTOR_CLAIM_READ_UNCERTAIN');
 const result=permit.validateOriginalClaimsIndex(raw);
 if(!object(result)||result.version!==1||
    !object(result.claims)||!object(result.generations)||
    !object(result.processed))
  throw Error('PF105_ORIGINAL_ACTOR_CLAIMS_INVALID');
 // Caller may legitimately update a validated clone within its one
 // original GameStore transaction. Do not freeze the mutable record.
 return result;
}
function createOriginalClaimsPolicy(){
 if(typeof permit?.validateOriginalClaimsIndex!=='function')
  throw Error('PF105_ORIGINAL_PF58_CLAIM_VALIDATOR_NOT_INSTALLED');
 // Fail if original PF58 disagrees on the canonical empty schema, rather
 // than allowing two actors to claim the same real item after a restart.
 const stock=permit.validateOriginalClaimsIndex(null);
 if(!object(stock)||stock.version!==1||!object(stock.claims)||
    !object(stock.generations)||!object(stock.processed)||
    Object.keys(stock.claims).length!==0||
    Object.keys(stock.generations).length!==0||
    Object.keys(stock.processed).length!==0)
  throw Error('PF105_ORIGINAL_PF58_EMPTY_CLAIMS_SCHEMA_CHANGED');
 return Object.freeze({KEY,empty,validate});
}
module.exports=Object.freeze({createOriginalClaimsPolicy});
