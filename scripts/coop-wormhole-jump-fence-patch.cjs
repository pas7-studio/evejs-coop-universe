"use strict";
// Chat-23 native service one-call hooks; Chat 01 owns central installer/spec.
const fileName="server/src/services/exploration/wormholes/wormholeMgrService.js";
const HEAD='  const pendingJump = session._wormholeJumpPending;';
const BEGIN='  Handle_WormholeJump(args, session) {';
const hookComplete='  if (process.env.EVEJS_COOP_WORMHOLE_JUMP_FENCE === "1") return require("../../../space/coopWormholeJumpFence").completeWormholeJump({session,sourceScene,sourceEndpointID,shipMass,prepareResult,wormholeRuntime,wormholeRuntimeState:require("./wormholeRuntimeState"),gameStore:require("../../../gameStore"),spaceRuntime,getActiveShipRecord,buildShipResourceState,jumpSessionToSolarSystem,syncSessionSystemWideEffectsForSystem,notifyWormholeJumpCancel});';
const hookBegin='    if (process.env.EVEJS_COOP_WORMHOLE_JUMP_FENCE === "1" && !require("../../../space/coopWormholeJumpFence").mayBegin(session)) return null;';
function patch(source,file,remove=false){
 if(file!==fileName)return source;
 if(typeof source!=="string")throw Error("WORMHOLE_SOURCE_INVALID");
 const eol=source.includes("\r\n")?"\r\n":"\n";
 const occurrence=(s,needle)=>s.split(needle).length-1;
 const completeA=source.indexOf("function completeWormholeJump(");
 const completeB=source.indexOf("class WormholeMgrService",completeA);
 const beginA=source.indexOf(BEGIN);
 const beginB=source.indexOf("    const endpointID =",beginA);
 if(completeA<0||completeB<=completeA||beginA<0||beginB<=beginA||
    occurrence(source,HEAD)!==1||occurrence(source,BEGIN)!==1||
    source.indexOf(HEAD)<completeA||source.indexOf(HEAD)>completeB)
  throw Error("WORMHOLE_FENCE_NATIVE_ANCHOR_DRIFT");
 const doOne=(input,anchor,hook)=>{
  const plain=anchor+eol,enhanced=plain+hook+eol;
  if(occurrence(input,plain)!==1 || occurrence(input,hook)>1)
    throw Error("WORMHOLE_FENCE_ANCHOR_MULTIPLE");
  const present=occurrence(input,enhanced)===1;
  if(remove)return present?input.replace(enhanced,plain):input;
  if(present)return input;
  if(occurrence(input,hook)!==0)throw Error("WORMHOLE_FENCE_HOOK_DRIFT");
  return input.replace(plain,enhanced);
 };
 let next=doOne(source,HEAD,hookComplete);
 next=doOne(next,BEGIN,hookBegin);
 return next;
}
module.exports={patch,fileName,hookComplete,hookBegin};
