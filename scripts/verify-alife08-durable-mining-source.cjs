"use strict";
// Read-only verification against the pinned pristine EveJS mining source.
const vm=require("node:vm");
const {gitBlobSha,readPinned,assertReversible,runVerifier}=require("./lib/pinned-source.cjs");
const {patchStartupRecovery}=require("./coop-mining-startup-recovery-patch.cjs");
const {patch}=require("./coop-native-mining-durable-patch.cjs");
const EXPECTED="80e8aa4e43afc4665a2a885d03c2fd81e7171eee";
const FILE="server/src/services/mining/miningNpcOperations.js";
function verify(codeRoot){
 const {original,canonical,sha}=readPinned(codeRoot,FILE);
 if(sha!==EXPECTED)throw Error("ALIFE08_PINNED_MINING_SOURCE_MISMATCH:"+sha);
 const modes=assertReversible({
  variants:[{mode:"LF",text:canonical},
   {mode:"CRLF",text:canonical.replace(/\n/g,"\r\n")}],
  stages:[
   {name:"startupRecovery",apply:(t)=>patchStartupRecovery(t,false),
    revert:(t)=>patchStartupRecovery(t,true)},
   {name:"durable",apply:(t)=>patch(t,false),revert:(t)=>patch(t,true)}
  ],
  checkSyntax:(text)=>{new vm.Script(text,{filename:"miningNpcOperations.js"});},
  failure:(mode)=>"ALIFE08_SOURCE_PATCH_NOT_REVERSIBLE:"+mode
 });
 return {status:"PINNED_SOURCE_PASS",sourceSha:sha,readOnly:true,
  checks:modes.map((mode)=>({mode,status:"PASS",byteExact:true,syntax:true}))};
}
if(require.main===module)runVerifier({verify,
 usage:"Usage: node scripts/verify-alife08-durable-mining-source.cjs <original EveJS Code path>"});
// hashGitBlob/EXPECTED stay exported: verify-alife09 reuses them.
module.exports={verify,hashGitBlob:gitBlobSha,EXPECTED};
