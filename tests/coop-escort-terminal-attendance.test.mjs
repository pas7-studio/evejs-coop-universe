import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createEscortTerminalAttendance}=require("../integration/coopEscortTerminalAttendance.cjs");
const FLAGS=["EVEJS_COOP_ESCORT_PEACEFUL_REPLAY","EVEJS_COOP_ESCORT_ROUTE_WITNESS"];
const saved=Object.fromEntries(FLAGS.map(x=>[x,process.env[x]]));
for(const x of FLAGS)process.env[x]="1";
const key="30000144-77-123",contract="escort-30000144-77-123";
const booking=()=>({manifestKey:key,contractID:contract,systemID:30000144,fleetID:77,
 haulerID:901,stationID:6001001,corporationID:1000001,amountISK:600000,
 playerFleetID:44,characters:[701,702]});
const departure=()=>({status:"VERIFIED_NATIVE_ESCORT_DEPARTURE",manifestKey:key,
 contractID:contract,at:1000000,characters:[701,702],shipIDs:[1701,1702],
 origin:{x:0,y:0,z:0}});
const route=()=>({status:"VERIFIED_NATIVE_ESCORT_ROUTE_SERVICE",
 manifestKey:key,contractID:contract,characters:[701,702],
 firstAt:1001000,secondAt:1002000});
