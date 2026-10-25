"use strict";
// One optional, reversible L1 statement. All behavior is in L2 module.
function patch(source,file,remove=false){
 if(file!=="server/src/services/chat/chatCommands.js")
  throw Error("UNSUPPORTED_COOP_P1_OPERATIONS_NATIVE_FILE");
 const text=String(source),eol=text.includes("\r\n")?"\r\n":"\n";
 const original='  const argumentText = rest.join(" ").trim();';
 const addition='  if (process.env.EVEJS_COOP_P1_OPERATIONS === "1" && command === "coopops") return handledResult(chatHub,session,options,require("../../space/coopFleetOperations").execute(session,argumentText,chatHub).message);';
 const inserted=original+eol+addition;
 if(text.includes(inserted)){
  if(text.split(inserted).length!==2)throw Error("DUPLICATE_COOP_P1_OPERATIONS_HOOK");
  return remove?text.replace(inserted,original):text;
 }
 if(text.split(original).length!==2)throw Error("UNKNOWN_PINNED_CHAT_COMMAND_SOURCE");
 return remove?text:text.replace(original,inserted);
}
module.exports={patch};
