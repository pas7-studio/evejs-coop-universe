"use strict";
// Server-only proof that THIS authenticated pilot actually resolved a native
// probe signature. No client-provided coordinates, items, ISK or fake warps.
// Receipt is session-local, expires, and disappears on reconnect by design.
const PROOF_TTL_MS = 15 * 60 * 1000;
const MAX_PROOFS = 64;
const numberID=value=>{
 const n=Number(value);
 return Number.isSafeInteger(n)&&n>0?n:0;
};
const normalizeTargetID=value=>
 (typeof value==="string"||Number.isSafeInteger(value))
   ?String(value).trim().toUpperCase():"";
const currentSystem=session=>numberID(session&&
 ((session._space&&session._space.systemID)||session.solarsystemid2||session.solarsystemid));
const charID=session=>numberID(session&&(session.characterID||session.charid));
function keyValData(row){
 if(!row||row.type!=="object"||row.name!=="util.KeyVal"||
   !row.args||row.args.type!=="dict"||!Array.isArray(row.args.entries))
  return null;
 return Object.fromEntries(row.args.entries.filter(e=>Array.isArray(e)&&e.length===2));
}
function findMatchingSite(sites,resultID){
 const id=normalizeTargetID(resultID);
 if(!id||!Array.isArray(sites))return null;
 const found=sites.filter(site=>numberID(site&&site.siteID)>0&&
  (normalizeTargetID(site.targetID)===id||String(site.siteID)===id));
 return found.length===1?found[0]:null;
}
function record({session,scanResult,origin,sites,nowMs=Date.now()}={}){
 const characterID=charID(session),systemID=currentSystem(session);
 const timestamp=Number(nowMs);
 if(!characterID||!systemID||!origin||
   numberID(origin.characterID)!==characterID||
   numberID(origin.systemID)!==systemID||
   !session._space||!numberID(session._space.shipID)||
   !Number.isFinite(timestamp)||timestamp<0||
   !Array.isArray(scanResult&&scanResult.results))
  return {status:"INVALID_NATIVE_SCAN_ORIGIN",count:0};
 const old=session._coopNativeScanProof;
 const proof=old&&old.characterID===characterID&&old.systemID===systemID&&
   Array.isArray(old.receipts)?old.receipts.filter(r=>
      r&&r.expiresAtMs>timestamp&&r.expiresAtMs<=timestamp+PROOF_TTL_MS):[];
 let added=0;
 for(const raw of scanResult.results){
  const entry=keyValData(raw);
  const certainty=Number(entry&&entry.certainty);
  if(!entry||!Number.isFinite(certainty)||certainty<1)continue;
  const site=findMatchingSite(sites,entry.id);
  if(!site)continue;
  const id=numberID(site.siteID),targetID=normalizeTargetID(site.targetID);
  if(!targetID)continue;
  const next={siteID:id,targetID,expiresAtMs:timestamp+PROOF_TTL_MS};
  const idx=proof.findIndex(r=>r.siteID===id);
  if(idx>=0)proof.splice(idx,1);
  proof.push(next);added++;
 }
 session._coopNativeScanProof={
   characterID,systemID,receipts:proof.slice(-MAX_PROOFS)
 };
 return {status:"NATIVE_PROBE_SCAN_RECORDED",count:added};
}
function authorize({session,locationID,resultID,sites,nowMs=Date.now()}={}){
 const characterID=charID(session),systemID=currentSystem(session);
 const requestedSystem=numberID(locationID),timestamp=Number(nowMs);
 if(!characterID||!systemID||requestedSystem!==systemID||
   !session._space||!numberID(session._space.shipID)||
   !Number.isFinite(timestamp)||timestamp<0)
  return {ok:false,reason:"INVALID_SESSION_OR_SYSTEM"};
 const proof=session._coopNativeScanProof;
 if(!proof||proof.characterID!==characterID||proof.systemID!==systemID||
   !Array.isArray(proof.receipts))
  return {ok:false,reason:"NO_NATIVE_SCAN_RECEIPT"};
 const site=findMatchingSite(sites,resultID);
 if(!site)return {ok:false,reason:"SIGNATURE_NOT_FOUND"};
 const siteID=numberID(site.siteID);
 const targetID=normalizeTargetID(site.targetID);
 if(!siteID||!targetID)return {ok:false,reason:"INVALID_SITE"};
 const recorded=proof.receipts.find(r=>
   r.siteID===siteID&&r.targetID===targetID&&
   Number.isFinite(r.expiresAtMs)&&r.expiresAtMs>timestamp&&
   r.expiresAtMs<=timestamp+PROOF_TTL_MS);
 if(!recorded)return {ok:false,reason:"PERFECT_SCAN_REQUIRED"};
 return {ok:true,siteID,targetID};
}
function fastFleetBookmarkAccess({session,bookmarkView,fleetRuntime}={}){
 if(!session||!bookmarkView||!bookmarkView.bookmark||
   !bookmarkView.folder||bookmarkView.folder.isPersonal!==false||
   bookmarkView.isActive!==true||!fleetRuntime)
  return false;
 const caller=charID(session),creator=numberID(bookmarkView.bookmark.creatorID);
 if(!caller||!creator||caller===creator)return false;
 // Native bookmarkRuntime.getBookmarkForCharacter must have already granted
 // caller actual access. This helper NEVER grants private-folder access.
 const fleet=typeof fleetRuntime.getFleetForCharacter==="function"
   ?fleetRuntime.getFleetForCharacter(caller):null;
 return Boolean(fleet&&typeof fleetRuntime.getMemberRecord==="function"&&
   fleetRuntime.getMemberRecord(fleet,caller)&&
   fleetRuntime.getMemberRecord(fleet,creator));
}
module.exports={record,authorize,fastFleetBookmarkAccess,_testing:{keyValData,findMatchingSite}};
