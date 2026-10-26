import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createWarRecoverySocket}=require("../integration/coopWarRecoverySocket.cjs");
const secret="ABCD".repeat(16);
async function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"fw-war-socket-"));
 const runDir=path.join(root,"private");
 fs.mkdirSync(runDir,{mode:0o700});
 const socketPath=path.join(runDir,"war.sock");
 const secretFile=path.join(root,"key");
 fs.writeFileSync(secretFile,secret,{mode:0o600});
 fs.chmodSync(secretFile,0o600);
 const env={EVEJS_COOP_WAR_RECOVERY_ADMIN:"1",
  EVEJS_COOP_WAR_RECOVERY_SOCKET:"1",
  EVEJS_COOP_FACTION_WAR_NATIVE_TRANSFER:"1"};
 const seen=[];
 const server=createWarRecoverySocket({socketPath,secretFile,env,
  createConsole:({authorizeOperator})=>({
   review:req=>{
    seen.push({type:"review",req});
    return {status:authorizeOperator({operator:req.operator})?
     "REVIEW_REQUIRED":"FORBIDDEN",entityID:req.entityID};
   },
   apply:req=>{
    seen.push({type:"apply",req});
    return {status:authorizeOperator({operator:req.operator})?
     "REPAIR_STEP_APPLIED":"FORBIDDEN",action:req.action};
   }
  })});
 assert.equal(server.start().status,"LISTENING_INITIATED");
 for(let i=0;i<100&&!fs.existsSync(socketPath);i++)
  await new Promise(resolve=>setTimeout(resolve,10));
 assert.equal(fs.existsSync(socketPath),true);
 const send=payload=>new Promise((resolve,reject)=>{
  const client=net.connect(socketPath);
  let data="";
  client.on("connect",()=>client.write(JSON.stringify(payload)+"\n"));
  client.on("data",buffer=>data+=buffer.toString("utf8"));
  client.on("end",()=>{try{resolve(JSON.parse(data.trim()))}catch(e){reject(e)}});
  client.on("error",reject);
 });
 return {root,server,send,seen,secretFile,socketPath,env,
  cleanup:()=>{server.close();fs.rmSync(root,{recursive:true,force:true})}};
}
test("Unix socket denies wrong key and does not pass client-supplied identity",async()=>{
 const f=await fixture();
 try{
  assert.deepEqual(await f.send({credential:"bad",operation:"review",
   entityID:501,operator:{principalID:"forged"}}),{status:"FORBIDDEN"});
  assert.equal(f.seen.length,0);
  const result=await f.send({credential:secret,operation:"review",
   entityID:501,operator:{principalID:"forged"}});
  assert.equal(result.status,"REVIEW_REQUIRED");
  assert.equal(f.seen[0].req.operator.principalID,"local-war-operator");
 }finally{f.cleanup()}
});
test("Unix socket approves only explicit apply, not arbitrary mutations",async()=>{
 const f=await fixture();
 try{
  const x=await f.send({credential:secret,operation:"drop-database",
   entityID:501});
  assert.equal(x.status,"UNKNOWN_OPERATION");
  const y=await f.send({credential:secret,operation:"apply",entityID:501,
   action:"FINISH",expectedWitness:"a".repeat(64),
   reason:"Verified physical native custody"});
  assert.equal(y.status,"REPAIR_STEP_APPLIED");
  assert.equal(f.seen.length,1);
  assert.equal(f.seen[0].req.action,"FINISH");
 }finally{f.cleanup()}
});
test("missing group-safe key mode prevents recovery socket startup",()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"fw-war-key-"));
 try{
  const secretFile=path.join(root,"key"),socketPath=path.join(root,"war.sock");
  fs.writeFileSync(secretFile,secret,{mode:0o644});
  fs.chmodSync(secretFile,0o644);
  const server=createWarRecoverySocket({socketPath,secretFile,
   env:{EVEJS_COOP_WAR_RECOVERY_ADMIN:"1",
    EVEJS_COOP_WAR_RECOVERY_SOCKET:"1",
    EVEJS_COOP_FACTION_WAR_NATIVE_TRANSFER:"1"},
   createConsole:()=>({review:()=>({}),apply:()=>({})})});
  assert.throws(()=>server.start(),/WAR_RECOVERY_SECRET_FILE_UNSAFE/);
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
