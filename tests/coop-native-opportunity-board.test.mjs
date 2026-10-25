import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createBoard}=require("../integration/coopWorldOpportunityBoard.cjs");
function fixture({players=[],now=1000000}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"evejs-events-"));
 let tick=now,mail=[],failMail=false;
 const board=createBoard({root,clock:()=>tick,getSessions:()=>players,
  sendNativeMail:(characterID,m)=>{mail.push({characterID,...m});
   if(failMail)throw Error("MAIL_ACK_LOST");
   return {success:true,messageID:mail.length+1000};}});
 const position={x:0,y:0,z:0};
 const pirate={nativeNpc:true,itemID:202,kind:"ship",position},
  hauler={nativeNpc:true,itemID:901,kind:"ship",position};
 const scene={systemID:30000144,getEntityByID:id=>id===202?pirate:id===901?hauler:null};
 const action={action:"attack",pirateID:202,targetID:901,targetRole:"hauler"};
 const route={status:"EN_ROUTE"};
 const fleet={fleetID:77,systemID:30000144,haulerEntityIDs:[901],
  coopStationArrival:{fleetID:77,systemID:30000144,stationID:9000001,startedAt:999991}};
 return {board,root,scene,action,route,fleet,pirate,hauler,
  mails:()=>mail,failMail:()=>failMail=true,advance:n=>tick=n,
  close:()=>fs.rmSync(root,{recursive:true,force:true})};
}
function withFixture(opts,fn){const f=fixture(opts);try{fn(f)}finally{f.close()}}
const oldBoard=process.env.EVEJS_COOP_OPPORTUNITY_BOARD,
 oldMail=process.env.EVEJS_COOP_OPPORTUNITY_MAIL;
