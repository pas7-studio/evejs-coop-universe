"use strict";
// Chat 30 / Chat 01 handoff. Isolated one-expression reversible transform for
// pinned contractProxy; not a second installer, not automatically deployed.
const FILE="server/src/services/_other/contractProxyService.js";
const FLAG='process.env.EVEJS_COOP_NATIVE_CONTRACT_MUTATION_FENCE === "1"';
const GUARD='require("../../space/coopNativeContractMutationFence").facade()';
const fragments=Object.freeze([
  "createContract(rawInfo, session, {",
  "acceptContract(contractID, session, forCorp)",
  "completeContract(contractID, status, session)",
  "deleteContract(contractID, session)",
  "deleteMultipleContracts(contractIDs, session)"
]);
function patch(source,file,remove=false){
 if(file!==FILE)throw Error("CONTRACT_FENCE_WRONG_SOURCE");
 if(typeof source!=="string")throw Error("CONTRACT_FENCE_SOURCE_REQUIRED");
 let text=source;
 for(const expr of fragments){
  const before="contractRuntime."+expr;
  const after=`(${FLAG} ? ${GUARD} : contractRuntime).`+expr;
  const oldCount=text.split(before).length-1,newCount=text.split(after).length-1;
  if(newCount===1 && oldCount===0){
    if(remove)text=text.replace(after,before);
    continue;
  }
  if(newCount===0&&oldCount===1){if(!remove)text=text.replace(before,after);continue;}
  throw Error("CONTRACT_FENCE_PINNED_ANCHOR_DRIFT:"+expr);
 }
 return text;
}
module.exports={patch,FILE,FLAG};