const stock=()=>({status:"FULL_NATIVE_CARGO_DELIVERY_VERIFIED",
 key,stationID:6001001,haulerIDs:[901],cargoIDs:[5501,5502]});
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"coop-escort-terminal-"));
 const station={itemID:6001001,kind:"station",position:{x:100000,y:0,z:0}};
 const hauler={itemID:901,kind:"ship",nativeNpc:true,position:{x:100750,y:0,z:0}};
 const ships=new Map([
  [901,hauler],
  [1701,{itemID:1701,kind:"ship",nativeNpc:false,position:{x:100760,y:2,z:0}}],
  [1702,{itemID:1702,kind:"ship",nativeNpc:false,position:{x:100740,y:-2,z:0}}]
 ]);
 const sessions=new Map([[1,{characterID:701,socket:{destroyed:false},
  _space:{initialStateSent:true,systemID:30000144,shipID:1701}}],
  [2,{characterID:702,socket:{destroyed:false},
  _space:{initialStateSent:true,systemID:30000144,shipID:1702}}]]);
 const scene={systemID:30000144,staticEntities:[station],sessions,
  getEntityByID:id=>ships.get(id)};
 let duoValid=true;
 const verifyNativeDuo=()=>duoValid?{status:"VERIFIED_NATIVE_DUO_FLEET",
  fleetID:44,characters:[701,702]}:{status:"NO_NATIVE_DUO"};
 const loc=path.join(root,"escort-terminal-attendance",key+".json");
 const args=()=>({booking:booking(),departure:departure(),route:route(),
  stock:stock(),scene,verifyNativeDuo});
 const make=(io=fs)=>createEscortTerminalAttendance({root,io,clock:()=>1003000});
 return {root,make,scene,sessions,ships,station,loc,args,
  setDuo:v=>{duoValid=v},close:()=>fs.rmSync(root,{recursive:true,force:true})};
}
function withFixture(fn){const f=fixture();try{fn(f)}finally{f.close()}}
test("original two pilots at real native terminal create one durable immutable receipt",()=>withFixture(f=>{
 const result=f.make().record(f.args());
 assert.equal(result.status,"VERIFIED_NATIVE_ESCORT_TERMINAL_ATTENDANCE");
 assert.deepEqual(result.shipIDs,[1701,1702]);
 assert.equal(f.make().readDurable(booking(),departure(),route(),stock()).status,
  "VERIFIED_NATIVE_ESCORT_TERMINAL_ATTENDANCE");
 assert.equal(fs.readdirSync(path.dirname(f.loc)).length,1);
}));
test("offline player sessions after real terminal event do not erase original proof",()=>withFixture(f=>{
 f.make().record(f.args());f.sessions.clear();
 assert.equal(f.make().readDurable(booking(),departure(),route(),stock()).status,
  "VERIFIED_NATIVE_ESCORT_TERMINAL_ATTENDANCE");
}));
test("repeated terminal call does not mint or overwrite signed attendance",()=>withFixture(f=>{
 f.make().record(f.args());
 const a=fs.readFileSync(f.loc,"utf8");
 assert.equal(f.make().record(f.args()).status,"VERIFIED_NATIVE_ESCORT_TERMINAL_ATTENDANCE");
 assert.equal(fs.readFileSync(f.loc,"utf8"),a);
}));
test("terminal witness requires both ORIGINAL source player ships, not replacements",()=>withFixture(f=>{
 f.sessions.get(2)._space.shipID=9999;
 assert.equal(f.make().record(f.args()).status,
  "TERMINAL_NATIVE_PILOT_SESSION_NOT_UNIQUE");
 assert.equal(fs.existsSync(f.loc),false);
}));
test("missing actual second pilot cannot record an entitlement",()=>withFixture(f=>{
 f.sessions.delete(2);
 assert.equal(f.make().record(f.args()).status,
  "TERMINAL_NATIVE_PILOT_SESSION_NOT_UNIQUE");
 assert.equal(fs.existsSync(f.loc),false);
}));
test("same player logged into two native sessions cannot claim extra service",()=>withFixture(f=>{
 f.sessions.set(3,{...f.sessions.get(1)});
 assert.equal(f.make().record(f.args()).status,
  "TERMINAL_NATIVE_PILOT_SESSION_NOT_UNIQUE");
}));
test("afk pilot 200km from original terminal cannot qualify",()=>withFixture(f=>{
 f.ships.get(1702).position.x=300000;
 assert.equal(f.make().record(f.args()).status,
  "TERMINAL_NATIVE_PILOT_NOT_AT_DESTINATION");
}));
test("original NPC must physically be within canonical native station",()=>withFixture(f=>{
 f.ships.get(901).position.x=400000;
 assert.equal(f.make().record(f.args()).status,
  "TERMINAL_NATIVE_STATION_OR_HAULER_UNVERIFIED");
}));
test("unverified native duo never creates a payable terminal receipt",()=>withFixture(f=>{
 f.setDuo(false);
 assert.equal(f.make().record(f.args()).status,"TERMINAL_NATIVE_DUO_UNVERIFIED");
 assert.equal(fs.existsSync(f.loc),false);
}));
test("missing original midroute or source evidence cannot create terminal proof",()=>withFixture(f=>{
 const args=f.args();args.route.status="ROUTE_CHECKPOINT_NOT_FOUND";
 assert.equal(f.make().record(args).status,"TERMINAL_ORIGINAL_PROOF_INVALID");
 const next=f.args();next.departure.characters=[701,703];
 assert.equal(f.make().record(next).status,"TERMINAL_ORIGINAL_PROOF_INVALID");
}));
test("warehouse manifest cargo tamper rejects existing durable terminal evidence",()=>withFixture(f=>{
 f.make().record(f.args());const different=stock();different.cargoIDs=[5501,9999];
 assert.equal(f.make().readDurable(booking(),departure(),route(),different).status,
  "TERMINAL_ATTENDANCE_SOURCE_MISMATCH");
}));
test("changing original character pair or source ship fails replay proof",()=>withFixture(f=>{
 f.make().record(f.args());const modified=departure();modified.shipIDs[1]=9999;
 assert.equal(f.make().readDurable(booking(),modified,route(),stock()).status,
  "TERMINAL_ATTENDANCE_SOURCE_MISMATCH");
}));
test("unknown file/dir fsync outcome blocks original receipt payment authority",()=>withFixture(f=>{
 f.make().record(f.args());
 const io={...fs,fsyncSync(){throw Error("ACK_LOST")}};
 assert.equal(f.make(io).readDurable(booking(),departure(),route(),stock()).status,
  "TERMINAL_ATTENDANCE_FSYNC_UNCERTAIN");
}));
test("corrupt receipt cannot be silently replaced with a new signature",()=>withFixture(f=>{
 f.make().record(f.args());fs.writeFileSync(f.loc,"{broken\n");
 assert.equal(f.make().record(f.args()).status,"TERMINAL_ATTENDANCE_CORRUPT");
}));
test("hardlinked original receipt cannot become payout authority",()=>withFixture(f=>{
 f.make().record(f.args());fs.linkSync(f.loc,f.loc+".copy");
 assert.equal(f.make().readDurable(booking(),departure(),route(),stock()).status,
  "TERMINAL_ATTENDANCE_NONREGULAR_OR_LINKED");
}));
test("feature flag OFF does not create signed terminal entitlement",()=>withFixture(f=>{
 process.env.EVEJS_COOP_ESCORT_PEACEFUL_REPLAY="0";
 try{assert.equal(f.make().record(f.args()).status,"DISABLED");
  assert.equal(fs.existsSync(f.loc),false)}
 finally{process.env.EVEJS_COOP_ESCORT_PEACEFUL_REPLAY="1"}
}));
process.on("exit",()=>{for(const [k,v] of Object.entries(saved))
 if(v===undefined)delete process.env[k];else process.env[k]=v});