process.env.EVEJS_COOP_OPPORTUNITY_BOARD="1";
process.env.EVEJS_COOP_OPPORTUNITY_MAIL="1";
test("only authenticated NPC raid publishes a discoverable game event",()=>withFixture({},f=>{
 const result=f.board.nativeRaid({scene:f.scene,action:f.action});
 assert.equal(result.status,"EVENT_PUBLISHED");
 const listed=f.board.list({systemID:30000144});
 assert.equal(listed.events.length,1);
 assert.equal(listed.events[0].type,"RAID");
 assert.equal(listed.events[0].source,"NATIVE_VERIFIED");
}));
test("forged or absent NPC ship never generates an event",()=>withFixture({},f=>{
 f.pirate.nativeNpc=false;
 assert.equal(f.board.nativeRaid({scene:f.scene,action:f.action}).status,"NO_VERIFIED_NATIVE_SHIPS");
 assert.equal(f.board.list({all:true}).events.length,0);
}));
test("same native raid cannot create duplicate EVEmail",()=>withFixture({players:[{
 characterID:701,_space:{systemID:30000144},socket:{destroyed:false}}]},f=>{
 assert.equal(f.board.nativeRaid({scene:f.scene,action:f.action}).status,"EVENT_PUBLISHED");
 assert.equal(f.board.nativeRaid({scene:f.scene,action:f.action}).status,"EVENT_ALREADY_EXISTS_OR_WRITE_UNCERTAIN");
 assert.equal(f.mails().length,1);
}));
test("native EVEmail reaches only online pilots in the local system by default",()=>withFixture({players:[
 {characterID:701,_space:{systemID:30000144}},
 {characterID:702,_space:{systemID:30000142}},
 {characterID:703,_space:{systemID:30000144},socket:{destroyed:true}}
]},f=>{
 f.board.nativeRaid({scene:f.scene,action:f.action});
 assert.deepEqual(f.mails().map(m=>m.characterID),[701]);
 assert.match(f.mails()[0].body,/\/events info raid-30000144-202-901/);
}));
test("explicit all/off watch preferences persist across new board instances",()=>withFixture({players:[
 {characterID:701,_space:{systemID:30000142}},
 {characterID:702,_space:{systemID:30000144}}
]},f=>{
 assert.equal(f.board.setWatch(701,"all").status,"WATCH_UPDATED");
 assert.equal(f.board.setWatch(702,"off").status,"WATCH_UPDATED");
 f.board.nativeRaid({scene:f.scene,action:f.action});
 assert.deepEqual(f.mails().map(m=>m.characterID),[701]);
 assert.equal(f.board.watch(702).mode,"off");
}));
test("a mail timeout does not resend on replay",()=>withFixture({players:[
 {characterID:701,_space:{systemID:30000144}}
]},f=>{
 f.failMail();
 assert.equal(f.board.nativeRaid({scene:f.scene,action:f.action}).status,"EVENT_PUBLISHED");
 assert.equal(f.mails().length,1);
 assert.equal(f.board.nativeRaid({scene:f.scene,action:f.action}).status,"EVENT_ALREADY_EXISTS_OR_WRITE_UNCERTAIN");
 assert.equal(f.mails().length,1);
}));
test("native convoy is listed only after genuine in-scene route was started",()=>withFixture({},f=>{
 assert.equal(f.board.nativeConvoy({scene:f.scene,fleet:f.fleet,route:f.route}).status,"EVENT_PUBLISHED");
 const row=f.board.list({all:true}).events[0];
 assert.equal(row.type,"CONVOY");assert.equal(row.stationID,9000001);
}));
test("a fabricated pending convoy cannot publish",()=>withFixture({},f=>{
 f.fleet.coopStationArrival=null;
 assert.equal(f.board.nativeConvoy({scene:f.scene,fleet:f.fleet,route:f.route}).status,"NO_VERIFIED_NATIVE_CONVOY");
}));
test("expired events disappear without fake reward or route changes",()=>withFixture({},f=>{
 f.board.nativeRaid({scene:f.scene,action:f.action});
 f.advance(1000000+31*60000);
 assert.equal(f.board.list({all:true}).events.length,0);
 assert.equal(f.board.interest(701,"raid-30000144-202-901").status,"EVENT_EXPIRED");
}));
test("voluntary interest is durable and never claims a fleet join",()=>withFixture({},f=>{
 f.board.nativeRaid({scene:f.scene,action:f.action});
 const r=f.board.interest(701,"raid-30000144-202-901");
 assert.equal(r.status,"INTEREST_RECORDED");
 assert.match(r.note,/Interest only/);
 assert.equal(f.board.interest(701,"raid-30000144-202-901").status,"ALREADY_INTERESTED_OR_WRITE_UNCERTAIN");
}));
test("chat slash interface filters local/global and exposes consent controls",()=>withFixture({},f=>{
 f.board.nativeRaid({scene:f.scene,action:f.action});
 const session={characterID:701,_space:{systemID:30000142}};
 assert.match(f.board.handleChat({session,command:"events",argumentText:"list"}).message,/No verified/);
 assert.match(f.board.handleChat({session,command:"events",argumentText:"all"}).message,/raid-30000144-202-901/);
 assert.equal(f.board.handleChat({session,command:"events",argumentText:"watch off"}).status,"WATCH_UPDATED");
 assert.match(f.board.handleChat({session,command:"events",argumentText:"info raid-30000144-202-901"}).message,/native EVE fleet/i);
}));
test("corrupted native event storage refuses to return a partial forged board",()=>withFixture({},f=>{
 f.board.nativeRaid({scene:f.scene,action:f.action});
 fs.appendFileSync(path.join(f.root,"coop-opportunities","events","raid-30000144-202-901.json"),"{bad");
 assert.equal(f.board.list({all:true}).status,"EVENT_STORAGE_UNTRUSTED");
}));
test("disabled flag prevents new native event files and live notices",()=>withFixture({players:[{
 characterID:701,_space:{systemID:30000144}
]},f=>{
 process.env.EVEJS_COOP_OPPORTUNITY_BOARD="0";
 try{assert.equal(f.board.nativeRaid({scene:f.scene,action:f.action}).status,"DISABLED");
  assert.equal(f.mails().length,0)}finally{process.env.EVEJS_COOP_OPPORTUNITY_BOARD="1"}
}));
test("mail flag OFF preserves board discovery and prevents EVEmail dispatch",()=>withFixture({players:[{
 characterID:701,_space:{systemID:30000144}
]},f=>{
 process.env.EVEJS_COOP_OPPORTUNITY_MAIL="0";
 try{assert.equal(f.board.nativeRaid({scene:f.scene,action:f.action}).status,"EVENT_PUBLISHED");
  assert.equal(f.mails().length,0)}finally{process.env.EVEJS_COOP_OPPORTUNITY_MAIL="1"}
}));
process.on("exit",()=>{
 if(oldBoard===undefined)delete process.env.EVEJS_COOP_OPPORTUNITY_BOARD;
 else process.env.EVEJS_COOP_OPPORTUNITY_BOARD=oldBoard;
 if(oldMail===undefined)delete process.env.EVEJS_COOP_OPPORTUNITY_MAIL;
 else process.env.EVEJS_COOP_OPPORTUNITY_MAIL=oldMail;
});
