import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {inspect,eligible,recordFollowerWarp}=require("../integration/coopFleetWarpSafety.cjs");
function fixture(){
 const leader={itemID:10001,kind:"ship",position:{x:0,y:0,z:0},mode:"STOP"};
 const wingman={itemID:10002,kind:"ship",position:{x:500,y:0,z:0},mode:"STOP"};
 const commander={characterID:5001,_space:{shipID:10001,systemID:30000142,initialStateSent:true},socket:{destroyed:false}};
 const follower={characterID:5002,_space:{shipID:10002,systemID:30000142,initialStateSent:true},socket:{destroyed:false}};
 const ships=new Map([[10001,leader],[10002,wingman]]);
 const scene={systemID:30000142,sessions:new Map([[5001,commander],[5002,follower]]),
  getEntityByID:id=>ships.get(id)||null,
  getShipEntityForSession:s=>ships.get(s._space.shipID)||null};
 const spaceRuntime={getSceneForSession:s=>
  scene.sessions.get(s.characterID)===s?scene:null};
 const inputs={commanderSession:commander,followerSession:follower,spaceRuntime};
 return {leader,wingman,commander,follower,scene,ships,spaceRuntime,inputs};
}
test("real in-space same-scene two-player ships qualify for native fleet warp",()=>{
 const x=fixture(),v=inspect(x.inputs);
 assert.equal(v.ok,true);assert.equal(v.systemID,30000142);
 assert.equal(v.commanderShipID,10001);assert.equal(v.followerShipID,10002);
});
test("cross-system fleet follower must not be warped even when session says fleet member",()=>{
 const x=fixture();x.follower._space.systemID=30000144;
 assert.equal(inspect(x.inputs).reason,"SYSTEM_MISMATCH");
});
test("disconnected or not-yet-loaded member cannot be moved as a fleet follower",()=>{
 const x=fixture();x.follower.socket.destroyed=true;
 assert.equal(inspect(x.inputs).reason,"DISCONNECTED");
 x.follower.socket.destroyed=false;x.follower._space.initialStateSent=false;
 assert.equal(inspect(x.inputs).reason,"SPACE_NOT_READY");
});
test("stale unrelated session is excluded, preventing a ghost-ship fleet warp",()=>{
 const x=fixture();x.scene.sessions.set(5002,{...x.follower});
 assert.equal(inspect(x.inputs).reason,"NOT_SAME_NATIVE_SCENE");
});
test("native ship entity must be physical, same identity and have finite position",()=>{
 const x=fixture();x.ships.set(10002,{...x.wingman});
 assert.equal(inspect(x.inputs).reason,"PHYSICAL_SHIP_NOT_READY");
 x.ships.set(10002,x.wingman);x.wingman.position.x=Infinity;
 assert.equal(inspect(x.inputs).reason,"PHYSICAL_SHIP_NOT_READY");
});
test("a follower in native warp must not accept a second competing fleet warp",()=>{
 const x=fixture();x.wingman.mode="WARP";
 assert.equal(inspect(x.inputs).reason,"FOLLOWER_ALREADY_WARPING");
 x.wingman.mode="STOP";x.wingman.pendingWarp={targetEntityID:88};
 assert.equal(inspect(x.inputs).reason,"FOLLOWER_ALREADY_WARPING");
});
test("no physical ship duplication or warp mutation occurs in read-only guard",()=>{
 const x=fixture(),old=JSON.stringify(x.wingman);
 assert.equal(eligible(x.inputs),true);
 assert.equal(JSON.stringify(x.wingman),old);
 assert.equal(x.ships.size,2);
});
test("accepted native warp event is not fabricated fleet arrival or a second ship",()=>{
 const x=fixture();
 const result=recordFollowerWarp({...x.inputs,result:{success:true},
  targetEntityID:44221,minimumRange:15000});
 assert.equal(result.status,"NATIVE_WARP_ORDER_ACCEPTED");
 assert.equal(result.arrivalVerified,false);
 assert.equal(result.followerShipID,10002);
 assert.equal(result.targetEntityID,44221);
 assert.equal(x.ships.size,2);
});
test("native warp command failure is not recorded as a successful warp",()=>{
 const x=fixture();
 const result=recordFollowerWarp({...x.inputs,
  result:{success:false,errorMsg:"SCRAMBLED"},targetEntityID:88001});
 assert.equal(result.status,"NATIVE_WARP_ORDER_FAILED");
 assert.equal(result.error,"SCRAMBLED");
 assert.equal(result.arrivalVerified,false);
});
test("commander and follower cannot refer to the same character or ship",()=>{
 const x=fixture();x.follower.characterID=x.commander.characterID;
 assert.equal(inspect(x.inputs).reason,"INVALID_MEMBER_ID");
 x.follower.characterID=5002;x.follower._space.shipID=10001;
 assert.equal(inspect(x.inputs).reason,"SHIP_ID_MISSING_OR_SHARED");
});
