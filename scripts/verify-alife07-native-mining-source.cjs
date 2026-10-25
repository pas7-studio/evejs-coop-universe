"use strict";
// Read-only: applies ALIFE-06 then ALIFE-07 to original pinned upstream in memory.
const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto");
const {PINNED}=require("./verify-alife-native-mining-cycle-source.cjs");
const {patch:stage6}=require("./coop-native-mining-cycle-conservation-patch.cjs");
const {patch:stage7}=require("./coop-native-mining-atomic-source-patch.cjs");
function verify(root){
 const results=[];
 for(const [name,pin] of Object.entries(PINNED)){
  const file=path.join(root,"server","src","services","mining",name);
  const original=fs.readFileSync(file,"utf8");
  const lf=original.replace(/\r\n/g,"\n");
  const hash=crypto.createHash("sha1")
    .update("blob "+Buffer.byteLength(lf)+"\0").update(lf).digest("hex");
  if(hash!==pin)throw Error("ALIFE07_SOURCE_PIN_MISMATCH:"+name);
  const target="server/src/services/mining/"+name;
  for(const format of ["LF","CRLF"]){
   const before=format==="LF"?lf:lf.replace(/\n/g,"\r\n");
   const six=stage6(before,target),seven=stage7(six,target);
   new Function("require","module","exports",seven);
   if(seven===six || stage7(seven,target)!==seven ||
      stage6(stage7(seven,target,true),target,true)!==before)
     throw Error("ALIFE07_SOURCE_REVERSIBILITY_FAILED:"+name+":"+format);
   results.push({file:name,eol:format,status:"PASS"});
  }
 }
 return {status:"PINNED_ALIFE07_SOURCE_VERIFIED",modifiedDisk:false,results};
}
if(require.main===module){
 const root=process.argv[2];
 if(!root){console.error("Pass original clean pinned EveJS Code root");process.exitCode=2;}
 else try{console.log(JSON.stringify(verify(path.resolve(root)),null,2));}
 catch(e){console.error(String(e.message||e));process.exitCode=1;}
}
module.exports={verify};
