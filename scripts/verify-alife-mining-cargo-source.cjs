"use strict";
// Read-only preflight against original pinned upstream Code tree. Never write it.
const fs=require("node:fs");
const path=require("node:path");
const {gitBlobSha,assertReversible,runVerifier}=require("./lib/pinned-source.cjs");
const {patchMiningCargo}=require("./coop-native-mining-cargo-integrity-patch.cjs");
const PINNED_NATIVE_MINING_BLOB="80e8aa4e43afc4665a2a885d03c2fd81e7171eee";
const MINING_FILE=path.join("server","src","services","mining","miningNpcOperations.js");
// The commit order of the cargo helpers is the invariant the patch relies on:
// the store entry exists before the strict append, and the loose append and the
// clear both run after them.
const ORDER=["function ensureNpcCargoStoreEntry(",
 "function coopAppendNpcMiningCargoStrict(",
 "function appendNpcMiningCargo(",
 "function clearNpcMiningCargo("];
function inspectNativeMiningSource(file){
 const original=fs.readFileSync(file,"utf8");
 // Git on Windows may check out the *same pinned bytes* using CRLF: hash the
 // canonical LF blob and patch the bytes that are actually on disk.
 const sha=gitBlobSha(original);
 if(sha!==PINNED_NATIVE_MINING_BLOB)
  return {status:"UPSTREAM_PIN_MISMATCH",expected:PINNED_NATIVE_MINING_BLOB,actual:sha};
 let patched=null;
 try{
  assertReversible({
   variants:[{mode:"DISK",text:original}],
   stages:[{name:"cargo",apply:(t)=>patchMiningCargo(t),revert:(t)=>patchMiningCargo(t,true)}],
   // Parse only. Never require the upstream game module; it boots game services.
   checkSyntax:(text)=>{patched=text;new Function("require","module","exports",text);},
   failure:()=>"REVERSIBLE_NATIVE_PATCH_CHECK_FAILED"
  });
 }catch(error){
  // A non-reversible patch is a report; a patch that does not parse is a
  // broken installer and must stay loud (the CLI turns it into exit 2).
  if(patched===null||String(error.message)!=="REVERSIBLE_NATIVE_PATCH_CHECK_FAILED")throw error;
  return {status:"REVERSIBLE_NATIVE_PATCH_CHECK_FAILED",expected:PINNED_NATIVE_MINING_BLOB};
 }
 const stage=ORDER.map((needle)=>patched.indexOf(needle));
 if(stage.some((x)=>x<0)||stage.some((x,i)=>i&&x<=stage[i-1]))
  return {status:"NATIVE_CARGO_COMMIT_ORDER_INVALID"};
 return {status:"PINNED_NATIVE_MINING_PATCH_VERIFIED",sha,
  newFeatureFlag:"EVEJS_COOP_NATIVE_MINING_CARGO_INTEGRITY",
  originalBytes:Buffer.byteLength(original),
  patchedBytes:Buffer.byteLength(patched),eol:original.includes("\r\n")?"CRLF":"LF",
  reversible:true,modifiedDisk:false};
}
if(require.main===module)runVerifier({
 verify:(input)=>inspectNativeMiningSource(path.join(path.resolve(input),MINING_FILE)),
 usage:"usage: node scripts/verify-alife-mining-cargo-source.cjs <original-pinned-EveJS-Code-root>",
 resolve:false,errorPrefix:"Preflight failed:",errorExitCode:2,
 isSuccess:(report)=>report.status==="PINNED_NATIVE_MINING_PATCH_VERIFIED"});
module.exports={inspectNativeMiningSource,PINNED_NATIVE_MINING_BLOB};
