import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createNotices}=require("../integration/coopPartyNotices.cjs");
const systemID=30000144;
function fixture(){
 let now=1000000;
 const shipA={itemID:1001,kind:"ship",position:{x:0,y:0,z:0}};
 const shipB={itemID:1002,kind:"ship",position:{x:45000,y:0,z:0}};
 const a={characterID:501,_space:{systemID,shipID:1001,initialStateSent:true},
  socket:{destroyed:false}};
 const b={characterID:502,_space:{systemID,shipID:1002,initialStateSent:true},
  socket:{destroyed:false}};
 const ships=new Map([[1001,shipA],[1002,shipB]]);
 const scene={systemID,sessions:new Map([[501,a],[502,b]]),
  getEntityByID:id=>ships.get(id)||null};
 const party={separation:45000,pilots:[
  {characterID:501,shipID:1001,session:a,ship:shipA},
  {characterID:502,shipID:1002,session:b,ship:shipB}
 ]};
 const messages=[];
 const service=createNotices({clock:()=>now,
  send:(session,text)=>messages.push({characterID:session.characterID,text})});
 return {service,scene,party,messages,ships,a,b,advance:ms=>{now+=ms}};
}
test("two physically real ready pilots each get exactly one in-game rendezvous notice",()=>{
 const f=fixture();
 const result=f.service.rendezvous({scene:f.scene,party:f.party,systemID});
 assert.equal(result.status,"SENT");
 assert.deepEqual(f.messages.map(x=>x.characterID),[501,502]);
 assert.match(f.messages[0].text,/45 km apart/);
 assert.match(f.messages[0].text,/Perimeter belts/);
 assert.equal(f.service.rendezvous({scene:f.scene,party:f.party,systemID}).status,"COOLDOWN");
 assert.equal(f.messages.length,2);
});
test("same duo may receive a new notice only after bounded cooldown",()=>{
 const f=fixture();
 f.service.rendezvous({scene:f.scene,party:f.party,systemID});
 f.advance(300000);
 assert.equal(f.service.rendezvous({scene:f.scene,party:f.party,systemID}).status,"SENT");
 assert.equal(f.messages.length,4);
});
test("no ghost notifications for stale scene ship, foreign session, wrong system or one pilot",()=>{
 const f=fixture();
 assert.equal(f.service.rendezvous({scene:f.scene,party:{...f.party,pilots:[f.party.pilots[0]]},systemID}).status,
  "NOT_TWO_READY_NATIVE_PILOTS");
 assert.equal(f.service.rendezvous({scene:f.scene,party:f.party,systemID:30000142}).status,
  "NOT_TWO_READY_NATIVE_PILOTS");
 f.ships.set(1002,{...f.party.pilots[1].ship});
 assert.equal(f.service.rendezvous({scene:f.scene,party:f.party,systemID}).status,
  "NOT_NATIVE_SCENE_MEMBERS");
 f.ships.set(1002,f.party.pilots[1].ship);
 f.scene.sessions.set(502,{...f.b});
 assert.equal(f.service.rendezvous({scene:f.scene,party:f.party,systemID}).status,
  "NOT_NATIVE_SCENE_MEMBERS");
 assert.equal(f.messages.length,0);
});
test("disconnected users and invalid distance cannot cause a made-up two-player greeting",()=>{
 const f=fixture();
 f.party.separation=250001;
 assert.equal(f.service.rendezvous({scene:f.scene,party:f.party,systemID}).status,
  "NOT_TWO_READY_NATIVE_PILOTS");
 f.party.separation=45000;
 f.a.socket.destroyed=true;f.b.socket.destroyed=true;
 assert.equal(f.service.rendezvous({scene:f.scene,party:f.party,systemID}).sent,0);
 assert.equal(f.messages.length,0);
});

