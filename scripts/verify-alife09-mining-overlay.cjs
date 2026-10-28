"use strict";
// ALIFE-09. Read-only full installer integration against the exact pinned EveJS.
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const {gitBlobSha,assertReversible,runVerifier}=require("./lib/pinned-source.cjs");
const {EXPECTED}=require("./verify-alife08-durable-mining-source.cjs");
const installer=require("./patch-evejs-coop.cjs");
const file="server/src/services/mining/miningNpcOperations.js";
// Hooks the installer must emit for the durable-fleet and station-arrival work.
const HOOKS=["coopDurableFleetID:Number(scene.systemID)*32+Number(slot),",
 "ALIFE09_NATIVE_FLEET_ID_COLLISION",
 "options.durableHauler === true || (options.coopDurableNative",
 "coopNativeStationArrival"];
function verify(upstreamCodeRoot){
 if(!upstreamCodeRoot||typeof upstreamCodeRoot!=="string")
  throw Error("ALIFE09_PINNED_UPSTREAM_ROOT_REQUIRED");
 const original=fs.readFileSync(path.join(path.resolve(upstreamCodeRoot),file),"utf8")
  .replace(/\r\n/g,"\n");
 const originalSha=gitBlobSha(original);
 if(originalSha!==EXPECTED)throw Error("ALIFE09_PINNED_NATIVE_MINING_MISMATCH:"+originalSha);
 const spec=installer.specs.find((s)=>s.file===file);
 if(!spec)throw Error("ALIFE09_INSTALLER_MISSING_MINING_FILE");
 // Installing twice must be a no-op, and the revert must restore the bytes.
 const installed={};
 const modes=assertReversible({
  variants:[{mode:"LF",text:original},
   {mode:"CRLF",text:original.replace(/\n/g,"\r\n")}],
  stages:[{name:"installer",
   apply:(t)=>installer.transform(t,spec,false),
   revert:(t)=>installer.transform(t,spec,true)}],
  checkSyntax:(text,mode)=>{new vm.Script(text,{filename:file});installed[mode]=text;},
  failure:(mode)=>"ALIFE09_PINNED_MINING_INSTALL_ROUNDTRIP_FAILED:"+mode
 });
 for(const mode of modes){
  if(HOOKS.some((hook)=>!installed[mode].includes(hook)))
   throw Error("ALIFE09_PINNED_NATIVE_HAUL_HOOK_MISSING:"+mode);
 }
 return {status:"ALIFE09_FULL_PINNED_OVERLAY_PASS",sourceSha:originalSha,
  readOnly:true,wroteGameState:false,
  checks:modes.map((mode)=>({source:file,lineEndings:mode,status:"PASS",
   idempotent:true,byteExactReverted:true,syntax:true}))};
}
if(require.main===module)runVerifier({verify,resolve:false,
 usage:"Usage: node scripts/verify-alife09-mining-overlay.cjs <clean-pinned-EveJS-Code>"});
module.exports={verify};
