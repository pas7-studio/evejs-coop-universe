import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createIndustryRuntime}=require("../integration/coopPlayerIndustryRuntime.cjs");
const {patch,fileName,pairs}=require("../scripts/coop-player-industry-native-patch.cjs");
const {specs,names,transform}=require("../scripts/patch-evejs-coop.cjs");

function setup(kind="INSTALL"){
 const proof={ok:true,kind,characterID:110,ownerID:110,blueprintID:500,
  jobID:kind==="DELIVER"?700:undefined,activityID:1,runs:2,cost:60};
 let calls=0;
 const guard={checkInstall:()=>proof,checkDeliver:()=>proof};
 const receipts={capture:p=>({kind:p.kind}),verifyInstall:()=>true,verifyDeliver:()=>true};
 const fence={execute:({proof:p,captureNative,nativeExecute,verifyNative})=>{
  const before=captureNative(p),result=nativeExecute();
  assert.equal(verifyNative({proof:p,before,nativeResult:result}),true);
  return {status:"NATIVE_INDUSTRY_OPERATION_SETTLED",nativeJobID:p.kind==="INSTALL"?result.data.jobID:p.jobID};
 }};
 const runtime=createIndustryRuntime({guard,receipts,fence});
 const run=()=>{calls++;return {success:true,data:{jobID:700}}};
 return {proof,guard,receipts,fence,runtime,run,get calls(){return calls}};
}
test("install calls original native industry writer once",()=>{
 const x=setup(),result=x.runtime.install({}, {},x.run,()=>null);
 assert.deepEqual(result,{success:true,data:{jobID:700}});
 assert.equal(x.calls,1);
});
test("delivery uses the same native job and only its original payload",()=>{
 const x=setup("DELIVER"),r=x.runtime.deliver({},700,x.run);
 assert.deepEqual(r,{success:true,data:{jobID:700}});assert.equal(x.calls,1);
});
test("forged owner or stale session never calls native wallet or inventory",()=>{
 const x=setup();x.guard.checkInstall=()=>({ok:false,reason:"NATIVE_ACCOUNT_MISMATCH"});
 assert.throws(()=>x.runtime.install({}, {},x.run,()=>null),/NATIVE_ACCOUNT_MISMATCH/);
 assert.equal(x.calls,0);
});
test("ambiguous industry transaction is quarantined, never replayed",()=>{
 const x=setup();x.fence.execute=()=>({status:"NATIVE_INDUSTRY_MANUAL_RECONCILIATION"});
 assert.throws(()=>x.runtime.install({}, {},x.run,()=>null),/MANUAL_RECONCILIATION/);
 assert.equal(x.calls,0);
});
test("wrong native job receipt is never returned as a success",()=>{
 const x=setup();x.fence.execute=({nativeExecute})=>{
  nativeExecute();return {status:"NATIVE_INDUSTRY_OPERATION_SETTLED",nativeJobID:701};
 };
 assert.throws(()=>x.runtime.install({}, {},x.run,()=>null),/NATIVE_JOB_RECEIPT_MISMATCH/);
 assert.equal(x.calls,1);
});
test("cancel cannot bypass industry custody fence",()=>{
 const x=setup();assert.throws(()=>x.runtime.cancel(),/CANCEL_REQUIRES_NATIVE_RECOVERY_BOUNDARY/);
});
function fixture(eol){
 return ["class IndustryManagerService {",
  "  Handle_InstallJob(args, session) {",
  "    const result = installIndustryJob(session, request);",
  "  }","  Handle_CompleteJob(args, session) {",
  "    const result = deliverIndustryJob(session, jobID);",
  "  }","  Handle_CompleteManyJobs(args, session) {",
  "      const result = deliverIndustryJob(session, jobID);",
  "  }","  Handle_CancelJob(args, session) {",
  "    const result = cancelIndustryJob(session, jobID);",
  "  }","}",""].join(eol);
}
for(const eol of ["\n","\r\n"])test("native industry source roundtrips "+JSON.stringify(eol),()=>{
 const source=fixture(eol),applied=patch(source,fileName);
 assert.equal(patch(applied,fileName),applied);
 assert.equal(patch(applied,fileName,true),source);
 for(const [,hook] of pairs)assert.equal(applied.split(hook).length-1,1);
 assert.doesNotThrow(()=>new vm.Script(applied));
});
test("central installer includes source guards, journal and native RPC spec exactly once",()=>{
 assert.equal(specs.filter(spec=>spec.file===fileName).length,1);
 for(const name of ["coopPlayerIndustryGuard","coopPlayerIndustryReceipts",
  "coopPlayerIndustryFence","coopPlayerIndustryRuntime"]){
  assert.equal(names.filter(x=>x===name).length,1);
  assert.equal(fs.existsSync(path.resolve("integration",name+".cjs")),true);
 }
 const spec=specs.find(x=>x.file===fileName),source=fixture("\n");
 assert.equal(transform(transform(source,spec,false),spec,true),source);
});
test("receipt imports work for repository .cjs and native deployed .js",()=>{
 const c=fs.readFileSync(path.resolve("integration/coopPlayerIndustryReceipts.cjs"),"utf8");
 assert.match(c,/__filename\.endsWith\("\.cjs"\)/);
 assert.match(c,/coopPlayerIndustryGuard/);
});
test("all native hooks leave original RPC behavior unchanged while flag OFF",()=>{
 for(const [plain,hook] of pairs){
  assert.match(hook,/EVEJS_COOP_PLAYER_INDUSTRY_GUARD === "1"/);
  assert.ok(hook.includes(plain.trim().split("= ")[1].split("(")[0]));
 }
});
