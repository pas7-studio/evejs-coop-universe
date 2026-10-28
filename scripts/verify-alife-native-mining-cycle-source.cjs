"use strict";
const path=require("node:path");
const {readPinned,assertReversible,runVerifier}=require("./lib/pinned-source.cjs");
const {patch}=require("./coop-native-mining-cycle-conservation-patch.cjs");
const DIR=path.join("server","src","services","mining");
const PINNED=Object.freeze({
 "miningRuntime.js":"02ba18721cfbb5238287ba043410f0b5d644cd4b",
 "miningRuntimeState.js":"c5c8b9fe01fa7a6f9c71f2eed11dd49b4a2d0585",
});
function verify(root){
 const results=[];
 for(const [name,sha] of Object.entries(PINNED)){
  const {original,sha: actual}=readPinned(root,path.join(DIR,name));
  if(actual!==sha)throw Error("PIN_MISMATCH "+name+" expected "+sha+" got "+actual);
  const target="server/src/services/mining/"+name;
  const modes=assertReversible({
   // The disk bytes and a CRLF checkout of the same pinned revision.
   variants:[{mode:"NON_REVERSIBLE",text:original},
    {mode:"CRLF_MISMATCH",text:original.replace(/\r?\n/g,"\r\n")}],
   stages:[{name:"conservation",apply:(t)=>patch(t,target),revert:(t)=>patch(t,target,true)}],
   checkSyntax:(text)=>{new Function("require","module","exports",text);},
   failure:(mode)=>mode+" "+name
  });
  results.push({name,sourceBlobSha:sha,bytes:Buffer.byteLength(original),
   LF:modes.includes("NON_REVERSIBLE"),CRLF:modes.includes("CRLF_MISMATCH"),
   syntax:true,reversible:true});
 }
 return {status:"PINNED_NATIVE_MINING_CYCLE_SOURCE_VERIFIED",modifiedDisk:false,results};
}
if(require.main===module)runVerifier({verify,
 usage:"Pass clean original EveJS Code root"});
module.exports={verify,PINNED};
