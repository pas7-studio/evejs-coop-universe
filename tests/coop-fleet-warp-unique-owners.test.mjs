import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require = createRequire(import.meta.url);
const {inspect,uniqueOwners} = require("../integration/coopFleetWarpSafety.cjs");
const {createTracker} = require("../integration/coopFleetWarpArrival.cjs");

function fixture(){
 let now=1000000;
 const a={characterID:5001,_space:{systemID:30000144,shipID:10001,initialStateSent:true},
  socket:{destroyed:false}};
 const b={characterID:5002,_space:{systemID:30000144,shipID:10002,initialStateSent:true},
  socket:{destroyed:false}};
 const leader={itemID:10001,kind:"ship",mode:"STOP",position:{x:0,y:0,z:0}};
 const follower={itemID:10002,kind:"ship",mode:"STOP",position:{x:5000,y:0,z:0}};
 const ships=new Map([[10001,leader],[10002,follower]]);
 const scene={systemID:30000144,sessions:new Map([[5001,a],[5002,b]]),
  getEntityByID:id=>ships.get(id)||null,
  getShipEntityForSession:s=>ships.get(s._space.shipID)||null};
 const spaceRuntime={getSceneForSession:s=>
  [...scene.sessions.values()].includes(s)?scene:null};
 const events=[];
 const tracker=createTracker({clock:()=>now,emit:e=>events.push(e),
  schedule:()=>({unref(){}}),unschedule:()=>{}});
 return {a,b,leader,follower,scene,spaceRuntime,events,tracker,
  input:{commanderSession:a,followerSession:b,spaceRuntime},
  warpInput:{commanderSession:a,followerSession:b,spaceRuntime,
   result:{success:true,data:{targetPoint:{x:900000,y:0,z:0}}},targetEntityID:20001},
  advance:ms=>{now+=ms;}};
}

test("unique native owners allow exactly two active independent ships",()=>{
 const f=fixture();
 assert.equal(uniqueOwners(f.scene,f.a,f.b,30000144),true);
 assert.equal(inspect(f.input).ok,true);
});

test("a second Ballpark-ready session of the same commander fails closed",()=>{
 const f=fixture();
 f.scene.sessions.set(9999,{...f.a,_space:{...f.a._space}});
 assert.equal(uniqueOwners(f.scene,f.a,f.b,30000144),false);
 assert.equal(inspect(f.input).reason,"STALE_OR_DUPLICATE_NATIVE_OWNER");
});

test("another character claiming the follower's exact native ship fails closed",()=>{
 const f=fixture();
 f.scene.sessions.set(9999,{characterID:9001,
  _space:{shipID:f.b._space.shipID,systemID:30000144,initialStateSent:true},
  socket:{destroyed:false}});
 assert.equal(inspect(f.input).reason,"STALE_OR_DUPLICATE_NATIVE_OWNER");
});

test("disconnected and not-yet-ready historical sessions are not active owners",()=>{
 const f=fixture();
 const ghost={...f.a,_space:{...f.a._space},socket:{destroyed:true}};
 f.scene.sessions.set(9999,ghost);
 assert.equal(inspect(f.input).ok,true);
 ghost.socket.destroyed=false;
 ghost._space.initialStateSent=false;
 assert.equal(inspect(f.input).ok,true);
});

test("a live wrong-system session retained in the scene cannot share a character or hull",()=>{
 const f=fixture();
 f.scene.sessions.set(9999,{...f.a,
  _space:{...f.a._space,systemID:30000142}});
 assert.equal(inspect(f.input).reason,"STALE_OR_DUPLICATE_NATIVE_OWNER");
});

test("arrival evidence refuses to begin with duplicate active native ownership",()=>{
 const f=fixture();
 f.scene.sessions.set(9999,{...f.b,_space:{...f.b._space}});
 assert.equal(f.tracker.track(f.warpInput).status,"STALE_OR_DUPLICATE_NATIVE_OWNER");
 assert.equal(f.tracker.pendingCount(),0);
});

test("arrival evidence cancels if duplicate native owner appears after accepted warp",()=>{
 const f=fixture();
 f.leader.mode="WARP";
 f.follower.mode="WARP";
 assert.equal(f.tracker.track(f.warpInput).status,"TRACKING_NATIVE_FLEET_FOLLOWER");
 f.scene.sessions.set(9999,{characterID:9001,
  _space:{shipID:10002,systemID:30000144,initialStateSent:true},
  socket:{destroyed:false}});
 f.advance(20000);
 f.leader.mode="STOP";f.follower.mode="STOP";
 f.leader.position.x=900000;f.follower.position.x=900000;
 f.tracker.tick();
 assert.equal(f.events.length,1);
 assert.equal(f.events[0].reason,"STALE_OR_DUPLICATE_NATIVE_OWNER");
 assert.equal(f.events[0].arrivalVerified,false);
 assert.equal(f.tracker.pendingCount(),0);
});

test("single real ship owners still physically complete an observed fleet warp",()=>{
 const f=fixture();
 f.leader.mode="WARP";f.follower.mode="WARP";
 assert.equal(f.tracker.track(f.warpInput).status,"TRACKING_NATIVE_FLEET_FOLLOWER");
 f.advance(20000);
 f.leader.mode="STOP";f.follower.mode="STOP";
 f.leader.position.x=900000;f.follower.position.x=900300;
 f.tracker.tick();
 assert.equal(f.events[0].status,"NATIVE_FLEET_FOLLOWER_ARRIVAL_VERIFIED");
 assert.equal(f.events[0].arrivalVerified,true);
});
