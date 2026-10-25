#!/usr/bin/env node
"use strict";
// COOP-059 server-host operator CLI; no player API, no literal secrets in argv.
// Run directly on the EveJS server host or via an authenticated SSH session.
const http=require("node:http"),crypto=require("node:crypto");
const {signRequest,readOperatorKey}=
 require("../integration/coopNpcBuyerAdminControl.cjs");
function args(argv){
 const action=argv.shift();
 if(!["audit","recover"].includes(action))throw Error("Action: audit|recover");
 const values={};
 for(const item of argv){
  const m=/^--([a-z-]+)=(.+)$/.exec(item);
  if(!m||Object.hasOwn(values,m[1])||
     !["claim-key","actor-id","action","ticket","reason",
       "port","secret-file"].includes(m[1]))
   throw Error("Invalid/duplicate option");
  values[m[1]]=m[2];
 }
 const key=values["claim-key"],port=Number(values.port||17171);
 if(!/^npc-corpbuy:[0-9a-f]{32}$/.test(key||"")||
    !Number.isSafeInteger(port)||port<1||port>65535)
  throw Error("Claim key / port invalid");
 if(action==="recover"&&(
   !/^[0-9a-f]{48}$/.test(values.ticket||"")||
   !["RETRY_SAME_CLAIM","RESUME_GAMESTORE_SAME_CLAIM",
     "FINALIZE_RUST_SAME_CLAIM","ACK_JOURNAL_SAME_CLAIM"].includes(values.action)||
   !Number.isSafeInteger(Number(values["actor-id"]))||
   Number(values["actor-id"])<=0||
   typeof values.reason!=="string"||
   values.reason.trim().length<12||values.reason.length>500))
  throw Error("Recovery requires --ticket, --action, --actor-id and --reason");
 const secretFile=values["secret-file"]||process.env.EVEJS_COOP_NPC_BUY_ADMIN_SECRET_FILE;
 return {action,values,key,port,secretFile};
}
async function run(argv=process.argv.slice(2)){
 const x=args([...argv]),key=readOperatorKey(x.secretFile);
 const path=x.action==="audit"?"/v1/recovery/audit":"/v1/recovery/execute";
 const payload=x.action==="audit"?{claimKey:x.key}:{
  ticket:x.values.ticket,claimKey:x.key,action:x.values.action,
  actorID:Number(x.values["actor-id"]),reason:x.values.reason};
 const body=JSON.stringify(payload),timestamp=String(Date.now()),
  nonce=crypto.randomBytes(18).toString("base64url");
 const signature=signRequest(key,{timestamp,nonce,path,body});
 const result=await new Promise((resolve,reject)=>{
  const req=http.request({hostname:"127.0.0.1",port:x.port,path,method:"POST",
   timeout:10000,headers:{"Content-Type":"application/json",
   "Content-Length":Buffer.byteLength(body),"X-Evejs-Timestamp":timestamp,
   "X-Evejs-Nonce":nonce,"X-Evejs-Signature":signature}},
   res=>{let data="";res.setEncoding("utf8");
    res.on("data",chunk=>{data+=chunk;if(data.length>8192)res.destroy()});
    res.on("end",()=>resolve({status:res.statusCode,body:data}));
    res.on("error",reject)});
  req.on("timeout",()=>req.destroy(Error("NPC admin request timed out")));
  req.on("error",reject);req.end(body);
 });
 process.stdout.write(result.body+"\n");
 if(result.status!==200)process.exitCode=1;
 return result;
}
if(require.main===module)run().catch(e=>{
 process.stderr.write("NPC admin CLI error: "+e.message+"\n");
 process.exitCode=1});
module.exports={run,args};
