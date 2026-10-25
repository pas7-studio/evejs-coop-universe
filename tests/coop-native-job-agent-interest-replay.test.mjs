import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createBoard}=require("../integration/coopWorldOpportunityBoard.cjs");
const {createNativeJobAgent}=require("../integration/coopNativeJobAgent.cjs");
const OLD=process.env.EVEJS_COOP_OPPORTUNITY_BOARD;
const OLDA=process.env.EVEJS_COOP_NATIVE_JOB_AGENT;
process.env.EVEJS_COOP_OPPORTUNITY_BOARD="1";
process.env.EVEJS_COOP_NATIVE_JOB_AGENT="1";
const NOW=100000,EID="convoy-30000144-77-123";
const publish=()=>({id:EID,type:"CONVOY",stage:"PREPARING",
 systemID:30000144,entityID:901,stationID:60000001,
 title:"Verified convoy",summary:"Real cargo to real station",
 expiresAt:NOW+50000});
function fixture({failSync=false}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"coop-job-interest-"));
 let blocked=false;
 const io={...fs,fsyncSync(fd){if(blocked)throw Error("INJECTED_FSYNC_FAILURE");
   return fs.fsyncSync(fd)}};
 const b=createBoard({root,io,clock:()=>NOW,getSessions:()=>[]});
 assert.equal(b.publish(publish()).status,"EVENT_PUBLISHED");
 const interestDir=path.join(root,"coop-opportunities","interest");
 const receipt=path.join(interestDir,EID+"-701.json");
 return {board:b,root,receipt,fail:()=>{blocked=true},close:()=>fs.rmSync(root,{recursive:true,force:true})};
}
test("native first interest is durable, duplicate requires re-read/fsync proof",()=>{
 const f=fixture();try{
  assert.equal(f.board.interest(701,EID).status,"INTEREST_RECORDED");
  const second=f.board.interest(701,EID);
  assert.equal(second.status,"INTEREST_ALREADY_DURABLY_RECORDED");
  assert.equal(f.board.readInterest(701,EID).status,"INTEREST_RECORDED");
 }finally{f.close()}
});
test("duplicate interest with lost fsync cannot silently authorize paid Accept",()=>{
 const f=fixture();try{
  assert.equal(f.board.interest(701,EID).status,"INTEREST_RECORDED");
  f.fail();
  assert.equal(f.board.interest(701,EID).status,"INTEREST_WRITE_UNCERTAIN_NEEDS_REPAIR");
 }finally{f.close()}
});
test("corrupted actor interest receipt never passes paid replay",()=>{
 const f=fixture();try{
  assert.equal(f.board.interest(701,EID).status,"INTEREST_RECORDED");
  fs.writeFileSync(f.receipt,JSON.stringify({v:1,characterID:702,
   eventID:EID,at:NOW,phase:"INTERESTED"})+"\n");
  assert.equal(f.board.interest(701,EID).status,"INTEREST_WRITE_UNCERTAIN_NEEDS_REPAIR");
 }finally{f.close()}
});
function agent(status){
 const session={characterID:701,socket:{destroyed:false},_space:{systemID:30000144}};
 const nativeAgent={agentID:500003,ownerName:"NPC",
  solarSystemID:30000144,stationID:60000001,corporationID:1000152,isInSpace:false};
 const event={...publish(),source:"NATIVE_VERIFIED",phase:"ACTIVE",createdAt:NOW};
 const quote={eventID:EID,contractID:"escort-30000144-77-123",
  systemID:30000144,haulerID:901,stationID:60000001,
  corporationID:1000152,amountISK:600000,expiresAt:NOW+50000};
 const logs=[],pin=new Map();
 const service=createNativeJobAgent({
  listEvents:()=>({status:"READY",events:[event]}),
  readEvent:()=>({status:"READY",event}),readQuote:()=>({status:"READY",quote}),
  readAccepted:()=>({status:"NOT_FOUND"}),
  getAgent:()=>nativeAgent,getMission:()=>null,getSessions:()=>[session],
  selection:{read:()=>pin.has("701")?{status:"READY",eventID:pin.get("701")}:{status:"NOT_FOUND"},
   pin:(_c,_a,id)=>{pin.set("701",id);return {status:"SELECTED",eventID:id}}},
  dispatch:({argumentText})=>{logs.push(argumentText);return {
   status:argumentText.startsWith("interest")?status:"WAITING_FOR_OTHER_VOLUNTEER"}},
  clock:()=>NOW});
 return {logs,click:a=>service.doAction({session,agentID:nativeAgent.agentID,actionID:a})};
}
test("agent Accept on truly durable duplicate can continue native volunteer gate",()=>{
 const a=agent("INTEREST_ALREADY_DURABLY_RECORDED");
 a.click(null);
 const x=a.click(3);
 assert.match(x.data.agentSays[0],/fleetmate/);
 assert.deepEqual(a.logs,["interest "+EID,"volunteer "+EID]);
});
test("agent Accept on ambiguous interest cannot invoke volunteer or priced wallet",()=>{
 const a=agent("INTEREST_WRITE_UNCERTAIN_NEEDS_REPAIR");
 a.click(null);
 const x=a.click(3);
 assert.match(x.data.agentSays[0],/Cannot register your interest/);
 assert.deepEqual(a.logs,["interest "+EID]);
});
process.on("exit",()=>{
 if(OLD===undefined)delete process.env.EVEJS_COOP_OPPORTUNITY_BOARD;
 else process.env.EVEJS_COOP_OPPORTUNITY_BOARD=OLD;
 if(OLDA===undefined)delete process.env.EVEJS_COOP_NATIVE_JOB_AGENT;
 else process.env.EVEJS_COOP_NATIVE_JOB_AGENT=OLDA;
});
