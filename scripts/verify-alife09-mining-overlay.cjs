"use strict";
// ALIFE-09. Read-only full installer integration against the exact pinned EveJS.
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const {hashGitBlob,EXPECTED}=require("./verify-alife08-durable-mining-source.cjs");
const installer=require("./patch-evejs-coop.cjs");
const file="server/src/services/mining/miningNpcOperations.js";
function verify(upstreamCodeRoot){
 if(!upstreamCodeRoot||typeof upstreamCodeRoot!=="string")
  throw Error("ALIFE09_PINNED_UPSTREAM_ROOT_REQUIRED");
 const realPath=path.join(path.resolve(upstreamCodeRoot),file);
 const original=fs.readFileSync(realPath,"utf8").replace(/\r\n/g,"\n");
 const originalSha=hashGitBlob(original);
 if(originalSha!==EXPECTED)throw Error("ALIFE09_PINNED_NATIVE_MINING_MISMATCH:"+originalSha);
 const spec=installer.specs.find(s=>s.file===file);
 if(!spec)throw Error("ALIFE09_INSTALLER_MISSING_MINING_FILE");
 const checks=[];
 for(const mode of ["LF","CRLF"]){
  const before=mode==="LF"?original:original.replace(/\n/g,"\r\n");
  const first=installer.transform(before,spec,false);
  new vm.Script(first,{filename:file});
  const second=installer.transform(first,spec,false);
  const restored=installer.transform(second,spec,true);
  if(first===before||second!==first||restored!==before)
    throw Error("ALIFE09_PINNED_MINING_INSTALL_ROUNDTRIP_FAILED:"+mode);
  if(!first.includes("coopDurableFleetID:Number(scene.systemID)*32+Number(slot),")||
     !first.includes("ALIFE09_NATIVE_FLEET_ID_COLLISION")||
     !first.includes("options.durableHauler === true || (options.coopDurableNative")||
     !first.includes("coopNativeStationArrival"))
    throw Error("ALIFE09_PINNED_NATIVE_HAUL_HOOK_MISSING:"+mode);
  checks.push({source:file,lineEndings:mode,status:"PASS",
   idempotent:true,byteExactReverted:true,syntax:true});
 }
 return{status:"ALIFE09_FULL_PINNED_OVERLAY_PASS",sourceSha:originalSha,
   readOnly:true,wroteGameState:false,checks};
}
if(require.main===module){
 const root=process.argv[2];
 if(!root){console.error("Usage: node scripts/verify-alife09-mining-overlay.cjs <clean-pinned-EveJS-Code>");process.exitCode=2;}
 else try{console.log(JSON.stringify(verify(root),null,2))}
 catch(error){console.error(String(error?.message||error));process.exitCode=1;}
}
module.exports={verify};
