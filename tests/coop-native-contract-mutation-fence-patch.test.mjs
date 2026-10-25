import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {patch,FILE}=require("../scripts/coop-native-contract-mutation-fence-patch.cjs");
const src=`class MyService {
 Handle_CreateContract(args, session) {
  const result = contractRuntime.createContract(rawInfo, session, {confirm:true});
 }
 Handle_AcceptContract(args, session) {
  return buildContractRow(contractRuntime.acceptContract(contractID, session, forCorp));
 }
 Handle_CompleteContract(args, session) {
  return contractRuntime.completeContract(contractID, status, session);
 }
 Handle_DeleteContract(args, session) {
  return contractRuntime.deleteContract(contractID, session);
 }
 Handle_DeleteMultipleContracts(args, session) {
  const result = contractRuntime.deleteMultipleContracts(contractIDs, session);
 }
}`;
for(const eol of ["\n","\r\n"]){test(`original RPC entrypoints have reversible ${eol==="\n"?"LF":"CRLF"} patch`,()=>{
 const pristine=src.replace(/\n/g,eol),out=patch(pristine,FILE);
 assert.notEqual(out,pristine);assert.equal(patch(out,FILE),out);
 assert.equal(patch(out,FILE,true),pristine);new vm.Script(out);
 assert.equal(out.split("EVEJS_COOP_NATIVE_CONTRACT_MUTATION_FENCE").length-1,5);
})}
test("duplicate or missing pinned source refuses mutation",()=>{
 assert.throws(()=>patch(src+src,FILE),/ANCHOR_DRIFT/);
 assert.throws(()=>patch(src.replace("contractRuntime.acceptContract","notNative.acceptContract"),FILE),/ANCHOR_DRIFT/);
 assert.throws(()=>patch(src,"server/src/space/transitions.js"),/WRONG_SOURCE/);
});