test("P0 fleet brief shows a genuine visible native NPC entity to BOTH real pilots",()=>{
 const f=fixture();
 const npc={itemID:911,kind:"ship",nativeNpc:true,position:{x:65000,y:0,z:0}};
 f.ships.set(911,npc);
 f.scene.dynamicEntities=new Map([[911,npc]]);
 const r=f.service.brief({scene:f.scene,party:f.party,systemID,fleetID:44});
 assert.equal(r.status,"FLEET_BRIEF_DELIVERED");
 assert.equal(r.targetEntityID,911);
 assert.deepEqual(f.messages.map(x=>x.characterID),[501,502]);
 assert.match(f.messages[0].text,/NPC-корабель #911/);
 assert.match(f.messages[0].text,/native Approach \/ Lock \/ Warp Fleet/);
 assert.equal(f.service.brief({scene:f.scene,party:f.party,systemID,fleetID:44}).status,"COOLDOWN");
 f.advance(120000);
 assert.equal(f.service.brief({scene:f.scene,party:f.party,systemID,fleetID:44}).sent,2);
});
test("P0 fleet brief never fabricates a target or trusts a clone of native ship",()=>{
 const f=fixture();const npc={itemID:911,kind:"ship",nativeNpc:true,position:{x:65000,y:0,z:0}};
 f.scene.dynamicEntities=new Map([[911,npc]]);
 assert.equal(f.service.brief({scene:f.scene,party:f.party,systemID,fleetID:44}).status,
  "NO_ACTIONABLE_NATIVE_SHIP");
 f.ships.set(911,{...npc});
 assert.equal(f.service.brief({scene:f.scene,party:f.party,systemID,fleetID:44}).status,
  "NO_ACTIONABLE_NATIVE_SHIP");
 f.ships.set(911,npc);
 npc.nativeNpc=false;
 assert.equal(f.service.brief({scene:f.scene,party:f.party,systemID,fleetID:44}).status,
  "NO_ACTIONABLE_NATIVE_SHIP");
 npc.nativeNpc=true;
 npc.position.x=500000;
 assert.equal(f.service.brief({scene:f.scene,party:f.party,systemID,fleetID:44}).status,
  "NO_ACTIONABLE_NATIVE_SHIP");
 assert.equal(f.messages.length,0);
});
test("P0 fleet brief denies unauthenticated, disconnected or foreign party",()=>{
 const f=fixture();const npc={itemID:911,kind:"ship",nativeNpc:true,position:{x:65000,y:0,z:0}};
 f.scene.dynamicEntities=new Map([[911,npc]]);f.ships.set(911,npc);
 assert.equal(f.service.brief({scene:f.scene,party:f.party,systemID,fleetID:0}).status,
  "NO_VERIFIED_NATIVE_FLEET_BRIEF");
 assert.equal(f.service.brief({scene:f.scene,party:f.party,systemID:30000142,fleetID:44}).status,
  "NO_VERIFIED_NATIVE_FLEET_BRIEF");
 f.a.socket.destroyed=true;
 assert.equal(f.service.brief({scene:f.scene,party:f.party,systemID,fleetID:44}).status,
  "STALE_NATIVE_FLEET_MEMBERS");
 f.a.socket.destroyed=false;
 f.scene.sessions.set(501,{...f.a});
 assert.equal(f.service.brief({scene:f.scene,party:f.party,systemID,fleetID:44}).status,
  "STALE_NATIVE_FLEET_MEMBERS");
 assert.equal(f.messages.length,0);
});

test("P0 cooldown is fleet-wide even when a different native NPC appears",()=>{
 const f=fixture();
 const first={itemID:911,kind:"ship",nativeNpc:true,position:{x:65000,y:0,z:0}};
 const second={itemID:912,kind:"ship",nativeNpc:true,position:{x:50000,y:0,z:0}};
 f.scene.dynamicEntities=new Map([[911,first]]);
 f.ships.set(911,first);f.ships.set(912,second);
 const args={scene:f.scene,party:f.party,systemID,fleetID:44};
 assert.equal(f.service.brief(args).status,"FLEET_BRIEF_DELIVERED");
 f.scene.dynamicEntities=new Map([[912,second]]);
 assert.equal(f.service.brief(args).status,"COOLDOWN");
 assert.equal(f.messages.length,2);
 f.advance(120000);
 const next=f.service.brief(args);
 assert.equal(next.status,"FLEET_BRIEF_DELIVERED");
 assert.equal(next.targetEntityID,912);
 assert.equal(f.messages.length,4);
});
