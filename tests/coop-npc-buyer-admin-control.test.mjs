import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createLocalNpcBuyerRecoveryControl,signRequest,readOperatorKey}=
 require("../integration/coopNpcBuyerAdminControl.cjs");
const {args:cliArgs}=require("../scripts/coop-npc-buyer-admin.cjs");
const K="npc-corpbuy:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",ACT="ACK_JOURNAL_SAME_CLAIM";
const BUYER=1000010,ORDER=456,SELLER=90000001,STATION=60000001,TYPE=34;
const env={EVEJS_COOP_NPC_BUY_ADMIN_LOCAL:"1",
 EVEJS_COOP_NPC_BUY_RECOVERY_OPERATOR:"1",
 EVEJS_COOP_NATIVE_ATOMIC_ROWS:"1",EVEJS_COOP_NPC_BUY_PLAYER_ASK:"1"};
async function fixture({badLog=false,hold=false,locked=false}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"coop059-")),
  secret=path.join(dir,"operator.key"),log=badLog?dir:path.join(dir,"audit.jsonl");
 const key=crypto.randomBytes(48);fs.writeFileSync(secret,key,{mode:0o600});
 fs.chmodSync(secret,0o600);
 let control,writes=0,readCount=0,authorized=0,now=1793000000000;
 const entry={phase:"PREPARED",claimKey:K,buyerCorpID:BUYER,
  orderID:ORDER,sellerID:SELLER,stationID:STATION,typeID:TYPE,
  quantity:20,unitPriceCents:125,minReserveCents:1000};
 const binding={
  inspect:()=>({version:1,entries:{[BUYER+":"+ORDER]:entry}}),
  audit:async()=>{readCount++;
   return {status:hold?"HOLD_MANUAL":"AUDITED",lockPresent:locked,
    entries:[{id:BUYER+":"+ORDER,claimKey:K,status:hold?"HOLD_MANUAL":ACT,
     requiresOperator:true,fillID:930000000000001,itemID:1990000200,quantity:20}]}},
  recoverApproved:async({actorID,approval})=>{
   const okay=await control.authorizeRecoveryOperator({...approval,actorID,
    orderID:ORDER,buyerCorpID:BUYER,stationID:STATION,typeID:TYPE});
   if(!okay)return {status:"BLOCKED",reason:"OPERATOR_DENIED"};
   authorized++;writes++;
   return {status:"NPC_BUY_OPERATOR_RECOVERED",fillID:930000000000001,itemID:1990000200};
  }
 };
 control=createLocalNpcBuyerRecoveryControl({
  getBinding:()=>binding,secretFile:secret,auditLogFile:log,
  port:0,env,clock:()=>now
 });
 const address=await control.start();
 async function post(endpoint,payload,{nonce,ts,secretKey,badSig=false,method="POST"}={}){
  const body=JSON.stringify(payload),timestamp=String(ts??now);
  nonce??=crypto.randomBytes(18).toString("base64url");
  const signature=badSig?"0".repeat(64):signRequest(secretKey??key,{
   timestamp,nonce,path:endpoint,body});
  return await new Promise((resolve,reject)=>{
   const req=http.request({host:"127.0.0.1",port:address.port,path:endpoint,method,
    headers:{"content-type":"application/json",
      "x-evejs-timestamp":timestamp,"x-evejs-nonce":nonce,
      "x-evejs-signature":signature}},res=>{
     let data="";res.on("data",chunk=>data+=chunk);
     res.on("end",()=>resolve({code:res.statusCode,body:JSON.parse(data)}));
   });
   req.on("error",reject);
   if(method==="POST")req.end(body);
   else req.end();
  });
 }
 const audit=opts=>post("/v1/recovery/audit",{claimKey:K},opts);
 const execute=(ticket,patch={},opts={})=>post("/v1/recovery/execute",{
  ticket,claimKey:K,action:ACT,actorID:100,
  reason:"Approved operator journal-only reconciliation",...patch},opts);
 return {control,post,audit,execute,key,secret,log,dir,
  get writes(){return writes},get authorized(){return authorized},
  get reads(){return readCount},
  setNow:x=>{now=x},close:async()=>{await control.close();
   fs.rmSync(dir,{recursive:true,force:true})}};
}
async function run(fn,options){
 const f=await fixture(options);
 try{return await fn(f)}finally{await f.close()}
}
test("server starts strictly on 127.0.0.1 and rejects unsigned REST",()=>run(async f=>{
 const good=await f.audit();
 assert.equal(good.code,200);assert.equal(good.body.action,ACT);
 assert.match(good.body.ticket,/^[0-9a-f]{48}$/);
 assert.equal((await f.post("/v1/recovery/audit",{claimKey:K},{badSig:true})).code,401);
 assert.equal((await f.post("/v1/recovery/audit",{claimKey:K},{method:"GET"})).code,404);
 assert.equal(f.writes,0);
}));
test("one signed preflight audit then one trusted in-memory grant performs a single approved recovery",()=>run(async f=>{
 const audited=await f.audit();
 const result=await f.execute(audited.body.ticket);
 assert.equal(result.code,200);
 assert.equal(result.body.status,"NPC_BUY_OPERATOR_RECOVERED");
 assert.equal(f.writes,1);assert.equal(f.authorized,1);
 const lines=fs.readFileSync(f.log,"utf8").trim().split("\n").map(JSON.parse);
 assert.deepEqual(lines.map(x=>x.stage),["APPROVED","RESULT"]);
 assert.equal(lines[0].action,ACT);
 assert.equal(lines[1].status,"NPC_BUY_OPERATOR_RECOVERED");
}));
test("audit ticket is one-time and cannot double-credit on repeated execute",()=>run(async f=>{
 const ticket=(await f.audit()).body.ticket;
 assert.equal((await f.execute(ticket)).code,200);
 assert.equal((await f.execute(ticket)).code,409);
 assert.equal(f.writes,1);
}));
test("HMAC nonce cannot be replayed for another operator action",()=>run(async f=>{
 const nonce=crypto.randomBytes(18).toString("base64url");
 assert.equal((await f.audit({nonce})).code,200);
 assert.equal((await f.audit({nonce})).code,401);
 assert.equal(f.reads,1);assert.equal(f.writes,0);
}));
test("expired or forged signature cannot audit or approve transfers",()=>run(async f=>{
 assert.equal((await f.audit({ts:1793000000000-65000})).code,401);
 assert.equal((await f.audit({secretKey:crypto.randomBytes(48)})).code,401);
 assert.equal((await f.audit({badSig:true})).code,401);
 assert.equal(f.reads,0);assert.equal(f.writes,0);
}));
test("wrong action or claim invalidates preaudit capability",()=>run(async f=>{
 const ticket=(await f.audit()).body.ticket;
 assert.equal((await f.execute(ticket,{action:"RESUME_GAMESTORE_SAME_CLAIM"})).code,409);
 assert.equal((await f.execute(ticket)).code,409);
 assert.equal(f.writes,0);
}));
test("manual hold or foreign lock never issues an audit ticket",()=>run(async f=>{
 assert.equal((await f.audit()).code,409);
 assert.equal(f.writes,0);
},{hold:true}));
test("stale finance lock rejects even HMAC-authenticated operator",()=>run(async f=>{
 assert.equal((await f.audit()).code,409);
 assert.equal(f.writes,0);
},{locked:true}));
test("unwritable/nonregular audit log fails closed BEFORE writer",()=>run(async f=>{
 const ticket=(await f.audit()).body.ticket;
 assert.equal((await f.execute(ticket)).code,503);
 assert.equal(f.writes,0);
},{badLog:true}));
test("direct calls without a server-minted approval grant are denied",()=>run(async f=>{
 const approved=await f.control.authorizeRecoveryOperator({approvalID:"untrusted-agent",
  claimKey:K,action:ACT,actorID:100});
 assert.equal(approved,false);
 assert.equal(f.writes,0);
}));
test("bad, missing and overprivileged credential files are rejected",()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"coop059-secrets-"));
 try{
  const file=path.join(dir,"secret");
  fs.writeFileSync(file,"tiny",{mode:0o600});
  assert.throws(()=>readOperatorKey(file),/INVALID_FILE/);
  fs.writeFileSync(file,crypto.randomBytes(48));fs.chmodSync(file,0o644);
  if(typeof process.getuid==="function")
   assert.throws(()=>readOperatorKey(file),/PERMISSIONS/);
  fs.chmodSync(file,0o600);assert.equal(readOperatorKey(file).length,48);
  fs.symlinkSync(file,path.join(dir,"link"));
  assert.throws(()=>readOperatorKey(path.join(dir,"link")),/INVALID_FILE/);
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
test("admin endpoint rejects missing explicit flags",()=>{
 const fake={...env,EVEJS_COOP_NPC_BUY_ADMIN_LOCAL:"0"};
 assert.throws(()=>createLocalNpcBuyerRecoveryControl({
  getBinding:()=>null,secretFile:"/tmp/safe",auditLogFile:"/tmp/audit",
  port:17171,env:fake}),/DISABLED/);
});
test("server operator CLI rejects invalid action/actor/ticket before network",()=>{
 assert.throws(()=>cliArgs(["recover","--claim-key="+K,"--ticket=wrong"]),
  /Recovery requires/);
 assert.throws(()=>cliArgs(["audit","--claim-key=wrong"]),/Claim key/);
 const valid=cliArgs(["audit","--claim-key="+K,"--port=17171"]);
 assert.equal(valid.key,K);assert.equal(valid.action,"audit");
});
