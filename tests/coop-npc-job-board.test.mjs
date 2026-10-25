import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createJobBoard}=require("../integration/coopNpcJobBoard.cjs");
const NOW=10000, SYSTEM=30000144, HAULER=901, STATION=6001001;
const eventID="convoy-"+SYSTEM+"-77-123";
const raidID="raid-"+SYSTEM+"-444-901";
const convoy=()=>({
 v:1,id:eventID,type:"CONVOY",stage:"PREPARING",phase:"ACTIVE",
 source:"NATIVE_VERIFIED",createdAt:NOW-1000,expiresAt:NOW+5000,
 systemID:SYSTEM,entityID:HAULER,stationID:STATION,title:"NPC convoy preparing",
 summary:"Real NPC hauling cargo"});
const minerRaid=()=>({
 v:1,id:raidID,type:"RAID",phase:"ACTIVE",source:"NATIVE_VERIFIED",
 createdAt:NOW-1000,expiresAt:NOW+5000,systemID:SYSTEM,entityID:901,
 title:"Pirates attacking NPC miner",summary:"Real miner in distress"});
const quote=()=>({
 eventID,contractID:"escort-"+SYSTEM+"-77-123",corporationID:1000001,
 systemID:SYSTEM,haulerID:HAULER,stationID:STATION,
 amountISK:600000,expiresAt:NOW+5000});
