"use strict";
const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto");
const {patch}=require("./coop-native-mining-cycle-conservation-patch.cjs");
const PINNED=Object.freeze({
 "miningRuntime.js":"02ba18721cfbb5238287ba043410f0b5d644cd4b",
 "miningRuntimeState.js":"c5c8b9fe01fa7a6f9c71f2eed11dd49b4a2d0585",
});
function verify(root){
 const results=[];
 for(const [name,sha] of Object.entries(PINNED)){
  const file=path.join(root,"server","src","services","mining",name);
  const original=fs.readFileSync(file,"utf8");
  const canonical=original.replace(/\r\n/g,"\n");
  const hash=crypto.createHash("sha1").update(
    "blob "+Buffer.byteLength(canonical)+"\0").update(canonical).digest("hex");
  if(hash!==sha)throw Error("PIN_MISMATCH "+name+" expected "+sha+" got "+hash);
  const target="server/src/services/mining/"+name;
  const patched=patch(original,target);
  new Function("require","module","exports",patched);
  if(patched===original||patch(patched,target)!==patched||
      patch(patched,target,true)!==original)throw Error("NON_REVERSIBLE "+name);
  const win=original.replace(/\r?\n/g,"\r\n");
  const winPatched=patch(win,target);
  if(patch(winPatched,target,true)!==win)throw Error("CRLF_MISMATCH "+name);
  results.push({name,sourceBlobSha:sha,bytes:Buffer.byteLength(original),
    LF:true,CRLF:true,syntax:true,reversible:true});
 }
 return {status:"PINNED_NATIVE_MINING_CYCLE_SOURCE_VERIFIED",modifiedDisk:false,results};
}
if(require.main===module) {
 const root=process.argv[2];
 if(!root){console.error("Pass clean original EveJS Code root");process.exitCode=2;}
 else try{console.log(JSON.stringify(verify(path.resolve(root)),null,2));}
 catch(error){console.error(error.message);process.exitCode=1;}
}
module.exports={verify,PINNED};
