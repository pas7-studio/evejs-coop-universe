import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createVolunteers}=require("../integration/coopEscortVolunteers.cjs");
const OLD=process.env.EVEJS_COOP_EVENT_VOLUNTEERS;
process.env.EVEJS_COOP_EVENT_VOLUNTEERS="1";
function fixture(fn){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"escort-volunteer-"));
 let now=1200000,interests=new Set(),members=[701,702];
 const session=id=>({characterID:id,socket:{destroyed:false},
  _space:{systemID:30000144,shipID:id+200,initialStateSent:true}});
 const players=[session(701),session(702)];
 const npc={kind:"ship",nativeNpc:true,itemID:901,transient:false};
 const ships=new Map([[901,npc],...players.map(s=>[s._space.shipID,{
  kind:"ship",nativeNpc:false,itemID:s._space.shipID}])]);
 const scene={systemID:30000144,sessions:new Map(players.map(s=>[s.characterID,s])),
  getEntityByID:id=>ships.get(id)};
 const fleet={fleetID:77,members:new Map(members.map(c=>[c,{}]))};
 const fleets={getFleetForCharacter:id=>fleet.members.has(id)?fleet:null,
  getMemberRecord:(_,id)=>fleet.members.get(id)||null};
 const event={id:"convoy-30000144-77-1111000",status:"READY",type:"CONVOY",
  phase:"ACTIVE",systemID:30000144,entityID:901,expiresAt:2000000};
 const args={root,clock:()=>now,readEvent:()=>({status:"READY",event}),
  readInterest:(id)=>interests.has(id)?{status:"INTEREST_RECORDED"}:{status:"NOT_FOUND"},
  getSessions:()=>players,getScene:()=>scene,fleetRuntime:fleets};
 const api=()=>createVolunteers(args);
 const f={api,players,scene,ships,fleet,fleets,event,args,
  interested:id=>interests.add(id),time:t=>now=t,};
 try{fn(f)}finally{fs.rmSync(root,{recursive:true,force:true})}
}
const id="convoy-30000144-77-1111000";
test("both players must separately opt in before verified duo participation",()=>fixture(f=>{
 f.interested(701);f.interested(702);
 assert.equal(f.api().volunteer(f.players[0],id).status,"WAITING_FOR_OTHER_VOLUNTEER");
 const b=f.api().volunteer(f.players[1],id);
 assert.equal(b.status,"VERIFIED_NATIVE_DUO_VOLUNTEER");
 assert.deepEqual(b.characters,[701,702]);
 assert.equal(f.api().status(id).status,"VERIFIED_NATIVE_DUO_VOLUNTEER");
}));
test("no in-game interest blocks volunteer without touching a native fleet",()=>fixture(f=>{
 assert.equal(f.api().volunteer(f.players[0],id).status,"OPT_IN_INTEREST_REQUIRED");
 assert.equal(f.api().status(id).status,"NOT_FOUND");
}));
test("disconnected player cannot volunteer",()=>fixture(f=>{
 f.interested(701);f.players[0].socket.destroyed=true;
 assert.equal(f.api().volunteer(f.players[0],id).status,"NOT_TWO_AUTHENTIC_NATIVE_PILOTS");
}));
test("fake NPC entity cannot be the target of an accepted event",()=>fixture(f=>{
 f.interested(701);f.ships.get(901).nativeNpc=false;
 assert.equal(f.api().volunteer(f.players[0],id).status,"NOT_TWO_AUTHENTIC_NATIVE_PILOTS");
}));
test("membership must be exact real native duo",()=>fixture(f=>{
 f.interested(701);f.fleet.members.set(703,{});
 assert.equal(f.api().volunteer(f.players[0],id).status,"NOT_TWO_AUTHENTIC_NATIVE_PILOTS");
}));
test("duplicate active character session is never counted as native pilot",()=>fixture(f=>{
 f.interested(701);f.args.getSessions=()=>[...f.players,f.players[0]];
 assert.equal(f.api().volunteer(f.players[0],id).status,"NOT_TWO_AUTHENTIC_NATIVE_PILOTS");
}));
test("expired opportunity cannot be voluntarily joined",()=>fixture(f=>{
 f.interested(701);f.time(2100000);
 assert.equal(f.api().volunteer(f.players[0],id).status,"EVENT_EXPIRED");
}));
test("second actor cannot steal a consent record after changing their ship",()=>fixture(f=>{
 f.interested(701);f.interested(702);
 assert.equal(f.api().volunteer(f.players[0],id).status,"WAITING_FOR_OTHER_VOLUNTEER");
 const old=f.players[0]._space.shipID;f.ships.set(1403,{
  kind:"ship",nativeNpc:false,itemID:1403});f.players[0]._space.shipID=1403;
 assert.equal(f.api().volunteer(f.players[1],id).status,"VOLUNTEER_IDENTITY_CHANGED");
 f.players[0]._space.shipID=old;
}));
test("volunteering flag disabled by default",()=>fixture(f=>{
 f.interested(701);process.env.EVEJS_COOP_EVENT_VOLUNTEERS="0";
 try{assert.equal(f.api().volunteer(f.players[0],id).status,"DISABLED")}
 finally{process.env.EVEJS_COOP_EVENT_VOLUNTEERS="1"}
}));
process.on("exit",()=>{if(OLD===undefined)delete process.env.EVEJS_COOP_EVENT_VOLUNTEERS;
 else process.env.EVEJS_COOP_EVENT_VOLUNTEERS=OLD});
