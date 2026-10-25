import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const require=createRequire(import.meta.url);
const {verify,note}=require("../integration/coopNativeLootPickupEvidence.cjs");
const systemID=30000144,characterID=51001,shipID=77001,wreckID=91001;
function setup(){
 const wreck={wreckID,systemID,sourceEntityID:12001};
 const nativeWreck={itemID:wreckID,nativeNpcWreck:true,launcherID:12001};
 const ship={itemID:shipID,kind:"ship",pilotCharacterID:characterID};
 const entities=new Map([[wreckID,nativeWreck],[shipID,ship]]);
 const session={characterID,clientID:44001,socket:{destroyed:false},
  _space:{systemID,shipID,initialStateSent:true}};
 const scene={systemID,sessions:new Map([[1,session]]),
  getEntityByID:id=>entities.get(Number(id))||null};
 const sourceBefore={wreckID,wreckItemID:82001,typeID:34,quantity:6};
 const args={scene,wreck,characterID,wreckItemID:82001,
  destinationLocationID:shipID,sourceBefore,sourceAfter:null,
  availableQuantity:6,requestedQuantity:6,
  grantResult:{success:true,data:{quantity:6,
   changes:[{item:{itemID:99001,ownerID:characterID,locationID:shipID,
    typeID:34,quantity:6}}]}}};
 return {args,scene,session,ship,entities};
}
test("authenticated, connected, native Ballpark-ready looter remains admitted",()=>{
 const f=setup();
 assert.equal(verify(f.args).status,"VERIFIED_NATIVE_LOOT_PICKUP");
 assert.equal(verify(f.args).shipID,shipID);
});
test("stale socket and uninitialized Ballpark cannot impersonate a real looter",()=>{
 const offline=setup();offline.session.socket.destroyed=true;
 assert.equal(verify(offline.args).status,"NO_UNIQUE_AUTHENTICATED_SPACE_LOOTER");
 const pending=setup();pending.session._space.initialStateSent=false;
 assert.equal(verify(pending.args).status,"NO_UNIQUE_AUTHENTICATED_SPACE_LOOTER");
 const uninitialized=setup();delete uninitialized.session._space.initialStateSent;
 assert.equal(verify(uninitialized.args).status,"NO_UNIQUE_AUTHENTICATED_SPACE_LOOTER");
});
test("real native item grant cannot borrow a disconnected ghost from scene membership",()=>{
 const f=setup();f.session.socket.destroyed=true;
 const r=verify(f.args);
 assert.equal(r.status,"NO_UNIQUE_AUTHENTICATED_SPACE_LOOTER");
 assert.notEqual(r.status,"VERIFIED_NATIVE_LOOT_PICKUP");
});
test("player ship identity must remain physically authoritative",()=>{
 const removed=setup();removed.entities.delete(shipID);
 assert.equal(verify(removed.args).status,"NO_UNIQUE_AUTHENTICATED_SPACE_LOOTER");
 const spoofed=setup();spoofed.ship.pilotCharacterID=99999;
 assert.equal(verify(spoofed.args).status,"NO_UNIQUE_AUTHENTICATED_SPACE_LOOTER");
 const replaced=setup();replaced.entities.set(shipID,{itemID:shipID+1,kind:"ship"});
 assert.equal(verify(replaced.args).status,"NO_UNIQUE_AUTHENTICATED_SPACE_LOOTER");
 const wrongSystem=setup();wrongSystem.session._space.systemID=30000142;
 assert.equal(verify(wrongSystem.args).status,"NO_UNIQUE_AUTHENTICATED_SPACE_LOOTER");
});
test("duplicate live character sessions cannot be treated as a unique native pickup",()=>{
 const f=setup();
 f.scene.sessions.set(2,{...f.session});
 assert.equal(verify(f.args).status,"NO_UNIQUE_AUTHENTICATED_SPACE_LOOTER");
});
test("source debit failure wins over disconnect so quarantine can still activate",()=>{
 const f=setup();
 f.session.socket.destroyed=true;
 f.args.sourceAfter={...f.args.sourceBefore};
 assert.equal(verify(f.args).status,"NATIVE_LOOT_SOURCE_NOT_REMOVED");
});
test("successful in-game transfer without durable evidence cannot be labeled recorded",()=>{
 const f=setup();
 const beforeFeature=process.env.EVEJS_COOP_NATIVE_LOOT_EVIDENCE;
 const beforeDestination=process.env.EVEJS_COOP_EVENTS_FILE;
 try{
  process.env.EVEJS_COOP_NATIVE_LOOT_EVIDENCE="1";
  delete process.env.EVEJS_COOP_EVENTS_FILE;
  const result=note(f.args);
  assert.equal(result.status,"TELEMETRY_NOT_RECORDED");
  assert.equal(result.nativeTransferVerified,true);
  assert.equal(result.wreckID,wreckID);
 }finally{
  if(beforeFeature===undefined)delete process.env.EVEJS_COOP_NATIVE_LOOT_EVIDENCE;
  else process.env.EVEJS_COOP_NATIVE_LOOT_EVIDENCE=beforeFeature;
  if(beforeDestination===undefined)delete process.env.EVEJS_COOP_EVENTS_FILE;
  else process.env.EVEJS_COOP_EVENTS_FILE=beforeDestination;
 }
});
test("recorded native pickup must have a physically written append-only event",()=>{
 const f=setup(),dir=fs.mkdtempSync(path.join(os.tmpdir(),"evejs-native-loot-test-"));
 const destination=path.join(dir,"coop-events.jsonl");
 const oldFeature=process.env.EVEJS_COOP_NATIVE_LOOT_EVIDENCE;
 const oldDestination=process.env.EVEJS_COOP_EVENTS_FILE;
 try{
  process.env.EVEJS_COOP_NATIVE_LOOT_EVIDENCE="1";
  process.env.EVEJS_COOP_EVENTS_FILE=destination;
  const receipt=note(f.args);
  assert.equal(receipt.status,"VERIFIED_NATIVE_LOOT_PICKUP");
  const events=fs.readFileSync(destination,"utf8").trim().split("\n");
  assert.equal(events.length,1);
  const event=JSON.parse(events[0]);
  assert.equal(event.event,"living-native-loot-pickup");
  assert.equal(event.status,"VERIFIED_NATIVE_LOOT_PICKUP");
  assert.equal(event.characterID,characterID);
  assert.equal(event.wreckID,wreckID);
 }finally{
  if(oldFeature===undefined)delete process.env.EVEJS_COOP_NATIVE_LOOT_EVIDENCE;
  else process.env.EVEJS_COOP_NATIVE_LOOT_EVIDENCE=oldFeature;
  if(oldDestination===undefined)delete process.env.EVEJS_COOP_EVENTS_FILE;
  else process.env.EVEJS_COOP_EVENTS_FILE=oldDestination;
  fs.rmSync(dir,{recursive:true,force:true});
 }
});
