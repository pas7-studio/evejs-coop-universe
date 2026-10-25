import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createTracker}=require("../integration/coopFleetWarpArrival.cjs");
function fixture(){
 let now=1000000,callback=null;
 const leader={itemID:101,kind:"ship",mode:"WARP",
  position:{x:0,y:0,z:0}};
 const wingman={itemID:102,kind:"ship",mode:"WARP",
  position:{x:0,y:5000,z:0}};
 const a={characterID:1001,_space:{shipID:101,systemID:30000144,initialStateSent:true},
  socket:{destroyed:false}};
 const b={characterID:1002,_space:{shipID:102,systemID:30000144,initialStateSent:true},
  socket:{destroyed:false}};
 const ships=new Map([[101,leader],[102,wingman]]);
 const scene={systemID:30000144,sessions:new Map([[1001,a],[1002,b]]),
  getEntityByID:id=>ships.get(id)||null,
  getShipEntityForSession:s=>ships.get(s._space.shipID)||null};
 const runtime={getSceneForSession:s=>scene.sessions.get(s.characterID)===s?scene:null};
 const events=[];
 const tracker=createTracker({clock:()=>now,emit:event=>events.push(event),
  schedule:cb=>{callback=cb;return {unref(){}};},unschedule:()=>{}});
 const result={success:true,data:{targetPoint:{x:900000,y:0,z:0}}};
 const input={commanderSession:a,followerSession:b,
  spaceRuntime:runtime,result,targetEntityID:500};
 return {tracker,leader,wingman,a,b,scene,ships,events,input,
  advance:ms=>{now+=ms;},tick:()=>callback?.()};
}
test("native fleet follower physically warps and lands with commander near the real destination",()=>{
 const f=fixture();
 assert.equal(f.tracker.track(f.input).status,"TRACKING_NATIVE_FLEET_FOLLOWER");
 f.tick();
 assert.equal(f.events.length,0);
 f.advance(20000);
 f.wingman.mode="STOP";f.leader.mode="STOP";
 f.leader.position.x=900200;f.wingman.position.x=900300;
 f.tick();
 assert.equal(f.events[0].status,"NATIVE_FLEET_FOLLOWER_ARRIVAL_VERIFIED");
 assert.equal(f.events[0].arrivalVerified,true);
 assert.equal(f.events[0].followerShipID,102);
 assert.equal(f.tracker.pendingCount(),0);
});
test("accepted order alone is not a physical warp or arrival",()=>{
 const f=fixture();
 f.wingman.mode="STOP";f.leader.mode="STOP";
 f.tracker.track({...f.input,result:{success:true,data:{targetPoint:{x:900000,y:0,z:0}}}});
 f.tick();
 assert.equal(f.events.length,0);
 f.advance(180000);f.tick();
 assert.equal(f.events[0].reason,"NATIVE_ARRIVAL_TIMEOUT");
 assert.equal(f.events[0].arrivalVerified,false);
});
test("ship cannot claim arrival outside destination or far from its wingmate",()=>{
 const f=fixture();
 f.tracker.track(f.input);
 f.advance(20000);
 f.wingman.mode="STOP";f.leader.mode="STOP";
 f.wingman.position.x=900000;f.leader.position.x=20000;
 f.tick();assert.equal(f.events.length,0);
 f.leader.position.x=900000;
 f.tick();assert.equal(f.events[0].arrivalVerified,true);
});
test("reconnect replacing ship/session must cancel arrival without creating duplicates",()=>{
 const f=fixture();f.tracker.track(f.input);
 f.ships.set(102,{...f.wingman});
 f.advance(2000);f.tick();
 assert.equal(f.events[0].reason,"NATIVE_ENTITY_MISSING_OR_REPLACED");
 assert.equal(f.events[0].arrivalVerified,false);
});
test("different solar system, another warp order or client disconnect fail closed",()=>{
 const f=fixture();f.tracker.track(f.input);
 f.b._space.systemID=30000142;
 f.tick();assert.equal(f.events[0].reason,"SESSION_OR_SHIP_CHANGED");
 const g=fixture();g.tracker.track(g.input);
 g.tracker.track(g.input);
 assert.equal(g.events[0].reason,"SUPERSEDED_BY_ANOTHER_WARP");
 g.b.socket.destroyed=true;
 g.tick();assert.equal(g.events[1].arrivalVerified,false);
});
test("no arbitrary movement counts if native warp was never observed",()=>{
 const f=fixture();
 f.wingman.mode="STOP";f.leader.mode="STOP";
 f.tracker.track(f.input);
 f.wingman.position.x=900000;f.leader.position.x=900000;
 f.tick();assert.equal(f.events.length,0);
 f.advance(180000);f.tick();assert.equal(f.events[0].arrivalVerified,false);
});
test("no false landing with unknown physical destination",()=>{
 const f=fixture();f.tracker.track({...f.input,
  targetEntityID:0,result:{success:true,data:{}}});
 f.advance(20000);f.wingman.mode="STOP";f.leader.mode="STOP";
 f.wingman.position.x=900000;f.leader.position.x=900000;
 f.tick();assert.equal(f.events.length,0);
 f.advance(180000);f.tick();assert.equal(f.events[0].reason,"NATIVE_ARRIVAL_TIMEOUT");
});
