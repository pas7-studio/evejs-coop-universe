import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createJobNotifications}=require("../integration/coopNativeJobNotifications.cjs");
const EID="convoy-30000144-77-123",NOW=100000;
const quote=()=>({eventID:EID,contractID:"escort-30000144-77-123",
 systemID:30000144,stationID:60000001,haulerID:901,corporationID:1000152,
 amountISK:600000,expiresAt:NOW+10000});
const event=()=>({id:EID,type:"CONVOY",source:"NATIVE_VERIFIED",
 phase:"ACTIVE",stage:"PREPARING",systemID:30000144,stationID:60000001,
 entityID:901,expiresAt:NOW+10000});
const agent=()=>({agentID:500003,ownerName:"Real NPC Officer",
 stationID:60000001,solarSystemID:30000144,corporationID:1000152,
 isInSpace:false});
const oldA=process.env.EVEJS_COOP_NATIVE_JOB_AGENT;
const oldM=process.env.EVEJS_COOP_OPPORTUNITY_MAIL;
process.env.EVEJS_COOP_NATIVE_JOB_AGENT="1";
process.env.EVEJS_COOP_OPPORTUNITY_MAIL="1";
function fixture(options={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"evejs-npc-job-mail-"));
 const sent=[];
 const sessions=options.sessions||[
  {characterID:701,socket:{destroyed:false},_space:{systemID:30000144}},
  {characterID:702,socket:{destroyed:false},_space:{systemID:30000142}}
 ];
 const settings=options.settings||{701:"local",702:"all"};
 const config={
  root,clock:()=>NOW,
  readEvent:()=>({status:"READY",event:options.event||event()}),
  agentsForCorporation:()=>options.agents===undefined?[agent()]:options.agents,
  getSessions:()=>sessions,
  watch:id=>({status:"READY",mode:settings[id]||"off"}),
  sendNativeMail:(id,message)=>{
   sent.push({id,...message});
   if(options.unknownAck)throw Error("LOST_MAIL_ACK");
   return {success:true,messageID:sent.length};
  }
 };
 const create=()=>createJobNotifications(config);
 return {root,sent,notify:create().notify,create,close:()=>fs.rmSync(root,{recursive:true,force:true})};
}
function withFixture(opts,fn){const f=fixture(opts);try{fn(f)}finally{f.close()}}
test("real funded-capable quote sends native EVE Mail with a stock agent contact",()=>withFixture({},f=>{
 const r=f.notify(quote());
 assert.equal(r.status,"NATIVE_AGENT_MAIL_DISPATCHED");
 assert.equal(r.sent,2);
 assert.equal(r.agentID,500003);
 assert.match(f.sent[0].body,/open the Agents list/i);
 assert.match(f.sent[0].body,/native Accept button/i);
 assert.match(f.sent[0].body,/not reserved or guaranteed/i);
 assert.doesNotMatch(f.sent[0].body,/\/jobs|\/events/);
}));
test("local watch prevents a distant player from receiving local job mail",()=>withFixture({settings:{701:"local",702:"local"}},f=>{
 assert.equal(f.notify(quote()).sent,1);
 assert.deepEqual(f.sent.map(x=>x.id),[701]);
}));
test("watch off excludes opted-out clients",()=>withFixture({settings:{701:"off",702:"all"}},f=>{
 assert.equal(f.notify(quote()).sent,1);
 assert.deepEqual(f.sent.map(x=>x.id),[702]);
}));
test("same quote replay never sends another EVEmail after restart",()=>withFixture({},f=>{
 assert.equal(f.notify(quote()).sent,2);
 assert.equal(f.create().notify(quote()).sent,0);
 assert.equal(f.sent.length,2);
}));
test("unknown native EVEmail send ACK never retries blindly",()=>withFixture({unknownAck:true},f=>{
 const r=f.notify(quote());
 assert.equal(r.sent,0);
 assert.equal(f.create().notify(quote()).sent,0);
 assert.equal(f.sent.length,2);
}));
test("agent mismatch cannot impersonate the quote issuer",()=>withFixture({agents:[{...agent(),corporationID:1000999}]},f=>{
 assert.equal(f.notify(quote()).status,"NO_REAL_SDE_CORPORATE_AGENT");
 assert.equal(f.sent.length,0);
}));
test("corporation real agent in wrong solar system is not a destination contact",()=>withFixture({agents:[{...agent(),solarSystemID:30000142}]},f=>{
 assert.equal(f.notify(quote()).status,"NO_REAL_SDE_CORPORATE_AGENT");
}));
test("native NPC in-space record is not presented as a station agent",()=>withFixture({agents:[{...agent(),isInSpace:true,stationID:null}]},f=>{
 assert.equal(f.notify(quote()).status,"NO_REAL_SDE_CORPORATE_AGENT");
}));
test("altered real source hauler or station cannot generate an agent mail",()=>withFixture({event:{...event(),entityID:999}},f=>{
 assert.equal(f.notify(quote()).status,"NATIVE_EVENT_QUOTE_MISMATCH");
 assert.equal(f.sent.length,0);
}));
test("expired source event is not a live job",()=>withFixture({event:{...event(),phase:"RESOLVED"}},f=>{
 assert.equal(f.notify(quote()).status,"NATIVE_EVENT_QUOTE_MISMATCH");
}));
test("priced native event tampering is rejected",()=>withFixture({},f=>{
 assert.equal(f.notify({...quote(),amountISK:0}).status,"INVALID_NATIVE_QUOTE");
 assert.equal(f.notify({...quote(),amountISK:600001}).status,"INVALID_NATIVE_QUOTE");
 assert.equal(f.notify({...quote(),eventID:"../etc/passwd"}).status,"INVALID_NATIVE_QUOTE");
 assert.equal(f.sent.length,0);
}));
test("offline or disconnected users are never notified",()=>withFixture({sessions:[
 {characterID:701,socket:{destroyed:true},_space:{systemID:30000144}}
]},f=>{
 assert.equal(f.notify(quote()).sent,0);
 assert.equal(f.sent.length,0);
}));
test("flags OFF suppress all native messages",()=>withFixture({},f=>{
 process.env.EVEJS_COOP_NATIVE_JOB_AGENT="0";
 try{assert.equal(f.notify(quote()).status,"DISABLED");assert.equal(f.sent.length,0)}
 finally{process.env.EVEJS_COOP_NATIVE_JOB_AGENT="1"}
}));
test("same connected character duplicate sessions do not double notify",()=>withFixture({sessions:[
 {characterID:701,_space:{systemID:30000144}},
 {characterID:701,_space:{systemID:30000144}}
]},f=>{
 assert.equal(f.notify(quote()).sent,1);
 assert.equal(f.sent.length,1);
}));
test("native quote integration is called only when original priced gate creates offer",()=>{
 const s=fs.readFileSync(new URL("../integration/coopEscortPricedOffers.cjs",import.meta.url),"utf8");
 const b=fs.readFileSync(new URL("../integration/coopWorldOpportunityBoard.cjs",import.meta.url),"utf8");
 assert.match(s,/NATIVE_QUOTE_DURABLY_PREPARED/);
 assert.match(s,/notifyNativeQuote\(result\.quote\)/);
 assert.match(b,/NATIVE_AGENT_QUOTE_PENDING/);
});
process.on("exit",()=>{
 if(oldA===undefined)delete process.env.EVEJS_COOP_NATIVE_JOB_AGENT;
 else process.env.EVEJS_COOP_NATIVE_JOB_AGENT=oldA;
 if(oldM===undefined)delete process.env.EVEJS_COOP_OPPORTUNITY_MAIL;
 else process.env.EVEJS_COOP_OPPORTUNITY_MAIL=oldM;
});
