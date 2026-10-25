"use strict";
// Only the original EVE industry RPC is patched; preserve native implementation.
const fileName="server/src/services/industry/industryManagerService.js";
const pairs=[
 [
  "    const result = installIndustryJob(session, request);",
  "    const result = process.env.EVEJS_COOP_PLAYER_INDUSTRY_GUARD === \"1\" ? require(\"../../space/coopPlayerIndustryRuntime\").install({session,request,nativeInstall:installIndustryJob,readPreviousJob:getJobByID}) : installIndustryJob(session, request);"
 ],
 [
  "    const result = deliverIndustryJob(session, jobID);",
  "    const result = process.env.EVEJS_COOP_PLAYER_INDUSTRY_GUARD === \"1\" ? require(\"../../space/coopPlayerIndustryRuntime\").deliver({session,jobID,nativeDeliver:deliverIndustryJob}) : deliverIndustryJob(session, jobID);"
 ],
 [
  "      const result = deliverIndustryJob(session, jobID);",
  "      const result = process.env.EVEJS_COOP_PLAYER_INDUSTRY_GUARD === \"1\" ? require(\"../../space/coopPlayerIndustryRuntime\").deliver({session,jobID,nativeDeliver:deliverIndustryJob}) : deliverIndustryJob(session, jobID);"
 ],
 [
  "    const result = cancelIndustryJob(session, jobID);",
  "    const result = process.env.EVEJS_COOP_PLAYER_INDUSTRY_GUARD === \"1\" ? require(\"../../space/coopPlayerIndustryRuntime\").cancel({session,jobID,nativeCancel:cancelIndustryJob}) : cancelIndustryJob(session, jobID);"
 ]
];

function patch(source,file,remove=false){
 if(file!==fileName)return source;
 if(typeof source!=="string")throw Error("COOP_INDUSTRY_NATIVE_SOURCE_REQUIRED");
 const eol=source.includes("\r\n")?"\r\n":"\n";
 let result=source;
 for(const [plainLine,guardedLine] of pairs){
  // Include the preceding line break so single-job and batch-job indentation
  // cannot accidentally match one another as overlapping substrings.
  const plain=eol+plainLine+eol,guarded=eol+guardedLine+eol;
  const count=(s,needle)=>s.split(needle).length-1;
  const base=count(result,plain),installed=count(result,guarded);
  if(base+installed!==1)throw Error("COOP_INDUSTRY_NATIVE_ANCHOR_DRIFT");
  if(remove){if(installed)result=result.replace(guarded,plain);}
  else if(base)result=result.replace(plain,guarded);
 }
 return result;
}
module.exports={patch,fileName,pairs};
