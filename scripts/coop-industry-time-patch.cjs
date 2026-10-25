"use strict";
// Only the pinned industry parity helper's FINAL manufacturing duration
// is adjusted. No blueprints, materials, taxes, slots or jobs are minted.
function patch(source,file,remove=false){
 if(!file.endsWith("industry/industryParityHelpers.js"))return String(source);
 const text=String(source);
 const old="    Math.round(totalSeconds),";
 const updated='    Math.round(require("../../space/coopIndustryPacing").adjust(totalSeconds, activityID, INDUSTRY_ACTIVITY.MANUFACTURING)),';
 const before=text.split(old).length-1,after=text.split(updated).length-1;
 if(before+after!==1||!text.includes("function resolveIndustryJobTimeSeconds("))
  throw Error("UNKNOWN_OR_PARTIALLY_PATCHED_NATIVE_INDUSTRY_TIMING");
 return remove&&after?text.replace(updated,old):
  !remove&&before?text.replace(old,updated):text;
}
module.exports={patch};
