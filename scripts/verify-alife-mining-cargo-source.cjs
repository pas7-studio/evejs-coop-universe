"use strict";
// Read-only preflight against original pinned upstream Code tree. Never write it.
const fs=require("node:fs");
const path=require("node:path");
const crypto=require("node:crypto");
const {patchMiningCargo}=require("./coop-native-mining-cargo-integrity-patch.cjs");
const PINNED_NATIVE_MINING_BLOB="80e8aa4e43afc4665a2a885d03c2fd81e7171eee";
function inspectNativeMiningSource(file){
 const original=fs.readFileSync(file,"utf8");
 // Git on Windows may check out the *same pinned bytes* using CRLF.
 // Hash the canonical LF Git blob while preserving original disk bytes.
 const canonical=original.replace(/\r\n/g,"\n");
 const sha=crypto.createHash("sha1").update(
  "blob "+Buffer.byteLength(canonical)+"\0").update(canonical).digest("hex");
 if(sha!==PINNED_NATIVE_MINING_BLOB)
  return {status:"UPSTREAM_PIN_MISMATCH",expected:PINNED_NATIVE_MINING_BLOB,actual:sha};
 const patched=patchMiningCargo(original);
 if(patched===original||patchMiningCargo(patched)!==patched||
   patchMiningCargo(patched,true)!==original)
  return {status:"REVERSIBLE_NATIVE_PATCH_CHECK_FAILED",expected:PINNED_NATIVE_MINING_BLOB};
 // Parse only. Never require the upstream game module; it boots game services.
 new Function("require","module","exports",patched);
 const stage=[
  patched.indexOf("function ensureNpcCargoStoreEntry("),
  patched.indexOf("function coopAppendNpcMiningCargoStrict("),
  patched.indexOf("function appendNpcMiningCargo("),
  patched.indexOf("function clearNpcMiningCargo(")
 ];
 if(stage.some(x=>x<0)||stage.some((x,i)=>i&&x<=stage[i-1]))
  return {status:"NATIVE_CARGO_COMMIT_ORDER_INVALID"};
 return {status:"PINNED_NATIVE_MINING_PATCH_VERIFIED",sha,
  newFeatureFlag:"EVEJS_COOP_NATIVE_MINING_CARGO_INTEGRITY",
  originalBytes:Buffer.byteLength(original),
  patchedBytes:Buffer.byteLength(patched),eol:original.includes("\r\n")?"CRLF":"LF",
  reversible:true,modifiedDisk:false};
}
if(require.main===module){
 const input=process.argv[2];
 if(!input){
  console.error("usage: node scripts/verify-alife-mining-cargo-source.cjs <original-pinned-EveJS-Code-root>");
  process.exitCode=2;
 }else{
  try{
   const file=path.join(path.resolve(input),"server","src","services",
    "mining","miningNpcOperations.js");
   const report=inspectNativeMiningSource(file);
   console.log(JSON.stringify(report,null,2));
   if(report.status!=="PINNED_NATIVE_MINING_PATCH_VERIFIED")process.exitCode=1;
  }catch(error){console.error("Preflight failed:",error.message);process.exitCode=2;}
 }
}
module.exports={inspectNativeMiningSource,PINNED_NATIVE_MINING_BLOB};
