"use strict";
// Isolated Chat-08 L1 transform helper; NEVER run standalone against a deployed
// EveJS checkout. Chat 01's transactional installer must own invocation.
const FILE="server/src/services/fitting/liveFittingState.js";
const ANCHOR="  const limit = toInt(slotCounts[family], 0);";
const HOOK='  if (process.env.EVEJS_COOP_FITTING_SLOT_GUARD === "1") return require("../../space/coopNativeFittingSlotGuard").getSlotFlagsForFamily({family,shipTypeID,baseFlags,slotCounts});';
function patch(source,file,remove=false){
 if(file!==FILE||typeof source!=="string")throw Error("FITTING_SLOT_WRONG_SOURCE");
 const eol=source.includes("\r\n")?"\r\n":"\n";
 const count=needle=>source.split(needle).length-1;
 if(count(ANCHOR)!==1)throw Error("FITTING_SLOT_ANCHOR_DRIFT");
 const before=source.indexOf("function getSlotFlagsForFamily(");
 const after=source.indexOf("function sortFittedItems(",before);
 if(before<0||after<=before||!(source.indexOf(ANCHOR)>before&&source.indexOf(ANCHOR)<after))
  throw Error("FITTING_SLOT_FUNCTION_DRIFT");
 const old='  return limit > 0 ? baseFlags.slice(0, limit) : [...baseFlags];';
 if(count(old)!==1)throw Error("FITTING_SLOT_RETURN_DRIFT");
 if(remove){
  if(count(HOOK)>1)throw Error("FITTING_SLOT_DUPLICATE_HOOK");
  return count(HOOK)===1?source.replace(HOOK+eol,""):source;
 }
 if(count(HOOK)===1)return source;
 if(count(HOOK)>1)throw Error("FITTING_SLOT_DUPLICATE_HOOK");
 return source.replace(ANCHOR+eol,ANCHOR+eol+HOOK+eol);
}
module.exports={patch,FILE,ANCHOR,HOOK};
