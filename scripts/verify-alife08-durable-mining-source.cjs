"use strict";
// Read-only verification against the pinned pristine EveJS mining source.
const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto"),vm=require("node:vm");
const {patchStartupRecovery}=require("./coop-mining-startup-recovery-patch.cjs");
const {patch}=require("./coop-native-mining-durable-patch.cjs");
const EXPECTED="80e8aa4e43afc4665a2a885d03c2fd81e7171eee";
function hashGitBlob(text){
 const raw=Buffer.from(text,"utf8");
 return crypto.createHash("sha1").update(Buffer.from("blob "+raw.length+"\0")).update(raw).digest("hex");
}
function verify(codeRoot){
 const file=path.join(codeRoot,"server/src/services/mining/miningNpcOperations.js");
 const bytes=fs.readFileSync(file,"utf8");
 const original=bytes.replace(/\r\n/g,"\n");
 const sha=hashGitBlob(original);
 if(sha!==EXPECTED)throw Error("ALIFE08_PINNED_MINING_SOURCE_MISMATCH:"+sha);
 const checks=[];
 for(const mode of ["LF","CRLF"]){
  const before=mode==="LF"?original:original.replace(/\n/g,"\r\n");
  const six=patchStartupRecovery(before,false),eight=patch(six,false);
  new vm.Script(eight,{filename:"miningNpcOperations.js"});
  if(eight===six||patch(eight,false)!==eight||
      patchStartupRecovery(patch(eight,true),true)!==before)
   throw Error("ALIFE08_SOURCE_PATCH_NOT_REVERSIBLE:"+mode);
  checks.push({mode,status:"PASS",byteExact:true,syntax:true});
 }
 return {status:"PINNED_SOURCE_PASS",sourceSha:sha,readOnly:true,checks};
}
if(require.main===module){
 const root=process.argv[2];
 if(!root){console.error("Usage: node scripts/verify-alife08-durable-mining-source.cjs <original EveJS Code path>");process.exitCode=2;}
 else try{console.log(JSON.stringify(verify(path.resolve(root)),null,2));}
 catch(e){console.error(String(e.message||e));process.exitCode=1;}
}
module.exports={verify,hashGitBlob,EXPECTED};
