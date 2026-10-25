import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createBoard}=require("../integration/coopWorldOpportunityBoard.cjs");
const {createVolunteers}=require("../integration/coopEscortVolunteers.cjs");
const vars=["EVEJS_COOP_OPPORTUNITY_BOARD","EVEJS_COOP_OPPORTUNITY_MAIL",
 "EVEJS_COOP_EVENT_VOLUNTEERS"];
const saved=Object.fromEntries(vars.map(k=>[k,process.env[k]]));
for(const k of vars)process.env[k]="1";
function fixture(fn){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"evejs-native-predeparture-"));
 let now=1000000,mails=[];
 const npc={nativeNpc:true,kind:"ship",itemID:901,transient:false};
 const players=[701,702].map((characterID,i)=>({characterID,
  socket:{destroyed:false},
  _space:{systemID:30000144,shipID:1701+i,initialStateSent:true}}));
 const ships=new Map([[901,npc],[1701,{itemID:1701,kind:"ship",nativeNpc:false}],
  [1702,{itemID:1702,kind:"ship",nativeNpc:false}]]);
 const scene={systemID:30000144,sessions:new Map(players.map(p=>[p.characterID,p])),
  getEntityByID:id=>ships.get(id)};
 const npcFleet={fleetID:77,systemID:30000144,haulerEntityIDs:[901]};
 const nativePlayerFleet={fleetID:33,members:new Map([[701,{}],[702,{}]])};
 const fleetRuntime={getFleetForCharacter:()=>nativePlayerFleet,
  getMemberRecord:(f,id)=>f.members.get(id)||null};
 const board=createBoard({root,clock:()=>now,getSessions:()=>players,
  sendNativeMail:(characterID,mail)=>{mails.push({characterID,...mail});
   return {success:true,messageID:mails.length}}});
 const volunteers=createVolunteers({root,clock:()=>now,readEvent:board.readEvent,
  readInterest:board.readInterest,getSessions:()=>players,getScene:()=>scene,
  fleetRuntime});
 const publish=()=>board.nativeConvoyPreparing({scene,fleet:npcFleet,
  stationID:60001,cargoIDs:[5501,5502]});
 const eventID="convoy-30000144-77-5501";
 try{fn({root,board,volunteers,scene,npcFleet,players,publish,eventID,
  setTime:t=>now=t,mails:()=>mails})}
 finally{fs.rmSync(root,{recursive:true,force:true})}
}
test("real cargo-bearing native hauler sends a notice BEFORE first warp",()=>fixture(f=>{
 const p=f.publish();assert.equal(p.status,"EVENT_PUBLISHED");
 assert.equal(p.id,f.eventID);
 const e=f.board.readEvent(f.eventID);
 assert.equal(e.event.stage,"PREPARING");
 assert.equal(e.event.phase,"ACTIVE");
 assert.equal(f.npcFleet.coopStationArrival,undefined);
 assert.equal(f.mails().length,2);
 assert.match(f.mails()[0].body,/\/events volunteer|\/events interest/);
}));
test("retrying same cargo after restart does not send another EVEmail",()=>fixture(f=>{
 assert.equal(f.publish().status,"EVENT_PUBLISHED");
 assert.equal(f.publish().status,"NATIVE_PREPARING_EVENT_READY");
 assert.equal(f.mails().length,2);
 const rebooted=createBoard({root:f.root,clock:()=>1000000,getSessions:()=>[]});
 assert.equal(rebooted.nativeConvoyPreparing({
  scene:f.scene,fleet:f.npcFleet,stationID:60001,cargoIDs:[5502,5501]
 }).status,"NATIVE_PREPARING_EVENT_READY");
}));
test("stable preflight ID is the original cargo ID, not a new retry timestamp",()=>fixture(f=>{
 f.publish();f.setTime(3000000);
 assert.equal(f.publish().id,f.eventID);
}));
test("no source NPC ship blocks false preparation alert",()=>fixture(f=>{
 f.scene.getEntityByID=()=>null;
 assert.equal(f.publish().status,"PREPARING_NATIVE_HAULER_NOT_PRESENT");
}));
test("duplicate or missing original native cargo IDs refuse the offer",()=>fixture(f=>{
 assert.equal(f.board.nativeConvoyPreparing({scene:f.scene,fleet:f.npcFleet,
  stationID:60001,cargoIDs:[5501,5501]}).status,"PREPARING_SOURCE_INVALID");
}));
test("both distinct real EVE pilots volunteer to the same PREPARING event",()=>fixture(f=>{
 f.publish();
 assert.equal(f.board.interest(701,f.eventID).status,"INTEREST_RECORDED");
 assert.equal(f.board.interest(702,f.eventID).status,"INTEREST_RECORDED");
 assert.equal(f.volunteers.volunteer(f.players[0],f.eventID).status,
  "WAITING_FOR_OTHER_VOLUNTEER");
 assert.equal(f.volunteers.volunteer(f.players[1],f.eventID).status,
  "VERIFIED_NATIVE_DUO_VOLUNTEER");
 assert.equal(f.volunteers.status(f.eventID).status,
  "VERIFIED_NATIVE_DUO_VOLUNTEER");
}));
test("actual native successful departure retires PREPARING and links real trip",()=>fixture(f=>{
 f.publish();
 const trip={manifestID:"30000144-77-2200000",fleetID:77,systemID:30000144,
  stationID:60001,startedAt:2200000,haulers:{"901":{arrivedAt:0}}};
 assert.equal(f.board.nativePreparingDeparted({scene:f.scene,fleet:f.npcFleet,
  preparingEventID:f.eventID,trip}).status,"NATIVE_PREPARING_EVENT_CLOSED");
 const e=f.board.readEvent(f.eventID).event;
 assert.equal(e.phase,"RESOLVED");assert.equal(e.outcome,"DEPARTED");
 assert.equal(e.linkedTripID,trip.manifestID);
 assert.equal(f.board.list({all:true}).events.length,0);
}));
test("duplicate terminal departure after a lost ACK is idempotent",()=>fixture(f=>{
 f.publish();
 const trip={manifestID:"30000144-77-2200000",fleetID:77,systemID:30000144,
  stationID:60001,startedAt:2200000,haulers:{"901":{arrivedAt:0}}};
 const request={scene:f.scene,fleet:f.npcFleet,preparingEventID:f.eventID,trip};
 assert.equal(f.board.nativePreparingDeparted(request).status,"NATIVE_PREPARING_EVENT_CLOSED");
 assert.equal(f.board.nativePreparingDeparted(request).status,"NATIVE_PREPARING_EVENT_CLOSED");
 assert.equal(f.board.readEvent(f.eventID).event.linkedTripID,trip.manifestID);
}));
test("forged departure without a matching real native hauler never retires alert",()=>fixture(f=>{
 f.publish();
 const bad={manifestID:"30000144-77-2200000",fleetID:77,systemID:30000144,
  stationID:60001,startedAt:2200000,haulers:{"999":{arrivedAt:0}}};
 assert.equal(f.board.nativePreparingDeparted({scene:f.scene,fleet:f.npcFleet,
  preparingEventID:f.eventID,trip:bad}).status,
  "PREPARING_DEPARTURE_PROVENANCE_MISMATCH");
 assert.equal(f.board.readEvent(f.eventID).event.phase,"ACTIVE");
}));
test("expired offer cannot be reissued with a new fake timestamp",()=>fixture(f=>{
 f.publish();f.setTime(1000000+2*60*60*1000+1);
 assert.equal(f.publish().status,"PREPARING_EVENT_IDENTITY_OR_EXPIRY_CONFLICT");
 assert.equal(f.mails().length,2);
}));
test("feature OFF cannot create any predeparture event",()=>fixture(f=>{
 process.env.EVEJS_COOP_OPPORTUNITY_BOARD="0";
 try{assert.equal(f.publish().status,"DISABLED");
  assert.equal(f.mails().length,0)}
 finally{process.env.EVEJS_COOP_OPPORTUNITY_BOARD="1"}
}));
process.on("exit",()=>{for(const [k,v] of Object.entries(saved))
 if(v===undefined)delete process.env[k];else process.env[k]=v});
