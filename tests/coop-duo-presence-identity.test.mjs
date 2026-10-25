import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {snapshot}=require("../integration/coopDuoPresence.cjs");

function fixture(){
 const a={characterID:1001,_space:{
  shipID:501,systemID:30000144,initialStateSent:true,
  visibleDynamicEntityIDs:new Set([502])
 },socket:{destroyed:false}};
 const b={characterID:1002,_space:{
  shipID:502,systemID:30000144,initialStateSent:true,
  visibleDynamicEntityIDs:new Set([501])
 },socket:{destroyed:false}};
 const ships=new Map([
  [501,{kind:"ship",itemID:501,pilotCharacterID:1001}],
  [502,{kind:"ship",itemID:502,pilotCharacterID:1002}]
 ]);
 const scene={systemID:30000144,
  sessions:new Map([[1001,a],[1002,b]]),
  getEntityByID:id=>ships.get(id)||null};
 return {a,b,ships,scene};
}

test("distinct native ships provide mutual visibility",()=>{
 const f=fixture(),state=snapshot(f.scene);
 assert.equal(state.status,"TWO_PILOTS_IN_SCENE");
 assert.equal(state.mutualVisibility,true);
});

test("different characters claiming one native hull cannot count as two pilots",()=>{
 const f=fixture();
 f.b._space.shipID=501;
 f.a._space.visibleDynamicEntityIDs.add(501);
 f.b._space.visibleDynamicEntityIDs.add(501);
 const state=snapshot(f.scene);
 assert.equal(state.status,"DUPLICATE_ACTIVE_SHIP_OWNER");
 assert.equal(state.mutualVisibility,false);
 assert.deepEqual(state.pilots,[]);
});

test("physical ship with explicitly conflicting pilot identity is not valid",()=>{
 const f=fixture();
 f.ships.get(502).pilotCharacterID=1001;
 const state=snapshot(f.scene);
 assert.equal(state.status,"NOT_READY");
 assert.equal(state.mutualVisibility,false);
});

test("disconnected stale session does not block actual two pilots",()=>{
 const f=fixture();
 f.scene.sessions.set(9001,{...f.a,socket:{destroyed:true}});
 assert.equal(snapshot(f.scene).mutualVisibility,true);
});

test("duplicate ready character is rejected instead of silently merged",()=>{
 const f=fixture();
 f.scene.sessions.set(9001,{...f.a});
 assert.equal(snapshot(f.scene).status,"DUPLICATE_ACTIVE_CHARACTER_SESSION");
});

test("third active character sharing a physical hull invalidates visibility",()=>{
 const f=fixture();
 f.scene.sessions.set(9001,{characterID:1003,
  _space:{shipID:501,systemID:30000144,initialStateSent:true},
  socket:{destroyed:false}});
 assert.equal(snapshot(f.scene).status,"DUPLICATE_ACTIVE_SHIP_OWNER");
});

test("cross-system active duplicate hull in the authoritative scene is rejected",()=>{
 const f=fixture();
 f.scene.sessions.set(9001,{characterID:1003,
  _space:{shipID:501,systemID:30000142,initialStateSent:true},
  socket:{destroyed:false}});
 assert.equal(snapshot(f.scene).status,"DUPLICATE_ACTIVE_SHIP_OWNER");
});

test("cross-system active duplicate character in the scene is rejected",()=>{
 const f=fixture();
 f.scene.sessions.set(9001,{characterID:1001,
  _space:{shipID:9001,systemID:30000142,initialStateSent:true},
  socket:{destroyed:false}});
 assert.equal(snapshot(f.scene).status,"DUPLICATE_ACTIVE_CHARACTER_SESSION");
});

test("not-yet-ready historical ship owner does not block valid pilots",()=>{
 const f=fixture();
 f.scene.sessions.set(9001,{characterID:1003,
  _space:{shipID:501,systemID:30000144,initialStateSent:false},
  socket:{destroyed:false}});
 assert.equal(snapshot(f.scene).mutualVisibility,true);
});

test("unowned stock hulls remain valid, fake static entity does not",()=>{
 const f=fixture();
 delete f.ships.get(501).pilotCharacterID;
 delete f.ships.get(502).pilotCharacterID;
 assert.equal(snapshot(f.scene).mutualVisibility,true);
 f.ships.set(502,{kind:"asteroidBelt",itemID:502});
 assert.equal(snapshot(f.scene).mutualVisibility,false);
});