function fixture({events=[convoy(),minerRaid()],quoted=true,accepted=false,failList=false,failQuote=false}={}){
 const forwarded=[];
 const api=createJobBoard({
 clock:()=>NOW,
 listEvents:({all,systemID,limit})=>{
  if(failList)throw Error("native list offline");
  assert.equal(limit,20);
  return {status:"READY",events:events.filter(e=>all||e.systemID===systemID)};
 },
 readEvent:id=>({status:"READY",event:events.find(e=>e.id===id)}),
 readQuote:id=>{
  if(failQuote)throw Error("quote offline");
  return quoted&&id===eventID?{status:"READY",quote:typeof quoted==="object"?quoted:quote()}:{status:"NOT_FOUND"};
 },
 readAcceptance:id=>accepted&&id===eventID?{
  status:"DURABLE_TWO_PILOT_PAID_ACCEPTANCE",contractID:quote().contractID,
  amountISK:600000,characters:[701,702]}:{status:"NOT_FOUND"},
 delegate:args=>{forwarded.push(args);return {status:"DELEGATED",message:"native: "+args.argumentText}}
 });
 const session={characterID:701,_space:{systemID:SYSTEM},socket:{destroyed:false}};
 return {api,session,forwarded,chat:(text,own=session)=>api.handleChat({session:own,argumentText:text})};
}
const before=process.env.EVEJS_COOP_NPC_JOBS;
process.env.EVEJS_COOP_NPC_JOBS="1";
test("default-off flag refuses even read-only job browse",()=>{
 const f=fixture();process.env.EVEJS_COOP_NPC_JOBS="0";
 try{assert.equal(f.chat("list").status,"DISABLED");
 assert.equal(f.forwarded.length,0)}
 finally{process.env.EVEJS_COOP_NPC_JOBS="1"}
});
test("only actual verified native activity appears; source IDs stay unchanged",()=>{
 const f=fixture();const r=f.chat("all");
 assert.equal(r.status,"READY");
 assert.match(r.message,new RegExp(eventID));
 assert.match(r.message,new RegExp(raidID));
 assert.equal(f.api.browse({all:true}).jobs.length,2);
});
test("quote is a total, not a funded guarantee or amount per pilot multiplied",()=>{
 const f=fixture();const r=f.chat("info "+eventID);
 assert.match(r.message,/600000 ISK total/);
 assert.match(r.message,/300000 ISK per pilot/);
 assert.match(r.message,/not reserved until native pre-warp funding/i);
});
test("no native priced quote means NO advertised paid contract",()=>{
 const f=fixture({quoted:false});
 assert.match(f.chat("list").message,/UNPAID \/ NOT FUNDED/);
 assert.equal(f.chat("accept "+eventID).status,"NO_VERIFIED_PAID_QUOTE");
 assert.equal(f.forwarded.length,0);
});
test("mismatched corporate quote provenance fails closed",()=>{
 const q=quote();q.haulerID++;
 const f=fixture({quoted:q});
 assert.equal(f.api.get(eventID).job.status,"QUOTE_PROVENANCE_INVALID");
 assert.equal(f.chat("accept "+eventID).status,"NO_VERIFIED_PAID_QUOTE");
});
test("quote authority errors do not turn interest into payable acceptance",()=>{
 const f=fixture({failQuote:true});
 assert.equal(f.chat("accept "+eventID).status,"NO_VERIFIED_PAID_QUOTE");
 assert.equal(f.forwarded.length,0);
});
test("native server controls paid accept, board never writes ISK",()=>{
 const f=fixture();const r=f.chat("accept "+eventID);
 assert.equal(r.status,"DELEGATED");
 assert.deepEqual(f.forwarded.map(x=>x.argumentText),["accept "+eventID]);
});
test("cannot accept from wrong system or no native location",()=>{
 const f=fixture();
 assert.equal(f.chat("accept "+eventID,{...f.session,_space:{systemID:30000142}}).status,"NATIVE_SYSTEM_MISMATCH");
 assert.equal(f.chat("volunteer "+eventID,{...f.session,_space:{}}).status,"NATIVE_SYSTEM_MISMATCH");
 assert.equal(f.forwarded.length,0);
});
test("client cannot accept a miner raid or an en-route convoy as paid work",()=>{
 const f=fixture();assert.equal(f.chat("accept "+raidID).status,"NO_VERIFIED_PAID_QUOTE");
 const v=convoy();v.stage="EN_ROUTE";
 const g=fixture({events:[v]});
 assert.equal(g.chat("accept "+eventID).status,"NO_VERIFIED_PAID_QUOTE");
});
test("miners are visible as unpaid emergency work only",()=>{
 const f=fixture();
 assert.match(f.chat("miner").message,/MINER_RESCUE/);
 assert.match(f.chat("miner").message,/UNPAID \/ NOT FUNDED/);
 assert.doesNotMatch(f.chat("miner").message,/TRADE_ESCORT/);
});
test("real voluntary interest passes through existing native Board consent",()=>{
 const f=fixture();
 assert.equal(f.chat("interest "+raidID).status,"DELEGATED");
 assert.equal(f.chat("volunteer "+raidID).status,"DELEGATED");
 assert.deepEqual(f.forwarded.map(x=>x.argumentText),["interest "+raidID,"volunteer "+raidID]);
});
test("native active signature never claims escrow, wallet payout or departure",()=>{
 const f=fixture({accepted:true});
 assert.match(f.chat("active").message,/SIGNED \(escrow\/departure not established\)/);
 assert.doesNotMatch(f.chat("active").message,/FUNDED|PAID/);
 const s={...f.session,characterID:999};
 assert.match(f.chat("active",s).message,/No signed native offers/);
});
test("history and watch delegate to original native authorities",()=>{
 const f=fixture();
 f.chat("watch off");f.chat("history");
 assert.deepEqual(f.forwarded.map(x=>x.argumentText),["watch off","history"]);
});
test("forged events, wrong type and expiry are excluded without mutation",()=>{
 const corrupted=convoy();corrupted.source="CLIENT_SUPPLIED";
 const expired=minerRaid();expired.expiresAt=NOW;
 const impossible={...convoy(),id:raidID};
 const f=fixture({events:[corrupted,expired,impossible]});
 assert.equal(f.api.browse({all:true}).jobs.length,0);
 assert.equal(f.chat("accept "+eventID).status,"JOB_NOT_AVAILABLE");
});
test("native listing failure refuses to advertise stale tasks",()=>{
 const f=fixture({failList:true});
 assert.equal(f.chat("all").status,"JOB_SOURCE_UNAVAILABLE");
 assert.equal(f.chat("active").status,"JOB_SOURCE_UNAVAILABLE");
});
test("invalid account and forged command ID fail without downstream call",()=>{
 const f=fixture();
 assert.equal(f.chat("list",{...f.session,characterID:0}).status,"UNAUTHENTICATED");
 assert.equal(f.chat("list",{...f.session,socket:{destroyed:true}}).status,"UNAUTHENTICATED");
 assert.equal(f.chat("accept ../secret").status,"INVALID_JOB_ID");
 assert.equal(f.forwarded.length,0);
});
test("local list requires a real native system; global list does not",()=>{
 const f=fixture(),s={...f.session,_space:{}};
 assert.equal(f.chat("list",s).status,"NATIVE_SYSTEM_UNKNOWN");
 assert.equal(f.chat("all",s).status,"READY");
});
test("only recognized command verbs are forwarded",()=>{
 const f=fixture();
 assert.equal(f.chat("pay "+eventID).status,"HELP");
 assert.equal(f.chat("watch global").status,"HELP");
 assert.equal(f.forwarded.length,0);
});
test("only a bounded source listing can supply job results",()=>{
 const f=createJobBoard({
  listEvents:()=>({status:"READY",events:Array(21).fill(convoy())}),
  readEvent:()=>({status:"NOT_FOUND"}),
  readQuote:()=>({status:"NOT_FOUND"}),
  readAcceptance:()=>({status:"NOT_FOUND"}),
  delegate:()=>({status:"UNEXPECTED"}),
  clock:()=>NOW
 });
 assert.equal(f.browse({all:true}).status,"JOB_SOURCE_UNTRUSTED");
});
test("new read-only hook and chat registration are present in the reversible installer",async()=>{
 const fs=await import("node:fs");
 const installer=fs.readFileSync(new URL("../scripts/patch-evejs-coop.cjs",import.meta.url),"utf8");
 const board=fs.readFileSync(new URL("../integration/coopWorldOpportunityBoard.cjs",import.meta.url),"utf8");
 assert.match(installer,/coopNpcJobBoard/);
 assert.match(installer,/if \(command === "jobs"\)/);
 assert.match(installer,/names\.splice\(names\.indexOf\("coopWorldOpportunityBoard"\)/);
 assert.match(board,/function listNativeEvents\(/);
});
process.on("exit",()=>{
 if(before===undefined)delete process.env.EVEJS_COOP_NPC_JOBS;
 else process.env.EVEJS_COOP_NPC_JOBS=before;
});
