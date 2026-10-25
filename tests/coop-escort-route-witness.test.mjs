import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createRouteWitness}=require("../integration/coopEscortRouteWitness.cjs");
const FLAG="EVEJS_COOP_ESCORT_ROUTE_WITNESS",old=process.env[FLAG];
process.env[FLAG]="1";
const key="30000144-77-123";
const booking=()=>({manifestKey:key,contractID:"escort-30000144-77-123",
 systemID:30000144,fleetID:77,haulerID:901,
 stationID:60000001,corporationID:1000152,
 playerFleetID:44,characters:[701,702],amountISK:600000});
const departure=()=>({status:"VERIFIED_NATIVE_ESCORT_DEPARTURE",
 manifestKey:key,contractID:"escort-30000144-77-123",
 characters:[701,702],shipIDs:[7001,7002],at:10000,
 origin:{x:0,y:0,z:0}});
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"coop-escort-route-"));
 let clock=20000;
 const entities=new Map([
  [901,{itemID:901,kind:"ship",nativeNpc:true,position:{x:30000,y:0,z:0}}],
  [7001,{itemID:7001,kind:"ship",nativeNpc:false,position:{x:30030,y:0,z:0}}],
  [7002,{itemID:7002,kind:"ship",nativeNpc:false,position:{x:30050,y:0,z:0}}]
 ]);
 const sessions=new Map([
  [1,{characterID:701,socket:{destroyed:false},_space:{initialStateSent:true,systemID:30000144,shipID:7001}}],
  [2,{characterID:702,socket:{destroyed:false},_space:{initialStateSent:true,systemID:30000144,shipID:7002}}]
 ]);
 const scene={systemID:30000144,sessions,getEntityByID:id=>entities.get(id)};
 const station={stationID:60000001,corporationID:1000152,position:{x:100000,y:0,z:0}};
 const verifyNativeDuo=()=>({status:"VERIFIED_NATIVE_DUO_FLEET",fleetID:44,characters:[701,702]});
 const witness=(io)=>createRouteWitness({root,io,clock:()=>clock});
 const input=()=>({booking:booking(),departure:departure(),scene,station,verifyNativeDuo});
 const move=x=>{for(const [id,diff] of [[901,0],[7001,30],[7002,50]])
  entities.get(id).position={x:x+diff,y:0,z:0}};
 return {root,witness,input,move,scene,station,sessions,entities,
  later:ms=>{clock+=ms},close:()=>fs.rmSync(root,{recursive:true,force:true})};
}
function withFixture(fn){const f=fixture();try{fn(f)}finally{f.close()}}
function two(f){
 const w=f.witness();
 assert.equal(w.sample(f.input()).status,"NATIVE_ROUTE_CHECKPOINT_DURABLY_RECORDED");
 f.move(70000);f.later(1000);
 assert.equal(w.sample(f.input()).status,"NATIVE_ROUTE_CHECKPOINT_DURABLY_RECORDED");
 return w;
}
test("actual two independent native escort pilots at two transit checkpoints qualifies",()=>withFixture(f=>{
 const w=two(f),v=w.verify(booking(),departure());
 assert.equal(v.status,"VERIFIED_NATIVE_ESCORT_ROUTE_SERVICE");
 assert.deepEqual(v.characters,[701,702]);
 assert.equal(v.firstAt,20000);assert.equal(v.secondAt,21000);
}));
test("immutable checkpoints survive restart with exact same native contract/ships",()=>withFixture(f=>{
 two(f);assert.equal(f.witness().verify(booking(),departure()).status,
  "VERIFIED_NATIVE_ESCORT_ROUTE_SERVICE");
 assert.equal(f.witness().sample(f.input()).status,
  "NATIVE_ROUTE_CHECKPOINT_ALREADY_RECORDED");
}));
test("waiting only at destination never generates checkpoint",()=>withFixture(f=>{
 f.move(100000);
 assert.equal(f.witness().sample(f.input()).status,"ROUTE_NOT_AT_CHECKPOINT");
 assert.equal(f.witness().verify(booking(),departure()).status,
  "ROUTE_CHECKPOINT_NOT_FOUND");
}));
test("one checkpoint is insufficient for corporate payout",()=>withFixture(f=>{
 const w=f.witness();w.sample(f.input());
 assert.equal(w.verify(booking(),departure()).status,"ROUTE_CHECKPOINT_NOT_FOUND");
}));
test("no stage-two witness without independent prior stage-one progress",()=>withFixture(f=>{
 f.move(70000);
 assert.equal(f.witness().sample(f.input()).status,
  "ROUTE_EARLIER_CHECKPOINT_REQUIRED");
}));
test("a fleetmate who camps behind at origin is not an active escort",()=>withFixture(f=>{
 f.witness().sample(f.input());
 f.move(70000);f.later(1000);
 f.entities.get(7002).position.x=0;
 assert.equal(f.witness().sample(f.input()).status,
  "ROUTE_PILOT_NOT_ESCORTING_NPC");
}));
test("disconnecting one player invalidates the midroute sample",()=>withFixture(f=>{
 f.sessions.get(2).socket.destroyed=true;
 assert.equal(f.witness().sample(f.input()).status,
  "ROUTE_PILOT_SESSION_NOT_UNIQUE");
}));
test("two sessions for one pilot cannot impersonate two real escorts",()=>withFixture(f=>{
 f.sessions.set(3,{...f.sessions.get(1)});
 assert.equal(f.witness().sample(f.input()).status,
  "ROUTE_PILOT_SESSION_NOT_UNIQUE");
}));
test("actual native fleet mismatch fails closed, no fictional ISK",()=>withFixture(f=>{
 const i=f.input();i.verifyNativeDuo=()=>({status:"WRONG_FLEET"});
 assert.equal(f.witness().sample(i).status,"ROUTE_NATIVE_FLEET_NOT_VERIFIED");
}));
test("real player ship identity must stay same as original source witness",()=>withFixture(f=>{
 f.sessions.get(2)._space.shipID=9999;
 assert.equal(f.witness().sample(f.input()).status,
  "ROUTE_PILOT_SESSION_NOT_UNIQUE");
}));
test("second checkpoint from an altered destination station is rejected",()=>withFixture(f=>{
 const w=f.witness();w.sample(f.input());f.later(1000);f.move(70000);
 const i=f.input();i.station.position={x:110000,y:0,z:0};
 assert.equal(w.sample(i).status,"ROUTE_DESTINATION_CHANGED");
}));
test("two consecutive samples less than 500ms apart are rejected",()=>withFixture(f=>{
 const w=f.witness();w.sample(f.input());f.later(100);f.move(70000);
 assert.equal(w.sample(f.input()).status,"ROUTE_SAMPLE_TIME_INVALID");
}));
test("tampered paid amount or player roster invalidates both saved proofs",()=>withFixture(f=>{
 const w=two(f);
 assert.equal(w.verify({...booking(),amountISK:660000},departure()).status,
  "ROUTE_CHECKPOINT_SOURCE_MISMATCH");
 assert.equal(w.verify({...booking(),characters:[701,703]},departure()).status,
  "ROUTE_IDENTITY_INVALID");
}));
test("invalid native path traversal manifest cannot create a paid journal",()=>withFixture(f=>{
 const i=f.input();i.booking.manifestKey="../x";
 assert.equal(f.witness().sample(i).status,"ROUTE_IDENTITY_INVALID");
}));
test("corrupt checkpoint file blocks paid route recovery, not guessed replay",()=>withFixture(f=>{
 const w=two(f);
 fs.writeFileSync(path.join(f.root,"escort-route-witness",key+".stage-1.json"),"{broken\n");
 assert.equal(w.verify(booking(),departure()).status,"ROUTE_CHECKPOINT_CORRUPT");
}));
test("second checkpoint cannot rely on first lost fsync ACK",()=>withFixture(f=>{
 let lost=false;const io={...fs,fsyncSync(fd){if(lost)throw Error("ACK_LOST");
  return fs.fsyncSync(fd)}};
 const w=f.witness(io);
 assert.equal(w.sample(f.input()).status,"NATIVE_ROUTE_CHECKPOINT_DURABLY_RECORDED");
 f.move(70000);f.later(1000);lost=true;
 assert.equal(w.sample(f.input()).status,"ROUTE_EARLIER_CHECKPOINT_FSYNC_UNCERTAIN");
 assert.equal(w.verify(booking(),departure()).status,"ROUTE_CHECKPOINT_NOT_FOUND");
}));
test("prior two files cannot authorize payout after lost final fsync ACK",()=>withFixture(f=>{
 two(f);
 const io={...fs,fsyncSync(){throw Error("ACK_LOST")}};
 assert.equal(f.witness(io).verify(booking(),departure()).status,
  "ROUTE_CHECKPOINT_FSYNC_UNCERTAIN");
}));
test("hardlinked route checkpoint is never payable",()=>withFixture(f=>{
 const w=two(f);
 const first=path.join(f.root,"escort-route-witness",key+".stage-1.json");
 fs.linkSync(first,first+".extra");
 assert.equal(w.verify(booking(),departure()).status,"ROUTE_NONREGULAR_OR_LINKED_JOURNAL");
}));
test("symlinked route checkpoint cannot verify or produce a second paid sample",t=>withFixture(f=>{
 const w=f.witness();
 assert.equal(w.sample(f.input()).status,"NATIVE_ROUTE_CHECKPOINT_DURABLY_RECORDED");
 const first=path.join(f.root,"escort-route-witness",key+".stage-1.json");
 const backup=first+".backup";
 fs.renameSync(first,backup);
 try{fs.symlinkSync(backup,first)}catch(error){
  if(error?.code==="EPERM"||error?.code==="EACCES"){t.skip("Symlink requires Windows Developer Mode/admin");return}
  throw error;
 }
 assert.equal(w.verify(booking(),departure()).status,
  "ROUTE_NONREGULAR_OR_LINKED_JOURNAL");
 f.move(70000);f.later(1000);
 assert.equal(w.sample(f.input()).status,
  "ROUTE_NONREGULAR_OR_LINKED_JOURNAL");
}));
test("optional Stage I is truly OFF by default and does not write route samples",()=>withFixture(f=>{
 process.env[FLAG]="0";
 try{assert.equal(f.witness().sample(f.input()).status,"DISABLED");
  assert.equal(fs.existsSync(path.join(f.root,"escort-route-witness")),false)}
 finally{process.env[FLAG]="1"}
}));
process.on("exit",()=>{if(old===undefined)delete process.env[FLAG];
 else process.env[FLAG]=old});
