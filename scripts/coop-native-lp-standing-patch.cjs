"use strict";
// Add opt-in authoritative standing gates to EveJS native static LP offers.
// Only checks native standingRuntime; stock purchase keeps LP/ISK/items authority.
const count=(s,n)=>s.split(n).length-1;
function replace(text,before,after,remove,label){
 if(text.includes(after)){
  if(count(text,after)!==1)throw Error("DUPLICATE_COOP_LP_PATCH "+label);
  return remove?text.replace(after,before):text;
 }
 if(count(text,before)!==1)throw Error("UNKNOWN_PINNED_LP_SOURCE "+label);
 return remove?text:text.replace(before,after);
}
function patch(source,file,remove=false){
 if(file!=="server/src/services/evermarks/lpStoreMgrService.js")
  throw Error("UNSUPPORTED_COOP_LP_PATCH "+file);
 let text=String(source);
 const eol=text.includes("\r\n")?"\r\n":"\n";
 const rule='  if (normalizePositiveInteger(offer.akCost, 0) > 0) {';
 const insert=[
  '  if (process.env.EVEJS_COOP_LP_STANDING_REQUIREMENTS === "1") {',
  '    const standingGate = require("../../space/coopNativeLpStandings").check({',
  '      characterID, corpID: normalizedCorpID,',
  '      requirements: offer.requiredStandings,',
  '      standingRuntime: require("../character/standingRuntime"),',
  '    });',
  '    if (!standingGate.ok) return { success: false, errorMsg: standingGate.errorMsg };',
  '  }',
  rule
 ].join(eol);
 text=replace(text,rule,insert,remove,"standing-gate");
 const message='  OFFER_NOT_FOUND: "That offer is no longer available.",';
 const messages=[
  '  STANDING_REQUIREMENT_NOT_MET: "Your faction or corporation standing is too low for this offer.",',
  '  STANDING_DATA_UNAVAILABLE: "Character standings cannot be verified for this offer.",',
  '  UNSUPPORTED_STANDING_REQUIREMENT: "This LP offer has an unsupported standing requirement.",',
  message
 ].join(eol);
 text=replace(text,message,messages,remove,"messages");
 return text;
}
module.exports={patch};
