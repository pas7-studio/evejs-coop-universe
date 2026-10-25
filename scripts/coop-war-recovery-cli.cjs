#!/usr/bin/env node
"use strict";
// Local-only operator CLI. The secret never appears in argv, URLs or logs.
// Run from INSIDE the EveJS Linux container with access to the 0600 key.
const fs=require("node:fs"),net=require("node:net");
const id=x=>typeof x==="string"&&/^[1-9][0-9]*$/.test(x)&&
 Number.isSafeInteger(Number(x))?Number(x):null;
function main(argv=process.argv.slice(2),env=process.env){
 const [command,rawID,action,witness,...reasonParts]=argv;
 const entityID=id(rawID);
 if(process.platform==="win32")
  throw Error("Use the Linux server/container for war recovery");
 if(!entityID||!["review","apply"].includes(command))
  throw Error("Usage: review <entityID> | apply <entityID> <action> <witness> <reason...>");
 if(command==="apply"&&(!["ABORT","RESTORE","NATIVE_COMMIT",
  "RELOCATE_PILOT","FINISH","CLEANUP_JOURNAL"].includes(action)||
  !/^[a-f0-9]{64}$/.test(witness)||reasonParts.join(" ").length<12))
  throw Error("Apply requires the exact reviewed action, 64-hex witness and reason");
 if(command==="review"&&argv.length!==2)throw Error("Review accepts only entityID");
 const socketPath=env.EVEJS_COOP_WAR_RECOVERY_SOCKET_PATH||
  "/run/evejs/coop-war-recovery.sock";
 const secretFile=env.EVEJS_COOP_WAR_RECOVERY_SECRET_FILE||
  "/run/secrets/evejs-war-recovery-key";
 const st=fs.lstatSync(secretFile);
 if(!st.isFile()||st.isSymbolicLink()||
  (st.mode&0o077)!==0||
  (typeof process.getuid==="function"&&st.uid!==process.getuid()))
  throw Error("Unsafe recovery credential file");
 const credential=fs.readFileSync(secretFile,"utf8").trim();
 if(!/^[A-Za-z0-9+/_=-]{32,200}$/.test(credential))
  throw Error("Invalid operator credential");
 const socket=net.connect(socketPath),request={
  credential,operation:command,entityID,
  ...(command==="apply"?{action,expectedWitness:witness,
   reason:reasonParts.join(" ")}:{})
 };
 socket.setTimeout(10000,()=>socket.destroy(Error("RECOVERY_SOCKET_TIMEOUT")));
 let answer="",finished=false;
 socket.on("connect",()=>socket.write(JSON.stringify(request)+"\n"));
 socket.on("data",buf=>{
  answer+=buf.toString("utf8");
  if(answer.length>16384)socket.destroy(Error("RESPONSE_TOO_LARGE"));
 });
 socket.on("end",()=>{
  if(finished)return;finished=true;
  const response=JSON.parse(answer);
  process.stdout.write(JSON.stringify(response,null,2)+"\n");
  if(["FORBIDDEN","UNSAFE","DISABLED","AUDIT_REQUIRED",
    "OUTCOME_UNKNOWN_RECHECK_REQUIRED","STALE_OR_UNSAFE_REPAIR_WITNESS"]
    .includes(response.status))process.exitCode=2;
 });
 socket.on("error",error=>{
  if(finished)return;finished=true;
  process.stderr.write("War recovery connection failed: "+
   String(error?.code||"CONNECTION_ERROR")+"\n");
  process.exitCode=1;
 });
}
try{main()}catch(error){
 process.stderr.write(String(error.message)+"\n");
 process.exitCode=1;
}
