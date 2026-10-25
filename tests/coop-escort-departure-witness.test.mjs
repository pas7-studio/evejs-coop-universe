import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createDepartureWitness}=require("../integration/coopEscortDepartureWitness.cjs");
const FLAG="EVEJS_COOP_ESCORT_DEPARTURE_WITNESS";
const PREVIOUS=process.env[FLAG];
process.env[FLAG]="1";
const manifestKey="30000144-77-123",now=100000;
const booking=()=>({
 manifestKey,contractID:"escort-30000144-77-123",
 systemID:30000144,fleetID:77,haulerID:901,stationID:60000001,
 corporationID:1000152,playerFleetID:44,amountISK:600000,
 characters:[701,702]
});
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"coop-escort-departure-"));
 const p=(x,y=0,z=0)=>({x,y,z});
 const entities=new Map([
  [901,{kind:"ship",nativeNpc:true,itemID:901,position:p(1000,0,0)}],
  [7001,{kind:"ship",nativeNpc:false,itemID:7001,position:p(2000,0,0)}],
  [7002,{kind:"ship",nativeNpc:false,itemID:7002,position:p(2500,0,0)}]
 ]);
 const sessions=new Map([
  [1,{characterID:701,socket:{destroyed:false},_space:{initialStateSent:true,systemID:30000144,shipID:7001}}],
  [2,{characterID:702,socket:{destroyed:false},_space:{initialStateSent:true,systemID:30000144,shipID:7002}}]
 ]);
 const scene={systemID:30000144,sessions,getEntityByID:id=>entities.get(id)};
 const verifier=()=>({status:"VERIFIED_NATIVE_DUO_FLEET",fleetID:44,characters:[701,702]});
 const create=()=>createDepartureWitness({root,clock:()=>now});
 return {root,scene,entities,sessions,create,verifier,close:()=>fs.rmSync(root,{recursive:true,force:true})};
}
function use(fn){const f=fixture();try{fn(f)}finally{f.close()}}
test("two genuine on-grid native player pilots create durable departure witness",()=>use(f=>{
 const r=f.create().record(booking(),f.scene,f.verifier);
 assert.equal(r.status,"DURABLE_NATIVE_ESCORT_DEPARTURE_WITNESS");
 const p=f.create().read(manifestKey,booking());
 assert.equal(p.status,"VERIFIED_NATIVE_ESCORT_DEPARTURE");
 assert.deepEqual(p.shipIDs,[7001,7002]);
 assert.deepEqual(p.characters,[701,702]);
}));
test("restart re-read is idempotent; cannot create a second predeparture event",()=>use(f=>{
 assert.equal(f.create().record(booking(),f.scene,f.verifier).status,
  "DURABLE_NATIVE_ESCORT_DEPARTURE_WITNESS");
 assert.equal(f.create().record(booking(),f.scene,()=>{throw Error("must not reverify on replay")}).status,
  "DURABLE_ESCORT_DEPARTURE_REPLAY");
}));
test("station camping is denied: first player outside 150km from real hauler",()=>use(f=>{
 f.entities.get(7001).position={x:300001,y:0,z:0};
 assert.equal(f.create().record(booking(),f.scene,f.verifier).status,
  "DEPARTURE_PLAYER_NOT_ON_CONVOY_GRID");
 assert.equal(f.create().read(manifestKey,booking()).status,"DEPARTURE_NOT_RECORDED");
}));
test("different native player ships and real fleet are mandatory",()=>use(f=>{
 f.sessions.get(2)._space.shipID=7001;
 assert.equal(f.create().record(booking(),f.scene,f.verifier).status,
  "DEPARTURE_DUPLICATE_PLAYER_SHIP");
}));
test("second session of same pilot causes denial, not two signatures",()=>use(f=>{
 f.sessions.set(3,{...f.sessions.get(1)});
 assert.equal(f.create().record(booking(),f.scene,f.verifier).status,
  "DEPARTURE_ACTIVE_PILOT_NOT_UNIQUE");
}));
test("absent authenticated native fleet denies even if two ships are on grid",()=>use(f=>{
 const r=f.create().record(booking(),f.scene,()=>({status:"NOT_NATIVE_FLEET"}));
 assert.equal(r.status,"DEPARTURE_NATIVE_FLEET_NOT_VERIFIED");
}));
test("source NPC ship spoofing or absence is rejected",()=>use(f=>{
 f.entities.get(901).nativeNpc=false;
 assert.equal(f.create().record(booking(),f.scene,f.verifier).status,
  "DEPARTURE_HAULER_NOT_PRESENT");
}));
test("invalid route IDs fail before any filesystem writes",()=>use(f=>{
 const b=booking();b.manifestKey="../../manifest";
 assert.equal(f.create().record(b,f.scene,f.verifier).status,"DEPARTURE_IDENTITY_INVALID");
 assert.equal(fs.existsSync(path.join(f.root,"escort-departure-witness")),false);
}));
test("altered paid quote, character list, or original hauler cannot reuse witness",()=>use(f=>{
 const w=f.create();
 assert.equal(w.record(booking(),f.scene,f.verifier).status,"DURABLE_NATIVE_ESCORT_DEPARTURE_WITNESS");
 for(const changed of [{amountISK:620000},{characters:[701,703]},{haulerID:999}]){
  assert.equal(w.read(manifestKey,{...booking(),...changed}).status,
   "DEPARTURE_RECORD_CORRUPT_OR_SOURCE_CHANGED");
 }
}));
test("corrupted journal must remain blocked even after all real pilots reconnect",()=>use(f=>{
 f.create().record(booking(),f.scene,f.verifier);
 const file=path.join(f.root,"escort-departure-witness",manifestKey+".json");
 fs.writeFileSync(file,"{corrupt\n");
 assert.equal(f.create().read(manifestKey,booking()).status,"DEPARTURE_RECORD_CORRUPT");
 assert.equal(f.create().record(booking(),f.scene,f.verifier).status,"DEPARTURE_RECORD_CORRUPT");
}));
test("symlinked witness file never counts as original player escort evidence",()=>use(f=>{
 f.create().record(booking(),f.scene,f.verifier);
 const file=path.join(f.root,"escort-departure-witness",manifestKey+".json");
 const moved=file+".old";fs.renameSync(file,moved);
 fs.symlinkSync(moved,file);
 assert.equal(f.create().read(manifestKey,booking()).status,
  "DEPARTURE_NONREGULAR_OR_LINKED_JOURNAL");
 assert.equal(f.create().record(booking(),f.scene,f.verifier).status,
  "DEPARTURE_NONREGULAR_OR_LINKED_JOURNAL");
}));
test("hardlinked original witness cannot establish native replay",()=>use(f=>{
 f.create().record(booking(),f.scene,f.verifier);
 const file=path.join(f.root,"escort-departure-witness",manifestKey+".json");
 fs.linkSync(file,file+".linked");
 assert.equal(f.create().read(manifestKey,booking()).status,
  "DEPARTURE_NONREGULAR_OR_LINKED_JOURNAL");
}));
test("lost fsync acknowledgement fails closed, never reports witnessed departure",()=>use(f=>{
 const io={...fs,fsyncSync(){throw Error("LOST_ACK")}};
 const w=createDepartureWitness({root:f.root,io,clock:()=>now});
 assert.equal(w.record(booking(),f.scene,f.verifier).status,
  "DEPARTURE_WRITE_UNCERTAIN_NEEDS_REPAIR");
}));
test("existing departure receipt with lost replay fsync ACK cannot authorize another warp",()=>use(f=>{
 assert.equal(f.create().record(booking(),f.scene,f.verifier).status,
  "DURABLE_NATIVE_ESCORT_DEPARTURE_WITNESS");
 const io={...fs,fsyncSync(){throw Error("LOST_REPLAY_ACK")}};
 const replay=createDepartureWitness({root:f.root,io,clock:()=>now});
 assert.equal(replay.record(booking(),f.scene,f.verifier).status,
  "DEPARTURE_REPLAY_FSYNC_UNCERTAIN_NEEDS_REPAIR");
}));
test("financial attendance flag OFF prevents native witness creation",()=>use(f=>{
 process.env[FLAG]="0";
 try{assert.equal(f.create().record(booking(),f.scene,f.verifier).status,"DISABLED")}
 finally{process.env[FLAG]="1"}
}));
process.on("exit",()=>{
 if(PREVIOUS===undefined)delete process.env[FLAG];
 else process.env[FLAG]=PREVIOUS;
});
