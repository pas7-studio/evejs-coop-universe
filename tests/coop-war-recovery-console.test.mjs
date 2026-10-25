import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createWarRecoveryConsole}=require("../integration/coopWarRecoveryConsole.cjs");
function fixture(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"evejs-war-recovery-"));
 const env={EVEJS_COOP_WAR_RECOVERY_ADMIN:"1",
  EVEJS_COOP_FACTION_WAR_NATIVE_TRANSFER:"1",
  EVEJS_COOP_NATIVE_ATOMIC_ROWS:"1"};
 let phase="PREPARED",pilot=101,physical=202,sql=101,writes=0;
 let allow=true;
 const data={pilotID:"coop-pilot-001",entityID:501,transferID:"fw:501:101:202",
  sourceSystemID:101,destinationSystemID:202,
  modulesHash:"a".repeat(64),cargoHash:"b".repeat(64),updatedAt:1000};
 const witness=()=>{
  if(phase===null)return {status:"NO_ACTIVE_TRANSFER"};
  let action=null;
  if(phase==="PREPARED"&&physical===101&&pilot===101)action="ABORT";
  if(phase==="PREPARED"&&physical===202&&pilot===101)action="NATIVE_COMMIT";
  if(phase==="NATIVE_COMMITTED"&&physical===202&&pilot===101)action="RELOCATE_PILOT";
  if(phase==="NATIVE_COMMITTED"&&physical===202&&pilot===202)action="FINISH";
  if((phase==="COMPLETE"&&physical===202&&pilot===202)||
   (phase==="ABORTED"&&physical===101&&pilot===101))action="CLEANUP_JOURNAL";
  return action?{...data,status:"VERIFIED",action,phase,
   rowSystemID:sql,physicalSystemID:physical,pilotSystemID:pilot}:
   {status:"UNSAFE",reason:"PHYSICAL_OR_PILOT_MISMATCH"};
 };
 const audit=[];
 const ledger={
  witness,
  recordRecoveryAttempt:x=>{
   const id=x.transferID+":"+x.action+":"+x.witnessHash;
   if(!audit.some(v=>v.id===id))audit.push({...x,id});
   return {status:"RECORDED",auditID:id};
  },
  nativeCommit:()=>{writes++;phase="NATIVE_COMMITTED";sql=202;return {status:phase}},
  finish:()=>{writes++;phase="COMPLETE";return {status:phase}},
  abort:()=>{writes++;phase="ABORTED";return {status:phase}},
  restore:()=>{writes++;phase="ABORTED";sql=101;return {status:phase}},
  retire:()=>{writes++;phase=null;return {status:"RETIRED"}}
 };
 const identityRegistry={relocate:(p,from,id,to)=>{
  assert.equal(p,"coop-pilot-001");assert.equal(from,101);
  assert.equal(id,501);assert.equal(to,202);
  pilot=202;return {status:"RELOCATED"};
 }};
 const consoleApi=createWarRecoveryConsole({ledger,identityRegistry,
  env,journalDir:dir,clock:()=>56789,
  authorizeOperator:({operator,permission})=>
   allow&&operator?.principalID==="root-administrator"&&
   ["INSPECT","APPLY"].includes(permission)});
 const operator={principalID:"root-administrator"},entityID=501;
 const review=()=>consoleApi.review({entityID,operator});
 const apply=(w,overrides={})=>consoleApi.apply({
  entityID,operator,action:w.action,expectedWitness:w.witness,
  reason:"Reviewed physical and SQL custody evidence",...overrides
 });
 const journal=()=>fs.writeFileSync(path.join(dir,"coop-pilot-001.json"),
  JSON.stringify({version:1,pilotID:data.pilotID,entityID:501,
   sourceSystemID:101,destinationSystemID:202,phase:"COMMITTED"}));
 return {dir,env,consoleApi,operator,entityID,review,apply,journal,audit,
  setPhase:x=>phase=x,setPhysical:x=>physical=x,setPilot:x=>pilot=x,
  deny:()=>allow=false,get writes(){return writes}};
}
test("privileged operator reviews a fresh verified native and SQL witness",()=>{
 const f=fixture();
 try{
  const w=f.review();
  assert.equal(w.status,"REVIEW_REQUIRED");assert.equal(w.action,"NATIVE_COMMIT");
  assert.match(w.witness,/^[0-9a-f]{64}$/);
  assert.equal(f.writes,0);
 }finally{fs.rmSync(f.dir,{recursive:true,force:true})}
});
test("operator cannot replay stale evidence after a native SQL state change",()=>{
 const f=fixture();
 try{
  const w=f.review();const result=f.apply(w);
  assert.equal(result.status,"REPAIR_STEP_APPLIED");
  assert.equal(result.nextAction,"RELOCATE_PILOT");
  assert.equal(f.apply(w).status,"STALE_OR_UNSAFE_REPAIR_WITNESS");
  assert.equal(f.writes,1);
  assert.equal(f.audit.length,1);
  assert.equal(f.audit[0].principalID,"root-administrator");
 }finally{fs.rmSync(f.dir,{recursive:true,force:true})}
});
test("operator must independently confirm each of the three durable steps",()=>{
 const f=fixture();
 try{
  const a=f.review();f.apply(a);
  const b=f.review();assert.equal(b.action,"RELOCATE_PILOT");
  const relocate=f.apply(b);assert.equal(relocate.nextAction,"FINISH");
  const c=f.review(),finish=f.apply(c);
  assert.equal(finish.status,"REPAIR_STEP_APPLIED");
  const terminal=f.review();
  assert.equal(terminal.action,"RETIRE_TRANSFER");
  assert.equal(f.apply(terminal).status,"REPAIR_STEP_APPLIED");
  assert.equal(f.review().status,"CLEAN");
  assert.equal(f.writes,3);
 }finally{fs.rmSync(f.dir,{recursive:true,force:true})}
});
test("finished matching native journal is archived, not silently erased",()=>{
 const f=fixture();
 try{
  f.setPhase("COMPLETE");f.setPilot(202);f.journal();
  const w=f.review();assert.equal(w.action,"CLEANUP_JOURNAL");
  const result=f.apply(w);
  assert.equal(result.status,"REPAIR_STEP_APPLIED");
  const retirement=f.review();
  assert.equal(retirement.action,"RETIRE_TRANSFER");
  assert.equal(f.apply(retirement).status,"REPAIR_STEP_APPLIED");
  assert.equal(f.review().status,"CLEAN");
  assert.equal(fs.existsSync(path.join(f.dir,"coop-pilot-001.json")),false);
  assert.equal(fs.readdirSync(f.dir+".recovered").length,1);
 }finally{fs.rmSync(f.dir,{recursive:true,force:true});
  fs.rmSync(f.dir+".recovered",{recursive:true,force:true})}
});
test("unauthorized account, disabled flag, short reason and false approval deny",()=>{
 const f=fixture();
 try{
  assert.equal(f.consoleApi.review({entityID:501,operator:{principalID:"player"}}).status,
   "FORBIDDEN");
  const w=f.review();
  assert.equal(f.apply(w,{reason:"ok"}).status,"INVALID_REPAIR_REQUEST");
  f.deny();assert.equal(f.apply(w).status,"FORBIDDEN");
  assert.equal(f.writes,0);
  f.env.EVEJS_COOP_WAR_RECOVERY_ADMIN="0";
  assert.equal(f.review().status,"DISABLED");
 }finally{fs.rmSync(f.dir,{recursive:true,force:true})}
});
test("corrupt native journal and unrecognized orphan temp never authorize repair",()=>{
 const f=fixture();
 try{
  fs.writeFileSync(path.join(f.dir,"coop-pilot-001.json"),"{invalid");
  assert.equal(f.review().status,"UNSAFE");
  fs.rmSync(path.join(f.dir,"coop-pilot-001.json"));
  fs.writeFileSync(path.join(f.dir,"coop-pilot-001.json.tmp-crash"),"garbage");
  assert.equal(f.review().status,"UNSAFE");
  assert.equal(f.writes,0);
 }finally{fs.rmSync(f.dir,{recursive:true,force:true})}
});
test("native physical mismatch requires manual intervention, not forced relocation",()=>{
 const f=fixture();
 try{
  f.setPhysical(0);
  assert.equal(f.review().status,"UNSAFE");
  assert.equal(f.writes,0);
 }finally{fs.rmSync(f.dir,{recursive:true,force:true})}
});
