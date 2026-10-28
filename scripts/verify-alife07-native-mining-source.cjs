"use strict";
// Read-only: applies ALIFE-06 then ALIFE-07 to original pinned upstream in memory.
const path=require("node:path");
const {readPinned,assertReversible,runVerifier}=require("./lib/pinned-source.cjs");
const {PINNED}=require("./verify-alife-native-mining-cycle-source.cjs");
const {patch:stage6}=require("./coop-native-mining-cycle-conservation-patch.cjs");
const {patch:stage7}=require("./coop-native-mining-atomic-source-patch.cjs");
const DIR=path.join("server","src","services","mining");
function verify(root){
 const results=[];
 for(const [name,pin] of Object.entries(PINNED)){
  const {canonical,sha}=readPinned(root,path.join(DIR,name));
  if(sha!==pin)throw Error("ALIFE07_SOURCE_PIN_MISMATCH:"+name);
  const target="server/src/services/mining/"+name;
  const modes=assertReversible({
   variants:[{mode:"LF",text:canonical},
    {mode:"CRLF",text:canonical.replace(/\n/g,"\r\n")}],
   stages:[
    {name:"conservation",apply:(t)=>stage6(t,target),revert:(t)=>stage6(t,target,true)},
    {name:"atomic",apply:(t)=>stage7(t,target),revert:(t)=>stage7(t,target,true)}
   ],
   checkSyntax:(text)=>{new Function("require","module","exports",text);},
   failure:(mode)=>"ALIFE07_SOURCE_REVERSIBILITY_FAILED:"+name+":"+mode
  });
  for(const mode of modes)results.push({file:name,eol:mode,status:"PASS"});
 }
 return {status:"PINNED_ALIFE07_SOURCE_VERIFIED",modifiedDisk:false,results};
}
if(require.main===module)runVerifier({verify,
 usage:"Pass original clean pinned EveJS Code root"});
module.exports={verify};
