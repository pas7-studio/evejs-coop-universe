import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {snapshot}=require("../integration/coopDuoPresence.cjs");
function fixture(){
 const ships=new Map([[101,{itemID:101,kind:"ship"}],
  [102,{itemID:102,kind:"ship"}]]);
 const alice={characterID:5001,socket:{destroyed:false},
  _space:{shipID:101,systemID:30000144,initialStateSent:true,
   visibleDynamicEntityIDs:new Set([101,102])}};
 const bob={characterID:5002,socket:{destroyed:false},
  _space:{shipID:102,systemID:30000144,initialStateSent:true,
   visibleDynamicEntityIDs:new Set([101,102])}};
 const scene={systemID:30000144,sessions:new Map([[1,alice],[2,bob]]),
  getEntityByID:id=>ships.get(id)||null};
 return {ships,alice,bob,scene};
}
test("two genuine in-space ships have reciprocal server-side visibility",()=>{
 const f=fixture(),s=snapshot(f.scene);
 assert.equal(s.status,"TWO_PILOTS_IN_SCENE");
 assert.equal(s.mutualVisibility,true);
 assert.deepEqual(s.pilots.map(p=>p.characterID),[5001,5002]);
});
test("old disconnected session never counts as the other active pilot",()=>{
 const f=fixture();f.bob.socket.destroyed=true;
 const s=snapshot(f.scene);
 assert.equal(s.status,"ONE_PILOT");
 assert.equal(s.mutualVisibility,false);
 assert.equal(s.pilots.length,1);
});
test("client not yet initialized Ballpark cannot pass reciprocal visibility",()=>{
 const f=fixture();f.bob._space.initialStateSent=false;
 const s=snapshot(f.scene);
 assert.equal(s.status,"ONE_PILOT");
 assert.equal(s.mutualVisibility,false);
});
test("client briefly attached to wrong system is not counted as an on-grid wingmate",()=>{
 const f=fixture();f.bob._space.systemID=30000142;
 assert.equal(snapshot(f.scene).status,"ONE_PILOT");
});
test("two active sessions for one character fail closed, never fabricate a unique duo",()=>{
 const f=fixture();
 const duplicate={...f.alice,_space:{...f.alice._space}};
 f.scene.sessions.set(3,duplicate);
 const s=snapshot(f.scene);
 assert.equal(s.status,"DUPLICATE_ACTIVE_CHARACTER_SESSION");
 assert.equal(s.mutualVisibility,false);
});
test("an invalid or missing physical hull cannot prove two players in space",()=>{
 const f=fixture();f.ships.set(102,{itemID:102,kind:"asteroidBelt"});
 const s=snapshot(f.scene);
 assert.equal(s.status,"NOT_READY");
 assert.equal(s.mutualVisibility,false);
});
