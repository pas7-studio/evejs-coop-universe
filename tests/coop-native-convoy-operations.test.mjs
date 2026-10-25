import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createOperations}=require("../integration/coopConvoyOperations.cjs");
const FILE="/tmp/coop-convoy-incidents-test.jsonl";
function env(){
 const files=new Map(),handles=new Map();let fd=1,writeFails=false,now=10000;
 const io={
  readFileSync:p=>{if(!files.has(p)){const e=new Error("ENOENT");e.code="ENOENT";throw e}return files.get(p)},
  mkdirSync(){},
  openSync:(p)=>{if(writeFails)throw Error("EIO");handles.set(++fd,p);return fd},
  writeSync:(n,bytes)=>{if(writeFails)throw Error("EIO");const p=handles.get(n);
   files.set(p,(files.get(p)||"")+bytes.toString());return bytes.length},
  fsyncSync:()=>{if(writeFails)throw Error("EIO")},
  closeSync:n=>handles.delete(n)
 };
 const entities=new Map([
  [900,{kind:"ship",nativeNpc:true,itemID:900,position:{x:0,y:0,z:0}}],
  [901,{kind:"ship",nativeNpc:true,itemID:901,position:{x:1000,y:0,z:0}}],
  [1001,{kind:"ship",itemID:1001,position:{x:5,y:0,z:0}}],
  [1002,{kind:"ship",itemID:1002,position:{x:10,y:0,z:0}}]]);
 const a={characterID:11,socket:{destroyed:false},
  _space:{shipID:1001,systemID:30000144,initialStateSent:true}};
 const b={characterID:22,socket:{destroyed:false},
  _space:{shipID:1002,systemID:30000144,initialStateSent:true}};
 const scene={systemID:30000144,sessions:new Map([[11,a],[22,b]]),
  dynamicEntities:new Map(),
  getEntityByID:id=>entities.get(Number(id))};
 const fleet={fleetID:77,members:new Map([[11,{}],[22,{}]])};
 const fleetRuntime={getFleetForCharacter:id=>fleet.members.has(id)?fleet:null,
  getMemberRecord:(f,id)=>f.members.get(id)||null};
 const raid=(action="attack")=>({pirateID:900,targetID:901,targetRole:"hauler",action});
 const receipt=(characterID=11,victimProof="LIVE_NATIVE_SHIP")=>({
  status:"APPLIED_NATIVE_PLAYER_DAMAGE",source:"NATIVE_KILLMAIL_TRACKER_NOTE_DAMAGE",
  systemID:30000144,characterID,shipID:characterID===11?1001:1002,
  victimEntityID:900,appliedDamage:125,victimProof});
 const make=()=>createOperations({file:FILE,io,clock:()=>now++});
 const lines=()=>files.get(FILE)?.trim().split("\n").filter(Boolean).map(JSON.parse)||[];
 const wreck=()=>{entities.delete(900);const w={kind:"wreck",nativeNpcWreck:true,
  itemID:80001,launcherID:900};entities.set(80001,w);scene.dynamicEntities.set(80001,w)};
 return {make,files,io,scene,fleet,fleetRuntime,raid,receipt,lines,wreck,entities,a,b,
  badDisk:()=>{writeFails=true}};
}
test("real NPC warp is APPROACH only, not a fictional attack, kill, reward or rescue",()=>{
 const f=env(),o=f.make(),r=o.raid({scene:f.scene,action:f.raid("warp-to-hauler")});
 assert.equal(r.status,"NATIVE_CONVOY_INCIDENT_RECORDED");
 assert.equal(o.snapshot().incidents[0].status,"APPROACH");
 assert.equal(f.lines().length,1);
 assert.equal(f.lines()[0].state,"APPROACH");
});
test("the actual native attack advances same stable incident exactly once",()=>{
 const f=env(),o=f.make();o.raid({scene:f.scene,action:f.raid("warp-to-hauler")});
 o.raid({scene:f.scene,action:f.raid()});
 assert.equal(o.raid({scene:f.scene,action:f.raid()}).status,"NATIVE_INCIDENT_ALREADY_RECORDED");
 assert.deepEqual(f.lines().map(x=>x.state),["APPROACH","UNDER_ATTACK"]);
 assert.equal(o.snapshot().incidents.length,1);
});
test("two independently verified native fleet pilots physically hit SAME pirate to qualify as a duo",()=>{
 const f=env(),o=f.make();o.raid({scene:f.scene,action:f.raid()});
 let x=o.damage({scene:f.scene,receipt:f.receipt(11),fleetRuntime:f.fleetRuntime});
 assert.equal(x.status,"NATIVE_CONVOY_INTERVENTION_RECORDED");
 assert.equal(x.duoConfirmed,false);
 x=o.damage({scene:f.scene,receipt:f.receipt(22),fleetRuntime:f.fleetRuntime});
 assert.equal(x.duoConfirmed,true);
 assert.equal(o.snapshot().incidents[0].duoFleetID,77);
 assert.deepEqual(o.snapshot().incidents[0].characters,[11,22]);
 assert.deepEqual(f.lines().map(x=>x.state),["UNDER_ATTACK","PLAYER_HIT","PLAYER_HIT","DUO_INTERVENED"]);
});
test("duplicate applied damage from one player never impersonates a second participant",()=>{
 const f=env(),o=f.make();o.raid({scene:f.scene,action:f.raid()});
 for(let i=0;i<6;i++)o.damage({scene:f.scene,receipt:f.receipt(11),fleetRuntime:f.fleetRuntime});
 assert.equal(o.snapshot().incidents[0].duoFleetID,0);
 assert.equal(f.lines().filter(x=>x.state==="PLAYER_HIT").length,1);
});
test("solo, different fleet, disconnected or duplicate native character cannot count as duo",()=>{
 for(const mutation of [
  f=>f.fleet.members.delete(22),
  f=>f.b.socket.destroyed=true,
  f=>f.scene.sessions.set(33,{...f.b}),
  f=>{f.b._space.systemID=30000142}
 ]){
  const f=env(),o=f.make();o.raid({scene:f.scene,action:f.raid()});mutation(f);
  o.damage({scene:f.scene,receipt:f.receipt(11),fleetRuntime:f.fleetRuntime});
  o.damage({scene:f.scene,receipt:f.receipt(22),fleetRuntime:f.fleetRuntime});
  assert.equal(o.snapshot().incidents[0].duoFleetID,0);
 }
});
test("falsified raid action, player-owned convoy or pirate are rejected before storage",()=>{
 for(const change of [
  f=>f.raid=()=>({pirateID:1001,targetID:901,targetRole:"hauler",action:"attack"}),
  f=>f.entities.get(900).nativeNpc=false,
  f=>f.entities.get(901).nativeNpc=false,
  f=>f.entities.get(901).position={x:NaN,y:0,z:0}
 ]){
  const f=env(),o=f.make();change(f);
  assert.equal(o.raid({scene:f.scene,action:f.raid()}).status,"NO_VERIFIED_NATIVE_CONVOY_RAID");
  assert.equal(f.files.size,0);
 }
});
test("a physically verified pirate native wreck closes the attack; does NOT claim convoy survival",()=>{
 const f=env(),o=f.make();o.raid({scene:f.scene,action:f.raid()});
 o.damage({scene:f.scene,receipt:f.receipt(11),fleetRuntime:f.fleetRuntime});
 f.wreck();
 const r=o.damage({scene:f.scene,receipt:f.receipt(11,"TERMINAL_NATIVE_WRECK"),fleetRuntime:f.fleetRuntime});
 assert.equal(r.pirateWreckConfirmed,true);
 assert.equal(o.snapshot().incidents[0].nativeWreckID,80001);
 assert.equal(o.snapshot().incidents[0].closed,true);
 assert.equal(f.lines().at(-1).state,"PIRATE_WRECK_CONFIRMED");
 assert.equal(o.raid({scene:f.scene,action:f.raid()}).status,"NO_VERIFIED_NATIVE_CONVOY_RAID");
});
test("a made-up terminal kill with no matching physical native wreck must never close incident",()=>{
 const f=env(),o=f.make();o.raid({scene:f.scene,action:f.raid()});
 f.entities.delete(900);
 assert.equal(o.damage({scene:f.scene,receipt:f.receipt(11,"TERMINAL_NATIVE_WRECK"),
  fleetRuntime:f.fleetRuntime}).status,"NATIVE_PIRATE_WRECK_UNVERIFIED");
 assert.equal(o.snapshot().incidents[0].closed,false);
});
test("a player shot does not belong to a raid in another solar system or unrelated pirate",()=>{
 const f=env(),o=f.make();o.raid({scene:f.scene,action:f.raid()});
 const wrong=f.receipt(11);wrong.victimEntityID=901;
 assert.equal(o.damage({scene:f.scene,receipt:wrong,fleetRuntime:f.fleetRuntime}).status,
  "NO_UNIQUE_ACTIVE_CONVOY_INCIDENT");
 const off=f.receipt(11);off.systemID=30000142;
 assert.equal(o.damage({scene:f.scene,receipt:off,fleetRuntime:f.fleetRuntime}).status,
  "NO_VERIFIED_NATIVE_PLAYER_INTERVENTION");
});
test("persistent restart retains incident, distinct contributors and no duplicate duo achievement",()=>{
 const f=env(),o=f.make();o.raid({scene:f.scene,action:f.raid()});
 o.damage({scene:f.scene,receipt:f.receipt(11),fleetRuntime:f.fleetRuntime});
 const fresh=f.make();
 assert.equal(fresh.snapshot().incidents[0].characters[0],11);
 fresh.damage({scene:f.scene,receipt:f.receipt(22),fleetRuntime:f.fleetRuntime});
 const next=f.make();
 assert.equal(next.snapshot().incidents[0].duoFleetID,77);
 next.damage({scene:f.scene,receipt:f.receipt(22),fleetRuntime:f.fleetRuntime});
 assert.equal(f.lines().filter(x=>x.state==="DUO_INTERVENED").length,1);
});
test("journal corruption or ambiguous fsync blocks new incident rather than inventing success",()=>{
 const corrupt=env();corrupt.files.set(FILE,'{"v":1');
 assert.equal(corrupt.make().raid({scene:corrupt.scene,action:corrupt.raid()}).status,
  "CONVOY_JOURNAL_CORRUPT");
 const broken=env(),o=broken.make();broken.badDisk();
 assert.equal(o.raid({scene:broken.scene,action:broken.raid()}).status,
  "CONVOY_JOURNAL_WRITE_UNCERTAIN");
 assert.equal(o.snapshot().status,"CONVOY_JOURNAL_WRITE_UNCERTAIN");
});
test("incident ledger is read-only to native wallets, NPC orders and cargo inventory",()=>{
 const f=env(),o=f.make();
 const before=JSON.stringify([...f.entities]);
 o.raid({scene:f.scene,action:f.raid()});
 o.damage({scene:f.scene,receipt:f.receipt(11),fleetRuntime:f.fleetRuntime});
 assert.equal(JSON.stringify([...f.entities]),before);
 assert.ok(f.lines().every(x=>["UNDER_ATTACK","PLAYER_HIT"].includes(x.state)));
});
